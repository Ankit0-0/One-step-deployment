import type { Server as HttpServer } from 'node:http';
import { parse as parseCookie } from 'cookie';
import type { Logger } from 'pino';
import { Server } from 'socket.io';
import { SOCKET_EVENTS, deploymentChannel, joinDeploymentPayloadSchema } from '@osd/shared';
import type { SessionTokens } from '../../lib/jwt.js';
import { SESSION_COOKIE } from '../../lib/session-cookie.js';
import type { DeploymentsService } from '../deployments/deployments.service.js';
import type { DeploymentHub } from '../deployments/hub.js';

type Ack = (res: { ok: boolean; error?: string }) => void;

/**
 * socket.io authenticated with the same session cookie as the REST API. A socket can only join
 * the room of a deployment its user owns; the hub pushes persisted logs and status changes there.
 */
export function attachRealtime(
  httpServer: HttpServer,
  deps: {
    webOrigin: string;
    tokens: SessionTokens;
    deployments: DeploymentsService;
    hub: DeploymentHub;
    logger: Logger;
  },
): Server {
  const io = new Server(httpServer, {
    cors: { origin: deps.webOrigin, credentials: true },
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });

  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const userId = deps.tokens.verify(cookies[SESSION_COOKIE]);
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    (socket.data as { userId: string }).userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data as { userId: string };

    socket.on(SOCKET_EVENTS.JOIN_DEPLOYMENT, async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      const parsed = joinDeploymentPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: 'invalid payload' });
      try {
        if (!(await deps.deployments.isOwner(userId, parsed.data.deploymentId))) {
          return reply({ ok: false, error: 'not found' });
        }
        await socket.join(deploymentChannel(parsed.data.deploymentId));
        reply({ ok: true });
      } catch (err) {
        deps.logger.error({ err }, 'socket join failed');
        reply({ ok: false, error: 'internal error' });
      }
    });

    socket.on(SOCKET_EVENTS.LEAVE_DEPLOYMENT, async (payload: unknown) => {
      const parsed = joinDeploymentPayloadSchema.safeParse(payload);
      if (parsed.success) await socket.leave(deploymentChannel(parsed.data.deploymentId));
    });
  });

  deps.hub.on('logs', (logs) => {
    for (const log of logs)
      io.to(deploymentChannel(log.deploymentId)).emit(SOCKET_EVENTS.DEPLOYMENT_LOG, log);
  });
  deps.hub.on('status', (status) => {
    io.to(deploymentChannel(status.deploymentId)).emit(SOCKET_EVENTS.DEPLOYMENT_STATUS, status);
  });

  return io;
}
