import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadApiEnv, loadProxyEnv, loadWorkerEnv, type EnvSource } from '../src/index.js';

const aws = fileURLToPath(new URL('../../../infra/aws/', import.meta.url));

/** Same substitution as infra/aws/render.mjs, with dummy values. */
function renderJson(path: string): unknown {
  const text = readFileSync(aws + path, 'utf8').replace(/\$\{([A-Z_]+)\}/g, (_m, name: string) =>
    name === 'AWS_ACCOUNT_ID' ? '123456789012' : `test-${name.toLowerCase().replace(/_/g, '-')}`,
  );
  return JSON.parse(text);
}

function readEnvFile(path: string): EnvSource {
  const env: EnvSource = {};
  for (const raw of readFileSync(aws + path, 'utf8').split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (line && !line.startsWith('#') && eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
}
interface TaskDefinition {
  containerDefinitions: Array<{
    name: string;
    environment: Array<{ name: string; value: string }>;
    secrets: Array<{ name: string }>;
  }>;
}

describe('infra/aws templates', () => {
  it('are valid JSON after rendering', () => {
    for (const dir of ['iam', 'ecs', 's3']) {
      for (const file of readdirSync(aws + dir).filter((f) => f.endsWith('.json'))) {
        expect(() => renderJson(`${dir}/${file}`), file).not.toThrow();
      }
    }
  });

  it('lets the build worker write deployments/* and nothing else', () => {
    const policy = renderJson('iam/build-worker-task-role.policy.json') as {
      Statement: Statement[];
    };
    expect(policy.Statement).toEqual([
      expect.objectContaining({
        Effect: 'Allow',
        Action: 's3:PutObject',
        Resource: 'arn:aws:s3:::test-bucket/deployments/*',
      }),
    ]);
  });

  it('gives the worker task a complete env without database credentials', () => {
    const def = renderJson('ecs/build-worker.task-definition.json') as TaskDefinition;
    const container = def.containerDefinitions[0]!;
    const env: EnvSource = Object.fromEntries(container.environment.map((e) => [e.name, e.value]));
    for (const secret of container.secrets) env[secret.name] = 'redis://:secret@10.0.1.10:6379';
    // Per-build values come from EcsRunner's container overrides.
    Object.assign(env, { DEPLOYMENT_ID: 'dep1', GIT_URL: 'https://github.com/a/b' });

    expect(() => loadWorkerEnv(env)).not.toThrow();
    expect(Object.keys(env).some((k) => k.startsWith('DATABASE'))).toBe(false);
  });

  it('keeps the EC2 env examples valid for the api and proxy', () => {
    const redis = { REDIS_URL: 'redis://:secret@redis:6379' };
    const api = loadApiEnv({ ...readEnvFile('ec2/api.env.example'), ...redis });
    expect(api.NODE_ENV).toBe('production');
    expect(api.BUILD_RUNNER).toBe('ecs');
    expect(() => loadProxyEnv({ ...readEnvFile('ec2/proxy.env.example'), ...redis })).not.toThrow();

    const def = renderJson('ecs/build-worker.task-definition.json') as TaskDefinition;
    expect(api.BUILD_RUNNER === 'ecs' && api.ECS_CONTAINER_NAME).toBe(
      def.containerDefinitions[0]!.name,
    );
  });
});
