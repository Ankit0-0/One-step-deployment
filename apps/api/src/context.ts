import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '@osd/db';
import { createHttpMetrics, type HttpMetrics } from '@osd/shared/http';
import type { ObjectStore } from '@osd/storage';
import { createSessionTokens, type SessionTokens } from './lib/jwt.js';
import { FixedWindowLimiter } from './lib/limiter.js';
import { createDeploymentMetrics } from './lib/metrics.js';
import type { CookieConfig } from './lib/session-cookie.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import type { EmailSender } from './modules/auth/email.js';
import { DeploymentsRepository } from './modules/deployments/deployments.repository.js';
import { DeploymentsService } from './modules/deployments/deployments.service.js';
import { DeploymentHub } from './modules/deployments/hub.js';
import { ProjectsRepository } from './modules/projects/projects.repository.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import type { BuildRunner } from './modules/runners/runner.js';

export interface ApiConfig {
  webOrigin: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  cookieSecure: boolean;
  cookieDomain?: string;
  siteUrlTemplate: string;
  maxConcurrentBuilds: number;
  trustProxy: boolean;
  metricsToken?: string;
  /** Redis key prefix for rate-limit counters. */
  rateLimitPrefix: string;
  production: boolean;
}

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
  store: ObjectStore;
  runner: BuildRunner;
  email: EmailSender;
}

export interface AppContext extends ApiDeps {
  tokens: SessionTokens;
  cookie: CookieConfig;
  hub: DeploymentHub;
  httpMetrics: HttpMetrics;
  repos: { deployments: DeploymentsRepository; projects: ProjectsRepository };
  services: { auth: AuthService; projects: ProjectsService; deployments: DeploymentsService };
}

/** Wires repositories and services. Everything external (db, redis, storage, runner, email) is injected. */
export function createContext(deps: ApiDeps): AppContext {
  const { config, prisma, redis, logger } = deps;
  const httpMetrics = createHttpMetrics('api');
  const hub = new DeploymentHub();
  const projectsRepo = new ProjectsRepository(prisma);
  const deploymentsRepo = new DeploymentsRepository(prisma);

  const auth = new AuthService(
    new AuthRepository(prisma),
    deps.email,
    new FixedWindowLimiter(redis, `${config.rateLimitPrefix}code-email:`, 5, 15 * 60),
    config.jwtSecret,
    logger,
  );
  const projects = new ProjectsService(projectsRepo, config.siteUrlTemplate);
  const deployments = new DeploymentsService({
    repo: deploymentsRepo,
    projects: projectsRepo,
    runner: deps.runner,
    hub,
    metrics: createDeploymentMetrics(httpMetrics.registry),
    logger,
    invalidateSiteCache: (key) => redis.del(key),
    maxConcurrentBuilds: config.maxConcurrentBuilds,
  });

  return {
    ...deps,
    tokens: createSessionTokens(config.jwtSecret, config.jwtTtlSeconds),
    cookie: {
      secure: config.cookieSecure,
      domain: config.cookieDomain,
      ttlSeconds: config.jwtTtlSeconds,
    },
    hub,
    httpMetrics,
    repos: { deployments: deploymentsRepo, projects: projectsRepo },
    services: { auth, projects, deployments },
  };
}
