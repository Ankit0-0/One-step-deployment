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

  /**
   * Creates the project, or returns null when the owner is a guest already at `guestLimit`.
   * A per-user advisory lock makes the count-then-insert atomic across concurrent requests.
   */
  create(
    userId: string,
    data: { name: string; slug: string; gitUrl: string },
    guestLimit: number,
  ): Promise<Project | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { isGuest: true } });
      if (owner?.isGuest && (await tx.project.count({ where: { userId } })) >= guestLimit) {
        return null;
      }
      return tx.project.create({ data: { ...data, userId } });
    });
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
