import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import request from 'supertest';
import { createPrismaClient, type PrismaClient } from '@osd/db';
import { MemoryObjectStore } from '@osd/storage';
import { createApp } from '../src/app.js';
import { createContext, type ApiConfig, type AppContext } from '../src/context.js';
import type { EmailSender } from '../src/modules/auth/email.js';
import type { BuildRunner, StartBuildInput } from '../src/modules/runners/runner.js';

/** Integration tests need a migrated Postgres and a Redis (CI services, or `pnpm infra:up`). */
export const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

export class FakeEmail implements EmailSender {
  readonly codes = new Map<string, string>();
  sendLoginCode(email: string, code: string) {
    this.codes.set(email, code);
    return Promise.resolve();
  }
}

export class FakeRunner implements BuildRunner {
  readonly started: StartBuildInput[] = [];
  readonly stopped: string[] = [];
  failNextStart = false;

  start(input: StartBuildInput) {
    if (this.failNextStart) {
      this.failNextStart = false;
      return Promise.reject(new Error('runner down'));
    }
    this.started.push(input);
    return Promise.resolve({ ref: `ref-${input.deploymentId}` });
  }

  stop(ref: string) {
    this.stopped.push(ref);
    return Promise.resolve();
  }
}

export interface TestEnv {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  prisma: PrismaClient;
  redis: Redis;
  email: FakeEmail;
  runner: FakeRunner;
  store: MemoryObjectStore;
  close(): Promise<void>;
}

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    webOrigin: 'http://localhost:3000',
    jwtSecret: 'test-secret-that-is-at-least-32-characters',
    jwtTtlSeconds: 3600,
    cookieSecure: false,
    siteUrlTemplate: 'http://{slug}.localhost:8000',
    maxConcurrentBuilds: 2,
    trustProxy: false,
    // Fresh rate-limit counters per test env.
    rateLimitPrefix: `test:${randomUUID()}:`,
    production: false,
    ...overrides,
  };
}

export async function createTestEnv(overrides: Partial<ApiConfig> = {}): Promise<TestEnv> {
  // Expected errors (e.g. unique violations → 409) would otherwise be printed by Prisma.
  const prisma = createPrismaClient({ log: [] });
  const redis = new Redis(process.env.REDIS_URL!);
  const email = new FakeEmail();
  const runner = new FakeRunner();
  const store = new MemoryObjectStore();
  const ctx = createContext({
    config: testConfig(overrides),
    logger: pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
    prisma,
    redis,
    store,
    runner,
    email,
  });
  return {
    ctx,
    app: createApp(ctx),
    prisma,
    redis,
    email,
    runner,
    store,
    async close() {
      await prisma.$disconnect();
      await redis.quit();
    },
  };
}

export const uniqueEmail = () => `user-${randomUUID()}@test.dev`;
export const uniqueSlug = () => `t-${randomUUID().slice(0, 18)}`;

/** Runs the email-code login and returns an agent carrying the session cookie. */
export async function login(env: TestEnv, email = uniqueEmail()) {
  const agent = request.agent(env.app);
  await agent.post('/auth/request-code').send({ email }).expect(202);
  const code = env.email.codes.get(email.trim().toLowerCase());
  if (!code) throw new Error('no code sent');
  const res = await agent.post('/auth/verify').send({ email, code }).expect(200);
  return { agent, user: res.body.user as { id: string; email: string }, email };
}

export async function createProject(agent: ReturnType<typeof request.agent>, slug = uniqueSlug()) {
  const res = await agent
    .post('/projects')
    .send({ name: 'Test', slug, gitUrl: 'https://github.com/octocat/Hello-World' })
    .expect(201);
  return res.body.project as { id: string; slug: string; currentDeploymentId: string | null };
}
