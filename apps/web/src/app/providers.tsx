'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, createApiClient, type ApiClient } from '@/lib/api';
import { ApiContext } from '@/lib/api-context';
import { env } from '@/lib/env';

export function Providers({ children, api }: { children: ReactNode; api?: ApiClient }) {
  const [client] = useState(() => api ?? createApiClient(env.NEXT_PUBLIC_API_URL));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // Auth and not-found errors won't fix themselves on retry.
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}
