import { describe, expect, it } from 'vitest';
import { formatDuration, formatRelative, repoName, shortSha, slugify } from '@/lib/format';

describe('format helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(4_400)).toBe('4s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(formatRelative('2026-09-26T11:58:00Z', now)).toBe('2 minutes ago');
    expect(formatRelative('2026-09-25T12:00:00Z', now)).toBe('yesterday');
  });

  it('shortens shas and repo URLs', () => {
    expect(shortSha('0123456789abcdef')).toBe('0123456');
    expect(shortSha(null)).toBe('—');
    expect(repoName('https://github.com/mdn/todo-react.git')).toBe('mdn/todo-react');
  });

  it('slugifies project names', () => {
    expect(slugify('My Cool App!')).toBe('my-cool-app');
    expect(slugify('  --Café  2026-- ')).toBe('cafe-2026');
    expect(slugify('a'.repeat(39) + ' b')).toBe('a'.repeat(39));
  });
});
