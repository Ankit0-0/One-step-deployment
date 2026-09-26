import { Counter, Histogram, type Registry } from 'prom-client';
import type { DeploymentStatus } from '@osd/shared';

export interface DeploymentMetrics {
  /** Every status a deployment enters (QUEUED on create, then each transition). */
  statusChanged(status: DeploymentStatus): void;
  buildFinished(status: DeploymentStatus, durationMs: number): void;
}

export function createDeploymentMetrics(registry: Registry): DeploymentMetrics {
  const byStatus = new Counter({
    name: 'deployments_total',
    help: 'Deployments entering each status',
    labelNames: ['status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'deployment_build_duration_seconds',
    help: 'Time from build start to a terminal status',
    labelNames: ['status'] as const,
    buckets: [5, 15, 30, 60, 120, 300, 600, 900],
    registers: [registry],
  });
  return {
    statusChanged: (status) => byStatus.inc({ status }),
    buildFinished: (status, ms) => duration.observe({ status }, ms / 1000),
  };
}

export const noopDeploymentMetrics: DeploymentMetrics = {
  statusChanged: () => {},
  buildFinished: () => {},
};
