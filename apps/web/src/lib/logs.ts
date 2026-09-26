import type { DeploymentLogDto } from '@osd/shared';

// CSI / OSC escape sequences emitted by npm, yarn, vite and friends.
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Log ids are bigint strings; compare numerically without losing precision. */
export function compareLogIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Merge new lines into an already sorted, de-duplicated list. History and live events overlap
 * while the page loads, so the same id can arrive twice; ids decide both identity and order.
 */
export function mergeLogs(
  current: readonly DeploymentLogDto[],
  incoming: readonly DeploymentLogDto[],
): DeploymentLogDto[] {
  if (incoming.length === 0) return current as DeploymentLogDto[];
  const last = current[current.length - 1];
  const sortedIncoming = [...incoming].sort((a, b) => compareLogIds(a.id, b.id));
  // Fast path: live lines almost always arrive after everything we already have.
  if (!last || compareLogIds(sortedIncoming[0]!.id, last.id) > 0) {
    return [...current, ...dedupeSorted(sortedIncoming)];
  }
  const byId = new Map<string, DeploymentLogDto>();
  for (const log of current) byId.set(log.id, log);
  for (const log of sortedIncoming) byId.set(log.id, log);
  return [...byId.values()].sort((a, b) => compareLogIds(a.id, b.id));
}

function dedupeSorted(logs: DeploymentLogDto[]): DeploymentLogDto[] {
  return logs.filter((log, i) => i === 0 || log.id !== logs[i - 1]!.id);
}
