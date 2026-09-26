import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const artifactsDir = fileURLToPath(new URL('./.artifacts/', import.meta.url));
export const apiLogFile = `${artifactsDir}api.log`;

export const API_PORT = 4000;
export const WEB_PORT = 3000;
export const apiUrl = `http://localhost:${API_PORT}`;
export const webUrl = `http://localhost:${WEB_PORT}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`e2e: ${name} must be set (see e2e/README.md)`);
  return value;
}

/**
 * The api runs for real against Postgres, Redis and MinIO, with the console email driver and
 * the mock build runner. Storage credentials default to the CI MinIO container.
 */
export function apiEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    PORT: String(API_PORT),
    DATABASE_URL: required('DATABASE_URL'),
    REDIS_URL: required('REDIS_URL'),
    WEB_ORIGIN: webUrl,
    ROOT_DOMAIN: 'localhost',
    SITE_URL_TEMPLATE: 'http://{slug}.localhost:8000',
    JWT_SECRET: 'e2e-only-jwt-secret-not-used-anywhere-else',
    COOKIE_SECURE: 'false',
    EMAIL_DRIVER: 'console',
    BUILD_RUNNER: 'mock',
    MOCK_BUILD_STEP_MS: '200',
    STORAGE_DRIVER: 'minio',
    STORAGE_BUCKET: process.env.E2E_BUCKET ?? 'osd-e2e',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'osd-ci-minio',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'osd-ci-minio-password',
    S3_REGION: 'us-east-1',
    PATH: process.env.PATH ?? '',
  };
}
