import { z } from 'zod';

export const DEPLOYMENT_STATUSES = [
  'QUEUED',
  'BUILDING',
  'UPLOADING',
  'READY',
  'FAILED',
  'CANCELED',
] as const;

export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

export const TERMINAL_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  'READY',
  'FAILED',
  'CANCELED',
]);

const TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  QUEUED: ['BUILDING', 'FAILED', 'CANCELED'],
  BUILDING: ['UPLOADING', 'FAILED', 'CANCELED'],
  UPLOADING: ['READY', 'FAILED', 'CANCELED'],
  READY: [],
  FAILED: [],
  CANCELED: [],
};

export function isTerminalStatus(status: DeploymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
