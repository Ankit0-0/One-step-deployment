import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@osd/db';
import type { ApiError } from '@osd/shared';
import { AppError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

/** Single place that turns errors into JSON. Clients never see stack traces or internal messages. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  const send = (status: number, error: ApiError['error']) => {
    res.status(status).json({ error: { ...error, requestId } } satisfies ApiError);
  };

  if (err instanceof AppError) {
    return send(err.status, { code: err.code, message: err.message });
  }
  if (err instanceof ZodError) {
    return send(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return send(409, { code: 'CONFLICT', message: 'Already exists' });
  }
  // body-parser errors carry a status and a safe type.
  const httpErr = err as { status?: number; type?: string };
  if (httpErr.type === 'entity.parse.failed') {
    return send(400, { code: 'BAD_REQUEST', message: 'Malformed JSON body' });
  }
  if (httpErr.type === 'entity.too.large') {
    return send(413, { code: 'BAD_REQUEST', message: 'Request body too large' });
  }
  if (httpErr.status && httpErr.status >= 400 && httpErr.status < 500) {
    return send(httpErr.status, { code: 'BAD_REQUEST', message: 'Bad request' });
  }

  req.log.error({ err }, 'unhandled error');
  send(500, { code: 'INTERNAL', message: 'Something went wrong' });
};
