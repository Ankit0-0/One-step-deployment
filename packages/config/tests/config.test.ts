import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  loadApiEnv,
  loadProxyEnv,
  loadWebEnv,
  loadWorkerEnv,
} from '../src/index.js';

const minio = {
  STORAGE_DRIVER: 'minio',
  STORAGE_BUCKET: 'osd-deployments',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'osdminio',
  S3_SECRET_ACCESS_KEY: 'change-me-minio',
};

const apiBase = {
  DATABASE_URL: 'postgresql://osd:pw@localhost:5432/osd',
  REDIS_URL: 'redis://:secret@localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'x'.repeat(32),
  ROOT_DOMAIN: 'localhost',
  BUILD_RUNNER: 'docker',
  EMAIL_DRIVER: 'console',
  ...minio,
};

function expectInvalid(fn: () => unknown, ...keys: string[]) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    const issues = (err as EnvValidationError).issues.join('\n');
    for (const key of keys) expect(issues).toContain(key);
    return;
  }
  throw new Error('expected loader to throw');
}

describe('loadApiEnv', () => {
  it('applies defaults for a minimal valid env', () => {
    const env = loadApiEnv(apiBase);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.MAX_CONCURRENT_BUILDS_PER_USER).toBe(2);
    expect(env.STORAGE_DRIVER).toBe('minio');
    expect(env.BUILD_RUNNER).toBe('docker');
  });

  it('reports every missing key at once', () => {
    expectInvalid(() => loadApiEnv({}), 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'WEB_ORIGIN');
  });

  it('treats empty strings as unset', () => {
    expectInvalid(() => loadApiEnv({ ...apiBase, JWT_SECRET: '' }), 'JWT_SECRET');
  });

  it('rejects a short JWT secret', () => {
    expectInvalid(() => loadApiEnv({ ...apiBase, JWT_SECRET: 'short' }), 'JWT_SECRET');
  });

  it('requires a password in REDIS_URL', () => {
    expectInvalid(
      () => loadApiEnv({ ...apiBase, REDIS_URL: 'redis://localhost:6379' }),
      'REDIS_URL',
    );
  });

  it('rejects unknown storage drivers', () => {
    expectInvalid(() => loadApiEnv({ ...apiBase, STORAGE_DRIVER: 'gcs' }), 'STORAGE_DRIVER');
  });

  it('allows the mock runner outside production only', () => {
    const env = loadApiEnv({ ...apiBase, BUILD_RUNNER: 'mock' });
    expect(env.BUILD_RUNNER === 'mock' && env.MOCK_BUILD_STEP_MS).toBe(400);
    expectInvalid(
      () => loadApiEnv({ ...apiBase, BUILD_RUNNER: 'mock', NODE_ENV: 'production' }),
      'BUILD_RUNNER',
    );
  });

  it('requires ECS settings when BUILD_RUNNER=ecs', () => {
    expectInvalid(
      () => loadApiEnv({ ...apiBase, BUILD_RUNNER: 'ecs' }),
      'ECS_CLUSTER',
      'ECS_SUBNETS',
    );
  });

  it('parses ECS list settings', () => {
    const env = loadApiEnv({
      ...apiBase,
      BUILD_RUNNER: 'ecs',
      AWS_REGION: 'ap-south-1',
      ECS_CLUSTER: 'builds',
      ECS_TASK_DEFINITION: 'build-worker:3',
      ECS_SUBNETS: 'subnet-a, subnet-b',
      ECS_SECURITY_GROUPS: 'sg-1',
    });
    if (env.BUILD_RUNNER !== 'ecs') throw new Error('expected ecs runner');
    expect(env.ECS_SUBNETS).toEqual(['subnet-a', 'subnet-b']);
    expect(env.ECS_ASSIGN_PUBLIC_IP).toBe(true);
  });

  it('requires a Resend key when EMAIL_DRIVER=resend', () => {
    expectInvalid(() => loadApiEnv({ ...apiBase, EMAIL_DRIVER: 'resend' }), 'RESEND_API_KEY');
  });

  it('does not echo secret values in error messages', () => {
    try {
      loadApiEnv({ ...apiBase, REDIS_URL: 'redis://supersecretvalue@' });
    } catch (err) {
      expect((err as Error).message).not.toContain('supersecretvalue');
    }
  });
});

describe('loadWorkerEnv', () => {
  const worker = {
    REDIS_URL: 'redis://:secret@localhost:6379',
    DEPLOYMENT_ID: 'dep_1',
    GIT_URL: 'https://github.com/vercel/next.js',
    ...minio,
  };

  it('applies build limits defaults', () => {
    const env = loadWorkerEnv(worker);
    expect(env.BUILD_TIMEOUT_MS).toBe(600_000);
    expect(env.MAX_OUTPUT_BYTES).toBeGreaterThan(0);
  });

  it('never exposes DATABASE_URL to the worker', () => {
    const env = loadWorkerEnv({ ...worker, DATABASE_URL: 'postgresql://x' });
    expect(env).not.toHaveProperty('DATABASE_URL');
  });
});

describe('loadProxyEnv', () => {
  it('parses with defaults', () => {
    const env = loadProxyEnv({
      DATABASE_URL: 'postgres://osd:pw@db:5432/osd',
      REDIS_URL: 'redis://:pw@redis:6379',
      ROOT_DOMAIN: 'example.dev',
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'osd-deployments',
      AWS_REGION: 'ap-south-1',
    });
    expect(env.PORT).toBe(8000);
    expect(env.CACHE_TTL_SECONDS).toBe(30);
  });
});

describe('loadWebEnv', () => {
  it('requires a valid API URL', () => {
    expectInvalid(
      () => loadWebEnv({ NEXT_PUBLIC_API_URL: 'nope', NEXT_PUBLIC_ROOT_DOMAIN: 'x' }),
      'NEXT_PUBLIC_API_URL',
    );
  });
});
