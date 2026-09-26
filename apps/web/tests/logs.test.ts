import { describe, expect, it } from 'vitest';
import { compareLogIds, mergeLogs, stripAnsi } from '@/lib/logs';
import { log } from './fixtures';

describe('mergeLogs', () => {
  it('appends newer lines on the fast path', () => {
    const current = [log(1), log(2)];
    expect(mergeLogs(current, [log(3), log(4)]).map((l) => l.id)).toEqual(['1', '2', '3', '4']);
  });

  it('dedupes overlap and restores id order', () => {
    const merged = mergeLogs([log(1), log(3), log(5)], [log(4), log(3), log(2)]);
    expect(merged.map((l) => l.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('dedupes repeats inside one incoming batch', () => {
    expect(mergeLogs([], [log(2), log(1), log(2)]).map((l) => l.id)).toEqual(['1', '2']);
  });

  it('returns the same array when nothing arrives', () => {
    const current = [log(1)];
    expect(mergeLogs(current, [])).toBe(current);
  });
});

describe('compareLogIds', () => {
  it('orders bigint ids numerically, beyond Number precision', () => {
    expect(compareLogIds('9', '10')).toBeLessThan(0);
    expect(compareLogIds('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    expect(compareLogIds('42', '42')).toBe(0);
  });
});

describe('stripAnsi', () => {
  it('removes color and cursor sequences', () => {
    expect(stripAnsi('\u001b[1m\u001b[32mok\u001b[39m\u001b[22m \u001b[2K\u001b[1Gdone')).toBe(
      'ok done',
    );
  });

  it('removes OSC hyperlinks but keeps the text', () => {
    expect(stripAnsi('\u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007')).toBe('link');
  });
});
