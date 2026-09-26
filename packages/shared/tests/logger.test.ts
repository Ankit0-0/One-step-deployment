import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, createLogger, withRequestId } from '../src/logger.js';

describe('logger', () => {
  it('creates a JSON logger bound to the service name', () => {
    const logger = createLogger({ service: 'test', pretty: false, level: 'debug' });
    expect(logger.level).toBe('debug');
    expect(logger.bindings()).toMatchObject({ service: 'test' });
  });

  it('binds request ids on child loggers', () => {
    const logger = createLogger({ service: 'test', pretty: false });
    expect(withRequestId(logger, 'req-1').bindings()).toMatchObject({ requestId: 'req-1' });
  });

  it('redacts secrets', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
    logger.info(
      { authCode: '123456', req: { headers: { cookie: 'session=abc' }, body: { code: '654321' } } },
      'x',
    );
    const out = lines.join('');
    expect(out).not.toContain('123456');
    expect(out).not.toContain('654321');
    expect(out).not.toContain('session=abc');
  });

  it('keeps error codes readable', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
    logger.error({ err: { code: 'ECONNREFUSED' } }, 'x');
    expect(lines.join('')).toContain('ECONNREFUSED');
  });
});
