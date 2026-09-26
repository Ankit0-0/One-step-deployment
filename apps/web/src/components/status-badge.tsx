import { CheckCircle2, CircleDashed, Loader2, UploadCloud, XCircle, Ban } from 'lucide-react';
import type { DeploymentStatus } from '@osd/shared';
import { Badge } from '@/components/ui/badge';

const STYLES: Record<
  DeploymentStatus,
  {
    label: string;
    variant: 'success' | 'warning' | 'info' | 'destructive' | 'secondary';
    icon: typeof Loader2;
    spin?: boolean;
  }
> = {
  QUEUED: { label: 'Queued', variant: 'secondary', icon: CircleDashed },
  BUILDING: { label: 'Building', variant: 'warning', icon: Loader2, spin: true },
  UPLOADING: { label: 'Uploading', variant: 'info', icon: UploadCloud },
  READY: { label: 'Ready', variant: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', variant: 'destructive', icon: XCircle },
  CANCELED: { label: 'Canceled', variant: 'secondary', icon: Ban },
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  const { label, variant, icon: Icon, spin } = STYLES[status];
  return (
    <Badge variant={variant} data-status={status}>
      <Icon className={spin ? 'size-3 animate-spin' : 'size-3'} aria-hidden />
      {label}
    </Badge>
  );
}
