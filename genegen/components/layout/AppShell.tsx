'use client';

import { CosmicBackground } from './CosmicBackground';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="cosmic-bg relative min-h-screen">
      <CosmicBackground />
      <Navbar />
      <main className="relative z-10 pt-16">{children}</main>
      <Footer />
    </div>
  );
}
