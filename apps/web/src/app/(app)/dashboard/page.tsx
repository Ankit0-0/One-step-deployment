'use client';

import { ExternalLink, GitBranch, Plus } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, ErrorState } from '@/components/query-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/hooks/queries';
import { formatRelative, repoName } from '@/lib/format';

export default function DashboardPage() {
  const projects = useProjects();

  const newProject = (
    <Button asChild>
      <Link href="/projects/new">
        <Plus aria-hidden />
        New project
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="Projects" actions={newProject} />
      {projects.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : projects.data.length === 0 ? (
        <EmptyState title="No projects yet">
          <p className="text-sm text-muted-foreground">
            Connect a public GitHub repository to deploy it.
          </p>
          {newProject}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Card className="relative h-full transition-colors hover:border-foreground/30">
                <CardHeader>
                  <CardTitle className="truncate">
                    <Link href={`/projects/${p.id}`} className="after:absolute after:inset-0">
                      {p.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 truncate">
                    <GitBranch className="size-3.5 shrink-0" aria-hidden />
                    {repoName(p.gitUrl)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2 text-sm">
                  {p.currentDeploymentId ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="relative z-10 flex items-center gap-1 truncate text-muted-foreground hover:text-foreground"
                    >
                      {p.url.replace(/^https?:\/\//, '')}
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not deployed</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(p.createdAt)}
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
