import type { z } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Record<string, string | undefined>;

/** First message per top-level field from a zod error. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    out[key] ??= issue.message;
  }
  return out;
}

/** Field errors from an API VALIDATION_ERROR response (details paths like "body.slug"). */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const out: FieldErrors = {};
  for (const d of error.details) out[d.path.split('.').pop() ?? d.path] ??= d.message;
  return out;
}
