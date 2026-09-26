import { describe, expect, it } from 'vitest';
import { generateLoginCode, hashLoginCode, loginCodeMatches } from '../../src/lib/codes.js';
import { createSessionTokens } from '../../src/lib/jwt.js';

const secret = 'x'.repeat(32);

describe('login codes', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 100; i++) expect(generateLoginCode()).toMatch(/^\d{6}$/);
  });

  it('binds the hash to the email', () => {
    const hash = hashLoginCode(secret, 'a@b.co', '123456');
    expect(hash).not.toContain('123456');
    expect(loginCodeMatches(secret, 'a@b.co', '123456', hash)).toBe(true);
    expect(loginCodeMatches(secret, 'a@b.co', '123457', hash)).toBe(false);
    expect(loginCodeMatches(secret, 'c@d.co', '123456', hash)).toBe(false);
    expect(loginCodeMatches('y'.repeat(32), 'a@b.co', '123456', hash)).toBe(false);
  });
});

describe('session tokens', () => {
  const tokens = createSessionTokens(secret, 60);

  it('round-trips the user id', () => {
    expect(tokens.verify(tokens.sign('user_1'))).toBe('user_1');
  });

  it('rejects tampered, foreign and missing tokens', () => {
    const token = tokens.sign('user_1');
    expect(tokens.verify(`${token}x`)).toBeNull();
    expect(tokens.verify(createSessionTokens('z'.repeat(32), 60).sign('user_1'))).toBeNull();
    expect(tokens.verify(undefined)).toBeNull();
    expect(tokens.verify('not-a-jwt')).toBeNull();
  });

  it('rejects expired tokens', () => {
    const expired = createSessionTokens(secret, -10).sign('user_1');
    expect(tokens.verify(expired)).toBeNull();
  });

  it('rejects the none algorithm', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user_1', iss: 'osd-api' })).toString(
      'base64url',
    );
    expect(tokens.verify(`${header}.${body}.`)).toBeNull();
  });
});
