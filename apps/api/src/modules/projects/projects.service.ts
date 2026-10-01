import { Prisma, type Project } from '@osd/db';
import type { CreateProjectBody, ProjectDto, UpdateProjectBody } from '@osd/shared';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import type { ProjectsRepository } from './projects.repository.js';

export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly siteUrlTemplate: string,
    private readonly guestMaxProjects: number,
  ) {}

  siteUrl(slug: string): string {
    return this.siteUrlTemplate.replace('{slug}', slug);
  }

  toDto(project: Project): ProjectDto {
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      gitUrl: project.gitUrl,
      currentDeploymentId: project.currentDeploymentId,
      url: this.siteUrl(project.slug),
      createdAt: project.createdAt.toISOString(),
    };
  }

  list(userId: string): Promise<Project[]> {
    return this.repo.listForUser(userId);
  }

  async getOwned(userId: string, id: string): Promise<Project> {
    const project = await this.repo.findOwned(userId, id);
    if (!project) throw notFound('Project');
    return project;
  }

  async create(userId: string, body: CreateProjectBody): Promise<Project> {
    let project: Project | null;
    try {
      project = await this.repo.create(userId, body, this.guestMaxProjects);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('That slug is already taken');
      }
      throw err;
    }
    if (!project) {
      throw forbidden(
        `Guest accounts can have at most ${this.guestMaxProjects} projects. Sign in with email for more.`,
      );
    }
    return project;
  }

  async update(userId: string, id: string, body: UpdateProjectBody): Promise<Project> {
    await this.getOwned(userId, id);
    return this.repo.update(id, body);
  }
}
