import { describe, expect, it } from 'vitest';
import { matchHost } from '../src/lib/host.js';
import { BadPathError, cacheControlFor, isSpaRoute, objectPathFor } from '../src/lib/path.js';

describe('matchHost', () => {
  const root = 'example.dev';
  it.each([
    ['my-app.example.dev', { kind: 'site', slug: 'my-app' }],
    ['My-App.Example.dev:443', { kind: 'site', slug: 'my-app' }],
    ['my-app.example.dev.', { kind: 'site', slug: 'my-app' }],
    ['example.dev', { kind: 'root' }],
    ['10.0.0.1:8000', { kind: 'root' }],
    [undefined, { kind: 'root' }],
    ['a.b.example.dev', { kind: 'invalid' }],
    ['ab.example.dev', { kind: 'invalid' }],
    ['bad_slug.example.dev', { kind: 'invalid' }],
    ['-bad.example.dev', { kind: 'invalid' }],
  ])('%s', (host, expected) => {
    expect(matchHost(host, root)).toEqual(expected);
  });

  it('works with a localhost root and port', () => {
    expect(matchHost('demo-site.localhost:8000', 'localhost')).toEqual({
      kind: 'site',
      slug: 'demo-site',
    });
  });
});

describe('objectPathFor', () => {
  it.each([
    ['/', 'index.html'],
    ['/about', 'about'],
    ['/docs/', 'docs/index.html'],
    ['/assets/app.js', 'assets/app.js'],
    ['/a%20b.png', 'a b.png'],
  ])('%s → %s', (url, path) => {
    expect(objectPathFor(url)).toBe(path);
  });

  it.each(['/../secret', '/%2e%2e/secret', '/a/%2e%2e/%2e%2e/x', '/%00', '/%E0%A4%A', '/a\\b'])(
    'rejects %s',
    (url) => {
      expect(() => objectPathFor(url)).toThrow(BadPathError);
    },
  );

  it('detects SPA routes and cache policy', () => {
    expect(isSpaRoute('dashboard/settings')).toBe(true);
    expect(isSpaRoute('app.js')).toBe(false);
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(cacheControlFor('app.js')).toBe('public, max-age=3600');
  });
});
