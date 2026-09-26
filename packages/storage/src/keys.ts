import { posix } from 'node:path';
import mime from 'mime-types';

export const DEPLOYMENTS_PREFIX = 'deployments';

const DEPLOYMENT_ID_PATTERN = /^[a-z0-9]{8,64}$/;

export class UnsafePathError extends Error {
  constructor(reason: string) {
    super(`Unsafe path: ${reason}`);
    this.name = 'UnsafePathError';
  }
}

/**
 * Normalize a path relative to a deployment root into a safe posix path without a leading slash.
 * Rejects anything that could escape the root: `..` segments, absolute paths, backslashes,
 * NUL/control characters.
 */
export function sanitizeRelativePath(input: string): string {
  if (input.length === 0) throw new UnsafePathError('empty');
  if (input.length > 1024) throw new UnsafePathError('too long');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) throw new UnsafePathError('control characters');
  if (input.includes('\\')) throw new UnsafePathError('backslash');
  if (input.startsWith('/')) throw new UnsafePathError('absolute');
  if (input.split('/').some((segment) => segment === '..')) {
    throw new UnsafePathError('parent segment');
  }
  const normalized = posix.normalize(input);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new UnsafePathError('outside root');
  }
  return normalized.replace(/^\.\//, '');
}

export function assertDeploymentId(deploymentId: string): void {
  if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
    throw new UnsafePathError('invalid deployment id');
  }
}

export function deploymentPrefix(deploymentId: string): string {
  assertDeploymentId(deploymentId);
  return `${DEPLOYMENTS_PREFIX}/${deploymentId}/`;
}

/** deployments/{deploymentId}/{relativePath} */
export function deploymentObjectKey(deploymentId: string, relativePath: string): string {
  return deploymentPrefix(deploymentId) + sanitizeRelativePath(relativePath);
}

/** Content-Type for a file name, with charset for text types. */
export function contentTypeFor(path: string): string {
  const type = mime.lookup(path);
  if (!type) return 'application/octet-stream';
  return mime.contentType(type) || type;
}
