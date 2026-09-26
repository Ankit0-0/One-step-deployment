import { createServer } from 'node:http';
import { Redis } from 'ioredis';
import { loadProxyEnv } from '@osd/config';
import { createPrismaClient } from '@osd/db';
import { createLogger } from '@osd/shared/logger';
import { S3ObjectStore } from '@osd/storage';
import { createApp } from './app.js';
import { redisCache } from './services/resolver.js';

const env = loadProxyEnv();
const logger = createLogger({
  service: 'proxy',
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});
const prisma = createPrismaClient();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on('error', (err) => logger.warn({ err }, 'redis error'));
const store = S3ObjectStore.fromEnv(env);

const app = createApp({
  rootDomain: env.ROOT_DOMAIN,
  cache: redisCache(redis),
  lookup: (slug) =>
    prisma.project.findUnique({ where: { slug }, select: { currentDeploymentId: true } }),
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  store,
  logger,
  metricsToken: env.METRICS_TOKEN,
  trustProxy: env.TRUST_PROXY,
  production: env.NODE_ENV === 'production',
  readiness: {
    db: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
    storage: () => store.ping(),
  },
});

const server = createServer(app);
server.listen(env.PORT, () =>
  logger.info({ port: env.PORT, rootDomain: env.ROOT_DOMAIN }, 'proxy listening'),
);

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.allSettled([prisma.$disconnect(), redis.quit()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
