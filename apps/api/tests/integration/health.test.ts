import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, hasInfra, type TestEnv } from '../helpers.js';

describe.skipIf(!hasInfra)('health, metrics and security headers', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv({ metricsToken: 'metrics-token-1234567890' });
  });
  afterAll(async () => {
    await env.close();
  });

  it('serves liveness and readiness', async () => {
    await request(env.app).get('/healthz').expect(200, { status: 'ok' });
    const res = await request(env.app).get('/readyz').expect(200);
    expect(res.body.checks).toEqual({ db: 'ok', redis: 'ok', storage: 'ok' });
  });

  it('reports not ready when storage is down', async () => {
    env.store.ping = () => Promise.reject(new Error('down'));
    const res = await request(env.app).get('/readyz').expect(503);
    expect(res.body.checks.storage).toBe('fail');
  });

  it('protects /metrics and exposes deployment metrics', async () => {
    await request(env.app).get('/metrics').expect(401);
    const res = await request(env.app)
      .get('/metrics')
      .set('Authorization', 'Bearer metrics-token-1234567890')
      .expect(200);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('deployments_total');
  });

  it('applies strict CORS and helmet headers', async () => {
    const ok = await request(env.app).get('/healthz').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(env.app).get('/healthz').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['x-powered-by']).toBeUndefined();
    expect(ok.headers['x-request-id']).toBeDefined();
  });

  it('returns JSON 404s for unknown routes', async () => {
    const res = await request(env.app).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
