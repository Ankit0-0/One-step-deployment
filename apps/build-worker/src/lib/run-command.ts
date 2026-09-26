import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type CommandErrorReason = 'spawn' | 'exit' | 'timeout' | 'output-limit' | 'aborted';

export class CommandError extends Error {
  constructor(
    readonly reason: CommandErrorReason,
    message: string,
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface RunCommandOptions {
  cwd: string;
  /** The complete child environment. Nothing is inherited from the worker process. */
  env: Record<string, string>;
  timeoutMs: number;
  /** Kill the command once its combined stdout+stderr exceeds this many bytes. */
  maxLogBytes: number;
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
  signal?: AbortSignal;
}

/**
 * Run a command with an argument array (never through a shell), streaming output line by line.
 * The child gets its own process group so a timeout or cancel kills everything it spawned.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CommandError('aborted', `${command} aborted before start`));
      return;
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let failure: CommandError | null = null;
    let logBytes = 0;

    const killGroup = (reason: CommandErrorReason, message: string) => {
      if (failure) return;
      failure = new CommandError(reason, message);
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(
      () =>
        killGroup('timeout', `${command} timed out after ${Math.round(options.timeoutMs / 1000)}s`),
      options.timeoutMs,
    );
    const onAbort = () => killGroup('aborted', `${command} was canceled`);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    for (const stream of ['stdout', 'stderr'] as const) {
      const source = child[stream];
      source.on('data', (chunk: Buffer) => {
        logBytes += chunk.length;
        if (logBytes > options.maxLogBytes) {
          killGroup(
            'output-limit',
            `${command} produced more than ${options.maxLogBytes} bytes of output`,
          );
        }
      });
      createInterface({ input: source, crlfDelay: Infinity }).on('line', (line) => {
        if (!failure) options.onLine(stream, line);
      });
    }

    child.on('error', (err) => {
      failure ??= new CommandError('spawn', `Could not start ${command}: ${err.message}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new CommandError('exit', `${command} exited with code ${code}`, code));
    });
  });
}
