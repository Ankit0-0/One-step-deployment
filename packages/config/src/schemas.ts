import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export const envBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Comma-separated list, e.g. "subnet-a,subnet-b". */
export const envList = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()).min(1));

export const port = z.coerce.number().int().min(1).max(65535);

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// URL');

/** Redis must be password protected in every environment. */
const redisUrl = z.string().refine((v) => {
  try {
    const url = new URL(v);
    return (url.protocol === 'redis:' || url.protocol === 'rediss:') && url.password.length > 0;
  } catch {
    return false;
  }
}, 'must be a redis:// or rediss:// URL that includes a password');

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

export const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const databaseSchema = z.object({
  DATABASE_URL: postgresUrl,
});

export const redisSchema = z.object({
  REDIS_URL: redisUrl,
});

const s3Storage = z.object({
  STORAGE_DRIVER: z.literal('s3'),
  STORAGE_BUCKET: z.string().min(3),
  AWS_REGION: z.string().min(1),
});

const minioStorage = z.object({
  STORAGE_DRIVER: z.literal('minio'),
  STORAGE_BUCKET: z.string().min(3),
  S3_ENDPOINT: z.url(),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_REGION: z.string().default('us-east-1'),
});

/** STORAGE_DRIVER=s3 uses the AWS credential chain; minio needs explicit keys. */
export const storageSchema = z.discriminatedUnion('STORAGE_DRIVER', [s3Storage, minioStorage]);

const ecsRunner = z.object({
  BUILD_RUNNER: z.literal('ecs'),
  AWS_REGION: z.string().min(1),
  ECS_CLUSTER: z.string().min(1),
  ECS_TASK_DEFINITION: z.string().min(1),
  ECS_CONTAINER_NAME: z.string().min(1).default('build-worker'),
  ECS_SUBNETS: envList,
  ECS_SECURITY_GROUPS: envList,
  ECS_ASSIGN_PUBLIC_IP: envBoolean.default(true),
});

const dockerRunner = z.object({
  BUILD_RUNNER: z.literal('docker'),
  BUILD_WORKER_IMAGE: z.string().min(1).default('osd/build-worker:local'),
  DOCKER_NETWORK: z.string().min(1).optional(),
});

/** BUILD_RUNNER=ecs runs builds as Fargate tasks; docker runs them locally for dev/tests. */
export const runnerSchema = z.discriminatedUnion('BUILD_RUNNER', [ecsRunner, dockerRunner]);

const emailConsole = z.object({
  EMAIL_DRIVER: z.literal('console'),
});

const emailResend = z.object({
  EMAIL_DRIVER: z.literal('resend'),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
});

/** EMAIL_DRIVER=console logs login codes instead of sending them. */
export const emailSchema = z.discriminatedUnion('EMAIL_DRIVER', [emailConsole, emailResend]);

// ---------------------------------------------------------------------------
// Per-service schemas
// ---------------------------------------------------------------------------

export const apiEnvSchema = baseSchema
  .extend(databaseSchema.shape)
  .extend(redisSchema.shape)
  .extend({
    PORT: port.default(4000),
    WEB_ORIGIN: z.url(),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 7),
    COOKIE_SECURE: envBoolean.default(true),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    ROOT_DOMAIN: z.string().min(1),
    MAX_CONCURRENT_BUILDS_PER_USER: z.coerce.number().int().min(1).default(2),
    TRUST_PROXY: envBoolean.default(false),
  })
  .and(storageSchema)
  .and(runnerSchema)
  .and(emailSchema);

/** The build worker never receives database credentials. */
export const workerEnvSchema = baseSchema
  .extend(redisSchema.shape)
  .extend({
    DEPLOYMENT_ID: z.string().min(1),
    GIT_URL: z.url(),
    REQUEST_ID: z.string().min(1).optional(),
    BUILD_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),
    MAX_OUTPUT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(500 * 1024 * 1024),
    WORK_DIR: z.string().min(1).default('/tmp/osd-build'),
  })
  .and(storageSchema);

export const proxyEnvSchema = baseSchema
  .extend(databaseSchema.shape)
  .extend(redisSchema.shape)
  .extend({
    PORT: port.default(8000),
    ROOT_DOMAIN: z.string().min(1),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
  })
  .and(storageSchema);

/** Only NEXT_PUBLIC_* values; they are inlined into the browser bundle. */
export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().min(1),
});

export type ApiEnv = z.output<typeof apiEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type ProxyEnv = z.output<typeof proxyEnvSchema>;
export type WebEnv = z.output<typeof webEnvSchema>;
export type StorageEnv = z.output<typeof storageSchema>;
export type RunnerEnv = z.output<typeof runnerSchema>;
export type EmailEnv = z.output<typeof emailSchema>;
