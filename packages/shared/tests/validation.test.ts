import { describe, expect, it } from 'vitest';
import {
  createProjectBodySchema,
  emailSchema,
  gitUrlSchema,
  parseGithubUrl,
  requestCodeBodySchema,
  slugSchema,
  verifyCodeBodySchema,
} from '../src/index.js';

describe('slugSchema', () => {
  it.each(['abc', 'my-app', 'a1-b2-c3', 'x'.repeat(40)])('accepts %s', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'x'.repeat(41)],
    ['uppercase', 'MyApp'],
    ['leading hyphen', '-app'],
    ['trailing hyphen', 'app-'],
    ['double hyphen', 'my--app'],
    ['underscore', 'my_app'],
    ['dot', 'my.app'],
    ['reserved', 'www'],
    ['reserved api', 'api'],
  ])('rejects %s', (_label, slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('gitUrlSchema', () => {
  it.each([
    'https://github.com/vercel/next.js',
    'https://github.com/vercel/next.js.git',
    'https://github.com/Ankit0-0/One-step-deployment',
    'https://github.com/a/b_c-d',
  ])('accepts %s', (url) => {
    expect(gitUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'http://github.com/a/b',
    'https://gitlab.com/a/b',
    'https://github.com/a',
    'https://github.com/a/b/tree/main',
    'https://github.com/a/b?x=1',
    'https://github.com/-a/b',
    'https://github.com/a/..',
    'https://user:pass@github.com/a/b',
    'git@github.com:a/b.git',
    'https://github.com/a/b;rm -rf /',
    'https://github.com/a/b --upload-pack=evil',
    'file:///etc/passwd',
  ])('rejects %s', (url) => {
    expect(gitUrlSchema.safeParse(url).success).toBe(false);
  });

  it('extracts owner and repo, stripping .git', () => {
    expect(parseGithubUrl('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });
});

describe('auth DTOs', () => {
  it('normalizes emails', () => {
    expect(emailSchema.parse('  Ankit@Example.COM ')).toBe('ankit@example.com');
  });

  it('rejects unknown keys', () => {
    expect(requestCodeBodySchema.safeParse({ email: 'a@b.co', admin: true }).success).toBe(false);
  });

  it.each(['12345', '1234567', 'abcdef', '12 456'])('rejects code %s', (code) => {
    expect(verifyCodeBodySchema.safeParse({ email: 'a@b.co', code }).success).toBe(false);
  });

  it('accepts a 6 digit code', () => {
    expect(verifyCodeBodySchema.safeParse({ email: 'a@b.co', code: '012345' }).success).toBe(true);
  });
});

describe('createProjectBodySchema', () => {
  it('accepts a valid project', () => {
    const body = { name: 'My App', slug: 'my-app', gitUrl: 'https://github.com/a/b' };
    expect(createProjectBodySchema.parse(body)).toEqual(body);
  });
});
