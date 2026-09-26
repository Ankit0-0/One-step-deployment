import { createServer, type Server as HttpServer } from 'node:http';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import { createApp } from './app.js';
import type { AppContext } from './context.js';
import { DeploymentEventIngestor } from './modules/deployments/ingestor.js';
import { attachRealtime } from './modules/realtime/socket.js';

export interface RunningApi {
  http: HttpServer;
  io: SocketServer;
  ingestor: DeploymentEventIngestor;
  close(): Promise<void>;
}

/**
 * HTTP + socket.io + worker event ingestion + stale-build sweeper.
 * `subscriber` is a dedicated Redis connection for pub/sub.
 */
export async function startApi(
  ctx: AppContext,
  options: { port: number; subscriber: Redis; staleAfterMs: number; sweepIntervalMs?: number },
): Promise<RunningApi> {
  const http = createServer(createApp(ctx));
  const io = attachRealtime(http, {
    webOrigin: ctx.config.webOrigin,
    tokens: ctx.tokens,
    deployments: ctx.services.deployments,
    hub: ctx.hub,
    logger: ctx.logger,
  });

  const ingestor = new DeploymentEventIngestor({
    repo: ctx.repos.deployments,
    service: ctx.services.deployments,
    hub: ctx.hub,
    logger: ctx.logger,
  });
  await ingestor.start(options.subscriber);

  const sweeper = setInterval(() => {
    ctx.services.deployments
      .failStale(new Date(Date.now() - options.staleAfterMs))
      .then((n) => n > 0 && ctx.logger.warn({ count: n }, 'failed stale deployments'))
      .catch((err: unknown) => ctx.logger.error({ err }, 'stale sweep failed'));
  }, options.sweepIntervalMs ?? 60_000);
  sweeper.unref();

  await new Promise<void>((resolve) => http.listen(options.port, resolve));

  return {
    http,
    io,
    ingestor,
    async close() {
      clearInterval(sweeper);
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
      await ingestor.stop();
      await options.subscriber.quit().catch(() => {});
    },
  };
}
