import type { Deployment, Project } from '@osd/db';
import {
  isTerminalStatus,
  proxySlugCacheKey,
  type DeploymentDto,
  type DeploymentLogDto,
} from '@osd/shared';
import type { Logger } from 'pino';
import { conflict, notFound, tooManyBuilds } from '../../lib/errors.js';
import type { DeploymentMetrics } from '../../lib/metrics.js';
import type { ProjectsRepository } from '../projects/projects.repository.js';
import type { BuildRunner } from '../runners/runner.js';
import type { DeploymentsRepository } from './deployments.repository.js';
import type { DeploymentHub } from './hub.js';
import { toDeploymentDto, toLogDto, toStatusEventDto } from './mappers.js';
import { planTransition, type StatusChange } from './transitions.js';

export interface DeploymentsServiceDeps {
  repo: DeploymentsRepository;
  projects: ProjectsRepository;
  runner: BuildRunner;
  hub: DeploymentHub;
  metrics: DeploymentMetrics;
  logger: Logger;
  /** Deletes the proxy's cached slug → deployment mapping. */
  invalidateSiteCache: (key: string) => Promise<unknown>;
  maxConcurrentBuilds: number;
}

export class DeploymentsService {
  constructor(private readonly deps: DeploymentsServiceDeps) {}

  async listForProject(userId: string, projectId: string): Promise<DeploymentDto[]> {
    const project = await this.ownedProject(userId, projectId);
    const list = await this.deps.repo.listForProject(project.id);
    return list.map((d) => toDeploymentDto(d, project.currentDeploymentId));
  }

  async get(userId: string, id: string): Promise<DeploymentDto> {
    const d = await this.deps.repo.findOwned(userId, id);
    if (!d) throw notFound('Deployment');
    return toDeploymentDto(d, d.project.currentDeploymentId);
  }

  async isOwner(userId: string, id: string): Promise<boolean> {
    return (await this.deps.repo.findOwned(userId, id)) !== null;
  }

  async logs(
    userId: string,
    id: string,
    query: { after?: string; limit: number },
  ): Promise<DeploymentLogDto[]> {
    if (!(await this.isOwner(userId, id))) throw notFound('Deployment');
    const rows = await this.deps.repo.logs(id, {
      after: query.after ? new Date(query.after) : undefined,
      limit: query.limit,
    });
    return rows.map(toLogDto);
  }

  /** QUEUED → runner.start. If the runner can't start, the deployment fails immediately. */
  async create(userId: string, projectId: string, requestId: string): Promise<DeploymentDto> {
    const project = await this.ownedProject(userId, projectId);
    const deployment = await this.deps.repo.createIfUnderLimit(
      userId,
      project.id,
      this.deps.maxConcurrentBuilds,
    );
    if (!deployment) throw tooManyBuilds(this.deps.maxConcurrentBuilds);
    this.deps.metrics.statusChanged('QUEUED');
    this.deps.hub.emit('status', toStatusEventDto(deployment));

    try {
      const { ref } = await this.deps.runner.start({
        deploymentId: deployment.id,
        gitUrl: project.gitUrl,
        requestId,
      });
      await this.deps.repo.setRunnerRef(deployment.id, ref);
    } catch (err) {
      this.deps.logger.error({ err, deploymentId: deployment.id }, 'runner failed to start build');
      await this.applyStatus(deployment.id, {
        status: 'FAILED',
        at: new Date(),
        errorMessage: 'Could not start the build',
      });
    }

    const fresh = await this.deps.repo.findById(deployment.id);
    return toDeploymentDto(fresh ?? deployment, project.currentDeploymentId);
  }

  async cancel(userId: string, id: string): Promise<DeploymentDto> {
    const d = await this.deps.repo.findOwned(userId, id);
    if (!d) throw notFound('Deployment');
    if (isTerminalStatus(d.status)) throw conflict('Deployment has already finished');

    const updated = await this.applyStatus(id, { status: 'CANCELED', at: new Date() });
    if (!updated) throw conflict('Deployment has already finished');
    if (d.runnerRef) {
      await this.deps.runner.stop(d.runnerRef).catch((err: unknown) => {
        this.deps.logger.warn({ err, deploymentId: id }, 'failed to stop build');
      });
    }
    return toDeploymentDto(updated, d.project.currentDeploymentId);
  }

  /** Points the project back at an earlier READY deployment. */
  async rollback(userId: string, projectId: string, deploymentId: string): Promise<Project> {
    const project = await this.ownedProject(userId, projectId);
    const d = await this.deps.repo.findById(deploymentId);
    if (!d || d.projectId !== project.id) throw notFound('Deployment');
    if (d.status !== 'READY') throw conflict('Only READY deployments can be rolled back to');
    const updated = await this.deps.projects.setCurrentDeployment(project.id, d.id);
    await this.invalidate(project.slug);
    this.deps.logger.info({ projectId, deploymentId }, 'rolled back');
    return updated;
  }

  /**
   * Apply a status change from the worker, the api (cancel) or the stale sweeper.
   * Returns the updated deployment, or null when the change is not a valid transition.
   */
  async applyStatus(id: string, change: StatusChange): Promise<Deployment | null> {
    const current = await this.deps.repo.findById(id);
    if (!current) return null;
    const update = planTransition(current, change);
    if (!update) {
      this.deps.logger.debug(
        { deploymentId: id, from: current.status, to: change.status },
        'ignored transition',
      );
      return null;
    }
    const applied = await this.deps.repo.applyTransition(current, update);
    if (!applied) return null;

    const updated = await this.deps.repo.findById(id);
    if (!updated) return null;
    this.deps.metrics.statusChanged(update.status);
    if (update.durationMs !== undefined)
      this.deps.metrics.buildFinished(update.status, update.durationMs);
    if (update.status === 'READY') await this.invalidate(current.project.slug);
    this.deps.hub.emit('status', toStatusEventDto(updated));
    return updated;
  }

  /** Fails builds that never reported a terminal status (worker crash, lost events). */
  async failStale(olderThan: Date): Promise<number> {
    const stale = await this.deps.repo.findStale(olderThan);
    let failed = 0;
    for (const d of stale) {
      const res = await this.applyStatus(d.id, {
        status: 'FAILED',
        at: new Date(),
        errorMessage: 'Build did not report back in time',
      });
      if (res) failed++;
    }
    return failed;
  }

  private async ownedProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.deps.projects.findOwned(userId, projectId);
    if (!project) throw notFound('Project');
    return project;
  }

  private async invalidate(slug: string): Promise<void> {
    await this.deps.invalidateSiteCache(proxySlugCacheKey(slug)).catch((err: unknown) => {
      this.deps.logger.warn({ err, slug }, 'failed to invalidate proxy cache');
    });
  }
}
