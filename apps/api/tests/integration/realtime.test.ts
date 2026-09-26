import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_EVENTS, deploymentChannel, type DeploymentLogDto } from '@osd/shared';
import { startApi, type RunningApi } from '../../src/server.js';
import { createProject, createTestEnv, hasInfra, login, type TestEnv } from '../helpers.js';

describe.skipIf(!hasInfra)('socket.io', () => {
  let env: TestEnv;
  let api: RunningApi;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    env = await createTestEnv();
    api = await startApi(env.ctx, {
      port: 0,
      subscriber: new Redis(process.env.REDIS_URL!),
      staleAfterMs: 3600_000,
    });
    url = `http://127.0.0.1:${(api.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await api.close();
    await env.close();
  });

  async function sessionCookie() {
    const session = await login(env);
    const res = await session.agent.get('/auth/me');
    const cookie = String(res.request.cookies ?? '');
    return { ...session, cookie: cookie || undefined };
  }

  function socketFor(cookie?: string) {
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: cookie ? { Cookie: cookie } : {},
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  const join = (socket: Socket, deploymentId: string) =>
    socket.emitWithAck(SOCKET_EVENTS.JOIN_DEPLOYMENT, { deploymentId }) as Promise<{ ok: boolean }>;

  it('rejects connections without a session', async () => {
    const socket = socketFor();
    const err = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
  });

  it('streams logs and status to the owner only', async () => {
    const owner = await sessionCookie();
    const intruder = await sessionCookie();
    const project = await createProject(owner.agent);
    const d = (await owner.agent.post(`/projects/${project.id}/deployments`).expect(201)).body
      .deployment;

    const ownerSocket = socketFor(owner.cookie);
    const intruderSocket = socketFor(intruder.cookie);
    expect(await join(ownerSocket, d.id)).toEqual({ ok: true });
    expect(await join(intruderSocket, d.id)).toEqual({ ok: false, error: 'not found' });
    expect(await join(ownerSocket, 'bad id with spaces'.repeat(10))).toMatchObject({ ok: false });

    const received: DeploymentLogDto[] = [];
    const leaked: unknown[] = [];
    ownerSocket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, (l: DeploymentLogDto) => received.push(l));
    intruderSocket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, (l: unknown) => leaked.push(l));
    const statusSeen = new Promise((resolve) =>
      ownerSocket.on(SOCKET_EVENTS.DEPLOYMENT_STATUS, resolve),
    );

    const ts = new Date().toISOString();
    api.ingestor.handle(
      deploymentChannel(d.id),
      JSON.stringify({ type: 'status', deploymentId: d.id, ts, status: 'BUILDING' }),
    );
    api.ingestor.handle(
      deploymentChannel(d.id),
      JSON.stringify({ type: 'log', deploymentId: d.id, ts, level: 'info', message: 'hello' }),
    );
    await api.ingestor.drain();

    await expect.poll(() => received.map((l) => l.message), { timeout: 3000 }).toEqual(['hello']);
    expect(await statusSeen).toMatchObject({ deploymentId: d.id, status: 'BUILDING' });
    expect(leaked).toEqual([]);
  });
});
