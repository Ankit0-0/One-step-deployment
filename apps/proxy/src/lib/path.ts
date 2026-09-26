import { extname } from 'node:path';
import { sanitizeRelativePath } from '@osd/storage';

export class BadPathError extends Error {}

/** URL path → object path inside the deployment ('/' → 'index.html', '/docs/' → 'docs/index.html'). */
export function objectPathFor(urlPath: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    throw new BadPathError('malformed URL encoding');
  }
  let path = decoded.replace(/^\/+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  try {
    return sanitizeRelativePath(path);
  } catch {
    throw new BadPathError('unsafe path');
  }
}

/** Paths without a file extension are client-side routes and fall back to index.html. */
export function isSpaRoute(objectPath: string): boolean {
  return extname(objectPath) === '';
}

export function cacheControlFor(objectPath: string): string {
  return objectPath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600';
}
