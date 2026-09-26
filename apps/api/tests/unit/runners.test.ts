import { RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { describe, expect, it, vi } from 'vitest';
import { workerEventSchema, type WorkerEvent } from '@osd/shared';
import { MemoryObjectStore } from '@osd/storage';
import {
  DockerRunner,
  parseMemory,
  type DockerApi,
} from '../../src/modules/runners/docker-runner.js';
import { EcsRunner } from '../../src/modules/runners/ecs-runner.js';
import { MockRunner } from '../../src/modules/runners/mock-runner.js';

const input = {
  deploymentId: 'cm1abcdefghijklmnopqrstuv',
  gitUrl: 'https://github.com/a/b',
  requestId: 'req-1',
};

describe('DockerRunner', () => {
  type Call = { method: string; path: string; body?: unknown };
  const id = 'f'.repeat(64);

  function fakeApi(
    responses: Record<string, { status: number; body?: string }>,
    calls: Call[],
  ): DockerApi {
    return async (method, path, body) => {
      calls.push({ method, path, body });
      const key = Object.keys(responses).find((k) => `${method} ${path}`.startsWith(k));
      const res = key ? responses[key]! : { status: 500 };
      return { status: res.status, body: res.body ?? '' };
    };
  }

  it('creates and starts a locked-down container with per-build env', async () => {
    const calls: Call[] = [];
    const runner = new DockerRunner({
      image: 'osd/build-worker:local',
      network: 'osd_default',
      memory: '2g',
      cpus: '1',
      workerEnv: { REDIS_URL: 'redis://:secret@redis:6379' },
      api: fakeApi(
        {
          'POST /containers/create': { status: 201, body: JSON.stringify({ Id: id }) },
          [`POST /containers/${id}/start`]: { status: 204 },
        },
        calls,
      ),
    });

    expect(await runner.start(input)).toEqual({ ref: id });
    expect(calls[0]!.path).toBe(`/containers/create?name=osd-build-${input.deploymentId}`);
    const body = calls[0]!.body as {
      Image: string;
      Env: string[];
      HostConfig: Record<string, unknown>;
    };
    expect(body.Image).toBe('osd/build-worker:local');
    expect(body.Env).toEqual(
      expect.arrayContaining([
        'REDIS_URL=redis://:secret@redis:6379',
        `DEPLOYMENT_ID=${input.deploymentId}`,
        `GIT_URL=${input.gitUrl}`,
        'REQUEST_ID=req-1',
      ]),
    );
    expect(body.Env.some((e) => e.startsWith('DATABASE_URL'))).toBe(false);
    expect(body.HostConfig).toMatchObject({
      AutoRemove: true,
      Memory: 2 * 1024 ** 3,
      NanoCpus: 1e9,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: 'osd_default',
    });
    expect(calls[1]).toMatchObject({ method: 'POST', path: `/containers/${id}/start` });
  });

  it('surfaces create failures and cleans up failed starts', async () => {
    const calls: Call[] = [];
    const noImage = new DockerRunner({
      image: 'missing',
      memory: '1g',
      cpus: '1',
      workerEnv: {},
      api: fakeApi({ 'POST /containers/create': { status: 404, body: 'No such image' } }, calls),
    });
    await expect(noImage.start(input)).rejects.toThrow(/docker create failed \(404\)/);

    const cleanup: Call[] = [];
    const badStart = new DockerRunner({
      image: 'x',
      memory: '1g',
      cpus: '1',
      workerEnv: {},
      api: fakeApi(
        {
          'POST /containers/create': { status: 201, body: JSON.stringify({ Id: id }) },
          [`POST /containers/${id}/start`]: { status: 500 },
          [`DELETE /containers/${id}`]: { status: 204 },
        },
        cleanup,
      ),
    });
    await expect(badStart.start(input)).rejects.toThrow(/docker start failed/);
    expect(cleanup.at(-1)).toMatchObject({ method: 'DELETE' });
  });

  it('treats already-stopped or removed containers as stopped', async () => {
    for (const status of [204, 304, 404]) {
      const runner = new DockerRunner({
        image: 'x',
        memory: '1g',
        cpus: '1',
        workerEnv: {},
        api: fakeApi({ POST: { status } }, []),
      });
      await expect(runner.stop(id)).resolves.toBeUndefined();
    }
    const runner = new DockerRunner({
      image: 'x',
      memory: '1g',
      cpus: '1',
      workerEnv: {},
      api: fakeApi({}, []),
    });
    await expect(runner.stop('../../etc')).rejects.toThrow(/invalid container id/);
  });

  it.each([
    ['512m', 512 * 1024 ** 2],
    ['2g', 2 * 1024 ** 3],
    ['1.5G', 1.5 * 1024 ** 3],
    ['1024', 1024],
  ])('parses memory %s', (value, bytes) => {
    expect(parseMemory(value)).toBe(bytes);
  });
});

describe('EcsRunner', () => {
  const options = {
    cluster: 'builds',
    taskDefinition: 'build-worker:3',
    containerName: 'build-worker',
    subnets: ['subnet-a'],
    securityGroups: ['sg-1'],
    assignPublicIp: true,
    buildTimeoutMs: 600_000,
  };

  it('runs a Fargate task with per-build env overrides (no AWS call)', async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (cmd: unknown) => {
        sent.push(cmd);
        return { tasks: [{ taskArn: 'arn:aws:ecs:task/1' }] };
      },
    } as never;
    const runner = new EcsRunner(client, options);
    expect(await runner.start(input)).toEqual({ ref: 'arn:aws:ecs:task/1' });

    const cmd = sent[0] as RunTaskCommand;
    expect(cmd).toBeInstanceOf(RunTaskCommand);
    expect(cmd.input.launchType).toBe('FARGATE');
    expect(cmd.input.networkConfiguration?.awsvpcConfiguration?.assignPublicIp).toBe('ENABLED');
    const envNames = cmd.input.overrides?.containerOverrides?.[0]?.environment?.map((e) => e.name);
    expect(envNames).toEqual(['DEPLOYMENT_ID', 'GIT_URL', 'REQUEST_ID', 'BUILD_TIMEOUT_MS']);
  });

  it('surfaces RunTask failures', async () => {
    const client = {
      send: async () => ({ tasks: [], failures: [{ reason: 'RESOURCE:CPU' }] }),
    } as never;
    await expect(new EcsRunner(client, options).start(input)).rejects.toThrow(/RESOURCE:CPU/);
  });

  it('stops tasks by ARN', async () => {
    const sent: unknown[] = [];
    const client = { send: async (cmd: unknown) => sent.push(cmd) } as never;
    await new EcsRunner(client, options).stop('arn:1');
    expect(sent[0]).toBeInstanceOf(StopTaskCommand);
    expect((sent[0] as StopTaskCommand).input).toMatchObject({ cluster: 'builds', task: 'arn:1' });
  });
});

