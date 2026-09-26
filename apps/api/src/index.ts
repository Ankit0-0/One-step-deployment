import { ECSClient } from '@aws-sdk/client-ecs';
import { Redis } from 'ioredis';
import { loadApiEnv, type ApiEnv } from '@osd/config';
import { createPrismaClient } from '@osd/db';
import { createLogger, type Logger } from '@osd/shared/logger';
import { S3ObjectStore } from '@osd/storage';
import { createContext } from './context.js';
import { ConsoleEmailSender, ResendEmailSender, type EmailSender } from './modules/auth/email.js';
import { DockerRunner } from './modules/runners/docker-runner.js';
import { EcsRunner } from './modules/runners/ecs-runner.js';
import type { BuildRunner } from './modules/runners/runner.js';
import { startApi } from './server.js';

function createRunner(env: ApiEnv): BuildRunner {
  if (env.BUILD_RUNNER === 'ecs') {
    return new EcsRunner(new ECSClient({ region: env.AWS_REGION }), {
      cluster: env.ECS_CLUSTER,
      taskDefinition: env.ECS_TASK_DEFINITION,
      containerName: env.ECS_CONTAINER_NAME,
      subnets: env.ECS_SUBNETS,
      securityGroups: env.ECS_SECURITY_GROUPS,
      assignPublicIp: env.ECS_ASSIGN_PUBLIC_IP,
      buildTimeoutMs: env.BUILD_TIMEOUT_MS,
    });
  }
  const storage: Record<string, string> =
    env.STORAGE_DRIVER === 'minio'
      ? {
          STORAGE_DRIVER: 'minio',
          STORAGE_BUCKET: env.STORAGE_BUCKET,
          S3_ENDPOINT: env.WORKER_S3_ENDPOINT ?? env.S3_ENDPOINT,
          S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
          S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
          S3_REGION: env.S3_REGION,
        }
      : { STORAGE_DRIVER: 's3', STORAGE_BUCKET: env.STORAGE_BUCKET, AWS_REGION: env.AWS_REGION };
  return new DockerRunner({
    image: env.BUILD_WORKER_IMAGE,
    network: env.DOCKER_NETWORK,
    memory: env.WORKER_MEMORY,
    cpus: env.WORKER_CPUS,
    workerEnv: {
      NODE_ENV: 'production',
      LOG_LEVEL: env.LOG_LEVEL,
      REDIS_URL: env.WORKER_REDIS_URL ?? env.REDIS_URL,
      BUILD_TIMEOUT_MS: String(env.BUILD_TIMEOUT_MS),
      ...storage,
    },
  });
}

function createEmail(env: ApiEnv, logger: Logger): EmailSender {
  return env.EMAIL_DRIVER === 'resend'
    ? new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : new ConsoleEmailSender(logger);
}

async function main() {
  const env = loadApiEnv();
  const logger = createLogger({
    service: 'api',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const subscriber = new Redis(env.REDIS_URL);
  redis.on('error', (err) => logger.warn({ err }, 'redis error'));
  subscriber.on('error', (err) => logger.warn({ err }, 'redis subscriber error'));
  const prisma = createPrismaClient();

  const ctx = createContext({
    config: {
      webOrigin: env.WEB_ORIGIN,
      jwtSecret: env.JWT_SECRET,
      jwtTtlSeconds: env.JWT_TTL_SECONDS,
      cookieSecure: env.COOKIE_SECURE,
      cookieDomain: env.COOKIE_DOMAIN,
      siteUrlTemplate: env.SITE_URL_TEMPLATE ?? `https://{slug}.${env.ROOT_DOMAIN}`,
      maxConcurrentBuilds: env.MAX_CONCURRENT_BUILDS_PER_USER,
      trustProxy: env.TRUST_PROXY,
      metricsToken: env.METRICS_TOKEN,
      rateLimitPrefix: 'rl:',
      production: env.NODE_ENV === 'production',
    },
    logger,
    prisma,
    redis,
    store: S3ObjectStore.fromEnv(env),
    runner: createRunner(env),
    email: createEmail(env, logger),
  });

  const api = await startApi(ctx, {
    port: env.PORT,
    subscriber,
    // A build gets BUILD_TIMEOUT_MS; allow 5 more minutes for queueing and upload before failing it.
    staleAfterMs: env.BUILD_TIMEOUT_MS + 5 * 60_000,
  });
  logger.info(
    { port: env.PORT, runner: env.BUILD_RUNNER, storage: env.STORAGE_DRIVER },
    'api listening',
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    void api
      .close()
      .then(() => Promise.allSettled([prisma.$disconnect(), redis.quit()]))
      .then(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
