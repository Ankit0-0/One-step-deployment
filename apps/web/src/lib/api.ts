import { z } from 'zod';
import {
  apiErrorSchema,
  deploymentDtoSchema,
  deploymentLogDtoSchema,
  projectDtoSchema,
  userDtoSchema,
  type ApiErrorCode,
  type CreateProjectBody,
  type DeploymentDto,
  type DeploymentLogDto,
  type ProjectDto,
  type UpdateProjectBody,
  type UserDto,
} from '@osd/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly details: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const userRes = z.object({ user: userDtoSchema });
const projectRes = z.object({ project: projectDtoSchema });
const projectsRes = z.object({ projects: z.array(projectDtoSchema) });
const deploymentRes = z.object({ deployment: deploymentDtoSchema });
const deploymentsRes = z.object({ deployments: z.array(deploymentDtoSchema) });
const logsRes = z.object({ logs: z.array(deploymentLogDtoSchema) });

export const LOG_PAGE_SIZE = 1000;

/**
 * Typed client for apps/api. Every response is validated against the shared DTO schemas, so a
 * contract drift fails loudly here instead of rendering garbage.
 */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function request<T>(
    schema: z.ZodType<T> | null,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        credentials: 'include',
        headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
    }

    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiError(res.status, code, message, details);
      }
      throw new ApiError(res.status, 'INTERNAL', `Request failed (${res.status})`);
    }
    if (schema === null || res.status === 204) return undefined as T;
    return schema.parse(await res.json());
  }

  return {
    requestCode: (email: string) =>
      request(null, '/auth/request-code', { method: 'POST', body: { email } }),
    verifyCode: (email: string, code: string): Promise<UserDto> =>
      request(userRes, '/auth/verify', { method: 'POST', body: { email, code } }).then(
        (r) => r.user,
      ),
    me: (): Promise<UserDto> => request(userRes, '/auth/me').then((r) => r.user),
    logout: () => request(null, '/auth/logout', { method: 'POST' }),

    listProjects: (): Promise<ProjectDto[]> =>
      request(projectsRes, '/projects').then((r) => r.projects),
    getProject: (id: string): Promise<ProjectDto> =>
      request(projectRes, `/projects/${encodeURIComponent(id)}`).then((r) => r.project),
    createProject: (body: CreateProjectBody): Promise<ProjectDto> =>
      request(projectRes, '/projects', { method: 'POST', body }).then((r) => r.project),
    updateProject: (id: string, body: UpdateProjectBody): Promise<ProjectDto> =>
      request(projectRes, `/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body }).then(
        (r) => r.project,
      ),
    rollback: (projectId: string, deploymentId: string): Promise<ProjectDto> =>
      request(projectRes, `/projects/${encodeURIComponent(projectId)}/rollback`, {
        method: 'POST',
        body: { deploymentId },
      }).then((r) => r.project),

    listDeployments: (projectId: string): Promise<DeploymentDto[]> =>
      request(deploymentsRes, `/projects/${encodeURIComponent(projectId)}/deployments`).then(
        (r) => r.deployments,
      ),
    createDeployment: (projectId: string): Promise<DeploymentDto> =>
      request(deploymentRes, `/projects/${encodeURIComponent(projectId)}/deployments`, {
        method: 'POST',
      }).then((r) => r.deployment),
    getDeployment: (id: string): Promise<DeploymentDto> =>
      request(deploymentRes, `/deployments/${encodeURIComponent(id)}`).then((r) => r.deployment),
    cancelDeployment: (id: string): Promise<DeploymentDto> =>
      request(deploymentRes, `/deployments/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
      }).then((r) => r.deployment),
    getLogs: (id: string, afterId?: string): Promise<DeploymentLogDto[]> => {
      const query = new URLSearchParams({ limit: String(LOG_PAGE_SIZE) });
      if (afterId) query.set('afterId', afterId);
      return request(logsRes, `/deployments/${encodeURIComponent(id)}/logs?${query}`).then(
        (r) => r.logs,
      );
    },
    /** All persisted logs, paging with the id cursor until a short page. */
    async getAllLogs(id: string): Promise<DeploymentLogDto[]> {
      const all: DeploymentLogDto[] = [];
      let afterId: string | undefined;
      for (;;) {
        const page = await this.getLogs(id, afterId);
        all.push(...page);
        if (page.length < LOG_PAGE_SIZE) return all;
        afterId = page[page.length - 1]!.id;
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
