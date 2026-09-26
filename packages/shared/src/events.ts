import { z } from 'zod';
import { deploymentStatusSchema } from './deployment-status.js';
import { idSchema } from './validation.js';

/** Redis pub/sub channel and socket.io room share one name per deployment. */
export const deploymentChannel = (deploymentId: string) => `deployment:${deploymentId}` as const;
export const DEPLOYMENT_CHANNEL_PATTERN = 'deployment:*';

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof logLevelSchema>;

const MAX_LOG_MESSAGE_LENGTH = 8 * 1024;

export const workerLogEventSchema = z.object({
  type: z.literal('log'),
  deploymentId: idSchema,
  ts: z.iso.datetime(),
  level: logLevelSchema,
  message: z.string().max(MAX_LOG_MESSAGE_LENGTH),
});

export const workerStatusEventSchema = z.object({
  type: z.literal('status'),
  deploymentId: idSchema,
  ts: z.iso.datetime(),
  status: deploymentStatusSchema,
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  errorMessage: z.string().max(2000).optional(),
});

/** Messages the build worker publishes on deploymentChannel(id). */
export const workerEventSchema = z.discriminatedUnion('type', [
  workerLogEventSchema,
  workerStatusEventSchema,
]);

export type WorkerLogEvent = z.infer<typeof workerLogEventSchema>;
export type WorkerStatusEvent = z.infer<typeof workerStatusEventSchema>;
export type WorkerEvent = z.infer<typeof workerEventSchema>;

/** socket.io event names shared by api and web. */
export const SOCKET_EVENTS = {
  /** client → server: { deploymentId } */
  JOIN_DEPLOYMENT: 'deployment:join',
  /** client → server: { deploymentId } */
  LEAVE_DEPLOYMENT: 'deployment:leave',
  /** server → client: DeploymentLogDto */
  DEPLOYMENT_LOG: 'deployment:log',
  /** server → client: DeploymentStatusEventDto */
  DEPLOYMENT_STATUS: 'deployment:status',
  /** server → client: { message } */
  ERROR: 'error',
} as const;

export const joinDeploymentPayloadSchema = z.object({ deploymentId: idSchema });
export type JoinDeploymentPayload = z.infer<typeof joinDeploymentPayloadSchema>;

/** Redis key the proxy caches slug → current deployment under; the api deletes it on change. */
export const proxySlugCacheKey = (slug: string) => `proxy:slug:${slug}` as const;
