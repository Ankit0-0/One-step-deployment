import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createHealthRouter, requestIdFrom } from '@osd/shared/http';
import type { AppContext } from './context.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { ipRateLimit } from './middleware/rate-limit.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { deploymentRoutes } from './modules/deployments/deployments.routes.js';
import { projectRoutes } from './modules/projects/projects.routes.js';

export function createApp(ctx: AppContext): Express {
  const { config } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req, res) => {
        const id = requestIdFrom(req);
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' },
    }),
  );
  app.use(ctx.httpMetrics.middleware);
  app.use(helmet());
  app.use(
    cors({
      // Only the dashboard origin gets CORS headers; any other origin gets none.
      origin: (origin, cb) => cb(null, origin === config.webOrigin ? origin : false),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.use(
    createHealthRouter({
      db: () => ctx.prisma.$queryRaw`SELECT 1`,
      redis: () => ctx.redis.ping(),
      storage: () => ctx.store.ping(),
    }),
  );
  app.get('/metrics', ctx.httpMetrics.handler(config.metricsToken));

  app.use(
    ipRateLimit(ctx.redis, {
      prefix: `${config.rateLimitPrefix}api:`,
      windowMs: 60_000,
      limit: 300,
    }),
  );

  const auth = requireAuth(ctx.tokens);
  app.use(
    '/auth',
    authRoutes({
      auth: ctx.services.auth,
      tokens: ctx.tokens,
      cookie: ctx.cookie,
      redis: ctx.redis,
      rateLimitPrefix: config.rateLimitPrefix,
    }),
  );
  app.use('/projects', auth, projectRoutes(ctx.services));
  app.use('/deployments', auth, deploymentRoutes(ctx.services));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
