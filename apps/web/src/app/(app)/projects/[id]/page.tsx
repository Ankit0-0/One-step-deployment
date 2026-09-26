'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, GitBranch, Loader2, Rocket } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { isTerminalStatus, type DeploymentDto } from '@osd/shared';
import { DeploymentsTable } from '@/components/deployments-table';
import { PageHeader } from '@/components/page-header';
import { ProjectSettings } from '@/components/project-settings';
import { EmptyState, ErrorState } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { deploymentsKey, projectKey, useDeployments, useProject } from '@/hooks/queries';
import { useApi } from '@/lib/api-context';
import { repoName } from '@/lib/format';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const project = useProject(id);
  const deployments = useDeployments(id);

  const deploy = useMutation({
    mutationFn: () => api.createDeployment(id),
    onSuccess: (deployment) => {
      void queryClient.invalidateQueries({ queryKey: deploymentsKey(id) });
      router.push(`/deployments/${deployment.id}`);
    },
  });
  const rollback = useMutation({
    mutationFn: (d: DeploymentDto) => api.rollback(id, d.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(projectKey(id), updated);
      void queryClient.invalidateQueries({ queryKey: deploymentsKey(id) });
    },
  });

  if (project.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }

  const p = project.data;
  const building = deployments.data?.some((d) => !isTerminalStatus(d.status)) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.name}
        description={
          <a
            href={p.gitUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <GitBranch className="size-3.5" aria-hidden />
            {repoName(p.gitUrl)}
          </a>
        }
        actions={
          <>
            {p.currentDeploymentId && (
              <Button variant="outline" asChild>
                <a href={p.url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden />
                  Visit
                </a>
              </Button>
            )}
            <Button onClick={() => deploy.mutate()} disabled={deploy.isPending}>
              {deploy.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Rocket aria-hidden />
              )}
              Deploy
            </Button>
          </>
        }
      />

      {deploy.isError && <Alert variant="destructive">{deploy.error.message}</Alert>}
      {rollback.isError && (
        <Alert variant="destructive">Rollback failed: {rollback.error.message}</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Live URL</CardTitle>
            <CardDescription>
              {p.currentDeploymentId
                ? 'Serving the current deployment.'
                : 'Deploy once to go live.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {p.currentDeploymentId ? (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-sm underline underline-offset-4 hover:text-muted-foreground"
              >
                {p.url}
              </a>
            ) : (
              <span className="font-mono text-sm text-muted-foreground">{p.url}</span>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectSettings key={`${p.name}|${p.gitUrl}`} project={p} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>Deployments</CardTitle>
            <CardDescription>
              {building ? 'A deployment is in progress.' : 'Every build of this project.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {deployments.isPending ? (
            <div className="space-y-2" aria-busy>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : deployments.isError ? (
            <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
          ) : deployments.data.length === 0 ? (
            <EmptyState title="No deployments yet">
              <p className="text-sm text-muted-foreground">
                Press Deploy to build {repoName(p.gitUrl)}.
              </p>
            </EmptyState>
          ) : (
            <DeploymentsTable
              deployments={deployments.data}
              onRollback={(d) => rollback.mutate(d)}
              rollingBackId={rollback.isPending ? rollback.variables.id : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
