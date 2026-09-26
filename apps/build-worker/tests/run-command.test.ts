import { describe, expect, it } from 'vitest';
import { CommandError, runCommand, type RunCommandOptions } from '../src/lib/run-command.js';

function opts(overrides: Partial<RunCommandOptions> = {}) {
  const lines: string[] = [];
  const options: RunCommandOptions = {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '' },
    timeoutMs: 10_000,
    maxLogBytes: 1024 * 1024,
    onLine: (_s, l) => lines.push(l),
    ...overrides,
  };
  return { options, lines };
}

describe('runCommand', () => {
  it('streams stdout and stderr lines', async () => {
    const { options, lines } = opts();
    await runCommand('node', ['-e', 'console.log("a\\nb"); console.error("c")'], options);
    expect(lines.sort()).toEqual(['a', 'b', 'c']);
  });

  it('passes arguments without a shell', async () => {
    const { options, lines } = opts();
    await runCommand('node', ['-e', 'console.log(process.argv[1])', '$(echo pwned); ls'], options);
    expect(lines).toEqual(['$(echo pwned); ls']);
  });

  it('does not leak the parent environment', async () => {
    process.env.OSD_TEST_SECRET = 'top-secret';
    const { options, lines } = opts();
    await runCommand('node', ['-e', 'console.log(process.env.OSD_TEST_SECRET ?? "none")'], options);
    expect(lines).toEqual(['none']);
    delete process.env.OSD_TEST_SECRET;
  });

  it('rejects on non-zero exit', async () => {
    const { options } = opts();
    await expect(runCommand('node', ['-e', 'process.exit(3)'], options)).rejects.toMatchObject({
      reason: 'exit',
      exitCode: 3,
    });
  });

  it('kills the process on timeout', async () => {
    const { options } = opts({ timeoutMs: 200 });
    const started = Date.now();
    await expect(
      runCommand('node', ['-e', 'setTimeout(() => {}, 60000)'], options),
    ).rejects.toMatchObject({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('kills the process when output exceeds the limit', async () => {
    const { options } = opts({ maxLogBytes: 10_000 });
    await expect(
      runCommand('node', ['-e', 'setInterval(() => console.log("x".repeat(1000)), 1)'], options),
    ).rejects.toMatchObject({ reason: 'output-limit' });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const { options } = opts({ signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(
      runCommand('node', ['-e', 'setTimeout(() => {}, 60000)'], options),
    ).rejects.toMatchObject({ reason: 'aborted' });
  });

  it('reports missing binaries', async () => {
    const { options } = opts();
    await expect(runCommand('definitely-not-a-binary', [], options)).rejects.toBeInstanceOf(
      CommandError,
    );
  });
});
