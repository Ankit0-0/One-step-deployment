import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { DeploymentResolver, MemoryCache, type KeyValueCache } from '../src/services/resolver.js';

const logger = pino({ level: 'silent' });

describe('DeploymentResolver', () => {
  it('caches lookups including negative results', async () => {
    const lookup = vi.fn(async (slug: string) =>
      slug === 'live'
        ? { currentDeploymentId: 'dep1' }
        : slug === 'new'
          ? { currentDeploymentId: null }
          : null,
    );
    const events: string[] = [];
    const resolver = new DeploymentResolver(new MemoryCache(), lookup, 30, logger, (r) =>
      events.push(r),
    );

    expect(await resolver.resolve('live')).toEqual({ status: 'ready', deploymentId: 'dep1' });
    expect(await resolver.resolve('live')).toEqual({ status: 'ready', deploymentId: 'dep1' });
    expect(await resolver.resolve('new')).toEqual({ status: 'pending' });
    expect(await resolver.resolve('nope')).toEqual({ status: 'unknown' });
    expect(await resolver.resolve('nope')).toEqual({ status: 'unknown' });

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(events).toEqual(['miss', 'hit', 'miss', 'miss', 'hit']);
  });

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers();
    try {
      const lookup = vi.fn(async () => ({ currentDeploymentId: 'dep1' }));
      const resolver = new DeploymentResolver(new MemoryCache(), lookup, 5, logger);
      await resolver.resolve('live');
      vi.advanceTimersByTime(6000);
      await resolver.resolve('live');
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the database when the cache is down', async () => {
    const broken: KeyValueCache = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => Promise.reject(new Error('redis down')),
    };
    const resolver = new DeploymentResolver(
      broken,
      async () => ({ currentDeploymentId: 'dep1' }),
      30,
      logger,
    );
    expect(await resolver.resolve('live')).toEqual({ status: 'ready', deploymentId: 'dep1' });
  });
});
