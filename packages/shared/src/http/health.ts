import { Router } from 'express';

export type ReadinessCheck = () => Promise<unknown>;

/**
 * GET /healthz: process is alive.
 * GET /readyz: every dependency answers within the timeout; 503 otherwise.
 */
export function createHealthRouter(
  checks: Record<string, ReadinessCheck>,
  timeoutMs = 2000,
): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/readyz', async (_req, res) => {
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, 'ok'] as const;
        } catch {
          return [name, 'fail'] as const;
        }
      }),
    );
    const ok = results.every(([, r]) => r === 'ok');
    res
      .status(ok ? 200 : 503)
      .json({ status: ok ? 'ok' : 'fail', checks: Object.fromEntries(results) });
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}
