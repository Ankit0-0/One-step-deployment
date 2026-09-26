import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { MemoryObjectStore } from '@osd/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandError, type runCommand } from '../src/lib/run-command.js';
import { buildEnv, runBuild, type BuildDeps } from '../src/services/build.js';
import type { EventPublisher } from '../src/services/publisher.js';

const deploymentId = 'cm1abcdefghijklmnopqrstuv';
const sha = 'a'.repeat(40);

class FakePublisher implements EventPublisher {
  events: Array<{ type: string; value: string; extra?: object }> = [];
  log(level: string, message: string) {
    this.events.push({ type: 'log', value: `${level}:${message}` });
    return Promise.resolve();
  }
  status(status: string, extra?: object) {
    this.events.push({ type: 'status', value: status, extra });
    return Promise.resolve();
  }
  statuses() {
    return this.events.filter((e) => e.type === 'status').map((e) => e.value);
  }
}

type Repo = Record<string, string>;
type Calls = Array<{ command: string; args: readonly string[]; env: Record<string, string> }>;

/** Fake runCommand: `git clone` writes `repo`, `<pm> run build` writes `built`. */
function fakeRun(repo: Repo, built: Repo, calls: Calls, fail?: string): typeof runCommand {
  return async (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (fail && command === fail)
      throw new CommandError('exit', `${command} exited with code 1`, 1);
    if (command === 'git' && args[0] === 'clone') {
      const dir = args[args.length - 1]!;
      await writeTree(dir, repo);
    } else if (command === 'git' && args[0] === 'rev-parse') {
      options.onLine('stdout', sha);
    } else if (args[0] === 'run' && args[1] === 'build') {
      options.onLine('stdout', 'building…');
      await writeTree(options.cwd, built);
    }
  };
}

async function writeTree(dir: string, tree: Repo) {
  for (const [path, content] of Object.entries(tree)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
}

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'osd-build-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function deps(overrides: Partial<BuildDeps>): BuildDeps {
  return {
    input: { deploymentId, cloneUrl: 'https://github.com/a/b.git' },
    store: new MemoryObjectStore(),
    publisher: new FakePublisher(),
    logger: pino({ level: 'silent' }),
    workDir,
    limits: { timeoutMs: 60_000, maxOutputBytes: 1e6, maxOutputFiles: 100, maxLogBytes: 1e6 },
    ...overrides,
  };
}

describe('runBuild', () => {
  it('builds an npm project and uploads dist/', async () => {
    const store = new MemoryObjectStore();
    const publisher = new FakePublisher();
    const calls: Calls = [];
    const result = await runBuild(
      deps({
        store,
        publisher,
        run: fakeRun(
          {
            'package.json': JSON.stringify({ scripts: { build: 'vite build' } }),
            'package-lock.json': '{}',
          },
          { 'dist/index.html': '<html></html>', 'dist/assets/app.js': 'x' },
          calls,
        ),
      }),
    );

    expect(result).toEqual({ ok: true, files: 2 });
    expect(publisher.statuses()).toEqual(['BUILDING', 'UPLOADING', 'READY']);
    expect(publisher.events.find((e) => e.value === 'READY')?.extra).toEqual({ commitSha: sha });
    expect([...store.objects.keys()].sort()).toEqual([
      `deployments/${deploymentId}/assets/app.js`,
      `deployments/${deploymentId}/index.html`,
    ]);
    expect(store.objects.get(`deployments/${deploymentId}/index.html`)?.contentType).toBe(
      'text/html; charset=utf-8',
    );
    expect(calls.map((c) => [c.command, ...c.args].join(' '))).toContain(
      'npm ci --no-audit --no-fund',
    );
    expect(calls[0]!.args).toContain('--');
  });

  it('never hands secrets to build commands', async () => {
    process.env.REDIS_URL = 'redis://:secret@x';
    const calls: Calls = [];
    await runBuild(
      deps({
        run: fakeRun(
          { 'package.json': '{"scripts":{"build":"x"}}' },
          { 'dist/index.html': 'x' },
          calls,
        ),
      }),
    );
    for (const call of calls) {
      expect(Object.keys(call.env).sort()).not.toContain('REDIS_URL');
      expect(JSON.stringify(call.env)).not.toContain('secret');
    }
    delete process.env.REDIS_URL;
  });

  it('deploys a static site without a build script', async () => {
    const store = new MemoryObjectStore();
    const calls: Calls = [];
    const result = await runBuild(
      deps({ store, run: fakeRun({ 'index.html': 'hi', 'style.css': 'x' }, {}, calls) }),
    );
    expect(result.ok).toBe(true);
    expect(store.objects.size).toBe(2);
    expect(calls.some((c) => c.args[0] === 'run')).toBe(false);
  });

  it('uses pnpm when a pnpm lockfile is present', async () => {
    const calls: Calls = [];
    await runBuild(
      deps({
        run: fakeRun(
          { 'package.json': '{"scripts":{"build":"x"}}', 'pnpm-lock.yaml': '' },
          { 'build/index.html': 'x' },
          calls,
        ),
      }),
    );
    expect(calls.map((c) => c.command)).toContain('pnpm');
  });

  it('reports FAILED with the command error when the build fails', async () => {
    const publisher = new FakePublisher();
    const result = await runBuild(
      deps({
        publisher,
        run: fakeRun({ 'package.json': '{"scripts":{"build":"x"}}' }, {}, [], 'npm'),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: 'npm exited with code 1' });
    expect(publisher.statuses()).toEqual(['BUILDING', 'FAILED']);
  });

  it('fails clearly when there is nothing to deploy', async () => {
    const publisher = new FakePublisher();
    const result = await runBuild(deps({ publisher, run: fakeRun({ 'README.md': 'x' }, {}, []) }));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing to deploy/) });
  });

  it('hides internal error details from the user', async () => {
    const publisher = new FakePublisher();
    const store = new MemoryObjectStore();
    store.put = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:9000'));
    const result = await runBuild(
      deps({ publisher, store, run: fakeRun({ 'index.html': 'x' }, {}, []) }),
    );
    expect(result).toMatchObject({ ok: false, error: 'Build failed due to an internal error' });
    expect(JSON.stringify(publisher.events)).not.toContain('10.0.0.5');
  });

  it('does not publish FAILED when canceled', async () => {
    const publisher = new FakePublisher();
    const controller = new AbortController();
    controller.abort();
    const run: typeof runCommand = () =>
      Promise.reject(new CommandError('aborted', 'git was canceled'));
    const result = await runBuild(deps({ publisher, signal: controller.signal, run }));
    expect(result).toMatchObject({ ok: false, canceled: true });
    expect(publisher.statuses()).toEqual(['BUILDING']);
  });
});

describe('buildEnv', () => {
  it('keeps proxy settings but nothing else from the worker env', () => {
    const env = buildEnv('/home/build', {
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:3128',
      REDIS_URL: 'redis://:secret@redis',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:3128',
      HOME: '/home/build',
      CI: 'true',
      GIT_TERMINAL_PROMPT: '0',
      npm_config_update_notifier: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    });
  });
});
