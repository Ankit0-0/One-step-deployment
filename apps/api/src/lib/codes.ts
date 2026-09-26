import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Codes are stored as HMACs bound to the email, so a leaked table can't be replayed or brute-forced offline. */
export function hashLoginCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`login-code:${email}:${code}`).digest('hex');
}

export function loginCodeMatches(
  secret: string,
  email: string,
  code: string,
  hash: string,
): boolean {
  const expected = Buffer.from(hashLoginCode(secret, email, code), 'hex');
  const actual = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
