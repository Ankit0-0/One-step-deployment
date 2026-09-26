import { describe, expect, it, vi } from 'vitest';
import { ApiError, LOG_PAGE_SIZE, createApiClient } from '@/lib/api';
import { deployment, log } from './fixtures';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  it('sends credentials and JSON bodies, and unwraps the response', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        user: { id: 'usr00000000001', email: 'a@b.dev', createdAt: '2026-09-26T10:00:00.000Z' },
      }),
    );
    const api = createApiClient('http://api.test', fetchImpl);
    const user = await api.verifyCode('a@b.dev', '123456');
    expect(user.email).toBe('a@b.dev');
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/auth/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.dev', code: '123456' }),
    });
  });

  it('maps API errors to ApiError with code and field details', async () => {
    const api = createApiClient('http://api.test', async () =>
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: [{ path: 'slug', message: 'This slug is reserved' }],
        },
      }),
    );
    const err = await api
      .createProject({ name: 'x', slug: 'admin', gitUrl: 'https://github.com/a/b' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ path: 'slug' }],
    });
  });

  it('turns unknown error bodies and network failures into readable errors', async () => {
    const html = createApiClient(
      'http://api.test',
      async () => new Response('<html>', { status: 502 }),
    );
    await expect(html.listProjects()).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });

    const offline = createApiClient('http://api.test', () =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expect(offline.listProjects()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('rejects responses that do not match the shared DTOs', async () => {
    const api = createApiClient('http://api.test', async () =>
      json(200, { deployment: { ...deployment(), status: 'EXPLODED' } }),
    );
    await expect(api.getDeployment('dep00000000001')).rejects.toThrow();
  });

  it('pages through logs with the id cursor', async () => {
    const first = Array.from({ length: LOG_PAGE_SIZE }, (_, i) => log(i + 1));
    const second = [log(LOG_PAGE_SIZE + 1)];
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      json(200, { logs: String(url).includes('afterId=') ? second : first }),
    );
    const api = createApiClient('http://api.test', fetchImpl);
    const logs = await api.getAllLogs('dep00000000001');
    expect(logs).toHaveLength(LOG_PAGE_SIZE + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain(`afterId=${LOG_PAGE_SIZE}`);
  });

  it('handles 204 responses', async () => {
    const api = createApiClient('http://api.test', async () => new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
