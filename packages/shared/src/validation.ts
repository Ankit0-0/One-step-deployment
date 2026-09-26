import { z } from 'zod';

/** Subdomains that must never be claimed by a project. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'cdn',
  'dashboard',
  'docs',
  'grafana',
  'help',
  'internal',
  'login',
  'mail',
  'metrics',
  'minio',
  'prometheus',
  'proxy',
  'root',
  'static',
  'status',
  'support',
  'system',
  'www',
]);

export const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;

export const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(40, 'Slug must be at most 40 characters')
  .regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens between them')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This slug is reserved');

// Owner: 1-39 chars, alphanumeric and single inner hyphens (GitHub rules).
// Repo: letters, digits, '.', '_', '-'; may not be '.' or '..'.
const GITHUB_URL_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:-?[A-Za-z0-9]){0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/;

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export function parseGithubUrl(url: string): GithubRepoRef | null {
  const match = GITHUB_URL_PATTERN.exec(url);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** Only public-style https://github.com/<owner>/<repo>(.git) URLs are accepted. */
export const gitUrlSchema = z
  .string()
  .trim()
  .max(200)
  .refine((v) => parseGithubUrl(v) !== null, 'Must be https://github.com/<owner>/<repo>');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const authCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

export const idSchema = z.string().min(1).max(64);

export const projectNameSchema = z.string().trim().min(1).max(100);
