import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BuildError } from './errors.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface BuildPlan {
  kind: 'node' | 'static';
  packageManager?: PackageManager;
  install?: { command: string; args: string[] };
  build?: { command: string; args: string[] };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Output folders checked in order after the build; the first with an index.html wins. */
export const OUTPUT_DIR_CANDIDATES = ['dist', 'build', 'out'] as const;

/**
 * Decide how to build a checked-out repo.
 * - package.json with a "build" script → install with the lockfile's package manager, then build.
 * - no build script but an index.html at the root → plain static site, uploaded as is.
 */
export async function planBuild(repoDir: string): Promise<BuildPlan> {
  const pkgPath = join(repoDir, 'package.json');
  if (await exists(pkgPath)) {
    let scripts: Record<string, unknown> = {};
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      scripts = pkg.scripts ?? {};
    } catch {
      throw new BuildError('package.json is not valid JSON');
    }
    if (typeof scripts.build === 'string') {
      const pm = await detectPackageManager(repoDir);
      return {
        kind: 'node',
        packageManager: pm,
        install: await installCommand(pm, repoDir),
        build: { command: pm, args: ['run', 'build'] },
      };
    }
  }
  if (await exists(join(repoDir, 'index.html'))) return { kind: 'static' };
  throw new BuildError('Nothing to deploy: add a "build" script to package.json or an index.html');
}

async function detectPackageManager(repoDir: string): Promise<PackageManager> {
  if (await exists(join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(repoDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

async function installCommand(
  pm: PackageManager,
  repoDir: string,
): Promise<{ command: string; args: string[] }> {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['install', '--frozen-lockfile'] };
    case 'yarn':
      return { command: 'yarn', args: ['install', '--frozen-lockfile', '--non-interactive'] };
    case 'npm':
      return (await exists(join(repoDir, 'package-lock.json')))
        ? { command: 'npm', args: ['ci', '--no-audit', '--no-fund'] }
        : { command: 'npm', args: ['install', '--no-audit', '--no-fund'] };
  }
}

export async function findOutputDir(repoDir: string): Promise<string> {
  for (const dir of OUTPUT_DIR_CANDIDATES) {
    if (await exists(join(repoDir, dir, 'index.html'))) return join(repoDir, dir);
  }
  for (const dir of OUTPUT_DIR_CANDIDATES) {
    if (await exists(join(repoDir, dir))) return join(repoDir, dir);
  }
  throw new BuildError(`No build output found (looked for ${OUTPUT_DIR_CANDIDATES.join(', ')})`);
}
