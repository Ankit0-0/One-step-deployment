import { pino } from 'pino';
import request from 'supertest';
import { MemoryObjectStore } from '@osd/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MemoryCache } from '../src/services/resolver.js';

const dep = 'cm1abcdefghijklmnopqrstuv';
const projects: Record<string, { currentDeploymentId: string | null }> = {
  'my-app': { currentDeploymentId: dep },
  'fresh-app': { currentDeploymentId: null },
};

let store: MemoryObjectStore;
let app: ReturnType<typeof createApp>;

async function put(path: string, body: string, contentType: string) {
  await store.put({
    key: `deployments/${dep}/${path}`,
    body: Buffer.from(body),
    contentType,
    contentLength: Buffer.byteLength(body),
  });
}

beforeEach(async () => {
  store = new MemoryObjectStore();
  await put('index.html', '<h1>home</h1>', 'text/html; charset=utf-8');
  await put('assets/app.js', 'console.log(1)', 'text/javascript; charset=utf-8');
  app = createApp({
    rootDomain: 'example.dev',
    cache: new MemoryCache(),
    lookup: async (slug) => projects[slug] ?? null,
    cacheTtlSeconds: 30,
    store,
    logger: pino({ level: 'silent' }),
    readiness: { db: async () => {} },
  });
});

const site = (path: string) => request(app).get(path).set('Host', 'my-app.example.dev');

describe('proxy routing', () => {
  it('serves index.html at /', async () => {
    const res = await site('/').expect(200);
    expect(res.text).toBe('<h1>home</h1>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves assets with their content type and cache headers', async () => {
    const res = await site('/assets/app.js').expect(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await site('/dashboard/settings').expect(200);
    expect(res.text).toBe('<h1>home</h1>');
  });

  it('404s for missing assets instead of returning index.html', async () => {
    const res = await site('/missing.js').expect(404);
    expect(res.text).toContain('Page not found');
  });

  it("uses the deployment's own 404.html when present", async () => {
    await put('404.html', 'custom 404', 'text/html; charset=utf-8');
    const res = await site('/missing.png').expect(404);
    expect(res.text).toBe('custom 404');
  });

  it('shows a 404 page for unknown slugs', async () => {
    const res = await request(app).get('/').set('Host', 'nope-app.example.dev').expect(404);
    expect(res.text).toContain('There is no site at this address');
  });

  it('shows a pending page when nothing is deployed yet', async () => {
    const res = await request(app).get('/').set('Host', 'fresh-app.example.dev').expect(404);
    expect(res.text).toContain('no ready deployment');
  });

  it('404s for malformed hosts', async () => {
    await request(app).get('/').set('Host', 'a.b.example.dev').expect(404);
  });

  it('rejects path traversal', async () => {
    await site('/%2e%2e/%2e%2e/etc/passwd').expect(400);
  });

  it('only allows GET and HEAD', async () => {
    const res = await request(app).post('/').set('Host', 'my-app.example.dev').expect(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    const head = await request(app).head('/').set('Host', 'my-app.example.dev').expect(200);
    expect(head.headers['content-length']).toBe('13');
  });

  it('sets security headers', async () => {
    const res = await site('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('internal endpoints', () => {
  it('serves health on the root host only', async () => {
    await request(app).get('/healthz').set('Host', 'example.dev').expect(200, { status: 'ok' });
    await request(app).get('/readyz').set('Host', 'example.dev').expect(200);
    // On a site host /healthz is just a path of the user's site (SPA fallback here).
    const res = await site('/healthz').expect(200);
    expect(res.text).toBe('<h1>home</h1>');
  });

  it('exposes metrics including cache lookups', async () => {
    await site('/');
    const res = await request(app).get('/metrics').set('Host', 'example.dev').expect(200);
    expect(res.text).toContain('proxy_slug_cache_total');
    expect(res.text).toContain('http_request_duration_seconds');
  });
});
