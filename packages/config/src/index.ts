import { loadEnv, type EnvSource } from './load.js';
import { apiEnvSchema, proxyEnvSchema, webEnvSchema, workerEnvSchema } from './schemas.js';

export * from './load.js';
export * from './schemas.js';

export const loadApiEnv = (source?: EnvSource) => loadEnv(apiEnvSchema, { service: 'api', source });
export const loadWorkerEnv = (source?: EnvSource) =>
  loadEnv(workerEnvSchema, { service: 'build-worker', source });
export const loadProxyEnv = (source?: EnvSource) =>
  loadEnv(proxyEnvSchema, { service: 'proxy', source });
export const loadWebEnv = (source?: EnvSource) => loadEnv(webEnvSchema, { service: 'web', source });
