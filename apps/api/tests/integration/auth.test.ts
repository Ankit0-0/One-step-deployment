import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, hasInfra, login, uniqueEmail, type TestEnv } from '../helpers.js';

describe.skipIf(!hasInfra)('auth', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => {
    await env.close();
  });

  it('logs in with an emailed code and sets a hardened session cookie', async () => {
    const email = uniqueEmail();
    await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    const code = env.email.codes.get(email)!;

    const stored = await env.prisma.authCode.findFirst({ where: { email } });
    expect(stored?.codeHash).not.toContain(code);
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    const res = await request(env.app).post('/auth/verify').send({ email, code }).expect(200);
    expect(res.body.user.email).toBe(email);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/osd_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('normalizes the email and creates the user once', async () => {
    const email = uniqueEmail();
    const first = await login(env, email);
    const second = await login(env, email.toUpperCase());
    expect(second.user.id).toBe(first.user.id);
  });

  it('returns the current user from /auth/me and clears it on logout', async () => {
    const { agent, user } = await login(env);
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user.id).toBe(user.id);
    await agent.post('/auth/logout').expect(204);
    await agent.get('/auth/me').expect(401);
  });

  it('rejects requests without a session', async () => {
    const res = await request(env.app).get('/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a forged cookie', async () => {
    await request(env.app)
      .get('/auth/me')
      .set('Cookie', 'osd_session=eyJhbGciOiJub25lIn0.e30.')
      .expect(401);
  });

  it('rejects a wrong code and locks the code after 5 attempts', async () => {
    const email = uniqueEmail();
    await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    const code = env.email.codes.get(email)!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await request(env.app).post('/auth/verify').send({ email, code: wrong }).expect(401);
    }
    const res = await request(env.app).post('/auth/verify').send({ email, code }).expect(401);
    expect(res.body.error.message).toMatch(/Too many attempts/);
  });

  it('rejects expired codes', async () => {
    const email = uniqueEmail();
    await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    await env.prisma.authCode.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(env.app)
      .post('/auth/verify')
      .send({ email, code: env.email.codes.get(email) })
      .expect(401);
  });

  it('codes are single use and a new code replaces the old one', async () => {
    const email = uniqueEmail();
    await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    const first = env.email.codes.get(email)!;
    await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    const second = env.email.codes.get(email)!;
    if (first !== second) {
      await request(env.app).post('/auth/verify').send({ email, code: first }).expect(401);
    }
    await request(env.app).post('/auth/verify').send({ email, code: second }).expect(200);
    await request(env.app).post('/auth/verify').send({ email, code: second }).expect(401);
  });

  it('rate-limits code requests per email', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++)
      await request(env.app).post('/auth/request-code').send({ email }).expect(202);
    const res = await request(env.app).post('/auth/request-code').send({ email }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('rate-limits code requests per IP', async () => {
    const ipEnv = await createTestEnv();
    try {
      let last = 0;
      for (let i = 0; i < 21; i++) {
        last = (await request(ipEnv.app).post('/auth/request-code').send({ email: uniqueEmail() }))
          .status;
      }
      expect(last).toBe(429);
    } finally {
      await ipEnv.close();
    }
  });

  it.each([[{ email: 'not-an-email' }], [{}], [{ email: 'a@b.co', extra: true }]])(
    'rejects invalid request-code body %j',
    async (body) => {
      const res = await request(env.app).post('/auth/request-code').send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId).toBeDefined();
    },
  );

  it.each([['12345'], ['abcdef'], ['1234567']])('rejects malformed code %s', async (code) => {
    await request(env.app).post('/auth/verify').send({ email: uniqueEmail(), code }).expect(400);
  });

  it('rejects malformed JSON without leaking internals', async () => {
    const res = await request(env.app)
      .post('/auth/request-code')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.error.message).toBe('Malformed JSON body');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it('rejects oversized bodies', async () => {
    await request(env.app)
      .post('/auth/request-code')
      .send({ email: `${'a'.repeat(20_000)}@b.co` })
      .expect(413);
  });
});
