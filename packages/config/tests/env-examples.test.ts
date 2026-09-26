import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadApiEnv,
  loadProxyEnv,
  loadWebEnv,
  loadWorkerEnv,
  type EnvSource,
} from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Minimal KEY=VALUE parser; enough for our .env.example files. */
function readEnvExample(relativePath: string): EnvSource {
  const env: EnvSource = {};
  for (const raw of readFileSync(repoRoot + relativePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

// Keeps every checked-in .env.example in sync with its zod schema.
describe('.env.example files', () => {
  it('root exists', () => {
    expect(existsSync(repoRoot + '.env.example')).toBe(true);
  });

  it('api', () => {
    expect(() => loadApiEnv(readEnvExample('apps/api/.env.example'))).not.toThrow();
  });

  it('build-worker (with per-build values the runner injects)', () => {
    const env = {
      ...readEnvExample('apps/build-worker/.env.example'),
      DEPLOYMENT_ID: 'dep_example',
      GIT_URL: 'https://github.com/a/b',
    };
    expect(() => loadWorkerEnv(env)).not.toThrow();
  });

  it('proxy', () => {
    expect(() => loadProxyEnv(readEnvExample('apps/proxy/.env.example'))).not.toThrow();
  });

  it('web', () => {
    expect(() => loadWebEnv(readEnvExample('apps/web/.env.example'))).not.toThrow();
  });
});
