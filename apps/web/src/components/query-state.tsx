import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4" aria-hidden />
        {error.message}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Alert>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}
