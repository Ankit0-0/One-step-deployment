import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { ApiError } from '@osd/shared';

/** Per-IP limiter backed by Redis so limits hold across api instances. */
export function ipRateLimit(
  redis: Redis,
  options: { prefix: string; windowMs: number; limit: number },
): RequestHandler {
  const body: ApiError = {
    error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
  };
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: body,
    store: new RedisStore({
      prefix: options.prefix,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
  });
}
