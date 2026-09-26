import type { RequestHandler, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import type { SessionTokens } from '../lib/jwt.js';
import { SESSION_COOKIE } from '../lib/session-cookie.js';

/** Rejects requests without a valid session cookie; the user id lands in res.locals.userId. */
export function requireAuth(tokens: SessionTokens): RequestHandler {
  return (req, res, next) => {
    const userId = tokens.verify(
      (req.cookies as Record<string, string | undefined>)[SESSION_COOKIE],
    );
    if (!userId) {
      next(unauthorized());
      return;
    }
    res.locals.userId = userId;
    next();
  };
}

export function currentUserId(res: Response): string {
  const id = res.locals.userId as string | undefined;
  if (!id) throw unauthorized();
  return id;
}
