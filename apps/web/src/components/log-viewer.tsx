'use client';

import { ArrowDown } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { DeploymentLogDto, LogLevel } from '@osd/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { LogStreamState } from '@/hooks/use-deployment-logs';
import { stripAnsi } from '@/lib/logs';
import { cn } from '@/lib/utils';

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-zinc-200',
  warn: 'text-amber-300',
  error: 'text-red-400',
};

/** Distance from the bottom (px) that still counts as "following" the tail. */
const STICKY_THRESHOLD = 24;

const timeFormat = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface LogViewerProps {
  logs: readonly DeploymentLogDto[];
  state: LogStreamState;
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
}

/**
 * Terminal-style log output. Follows new lines while scrolled to the bottom; scrolling up pauses
 * that until the user jumps back to the latest line.
 */
export function LogViewer({ logs, state, error, onRetry, className }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  /** Line count when the user paused following, to show how many arrived since. */
  const [pausedAt, setPausedAt] = useState(0);
  const unseen = following ? 0 : Math.max(0, logs.length - pausedAt);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (following) scrollToBottom();
  }, [logs.length, following, scrollToBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_THRESHOLD;
    if (atBottom === following) return;
    if (!atBottom) setPausedAt(logs.length);
    setFollowing(atBottom);
  }

  function jumpToLatest() {
    setFollowing(true);
    scrollToBottom();
  }

  return (
    <div className={cn('relative overflow-hidden rounded-lg border bg-zinc-950', className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live={state === 'live' ? 'polite' : 'off'}
        aria-busy={state === 'loading'}
        data-testid="log-scroll"
        className="h-[60vh] min-h-72 overflow-auto p-4 font-mono text-xs leading-5"
      >
        {state === 'loading' && logs.length === 0 ? (
          <div className="space-y-2" data-testid="log-loading">
            <Skeleton className="h-4 w-2/3 bg-zinc-800" />
            <Skeleton className="h-4 w-1/2 bg-zinc-800" />
            <Skeleton className="h-4 w-3/4 bg-zinc-800" />
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-start gap-3 text-red-400">
            <p>Could not load logs: {error?.message ?? 'unknown error'}</p>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-zinc-500">
            {state === 'live'
              ? 'Waiting for build output…'
              : 'No logs were recorded for this deployment.'}
          </p>
        ) : (
          <ol>
            {logs.map((log) => (
              <li
                key={log.id}
                data-level={log.level}
                className={cn('flex gap-3 whitespace-pre-wrap break-all', LEVEL_CLASS[log.level])}
              >
                <time dateTime={log.ts} className="shrink-0 select-none text-zinc-600">
                  {timeFormat.format(new Date(log.ts))}
                </time>
                <span>{stripAnsi(log.message)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {!following && logs.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={jumpToLatest}
          className="absolute bottom-4 right-6 shadow-lg"
        >
          <ArrowDown aria-hidden />
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'line' : 'lines'}` : 'Jump to latest'}
        </Button>
      )}
    </div>
  );
}
