import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Reuse a well-formed inbound x-request-id, otherwise mint one. */
export function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && VALID_REQUEST_ID.test(value) ? value : randomUUID();
}
