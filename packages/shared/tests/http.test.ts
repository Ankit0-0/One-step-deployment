import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHealthRouter, createHttpMetrics, requestIdFrom } from '../src/http/index.js';

describe('health router', () => {
  it('reports ready when all checks pass', async () => {
    const app = express().use(createHealthRouter({ db: () => Promise.resolve() }));
    await request(app).get('/healthz').expect(200, { status: 'ok' });
    await request(app)
      .get('/readyz')
      .expect(200, { status: 'ok', checks: { db: 'ok' } });
  });

  it('returns 503 when a check fails or hangs', async () => {
    const app = express().use(
      createHealthRouter(
        {
          db: () => Promise.resolve(),
          redis: () => Promise.reject(new Error('down')),
          storage: () => new Promise(() => {}),
        },
        50,
      ),
    );
    const res = await request(app).get('/readyz').expect(503);
    expect(res.body).toEqual({
      status: 'fail',
      checks: { db: 'ok', redis: 'fail', storage: 'fail' },
    });
  });
});

describe('metrics', () => {
  it('records request latency by route pattern', async () => {
    const metrics = createHttpMetrics('test');
    const app = express();
    app.use(metrics.middleware);
    app.get('/items/:id', (_req, res) => {
      res.send('ok');
    });
    app.get('/metrics', metrics.handler());
    await request(app).get('/items/123').expect(200);
    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain(
      'http_request_duration_seconds_count{service="test",method="GET",route="/items/:id",status_code="200"} 1',
    );
  });

  it('protects /metrics with a bearer token when configured', async () => {
    const metrics = createHttpMetrics('test');
    const app = express().get('/metrics', metrics.handler('a'.repeat(20)));
    await request(app).get('/metrics').expect(401);
    await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${'b'.repeat(20)}`)
      .expect(401);
    await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${'a'.repeat(20)}`)
      .expect(200);
  });
});

describe('requestIdFrom', () => {
  it('keeps valid ids and replaces unsafe ones', () => {
    const req = (id?: string) => ({ headers: id ? { 'x-request-id': id } : {} }) as never;
    expect(requestIdFrom(req('abc-123'))).toBe('abc-123');
    expect(requestIdFrom(req('bad id\n'))).not.toBe('bad id\n');
    expect(requestIdFrom(req())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
