'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Square, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { isTerminalStatus } from '@osd/shared';
import { LogViewer } from '@/components/log-viewer';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeployment } from '@/hooks/queries';
import { deploymentKey, useDeploymentLogs } from '@/hooks/use-deployment-logs';
import { useApi } from '@/lib/api-context';
import { formatDuration, formatRelative, shortSha } from '@/lib/format';

export default function DeploymentPage() {
  const { id } = useParams<{ id: string }>();
  const deployment = useDeployment(id);

  if (deployment.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  if (deployment.isError) {
    return <ErrorState error={deployment.error} onRetry={() => void deployment.refetch()} />;
  }
  return <DeploymentView id={id} />;
}

function DeploymentView({ id }: { id: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const deployment = useDeployment(id);
  const d = deployment.data!;
  // Bumped by Retry to restart the log stream after a failed history load.
  const [attempt, setAttempt] = useState(0);

  const cancel = useMutation({
    mutationFn: () => api.cancelDeployment(id),
    onSuccess: (updated) => queryClient.setQueryData(deploymentKey(id), updated),
  });

  const active = !isTerminalStatus(d.status);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link href={`/projects/${d.projectId}`}>
          <ArrowLeft aria-hidden />
          Back to project
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl">{d.id.slice(0, 10)}</span>
            <StatusBadge status={d.status} />
          </span>
        }
        description={
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex gap-1">
              <dt>Created</dt>
              <dd className="text-foreground">{formatRelative(d.createdAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Duration</dt>
              <dd className="text-foreground">
                {active ? 'In progress' : formatDuration(d.durationMs)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Commit</dt>
              <dd className="font-mono text-foreground">{shortSha(d.commitSha)}</dd>
            </div>
          </dl>
        }
        actions={
          active && (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Square aria-hidden />
              )}
              Cancel
            </Button>
          )
        }
      />
      {d.status === 'FAILED' && d.errorMessage && (
        <Alert variant="destructive">{d.errorMessage}</Alert>
      )}
      {cancel.isError && <Alert variant="destructive">Cancel failed: {cancel.error.message}</Alert>}
      <DeploymentLogs key={`${id}:${attempt}`} id={id} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  );
}

function DeploymentLogs({ id, onRetry }: { id: string; onRetry: () => void }) {
  const deployment = useDeployment(id);
  const { logs, state, error, reconnecting } = useDeploymentLogs(id, deployment.data?.status);
  return (
    <div className="space-y-2">
      {reconnecting && (
        <p className="flex items-center gap-2 text-sm text-amber-300">
          <WifiOff className="size-4" aria-hidden />
          Live connection lost, reconnecting…
        </p>
      )}
      <LogViewer logs={logs} state={state} error={error} onRetry={onRetry} />
    </div>
  );
}
