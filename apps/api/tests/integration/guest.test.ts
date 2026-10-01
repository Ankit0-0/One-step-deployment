import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proxySlugCacheKey } from '@osd/shared';
import { deploymentObjectKey } from '@osd/storage';
import { createProject, createTestEnv, hasInfra, login, type TestEnv } from '../helpers.js';

type Agent = ReturnType<typeof request.agent>;

describe.skipIf(!hasInfra)('guest accounts', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv({ guestTtlSeconds: 3600, guestMaxProjects: 2 });
  });
  afterAll(async () => {
    await env.close();
  });

  async function loginAsGuest() {
    const agent = request.agent(env.app);
    const res = await agent.post('/auth/guest').expect(201);
    return { agent, user: res.body.user as { id: string; email: string; expiresAt: string } };
  }

  /** Puts a built file in storage for a new deployment, as a finished build would. */
  async function deployWithFiles(agent: Agent, projectId: string) {
    const res = await agent.post(`/projects/${projectId}/deployments`).expect(201);
    const id = res.body.deployment.id as string;
    await env.store.put({
      key: deploymentObjectKey(id, 'index.html'),
      body: Buffer.from('<h1>hi</h1>'),
      contentType: 'text/html',
      contentLength: 11,
    });
    return id;
  }

  const expire = (userId: string) =>
    env.prisma.user.update({
      where: { id: userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

  it('creates a fresh guest on every click with a session that ends with the account', async () => {
    const before = Date.now();
    const a = await loginAsGuest();
    const b = await loginAsGuest();
    expect(a.user.id).not.toBe(b.user.id);

    const me = await a.agent.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ id: a.user.id, isGuest: true });
    const expiresAt = new Date(me.body.user.expiresAt as string).getTime();
    expect(expiresAt - before).toBeGreaterThan(3590 * 1000);
    expect(expiresAt - before).toBeLessThan(3610 * 1000);

    const res = await request(env.app).post('/auth/guest').expect(201);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/osd_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Max-Age=(3599|3600);/);
  });

  it('marks email users as non-guests', async () => {
    const { agent } = await login(env);
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ isGuest: false, expiresAt: null });
  });

  it('lets a guest create projects and deploy, up to the guest project limit', async () => {
    const { agent } = await loginAsGuest();
    const project = await createProject(agent);
    await agent.post(`/projects/${project.id}/deployments`).expect(201);
    await createProject(agent);
    const res = await agent
      .post('/projects')
      .send({ name: 'Third', slug: `t-${Date.now()}`, gitUrl: 'https://github.com/a/b' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects the session once the guest has expired', async () => {
    const { agent, user } = await loginAsGuest();
    await expire(user.id);
    await agent.get('/auth/me').expect(401);
  });

  it('deletes expired guests with their projects, deployments, logs and files', async () => {
    const { agent: emailAgent } = await login(env);
    const kept = await createProject(emailAgent);
    const keptDeployment = await deployWithFiles(emailAgent, kept.id);

    const fresh = await loginAsGuest();
    const freshProject = await createProject(fresh.agent);

    const old = await loginAsGuest();
    const project = await createProject(old.agent);
    const deploymentId = await deployWithFiles(old.agent, project.id);
    await env.prisma.deploymentLog.create({
      data: { deploymentId, ts: new Date(), message: 'building' },
    });
    await env.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'BUILDING', runnerRef: 'ref-running' },
    });
    await env.redis.set(proxySlugCacheKey(project.slug), 'cached');
    await expire(old.user.id);

    expect(await env.ctx.guestCleanup.run()).toBeGreaterThanOrEqual(1);

    expect(await env.prisma.user.findUnique({ where: { id: old.user.id } })).toBeNull();
    expect(await env.prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await env.prisma.deployment.findUnique({ where: { id: deploymentId } })).toBeNull();
    expect(await env.prisma.deploymentLog.count({ where: { deploymentId } })).toBe(0);
    expect(env.store.objects.has(deploymentObjectKey(deploymentId, 'index.html'))).toBe(false);
    expect(env.runner.stopped).toContain('ref-running');
    expect(await env.redis.exists(proxySlugCacheKey(project.slug))).toBe(0);
    await old.agent.get('/auth/me').expect(401);

    // Unexpired guests and email users are untouched.
    expect(await env.prisma.project.findUnique({ where: { id: freshProject.id } })).not.toBeNull();
    expect(await env.prisma.project.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(env.store.objects.has(deploymentObjectKey(keptDeployment, 'index.html'))).toBe(true);
  });

  it('returns 404 when guest login is disabled', async () => {
    const disabled = await createTestEnv({ guestLoginEnabled: false });
    try {
      await request(disabled.app).post('/auth/guest').expect(404);
    } finally {
      await disabled.close();
    }
  });
});
