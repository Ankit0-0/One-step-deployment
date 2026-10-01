'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useApi } from '@/lib/api-context';

/** Layout for signed-in pages: redirects to /login when there is no session. */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const api = useApi();
  const queryClient = useQueryClient();
  const unauthenticated = session.error instanceof ApiError && session.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  async function logout() {
    await api.logout().catch(() => {});
    queryClient.clear();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Rocket className="size-5" aria-hidden />
            Deploy
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {session.data ? (
              <>
                <span className="hidden text-muted-foreground sm:inline">
                  {session.data.isGuest ? 'Guest' : session.data.email}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void logout()}>
                  Log out
                </Button>
              </>
            ) : (
              <Skeleton className="h-5 w-40" />
            )}
          </div>
        </div>
      </header>
      {session.data?.isGuest && session.data.expiresAt && (
        <div className="border-b bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
          You are using a guest account. It and everything in it will be deleted{' '}
          {formatRelative(session.data.expiresAt)}.{' '}
          <button type="button" className="underline" onClick={() => void logout()}>
            Sign in with email
          </button>{' '}
          for a permanent account.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {session.data ? (
          children
        ) : session.error && !unauthenticated ? (
          <p className="text-destructive">Could not load your session: {session.error.message}</p>
        ) : (
          <div className="space-y-4" aria-busy>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </main>
    </div>
  );
}
