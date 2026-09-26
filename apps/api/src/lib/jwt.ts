import jwt from 'jsonwebtoken';

const ISSUER = 'osd-api';

export interface SessionTokens {
  sign(userId: string): string;
  /** Returns the user id, or null for any invalid, expired or tampered token. */
  verify(token: string | undefined): string | null;
}

export function createSessionTokens(secret: string, ttlSeconds: number): SessionTokens {
  return {
    sign: (userId) =>
      jwt.sign({}, secret, {
        algorithm: 'HS256',
        subject: userId,
        issuer: ISSUER,
        expiresIn: ttlSeconds,
      }),
    verify: (token) => {
      if (!token) return null;
      try {
        const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: ISSUER });
        return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
      } catch {
        return null;
      }
    },
  };
}
