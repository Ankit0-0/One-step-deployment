import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
