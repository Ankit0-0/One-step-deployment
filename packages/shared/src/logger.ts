import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level?: LoggerOptions['level'];
  /** Human-readable output via pino-pretty; defaults to true outside production. */
  pretty?: boolean;
  /** Extra fields bound to every line (e.g. deploymentId). */
  base?: Record<string, unknown>;
}

/** Keys that must never reach log output. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.code',
  'authCode',
  '*.authCode',
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
];

export function createLogger(options: CreateLoggerOptions): Logger {
  const pretty = options.pretty ?? process.env.NODE_ENV !== 'production';
  return pino({
    level: options.level ?? 'info',
    base: { service: options.service, ...options.base },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    formatters: { level: (label) => ({ level: label }) },
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
  });
}

/** Child logger bound to a request id, propagated from api to worker via REQUEST_ID. */
export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}
