import { Redis } from 'ioredis';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deploymentChannel,
  proxySlugCacheKey,
  type DeploymentLogDto,
  type WorkerEvent,
} from '@osd/shared';
import { DeploymentEventIngestor } from '../../src/modules/deployments/ingestor.js';
import { createProject, createTestEnv, hasInfra, login, type TestEnv } from '../helpers.js';

type Agent = ReturnType<typeof request.agent>;

describe.skipIf(!hasInfra)('deployments', () => {
  let env: TestEnv;
  let ingestor: DeploymentEventIngestor;

  beforeAll(async () => {
    env = await createTestEnv();
    ingestor = new DeploymentEventIngestor(
      {
        repo: env.ctx.repos.deployments,
        service: env.ctx.services.deployments,
        hub: env.ctx.hub,
        logger: pino({ level: 'silent' }),
      },
      { maxBatch: 3 },
    );
  });
  afterAll(async () => {
    await env.close();
  });

  const ts = () => new Date().toISOString();
  const send = (event: WorkerEvent) =>
    ingestor.handle(deploymentChannel(event.deploymentId), JSON.stringify(event));
  const status = (
    deploymentId: string,
    s: WorkerEvent & { type: 'status' } extends infer E
      ? E extends { status: infer S }
        ? S
        : never
      : never,
    extra = {},
  ) => send({ type: 'status', deploymentId, ts: ts(), status: s, ...extra });
  const log = (deploymentId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') =>
    send({ type: 'log', deploymentId, ts: ts(), level, message });

  async function deploy(agent: Agent, projectId: string) {
    const res = await agent.post(`/projects/${projectId}/deployments`).expect(201);
    return res.body.deployment as { id: string; status: string };
  }

  it('queues a deployment and starts the runner with the request id', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const res = await agent
      .post(`/projects/${project.id}/deployments`)
      .set('X-Request-Id', 'req-abc')
      .expect(201);
    expect(res.body.deployment).toMatchObject({
      status: 'QUEUED',
      projectId: project.id,
      isCurrent: false,
    });
    const started = env.runner.started.find((s) => s.deploymentId === res.body.deployment.id);
    expect(started).toEqual({
      deploymentId: res.body.deployment.id,
      gitUrl: 'https://github.com/octocat/Hello-World',
      requestId: 'req-abc',
    });
    const row = await env.prisma.deployment.findUniqueOrThrow({
      where: { id: res.body.deployment.id },
    });
    expect(row.runnerRef).toBe(`ref-${row.id}`);
  });

  it('fails the deployment when the runner cannot start', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    env.runner.failNextStart = true;
    const d = await deploy(agent, project.id);
    expect(d).toMatchObject({ status: 'FAILED', errorMessage: 'Could not start the build' });
  });

  it('limits concurrent builds per user', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => agent.post(`/projects/${project.id}/deployments`)),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 429, 429]);
    expect(results.find((r) => r.status === 429)?.body.error.code).toBe('TOO_MANY_BUILDS');

    // Finishing one frees a slot.
    const first = results.find((r) => r.status === 201)!.body.deployment.id as string;
    status(first, 'FAILED');
    await ingestor.drain();
    await agent.post(`/projects/${project.id}/deployments`).expect(201);
  });

  it('moves through the state machine, persists logs and goes live on READY', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);
    await env.redis.set(proxySlugCacheKey(project.slug), '!pending');

    const emitted: DeploymentLogDto[] = [];
    const statuses: string[] = [];
    env.ctx.hub.on('logs', (l) => emitted.push(...l.filter((x) => x.deploymentId === d.id)));
    env.ctx.hub.on('status', (s) => s.deploymentId === d.id && statuses.push(s.status));

    status(d.id, 'BUILDING');
    for (let i = 1; i <= 5; i++) log(d.id, `line ${i}`);
    log(d.id, 'npm WARN deprecated', 'warn');
    status(d.id, 'UPLOADING', { commitSha: 'a'.repeat(40) });
    log(d.id, 'uploaded');
    status(d.id, 'READY', { commitSha: 'a'.repeat(40) });
    await ingestor.drain();

    const deployment = (await agent.get(`/deployments/${d.id}`).expect(200)).body.deployment;
    expect(deployment).toMatchObject({
      status: 'READY',
      commitSha: 'a'.repeat(40),
      isCurrent: true,
    });
    expect(deployment.durationMs).toBeGreaterThanOrEqual(0);
    expect(deployment.startedAt).not.toBeNull();
    expect(deployment.finishedAt).not.toBeNull();

    const logs = (await agent.get(`/deployments/${d.id}/logs`).expect(200)).body
      .logs as DeploymentLogDto[];
    expect(logs.map((l) => l.message)).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'npm WARN deprecated',
      'uploaded',
    ]);
    expect(logs[5]!.level).toBe('warn');
    expect(emitted.map((l) => l.message)).toEqual(logs.map((l) => l.message));
    expect(statuses).toEqual(['BUILDING', 'UPLOADING', 'READY']);

    const proj = (await agent.get(`/projects/${project.id}`).expect(200)).body.project;
    expect(proj.currentDeploymentId).toBe(d.id);
    expect(await env.redis.get(proxySlugCacheKey(project.slug))).toBeNull();
  });

  it('pages logs with ?after', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      send({
        type: 'log',
        deploymentId: d.id,
        ts: new Date(base + i * 1000).toISOString(),
        level: 'info',
        message: `m${i}`,
      });
    }
    await ingestor.drain();
    const after = new Date(base).toISOString();
    const res = await agent.get(`/deployments/${d.id}/logs`).query({ after, limit: 1 }).expect(200);
    expect(res.body.logs.map((l: DeploymentLogDto) => l.message)).toEqual(['m1']);
    await agent.get(`/deployments/${d.id}/logs`).query({ limit: 0 }).expect(400);
  });

  it('ignores invalid transitions, duplicate events and forged channels', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);

    status(d.id, 'READY'); // QUEUED → READY is not allowed
    ingestor.handle(
      deploymentChannel('someoneelse0000000000000'),
      JSON.stringify({ type: 'status', deploymentId: d.id, ts: ts(), status: 'FAILED' }),
    );
    ingestor.handle(deploymentChannel(d.id), '{not json');
    ingestor.handle(
      deploymentChannel(d.id),
      JSON.stringify({ type: 'status', deploymentId: d.id, ts: ts(), status: 'HACKED' }),
    );
    log('does-not-exist-000000000', 'orphan');
    await ingestor.drain();
    expect((await agent.get(`/deployments/${d.id}`)).body.deployment.status).toBe('QUEUED');

    status(d.id, 'BUILDING');
    status(d.id, 'BUILDING');
    status(d.id, 'FAILED', { errorMessage: 'npm exited with code 1' });
    status(d.id, 'READY');
    await ingestor.drain();
    const final = (await agent.get(`/deployments/${d.id}`)).body.deployment;
    expect(final).toMatchObject({
      status: 'FAILED',
      errorMessage: 'npm exited with code 1',
      isCurrent: false,
    });
  });

  it('does not let an older build replace a newer live deployment', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const older = await deploy(agent, project.id);
    const newer = await deploy(agent, project.id);
    for (const id of [newer.id, older.id]) {
      status(id, 'BUILDING');
      status(id, 'UPLOADING');
      status(id, 'READY');
    }
    await ingestor.drain();
    const proj = (await agent.get(`/projects/${project.id}`)).body.project;
    expect(proj.currentDeploymentId).toBe(newer.id);
  });

  it('cancels an active deployment and stops the runner', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);
    const res = await agent.post(`/deployments/${d.id}/cancel`).expect(200);
    expect(res.body.deployment.status).toBe('CANCELED');
    expect(env.runner.stopped).toContain(`ref-${d.id}`);

    // Late worker events are ignored after cancel.
    status(d.id, 'BUILDING');
    await ingestor.drain();
    expect((await agent.get(`/deployments/${d.id}`)).body.deployment.status).toBe('CANCELED');
    await agent.post(`/deployments/${d.id}/cancel`).expect(409);
  });

  it('rolls back to an earlier READY deployment only', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const first = await deploy(agent, project.id);
    for (const s of ['BUILDING', 'UPLOADING', 'READY'] as const) status(first.id, s);
    await ingestor.drain();
    const second = await deploy(agent, project.id);
    for (const s of ['BUILDING', 'UPLOADING', 'READY'] as const) status(second.id, s);
    const failed = await deploy(agent, project.id);
    status(failed.id, 'FAILED');
    await ingestor.drain();
    expect((await agent.get(`/projects/${project.id}`)).body.project.currentDeploymentId).toBe(
      second.id,
    );

    const res = await agent
      .post(`/projects/${project.id}/rollback`)
      .send({ deploymentId: first.id })
      .expect(200);
    expect(res.body.project.currentDeploymentId).toBe(first.id);

    await agent
      .post(`/projects/${project.id}/rollback`)
      .send({ deploymentId: failed.id })
      .expect(409);
    await agent.post(`/projects/${project.id}/rollback`).send({}).expect(400);

    const history = (await agent.get(`/projects/${project.id}/deployments`).expect(200)).body
      .deployments;
    expect(history.map((h: { id: string }) => h.id)).toEqual([failed.id, second.id, first.id]);
    expect(history.find((h: { id: string }) => h.id === first.id).isCurrent).toBe(true);
  });

  it('enforces ownership on deployment endpoints and rollback', async () => {
    const owner = await login(env);
    const other = await login(env);
    const project = await createProject(owner.agent);
    const d = await deploy(owner.agent, project.id);
    const otherProject = await createProject(other.agent);

    await other.agent.get(`/deployments/${d.id}`).expect(404);
    await other.agent.get(`/deployments/${d.id}/logs`).expect(404);
    await other.agent.post(`/deployments/${d.id}/cancel`).expect(404);
    await other.agent
      .post(`/projects/${project.id}/rollback`)
      .send({ deploymentId: d.id })
      .expect(404);
    // A foreign deployment can't be rolled back to via one's own project either.
    await other.agent
      .post(`/projects/${otherProject.id}/rollback`)
      .send({ deploymentId: d.id })
      .expect(404);
    await request(env.app).get(`/deployments/${d.id}`).expect(401);
  });

  it('fails builds that never report back', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);
    await env.prisma.deployment.update({
      where: { id: d.id },
      data: { createdAt: new Date(Date.now() - 3600_000) },
    });
    const n = await env.ctx.services.deployments.failStale(new Date(Date.now() - 60_000));
    expect(n).toBeGreaterThanOrEqual(1);
    const final = (await agent.get(`/deployments/${d.id}`)).body.deployment;
    expect(final).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Build did not report back in time',
    });
  });

  it('ingests events published on Redis pub/sub end to end', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    const d = await deploy(agent, project.id);

    const subscriber = new Redis(process.env.REDIS_URL!);
    const live = new DeploymentEventIngestor({
      repo: env.ctx.repos.deployments,
      service: env.ctx.services.deployments,
      hub: env.ctx.hub,
      logger: pino({ level: 'silent' }),
    });
    await live.start(subscriber);
    try {
      const pub = (e: WorkerEvent) => env.redis.publish(deploymentChannel(d.id), JSON.stringify(e));
      await pub({ type: 'status', deploymentId: d.id, ts: ts(), status: 'BUILDING' });
      await pub({ type: 'log', deploymentId: d.id, ts: ts(), level: 'info', message: 'via redis' });
      await expect
        .poll(async () => (await agent.get(`/deployments/${d.id}/logs`)).body.logs.length, {
          timeout: 5000,
        })
        .toBe(1);
      expect((await agent.get(`/deployments/${d.id}`)).body.deployment.status).toBe('BUILDING');
    } finally {
      await live.stop();
      await subscriber.quit();
    }
  });
});
