import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="cosmic-bg flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-gradient">404</h1>
      <p className="mt-4 text-zinc-400">This page drifted out of orbit.</p>
      <Button className="mt-8" asChild>
        <Link href="/">Return home</Link>
      </Button>
    </div>
  );
}
