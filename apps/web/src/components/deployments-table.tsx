'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { DeploymentDto } from '@osd/shared';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDuration, formatRelative, shortSha } from '@/lib/format';

export function DeploymentsTable({
  deployments,
  onRollback,
  rollingBackId,
}: {
  deployments: DeploymentDto[];
  onRollback: (deployment: DeploymentDto) => void;
  rollingBackId?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Deployment</TableHead>
          <TableHead className="hidden sm:table-cell">Commit</TableHead>
          <TableHead className="hidden sm:table-cell">Duration</TableHead>
          <TableHead className="hidden sm:table-cell">Created</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deployments.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <StatusBadge status={d.status} />
            </TableCell>
            <TableCell className="font-mono text-xs">
              <Link href={`/deployments/${d.id}`} className="hover:underline">
                {d.id.slice(0, 10)}
              </Link>
              {d.isCurrent && (
                <Badge variant="outline" className="ml-2">
                  Current
                </Badge>
              )}
              <span className="mt-1 block font-sans text-muted-foreground sm:hidden">
                {formatRelative(d.createdAt)} · {formatDuration(d.durationMs)}
              </span>
            </TableCell>
            <TableCell className="hidden font-mono text-xs sm:table-cell">
              {shortSha(d.commitSha)}
            </TableCell>
            <TableCell className="hidden sm:table-cell">{formatDuration(d.durationMs)}</TableCell>
            <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
              <time dateTime={d.createdAt} title={new Date(d.createdAt).toLocaleString()}>
                {formatRelative(d.createdAt)}
              </time>
            </TableCell>
            <TableCell className="text-right">
              {d.status === 'READY' && !d.isCurrent && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Roll back to ${d.id.slice(0, 10)}`}
                  disabled={rollingBackId !== undefined}
                  onClick={() => onRollback(d)}
                >
                  {rollingBackId === d.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw aria-hidden />
                  )}
                  <span className="hidden sm:inline">Rollback</span>
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
