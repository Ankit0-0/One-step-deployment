import { describe, expect, it } from 'vitest';
import {
  MemoryObjectStore,
  UnsafePathError,
  contentTypeFor,
  deploymentObjectKey,
  sanitizeRelativePath,
} from '../src/index.js';

const id = 'cm1abcdefghijklmnopqrstuv';

describe('sanitizeRelativePath', () => {
  it.each([
    ['index.html', 'index.html'],
    ['assets/app.js', 'assets/app.js'],
    ['./a/./b.css', 'a/b.css'],
    ['a//b.txt', 'a/b.txt'],
  ])('normalizes %s', (input, expected) => {
    expect(sanitizeRelativePath(input)).toBe(expected);
  });

  it.each([
    '',
    '../secret',
    'a/../../b',
    'a/..',
    '/etc/passwd',
    'a\\..\\b',
    'a\u0000b',
    '.',
    'x'.repeat(1025),
  ])('rejects %j', (input) => {
    expect(() => sanitizeRelativePath(input)).toThrow(UnsafePathError);
  });
});

describe('deploymentObjectKey', () => {
  it('maps files under deployments/{id}/', () => {
    expect(deploymentObjectKey(id, 'index.html')).toBe(`deployments/${id}/index.html`);
    expect(deploymentObjectKey(id, 'static/js/main.js')).toBe(
      `deployments/${id}/static/js/main.js`,
    );
  });

  it('rejects malformed deployment ids', () => {
    expect(() => deploymentObjectKey('../x', 'index.html')).toThrow(UnsafePathError);
    expect(() => deploymentObjectKey('ABC/DEF', 'index.html')).toThrow(UnsafePathError);
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['photo.png', 'image/png'],
    ['data.json', 'application/json; charset=utf-8'],
    ['font.woff2', 'font/woff2'],
    ['mystery.zzz', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});

describe('MemoryObjectStore', () => {
  it('round-trips objects', async () => {
    const store = new MemoryObjectStore();
    await store.put({
      key: 'k',
      body: Buffer.from('hi'),
      contentType: 'text/plain',
      contentLength: 2,
    });
    const obj = await store.get('k');
    expect(obj?.contentType).toBe('text/plain');
    expect(await store.get('missing')).toBeNull();
  });
});
