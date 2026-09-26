import type {
  Deployment,
  DeploymentLog,
  DeploymentStatus,
  LogLevel,
  Prisma,
  PrismaClient,
} from '@osd/db';
import type { TransitionUpdate } from './transitions.js';

export const ACTIVE_STATUSES: DeploymentStatus[] = ['QUEUED', 'BUILDING', 'UPLOADING'];

export type DeploymentWithProject = Deployment & {
  project: {
    id: string;
    userId: string;
    slug: string;
    gitUrl: string;
    currentDeploymentId: string | null;
  };
};

const projectSelect = {
  select: { id: true, userId: true, slug: true, gitUrl: true, currentDeploymentId: true },
} as const;

export class DeploymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<DeploymentWithProject | null> {
    return this.prisma.deployment.findUnique({
      where: { id },
      include: { project: projectSelect },
    });
  }

  /** Ownership is part of the query. */
  findOwned(userId: string, id: string): Promise<DeploymentWithProject | null> {
    return this.prisma.deployment.findFirst({
      where: { id, project: { userId } },
      include: { project: projectSelect },
    });
  }

  listForProject(projectId: string, take = 50): Promise<Deployment[]> {
    return this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Creates a QUEUED deployment unless the user already has `limit` active builds.
   * A per-user advisory lock makes the count-then-insert atomic across concurrent requests.
   */
  createIfUnderLimit(userId: string, projectId: string, limit: number): Promise<Deployment | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const active = await tx.deployment.count({
        where: { status: { in: ACTIVE_STATUSES }, project: { userId } },
      });
      if (active >= limit) return null;
      return tx.deployment.create({ data: { projectId } });
    });
  }

  async setRunnerRef(id: string, runnerRef: string): Promise<void> {
    await this.prisma.deployment.update({ where: { id }, data: { runnerRef } });
  }

  /**
   * Compare-and-set on status so concurrent events can't both win. On READY the project's current
   * deployment moves too, unless a newer deployment is already current.
   */
  applyTransition(
    deployment: { id: string; status: DeploymentStatus; createdAt: Date; projectId: string },
    update: TransitionUpdate,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.deployment.updateMany({
        where: { id: deployment.id, status: deployment.status },
        data: update,
      });
      if (count !== 1) return false;
      if (update.status === 'READY') {
        await tx.project.updateMany({
          where: {
            id: deployment.projectId,
            OR: [
              { currentDeploymentId: null },
              { currentDeployment: { createdAt: { lte: deployment.createdAt } } },
            ],
          },
          data: { currentDeploymentId: deployment.id },
        });
      }
      return true;
    });
  }

  findStale(before: Date): Promise<Deployment[]> {
    return this.prisma.deployment.findMany({
      where: { status: { in: ACTIVE_STATUSES }, createdAt: { lt: before } },
      take: 100,
    });
  }

  logs(deploymentId: string, options: { after?: Date; limit: number }): Promise<DeploymentLog[]> {
    return this.prisma.deploymentLog.findMany({
      where: { deploymentId, ...(options.after && { ts: { gt: options.after } }) },
      orderBy: [{ ts: 'asc' }, { id: 'asc' }],
      take: options.limit,
    });
  }

  async existingIds(ids: string[]): Promise<Set<string>> {
    const rows = await this.prisma.deployment.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  insertLogs(
    rows: Array<{ deploymentId: string; ts: Date; level: LogLevel; message: string }>,
  ): Promise<DeploymentLog[]> {
    return this.prisma.deploymentLog.createManyAndReturn({
      data: rows satisfies Prisma.DeploymentLogCreateManyInput[],
    });
  }
}
