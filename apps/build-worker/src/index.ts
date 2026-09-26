import { Redis } from 'ioredis';
import { EnvValidationError, loadWorkerEnv } from '@osd/config';
import { createLogger } from '@osd/shared/logger';
import { S3ObjectStore } from '@osd/storage';
import { InputError, validateBuildInput } from './lib/validate.js';
import { runBuild } from './services/build.js';
import { RedisEventPublisher } from './services/publisher.js';

async function main(): Promise<number> {
  let env;
  try {
    env = loadWorkerEnv();
  } catch (err) {
    // No logger or Redis yet; stderr is all we have.
    process.stderr.write(`${err instanceof EnvValidationError ? err.message : String(err)}\n`);
    return 2;
  }

  const logger = createLogger({
    service: 'build-worker',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
    base: { deploymentId: env.DEPLOYMENT_ID, requestId: env.REQUEST_ID },
  });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const publisher = new RedisEventPublisher(redis, env.DEPLOYMENT_ID);

  const controller = new AbortController();
  const onSignal = (signal: string) => {
    logger.warn({ signal }, 'received stop signal, canceling build');
    controller.abort();
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  try {
    let input;
    try {
      input = validateBuildInput(env.DEPLOYMENT_ID, env.GIT_URL);
    } catch (err) {
      const message = err instanceof InputError ? err.message : 'Invalid build input';
      await publisher.status('FAILED', { errorMessage: message });
      logger.error({ err }, 'invalid input');
      return 1;
    }

    const result = await runBuild({
      input,
      store: S3ObjectStore.fromEnv(env),
      publisher,
      logger,
      workDir: env.WORK_DIR,
      signal: controller.signal,
      limits: {
        timeoutMs: env.BUILD_TIMEOUT_MS,
        maxOutputBytes: env.MAX_OUTPUT_BYTES,
        maxOutputFiles: 20_000,
        maxLogBytes: 20 * 1024 * 1024,
      },
    });
    logger.info({ result }, 'build finished');
    return result.ok ? 0 : 1;
  } finally {
    await redis.quit().catch(() => {});
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
