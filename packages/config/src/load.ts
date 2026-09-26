import type { z } from 'zod';

export type EnvSource = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(service: string, issues: readonly string[]) {
    super(`Invalid environment for ${service}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Empty strings in .env files mean "unset", so defaults and required checks apply. */
function dropEmpty(source: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * Parse and validate environment variables against a zod schema.
 * Throws an EnvValidationError listing every problem, so services fail fast at boot.
 * Error messages name the offending keys but never echo their values.
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  options: { service: string; source?: EnvSource },
): z.output<S> {
  const result = schema.safeParse(dropEmpty(options.source ?? process.env));
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(options.service, issues);
}
