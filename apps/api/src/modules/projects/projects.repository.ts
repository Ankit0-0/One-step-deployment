import type { PrismaClient, Project } from '@osd/db';

export class ProjectsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listForUser(userId: string): Promise<Project[]> {
    return this.prisma.project.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /** Ownership is part of the query, so another user's project is indistinguishable from none. */
  findOwned(userId: string, id: string): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { id, userId } });
  }

  create(userId: string, data: { name: string; slug: string; gitUrl: string }): Promise<Project> {
    return this.prisma.project.create({ data: { ...data, userId } });
  }

  update(id: string, data: { name?: string; gitUrl?: string }): Promise<Project> {
    return this.prisma.project.update({ where: { id }, data });
  }

  setCurrentDeployment(id: string, deploymentId: string): Promise<Project> {
    return this.prisma.project.update({
      where: { id },
      data: { currentDeploymentId: deploymentId },
    });
  }
}