describe('MockRunner', () => {
  const deploymentId = 'cm1abcdefghijklmnopqrstuv';

  function setup(stepMs = 0) {
    const events: WorkerEvent[] = [];
    const channels = new Set<string>();
    const sink = {
      publish: (channel: string, message: string) => {
        channels.add(channel);
        events.push(workerEventSchema.parse(JSON.parse(message)));
        return Promise.resolve(1);
      },
    };
    const store = new MemoryObjectStore();
    const runner = new MockRunner({ sink, store, stepMs });
    return { runner, events, channels, store };
  }

  const statuses = (events: WorkerEvent[]) =>
    events.flatMap((e) => (e.type === 'status' ? [e.status] : []));

  it('publishes valid worker events through to READY and writes a site', async () => {
    const { runner, events, channels, store } = setup();
    expect(await runner.start({ ...input, deploymentId })).toEqual({ ref: deploymentId });
    await vi.waitFor(() => expect(statuses(events)).toContain('READY'));

    expect(statuses(events)).toEqual(['BUILDING', 'UPLOADING', 'READY']);
    expect(channels).toEqual(new Set([`deployment:${deploymentId}`]));
    expect(events.filter((e) => e.type === 'log').length).toBeGreaterThan(5);
    const page = store.objects.get(`deployments/${deploymentId}/index.html`);
    expect(page?.contentType).toBe('text/html; charset=utf-8');
  });

  it('stops publishing when canceled', async () => {
    const { runner, store, events } = setup(20);
    await runner.start({ ...input, deploymentId });
    await vi.waitFor(() => expect(statuses(events)).toContain('BUILDING'));
    await runner.stop(deploymentId);
    const count = events.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBe(count);
    expect(statuses(events)).not.toContain('READY');
    expect(store.objects.size).toBe(0);
  });
});
