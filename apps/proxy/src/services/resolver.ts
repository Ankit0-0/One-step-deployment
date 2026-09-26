import type { Logger } from 'pino';
import { proxySlugCacheKey } from '@osd/shared';

export type Resolution =
  { status: 'ready'; deploymentId: string } | { status: 'pending' } | { status: 'unknown' };

export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Looks a slug up in the database: null = no such project, { currentDeploymentId: null } = nothing READY yet. */
export type ProjectLookup = (
  slug: string,
) => Promise<{ currentDeploymentId: string | null } | null>;

const PENDING = '!pending';
const UNKNOWN = '!unknown';

/**
 * slug → current READY deployment, cached with a short TTL (negative results too, so unknown hosts
 * can't hammer the database). The api deletes the key when a project's current deployment changes.
 * A cache outage degrades to direct database lookups instead of failing requests.
 */
export class DeploymentResolver {
  constructor(
    private readonly cache: KeyValueCache,
    private readonly lookup: ProjectLookup,
    private readonly ttlSeconds: number,
    private readonly logger: Logger,
    private readonly onCache: (result: 'hit' | 'miss') => void = () => {},
  ) {}

  async resolve(slug: string): Promise<Resolution> {
    const key = proxySlugCacheKey(slug);
    try {
      const cached = await this.cache.get(key);
      if (cached !== null) {
        this.onCache('hit');
        return decode(cached);
      }
    } catch (err) {
      this.logger.warn({ err }, 'slug cache read failed');
    }
    this.onCache('miss');

    const project = await this.lookup(slug);
    const value = !project ? UNKNOWN : (project.currentDeploymentId ?? PENDING);
    try {
      await this.cache.set(key, value, this.ttlSeconds);
    } catch (err) {
      this.logger.warn({ err }, 'slug cache write failed');
    }
    return decode(value);
  }
}

function decode(value: string): Resolution {
  if (value === UNKNOWN) return { status: 'unknown' };
  if (value === PENDING) return { status: 'pending' };
  return { status: 'ready', deploymentId: value };
}

export class MemoryCache implements KeyValueCache {
  readonly entries = new Map<string, { value: string; expiresAt: number }>();

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < Date.now()) return Promise.resolve(null);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }
}

export function redisCache(redis: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
}): KeyValueCache {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value, 'EX', ttl);
    },
  };
}
