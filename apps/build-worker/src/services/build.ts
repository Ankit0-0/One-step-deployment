import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@osd/shared/logger';
import type { ObjectStore } from '@osd/storage';
import { BuildError } from '../lib/errors.js';
import { collectOutputFiles } from '../lib/files.js';
import { findOutputDir, planBuild } from '../lib/project.js';
import { CommandError, runCommand, type RunCommandOptions } from '../lib/run-command.js';
import type { BuildInput } from '../lib/validate.js';
import type { EventPublisher } from './publisher.js';
import { planUpload, uploadFiles } from './upload.js';

export interface BuildLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxOutputFiles: number;
  maxLogBytes: number;
}

export interface BuildDeps {
  input: BuildInput;
  store: ObjectStore;
  publisher: EventPublisher;
  logger: Logger;
  workDir: string;
  limits: BuildLimits;
  signal?: AbortSignal;
  /** Injected for tests. */
  run?: typeof runCommand;
}

export type BuildResult =
  { ok: true; files: number } | { ok: false; error: string; canceled: boolean };

/** Network settings a build may need behind a corporate proxy; copied through when set. */
const PASSTHROUGH_ENV = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'GIT_SSL_CAINFO',
] as const;

/** Environment for untrusted install/build commands: no Redis or storage credentials. */
export function buildEnv(
  home: string,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const passthrough: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = source[key];
    if (value) passthrough[key] = value;
  }
  return {
    ...passthrough,
    PATH: source.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    CI: 'true',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_update_notifier: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/**
 * clone → install → build → upload, publishing every output line and status change.
 * The deployment was created QUEUED by the api; this moves it through BUILDING → UPLOADING → READY,
 * or to FAILED with a message safe to show the user.
 */
export async function runBuild(deps: BuildDeps): Promise<BuildResult> {
  const { input, publisher, logger, limits } = deps;
  const run = deps.run ?? runCommand;
  const deadline = Date.now() + limits.timeoutMs;

  await mkdir(deps.workDir, { recursive: true });
  const root = await mkdtemp(join(deps.workDir, 'build-'));
  const repoDir = join(root, 'repo');
  const home = join(root, 'home');
  await mkdir(home);

  const exec = async (command: string, args: string[], cwd: string) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CommandError('timeout', 'Build timed out');
    await publisher.log('info', `$ ${[command, ...args].join(' ')}`);
    const options: RunCommandOptions = {
      cwd,
      env: buildEnv(home),
      timeoutMs: remaining,
      maxLogBytes: limits.maxLogBytes,
      signal: deps.signal,
      onLine: (stream, line) => {
        void publisher.log(stream === 'stderr' ? 'warn' : 'info', line).catch(() => {});
      },
    };
    await run(command, args, options);
  };

  try {
    await publisher.status('BUILDING');
    await publisher.log('info', `Cloning ${input.cloneUrl}`);
    await exec('git', ['clone', '--depth', '1', '--no-tags', '--', input.cloneUrl, repoDir], root);

    let commitSha: string | undefined;
    await run('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      env: buildEnv(home),
      timeoutMs: 10_000,
      maxLogBytes: 1024,
      onLine: (_s, line) => {
        if (/^[0-9a-f]{40}$/.test(line.trim())) commitSha = line.trim();
      },
    });

    const plan = await planBuild(repoDir);
    let outputDir = repoDir;
    if (plan.kind === 'node' && plan.install && plan.build) {
      await publisher.log('info', `Detected ${plan.packageManager} project`);
      await exec(plan.install.command, plan.install.args, repoDir);
      await exec(plan.build.command, plan.build.args, repoDir);
      outputDir = await findOutputDir(repoDir);
    } else {
      await publisher.log('info', 'No build script; deploying static files');
    }

    await publisher.status('UPLOADING', { commitSha });
    const files = await collectOutputFiles(
      outputDir,
      { maxBytes: limits.maxOutputBytes, maxFiles: limits.maxOutputFiles },
      (path, reason) => void publisher.log('warn', `Skipped ${path}: ${reason}`).catch(() => {}),
    );
    await publisher.log('info', `Uploading ${files.length} files`);
    await uploadFiles(deps.store, planUpload(input.deploymentId, files), { signal: deps.signal });
    await publisher.log('info', 'Deployment ready');
    await publisher.status('READY', { commitSha });
    return { ok: true, files: files.length };
  } catch (err) {
    const canceled = deps.signal?.aborted === true;
    const message = userFacingError(err);
    logger.error({ err }, 'build failed');
    if (!canceled) {
      await publisher.log('error', message).catch(() => {});
      await publisher.status('FAILED', { errorMessage: message }).catch(() => {});
    }
    return { ok: false, error: message, canceled };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

function userFacingError(err: unknown): string {
  if (err instanceof CommandError) {
    if (err.reason === 'timeout') return 'Build timed out';
    if (err.reason === 'output-limit') return 'Build produced too much log output';
    if (err.reason === 'aborted') return 'Build canceled';
    return err.message;
  }
  if (err instanceof BuildError) return err.message;
  // Anything else (storage, filesystem) may carry internal details; keep it in the worker log only.
  return 'Build failed due to an internal error';
}
