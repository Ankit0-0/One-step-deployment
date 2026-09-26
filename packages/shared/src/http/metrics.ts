import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface HttpMetrics {
  registry: Registry;
  /** Records latency and status per route; mount before routes. */
  middleware: RequestHandler;
  /** GET /metrics; requires `Authorization: Bearer <token>` when a token is configured. */
  handler: (token?: string) => RequestHandler;
}

export function createHttpMetrics(service: string): HttpMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by method, route and status',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const end = duration.startTimer();
    res.on('finish', () => {
      // Route patterns (not raw URLs) keep label cardinality bounded.
      const route = (req.route as { path?: string } | undefined)?.path;
      end({
        method: req.method,
        route: route
          ? `${req.baseUrl}${route}`
          : ((res.locals.metricsRoute as string | undefined) ?? 'unmatched'),
        status_code: String(res.statusCode),
      });
    });
    next();
  };

  const handler =
    (token?: string): RequestHandler =>
    (req, res, next) => {
      if (token && !bearerMatches(req.headers.authorization, token)) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
      }
      registry
        .metrics()
        .then((body) => {
          res.setHeader('Content-Type', registry.contentType);
          res.send(body);
        })
        .catch(next);
    };

  return { registry, middleware, handler };
}

function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
