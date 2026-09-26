import { describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_STATUSES,
  canTransition,
  deploymentChannel,
  isTerminalStatus,
  workerEventSchema,
} from '../src/index.js';

describe('deployment status transitions', () => {
  it('follows the happy path', () => {
    expect(canTransition('QUEUED', 'BUILDING')).toBe(true);
    expect(canTransition('BUILDING', 'UPLOADING')).toBe(true);
    expect(canTransition('UPLOADING', 'READY')).toBe(true);
  });

  it('allows failure or cancellation from any active state', () => {
    for (const from of ['QUEUED', 'BUILDING', 'UPLOADING'] as const) {
      expect(canTransition(from, 'FAILED')).toBe(true);
      expect(canTransition(from, 'CANCELED')).toBe(true);
    }
  });

  it('never leaves a terminal state', () => {
    for (const from of DEPLOYMENT_STATUSES.filter(isTerminalStatus)) {
      for (const to of DEPLOYMENT_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('rejects skipping or going backwards', () => {
    expect(canTransition('QUEUED', 'READY')).toBe(false);
    expect(canTransition('UPLOADING', 'BUILDING')).toBe(false);
  });
});

describe('worker events', () => {
  it('uses one channel name per deployment', () => {
    expect(deploymentChannel('abc')).toBe('deployment:abc');
  });

  it('parses log and status events', () => {
    const ts = new Date().toISOString();
    expect(
      workerEventSchema.parse({
        type: 'log',
        deploymentId: 'd1',
        ts,
        level: 'info',
        message: 'hi',
      }),
    ).toMatchObject({ type: 'log' });
    expect(
      workerEventSchema.parse({ type: 'status', deploymentId: 'd1', ts, status: 'READY' }),
    ).toMatchObject({ status: 'READY' });
  });

  it('rejects unknown event types and statuses', () => {
    const ts = new Date().toISOString();
    expect(workerEventSchema.safeParse({ type: 'boom', deploymentId: 'd1', ts }).success).toBe(
      false,
    );
    expect(
      workerEventSchema.safeParse({ type: 'status', deploymentId: 'd1', ts, status: 'DONE' })
        .success,
    ).toBe(false);
  });
});
