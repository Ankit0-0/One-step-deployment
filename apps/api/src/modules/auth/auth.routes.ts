import { Router } from 'express';
import type { Redis } from 'ioredis';
import { requestCodeBodySchema, verifyCodeBodySchema } from '@osd/shared';
import type { SessionTokens } from '../../lib/jwt.js';
import {
  clearSessionCookie,
  setSessionCookie,
  type CookieConfig,
} from '../../lib/session-cookie.js';
import { parse } from '../../lib/validate.js';
import { currentUserId, requireAuth } from '../../middleware/auth.js';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { toUserDto, type AuthService } from './auth.service.js';

export function authRoutes(deps: {
  auth: AuthService;
  tokens: SessionTokens;
  cookie: CookieConfig;
  redis: Redis;
  rateLimitPrefix: string;
}): Router {
  const router = Router();
  const fifteenMinutes = 15 * 60 * 1000;

  router.post(
    '/request-code',
    ipRateLimit(deps.redis, {
      prefix: `${deps.rateLimitPrefix}code-ip:`,
      windowMs: fifteenMinutes,
      limit: 20,
    }),
    async (req, res) => {
      const { email } = parse(requestCodeBodySchema, req.body);
      await deps.auth.requestCode(email);
      res.status(202).json({ ok: true });
    },
  );

  router.post(
    '/verify',
    ipRateLimit(deps.redis, {
      prefix: `${deps.rateLimitPrefix}verify-ip:`,
      windowMs: fifteenMinutes,
      limit: 50,
    }),
    async (req, res) => {
      const { email, code } = parse(verifyCodeBodySchema, req.body);
      const user = await deps.auth.verify(email, code);
      setSessionCookie(res, deps.tokens.sign(user.id), deps.cookie);
      res.json({ user: toUserDto(user) });
    },
  );

  router.post(
    '/guest',
    ipRateLimit(deps.redis, {
      prefix: `${deps.rateLimitPrefix}guest-ip:`,
      windowMs: 60 * 60 * 1000,
      limit: 10,
    }),
    async (_req, res) => {
      const user = await deps.auth.loginAsGuest();
      const ttlSeconds = deps.auth.sessionTtlSeconds(user, deps.cookie.ttlSeconds);
      setSessionCookie(res, deps.tokens.sign(user.id, ttlSeconds), {
        ...deps.cookie,
        ttlSeconds,
      });
      res.status(201).json({ user: toUserDto(user) });
    },
  );

  router.get('/me', requireAuth(deps.tokens), async (_req, res) => {
    const user = await deps.auth.me(currentUserId(res));
    res.json({ user: toUserDto(user) });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res, deps.cookie);
    res.status(204).end();
  });

  return router;
}
