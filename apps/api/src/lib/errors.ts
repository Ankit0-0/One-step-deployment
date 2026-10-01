import type { ApiErrorCode } from '@osd/shared';

/** An error that maps to an HTTP response; its message is safe to show clients. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);
export const unauthorized = (message = 'Not signed in') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message: string) => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const rateLimited = (message = 'Too many requests, try again later') =>
  new AppError(429, 'RATE_LIMITED', message);
export const tooManyBuilds = (limit: number) =>
  new AppError(429, 'TOO_MANY_BUILDS', `You can run at most ${limit} builds at a time`);
