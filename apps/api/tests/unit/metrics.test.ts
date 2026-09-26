import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { createDeploymentMetrics } from '../../src/lib/metrics.js';

describe('deployment metrics', () => {
  it('exports every status at zero before any deployment', async () => {
    const registry = new Registry();
    createDeploymentMetrics(registry);
    const text = await registry.metrics();
    for (const status of ['QUEUED', 'BUILDING', 'UPLOADING', 'READY', 'FAILED', 'CANCELED']) {
      expect(text).toContain(`deployments_total{status="${status}"} 0`);
    }
    expect(text).toContain('deployment_build_duration_seconds_count{status="READY"} 0');
  });

  it('counts transitions and observes build durations in seconds', async () => {
    const registry = new Registry();
    const metrics = createDeploymentMetrics(registry);
    metrics.statusChanged('READY');
    metrics.buildFinished('READY', 42_000);
    const text = await registry.metrics();
    expect(text).toContain('deployments_total{status="READY"} 1');
    expect(text).toContain('deployment_build_duration_seconds_sum{status="READY"} 42');
  });
});
