import type { Logger } from 'pino';
import type { PrismaClient } from '@osd/db';
import { proxySlugCacheKey } from '@osd/shared';
import { deploymentPrefix, type ObjectStore } from '@osd/storage';
import { ACTIVE_STATUSES } from '../deployments/deployments.repository.js';
import type { BuildRunner } from '../runners/runner.js';

const BATCH_SIZE = 50;

/**
 * Deletes expired guest accounts and everything they own: running builds are stopped, built
 * files are removed from storage, then the user row goes (projects, deployments and logs
 * cascade) and the proxy cache for their sites is dropped. Storage is cleared before the row,
 * so a failure leaves the guest in place to be retried on the next run.
 */
export class GuestCleanup {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      store: ObjectStore;
      runner: BuildRunner;
      invalidateSiteCache: (key: string) => Promise<unknown>;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  /** Returns how many guest accounts were deleted. */
  async run(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    let deleted = 0;
    for (;;) {
      const guests = await this.deps.prisma.user.findMany({
        where: { isGuest: true, expiresAt: { lte: now } },
        select: {
          id: true,
          projects: {
            select: {
              slug: true,
              deployments: { select: { id: true, status: true, runnerRef: true } },
            },
          },
        },
        orderBy: { expiresAt: 'asc' },
        take: BATCH_SIZE,
      });
      let deletedThisBatch = 0;
      for (const guest of guests) {
        try {
          await this.deleteGuest(guest);
          deletedThisBatch++;
        } catch (err) {
          this.deps.logger.error({ err, userId: guest.id }, 'failed to delete expired guest');
        }
      }
      deleted += deletedThisBatch;
      // A short batch means we're done; a batch with no progress means every one failed.
      if (guests.length < BATCH_SIZE || deletedThisBatch === 0) return deleted;
    }
  }

  private async deleteGuest(guest: {
    id: string;
    projects: Array<{
      slug: string;
      deployments: Array<{ id: string; status: string; runnerRef: string | null }>;
    }>;
  }): Promise<void> {
    const { runner, store, prisma, logger } = this.deps;
    const deployments = guest.projects.flatMap((p) => p.deployments);

    for (const d of deployments) {
      if (d.runnerRef && (ACTIVE_STATUSES as string[]).includes(d.status)) {
        await runner.stop(d.runnerRef).catch((err: unknown) => {
          logger.warn({ err, deploymentId: d.id }, 'failed to stop guest build');
        });
      }
    }
    let files = 0;
    for (const d of deployments) files += await store.deletePrefix(deploymentPrefix(d.id));

    await prisma.user.deleteMany({ where: { id: guest.id, isGuest: true } });

    for (const p of guest.projects) {
      await this.deps.invalidateSiteCache(proxySlugCacheKey(p.slug)).catch((err: unknown) => {
        logger.warn({ err, slug: p.slug }, 'failed to invalidate proxy cache');
      });
    }
    logger.info(
      {
        userId: guest.id,
        projects: guest.projects.length,
        deployments: deployments.length,
        files,
      },
      'deleted expired guest',
    );
  }
}
