import { describe, expect, it } from 'vitest';
import { planTransition, type DeploymentState } from '../../src/modules/deployments/transitions.js';

const created = new Date('2026-01-01T00:00:00Z');
const at = (s: number) => new Date(created.getTime() + s * 1000);
const queued: DeploymentState = { status: 'QUEUED', createdAt: created, startedAt: null };

describe('planTransition', () => {
  it('stamps startedAt when the build starts', () => {
    expect(planTransition(queued, { status: 'BUILDING', at: at(2) })).toEqual({
      status: 'BUILDING',
      startedAt: at(2),
    });
  });

  it('computes duration from startedAt on READY and keeps the commit', () => {
    const building: DeploymentState = { status: 'UPLOADING', createdAt: created, startedAt: at(2) };
    expect(planTransition(building, { status: 'READY', at: at(32), commitSha: 'abc1234' })).toEqual(
      { status: 'READY', finishedAt: at(32), durationMs: 30_000, commitSha: 'abc1234' },
    );
  });

  it('falls back to createdAt for duration when the build never started', () => {
    expect(planTransition(queued, { status: 'CANCELED', at: at(5) })).toMatchObject({
      durationMs: 5000,
    });
  });

  it('records a default error message on failure', () => {
    expect(planTransition(queued, { status: 'FAILED', at: at(1) })).toMatchObject({
      errorMessage: 'Build failed',
    });
    expect(
      planTransition(queued, {
        status: 'FAILED',
        at: at(1),
        errorMessage: 'npm exited with code 1',
      }),
    ).toMatchObject({ errorMessage: 'npm exited with code 1' });
  });

  it('never produces negative durations from skewed clocks', () => {
    const started: DeploymentState = { status: 'BUILDING', createdAt: created, startedAt: at(10) };
    expect(planTransition(started, { status: 'FAILED', at: at(5) })).toMatchObject({
      durationMs: 0,
    });
  });

  it.each([
    ['QUEUED', 'READY'],
    ['READY', 'FAILED'],
    ['CANCELED', 'BUILDING'],
    ['BUILDING', 'BUILDING'],
    ['UPLOADING', 'BUILDING'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(planTransition({ ...queued, status: from }, { status: to, at: at(1) })).toBeNull();
  });
});
