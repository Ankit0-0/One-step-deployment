import { canTransition, isTerminalStatus, type DeploymentStatus } from '@osd/shared';

export interface DeploymentState {
  status: DeploymentStatus;
  createdAt: Date;
  startedAt: Date | null;
}

export interface StatusChange {
  status: DeploymentStatus;
  at: Date;
  commitSha?: string;
  errorMessage?: string;
}

export interface TransitionUpdate {
  status: DeploymentStatus;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  commitSha?: string;
  errorMessage?: string;
}

/**
 * Pure state machine step: the column updates for moving `current` to `change.status`,
 * or null when the move is not allowed (stale, duplicate or out-of-order events).
 */
export function planTransition(
  current: DeploymentState,
  change: StatusChange,
): TransitionUpdate | null {
  if (!canTransition(current.status, change.status)) return null;

  const update: TransitionUpdate = { status: change.status };
  if (change.commitSha) update.commitSha = change.commitSha;

  let startedAt = current.startedAt;
  if (change.status === 'BUILDING' || (!startedAt && change.status === 'UPLOADING')) {
    startedAt = change.at;
    update.startedAt = change.at;
  }
  if (isTerminalStatus(change.status)) {
    update.finishedAt = change.at;
    const from = startedAt ?? current.createdAt;
    update.durationMs = Math.max(0, change.at.getTime() - from.getTime());
  }
  if (change.status === 'FAILED') {
    update.errorMessage = change.errorMessage ?? 'Build failed';
  }
  return update;
}
