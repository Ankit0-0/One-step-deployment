import { z } from 'zod';
import { deploymentStatusSchema } from './deployment-status.js';
import { logLevelSchema } from './events.js';
import {
  authCodeSchema,
  emailSchema,
  gitUrlSchema,
  idSchema,
  projectNameSchema,
  slugSchema,
} from './validation.js';

// Dates travel as ISO strings over JSON.
const isoDate = z.iso.datetime();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const requestCodeBodySchema = z.object({ email: emailSchema }).strict();
export type RequestCodeBody = z.infer<typeof requestCodeBodySchema>;

export const verifyCodeBodySchema = z.object({ email: emailSchema, code: authCodeSchema }).strict();
export type VerifyCodeBody = z.infer<typeof verifyCodeBodySchema>;

export const userDtoSchema = z.object({
  id: idSchema,
  email: z.email(),
  createdAt: isoDate,
  /** Guest accounts are throwaway: everything they own is deleted at expiresAt. */
  isGuest: z.boolean(),
  expiresAt: isoDate.nullable(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const idParamsSchema = z.object({ id: idSchema });
export type IdParams = z.infer<typeof idParamsSchema>;

export const createProjectBodySchema = z
  .object({
    name: projectNameSchema,
    slug: slugSchema,
    gitUrl: gitUrlSchema,
  })
  .strict();
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z
  .object({
    name: projectNameSchema.optional(),
    gitUrl: gitUrlSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

export const projectDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  gitUrl: z.string(),
  currentDeploymentId: idSchema.nullable(),
  /** Public URL of the live deployment, e.g. https://my-app.example.dev */
  url: z.string(),
  createdAt: isoDate,
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export const deploymentDtoSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  status: deploymentStatusSchema,
  commitSha: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  isCurrent: z.boolean(),
});
export type DeploymentDto = z.infer<typeof deploymentDtoSchema>;

export const deploymentLogDtoSchema = z.object({
  id: z.string(),
  deploymentId: idSchema,
  ts: isoDate,
  level: logLevelSchema,
  message: z.string(),
});
export type DeploymentLogDto = z.infer<typeof deploymentLogDtoSchema>;

export const deploymentStatusEventDtoSchema = z.object({
  deploymentId: idSchema,
  status: deploymentStatusSchema,
  ts: isoDate,
  errorMessage: z.string().nullable(),
});
export type DeploymentStatusEventDto = z.infer<typeof deploymentStatusEventDtoSchema>;

export const rollbackBodySchema = z.object({ deploymentId: idSchema }).strict();
export type RollbackBody = z.infer<typeof rollbackBodySchema>;

export const logsQuerySchema = z.object({
  /** Return logs strictly after this ISO timestamp. */
  after: isoDate.optional(),
  /** Return logs with an id greater than this one (stable cursor for paging). */
  afterId: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'TOO_MANY_BUILDS',
  'INTERNAL',
] as const;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
