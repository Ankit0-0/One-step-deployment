import type { z } from 'zod';

/** Parse request input; a ZodError becomes a 400 VALIDATION_ERROR in the error handler. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value);
}
