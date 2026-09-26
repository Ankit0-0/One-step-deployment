import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'osd_session';

export interface CookieConfig {
  secure: boolean;
  domain?: string;
  ttlSeconds: number;
}

function baseOptions(config: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'lax',
    path: '/',
    ...(config.domain && { domain: config.domain }),
  };
}

export function setSessionCookie(res: Response, token: string, config: CookieConfig) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(config), maxAge: config.ttlSeconds * 1000 });
}

export function clearSessionCookie(res: Response, config: CookieConfig) {
  res.clearCookie(SESSION_COOKIE, baseOptions(config));
}
