export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diff) >= seconds || unit === 'second') {
      return rtf.format(Math.round(diff / seconds), unit);
    }
  }
  return '';
}

export const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : '—');

export function repoName(gitUrl: string): string {
  return gitUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}

/** "My Cool App!" → "my-cool-app" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}
