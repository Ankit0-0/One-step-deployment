import type { DeploymentDto, DeploymentLogDto, LogLevel } from '@osd/shared';

export const DEPLOYMENT_ID = 'dep00000000001';

export function log(
  id: number,
  message = `line ${id}`,
  level: LogLevel = 'info',
): DeploymentLogDto {
  return {
    id: String(id),
    deploymentId: DEPLOYMENT_ID,
    ts: new Date(Date.UTC(2026, 8, 26, 10, 0, id % 60)).toISOString(),
    level,
    message,
  };
}

export function deployment(overrides: Partial<DeploymentDto> = {}): DeploymentDto {
  return {
    id: DEPLOYMENT_ID,
    projectId: 'prj00000000001',
    status: 'BUILDING',
    commitSha: null,
    errorMessage: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    startedAt: '2026-09-26T10:00:01.000Z',
    finishedAt: null,
    durationMs: null,
    isCurrent: false,
    ...overrides,
  };
}
