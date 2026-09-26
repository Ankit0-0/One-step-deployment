import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { sanitizeRelativePath } from '@osd/storage';
import { BuildError } from './errors.js';

export interface OutputFile {
  absolutePath: string;
  /** posix path relative to the output root, already sanitized */
  relativePath: string;
  size: number;
}

export class OutputError extends BuildError {
  constructor(message: string) {
    super(message);
    this.name = 'OutputError';
  }
}

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/**
 * Walk the build output. Symlinks are never followed (a build could point one at /proc or a
 * secret), and every path goes through the same sanitizer the storage keys use.
 */
export async function collectOutputFiles(
  root: string,
  limits: { maxBytes: number; maxFiles: number },
  onSkip: (path: string, reason: string) => void = () => {},
): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name);
      const rel = relative(root, absolutePath).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        onSkip(rel, 'symbolic link');
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        onSkip(rel, 'not a regular file');
        continue;
      }
      const stats = await lstat(absolutePath);
      totalBytes += stats.size;
      if (totalBytes > limits.maxBytes) {
        throw new OutputError(`Build output is larger than ${limits.maxBytes} bytes`);
      }
      if (files.length + 1 > limits.maxFiles) {
        throw new OutputError(`Build output has more than ${limits.maxFiles} files`);
      }
      files.push({ absolutePath, relativePath: sanitizeRelativePath(rel), size: stats.size });
    }
  }

  await walk(root);
  if (files.length === 0) throw new OutputError('Build output is empty');
  return files;
}
