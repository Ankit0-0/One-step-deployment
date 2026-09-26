import type { Deployment, DeploymentLog } from '@osd/db';
import type { DeploymentDto, DeploymentLogDto, DeploymentStatusEventDto } from '@osd/shared';

export function toDeploymentDto(d: Deployment, currentDeploymentId: string | null): DeploymentDto {
  return {
    id: d.id,
    projectId: d.projectId,
    status: d.status,
    commitSha: d.commitSha,
    errorMessage: d.errorMessage,
    createdAt: d.createdAt.toISOString(),
    startedAt: d.startedAt?.toISOString() ?? null,
    finishedAt: d.finishedAt?.toISOString() ?? null,
    durationMs: d.durationMs,
    isCurrent: d.id === currentDeploymentId,
  };
}

export function toLogDto(log: DeploymentLog): DeploymentLogDto {
  return {
    id: log.id.toString(),
    deploymentId: log.deploymentId,
    ts: log.ts.toISOString(),
    level: log.level,
    message: log.message,
  };
}

export function toStatusEventDto(d: Deployment): DeploymentStatusEventDto {
  return {
    deploymentId: d.id,
    status: d.status,
    ts: (d.finishedAt ?? d.startedAt ?? d.createdAt).toISOString(),
    errorMessage: d.errorMessage,
  };
}
