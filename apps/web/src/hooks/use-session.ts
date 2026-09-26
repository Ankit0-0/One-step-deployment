'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';

export const sessionKey = ['session'] as const;

export function useSession() {
  const api = useApi();
  return useQuery({ queryKey: sessionKey, queryFn: () => api.me(), staleTime: 60_000 });
}
