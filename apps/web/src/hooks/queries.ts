'use client';

import { useQuery } from '@tanstack/react-query';
import { isTerminalStatus, type DeploymentDto } from '@osd/shared';
import { useApi } from '@/lib/api-context';
import { deploymentKey } from './use-deployment-logs';

export const projectsKey = ['projects'] as const;
export const projectKey = (id: string) => ['project', id] as const;
export const deploymentsKey = (projectId: string) => ['deployments', projectId] as const;

/** Poll while anything is still building so badges and durations stay current. */
const ACTIVE_POLL_MS = 3_000;

export function useProjects() {
  const api = useApi();
  return useQuery({ queryKey: projectsKey, queryFn: () => api.listProjects() });
}

export function useProject(id: string) {
  const api = useApi();
  return useQuery({ queryKey: projectKey(id), queryFn: () => api.getProject(id) });
}

export function useDeployments(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: deploymentsKey(projectId),
    queryFn: () => api.listDeployments(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((d) => !isTerminalStatus(d.status)) ? ACTIVE_POLL_MS : false,
  });
}

export function useDeployment(id: string) {
  const api = useApi();
  return useQuery<DeploymentDto>({
    queryKey: deploymentKey(id),
    queryFn: () => api.getDeployment(id),
  });
}
