'use client';

import { usePathname } from 'next/navigation';
import { AppShell } from './AppShell';

const bareRoutes = ['/', '/sign-in', '/sign-up'];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBare = bareRoutes.some((r) => pathname === r || pathname?.startsWith(r + '/'));

  if (isBare) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
