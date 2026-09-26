import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { Counter } from 'prom-client';
import {
  createHealthRouter,
  createHttpMetrics,
  requestIdFrom,
  type ReadinessCheck,
} from '@osd/shared/http';
import type { ObjectStore } from '@osd/storage';
import { matchHost } from './lib/host.js';
import { NOT_FOUND_PAGE } from './routes/pages.js';
import { siteHandler } from './routes/site.js';
import { DeploymentResolver, type KeyValueCache, type ProjectLookup } from './services/resolver.js';

export interface ProxyAppDeps {
  rootDomain: string;
  cache: KeyValueCache;
  lookup: ProjectLookup;
  cacheTtlSeconds: number;
  store: ObjectStore;
  logger: Logger;
  readiness: Record<string, ReadinessCheck>;
  metricsToken?: string;
  trustProxy?: boolean;
  production?: boolean;
}

export function createApp(deps: ProxyAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy ?? false);

  const metrics = createHttpMetrics('proxy');
  const cacheLookups = new Counter({
    name: 'proxy_slug_cache_total',
    help: 'Slug resolution cache lookups',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  });
  const resolver = new DeploymentResolver(
    deps.cache,
    deps.lookup,
    deps.cacheTtlSeconds,
    deps.logger,
    (result) => cacheLookups.inc({ result }),
  );
  const serveSite = siteHandler({ resolver, store: deps.store, logger: deps.logger });

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const id = requestIdFrom(req);
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(metrics.middleware);

  // Hosted sites are arbitrary user content, so no CSP is imposed; the rest of helmet's headers apply.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      strictTransportSecurity: deps.production ? undefined : false,
    }),
  );

  const internal = express.Router();
  internal.use(createHealthRouter(deps.readiness));
  internal.get('/metrics', metrics.handler(deps.metricsToken));

  app.use((req, res, next) => {
    const host = matchHost(req.headers.host, deps.rootDomain);
    if (host.kind === 'site') {
      void serveSite(req, res, next, host.slug);
      return;
    }
    if (host.kind === 'invalid') {
      res.status(404).type('html').send(NOT_FOUND_PAGE);
      return;
    }
    internal(req, res, next);
  });

  app.use((_req, res) => {
    res.status(404).type('html').send(NOT_FOUND_PAGE);
  });

  const onError: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    req.log.error({ err }, 'proxy error');
    res.status(502).type('text').send('Bad gateway');
  };
  app.use(onError);

  return app;
}
