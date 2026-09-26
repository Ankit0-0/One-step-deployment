import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutputError, collectOutputFiles } from '../src/lib/files.js';
import { planUpload } from '../src/services/upload.js';

let root: string;
const limits = { maxBytes: 1024 * 1024, maxFiles: 100 };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'osd-files-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('collectOutputFiles', () => {
  it('collects nested files with posix relative paths', async () => {
    await mkdir(join(root, 'assets/js'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<h1>hi</h1>');
    await writeFile(join(root, 'assets/js/app.js'), 'console.log(1)');
    const files = await collectOutputFiles(root, limits);
    expect(files.map((f) => f.relativePath).sort()).toEqual(['assets/js/app.js', 'index.html']);
  });

  it('never follows symlinks (path traversal via link)', async () => {
    await writeFile(join(root, 'index.html'), 'x');
    await symlink('/etc/passwd', join(root, 'passwd'));
    await symlink('/etc', join(root, 'etc-dir'));
    const skipped: string[] = [];
    const files = await collectOutputFiles(root, limits, (p) => skipped.push(p));
    expect(files.map((f) => f.relativePath)).toEqual(['index.html']);
    expect(skipped.sort()).toEqual(['etc-dir', 'passwd']);
  });

  it('skips .git and node_modules', async () => {
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, '.git/config'), 'secret');
    await writeFile(join(root, 'node_modules/x.js'), 'x');
    await writeFile(join(root, 'index.html'), 'x');
    const files = await collectOutputFiles(root, limits);
    expect(files.map((f) => f.relativePath)).toEqual(['index.html']);
  });

  it('enforces the output size limit', async () => {
    await writeFile(join(root, 'big.bin'), Buffer.alloc(2048));
    await expect(collectOutputFiles(root, { maxBytes: 1024, maxFiles: 10 })).rejects.toThrow(
      OutputError,
    );
  });

  it('enforces the file count limit', async () => {
    for (let i = 0; i < 3; i++) await writeFile(join(root, `${i}.txt`), 'x');
    await expect(collectOutputFiles(root, { maxBytes: 1024, maxFiles: 2 })).rejects.toThrow(
      /more than 2 files/,
    );
  });

  it('rejects empty output', async () => {
    await expect(collectOutputFiles(root, limits)).rejects.toThrow(/empty/);
  });
});

describe('planUpload', () => {
  it('maps files to deployments/{id}/ keys with content types', () => {
    const id = 'cm1abcdefghijklmnopqrstuv';
    const plan = planUpload(id, [
      { absolutePath: '/x/index.html', relativePath: 'index.html', size: 1 },
      { absolutePath: '/x/a/app.js', relativePath: 'a/app.js', size: 1 },
      { absolutePath: '/x/img/logo.svg', relativePath: 'img/logo.svg', size: 1 },
    ]);
    expect(plan.map((p) => [p.key, p.contentType])).toEqual([
      [`deployments/${id}/index.html`, 'text/html; charset=utf-8'],
      [`deployments/${id}/a/app.js`, 'text/javascript; charset=utf-8'],
      [`deployments/${id}/img/logo.svg`, 'image/svg+xml'],
    ]);
  });

  it('refuses traversal in relative paths', () => {
    expect(() =>
      planUpload('cm1abcdefghijklmnopqrstuv', [
        { absolutePath: '/x', relativePath: '../escape.html', size: 1 },
      ]),
    ).toThrow(/Unsafe path/);
  });
});
