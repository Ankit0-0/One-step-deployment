import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  createTestEnv,
  hasInfra,
  login,
  uniqueSlug,
  type TestEnv,
} from '../helpers.js';

describe.skipIf(!hasInfra)('projects', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => {
    await env.close();
  });

  it('creates, lists, reads and updates own projects', async () => {
    const { agent } = await login(env);
    const slug = uniqueSlug();
    const project = await createProject(agent, slug);
    expect(project).toMatchObject({
      slug,
      currentDeploymentId: null,
      url: `http://${slug}.localhost:8000`,
    });

    const list = await agent.get('/projects').expect(200);
    expect(list.body.projects.map((p: { id: string }) => p.id)).toEqual([project.id]);

    await agent.get(`/projects/${project.id}`).expect(200);
    const updated = await agent
      .patch(`/projects/${project.id}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect(updated.body.project.name).toBe('Renamed');
  });

  it('requires authentication', async () => {
    await request(env.app).get('/projects').expect(401);
    await request(env.app)
      .post('/projects')
      .send({ name: 'x', slug: uniqueSlug(), gitUrl: 'https://github.com/a/b' })
      .expect(401);
  });

  it("hides other users' projects (404, not 403)", async () => {
    const owner = await login(env);
    const other = await login(env);
    const project = await createProject(owner.agent);

    await other.agent.get(`/projects/${project.id}`).expect(404);
    await other.agent.patch(`/projects/${project.id}`).send({ name: 'pwned' }).expect(404);
    await other.agent.get(`/projects/${project.id}/deployments`).expect(404);
    await other.agent.post(`/projects/${project.id}/deployments`).expect(404);
    const list = await other.agent.get('/projects').expect(200);
    expect(list.body.projects).toEqual([]);
  });

  it('rejects a taken slug with 409', async () => {
    const a = await login(env);
    const b = await login(env);
    const slug = uniqueSlug();
    await createProject(a.agent, slug);
    const res = await b.agent
      .post('/projects')
      .send({ name: 'x', slug, gitUrl: 'https://github.com/a/b' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it.each([
    [{ name: 'x', slug: 'www', gitUrl: 'https://github.com/a/b' }, 'slug'],
    [{ name: 'x', slug: 'Bad_Slug', gitUrl: 'https://github.com/a/b' }, 'slug'],
    [{ name: 'x', slug: 'ok-slug', gitUrl: 'https://gitlab.com/a/b' }, 'gitUrl'],
    [{ name: 'x', slug: 'ok-slug', gitUrl: 'https://github.com/a/b; rm -rf /' }, 'gitUrl'],
    [{ name: '', slug: 'ok-slug', gitUrl: 'https://github.com/a/b' }, 'name'],
    [{ name: 'x', slug: 'ok-slug', gitUrl: 'https://github.com/a/b', userId: 'someone' }, ''],
  ])('rejects invalid body %j', async (body, field) => {
    const { agent } = await login(env);
    const res = await agent.post('/projects').send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
  });

  it('rejects empty updates', async () => {
    const { agent } = await login(env);
    const project = await createProject(agent);
    await agent.patch(`/projects/${project.id}`).send({}).expect(400);
  });
});
