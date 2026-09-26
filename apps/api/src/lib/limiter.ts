import type { Redis } from 'ioredis';

/** Fixed-window counter in Redis, for limits keyed by something other than IP (e.g. email). */
export class FixedWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly limit: number,
    private readonly windowSeconds: number,
  ) {}

  /** Counts a hit; returns false once the limit for this window is exceeded. */
  async hit(key: string): Promise<boolean> {
    const redisKey = `${this.prefix}${key}`;
    const results = await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, this.windowSeconds, 'NX')
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    return count <= this.limit;
  }
}
