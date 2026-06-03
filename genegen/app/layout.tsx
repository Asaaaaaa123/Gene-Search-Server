import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkPublishableKeyForNode } from '@/lib/clerk-env';
import { ClientLayout } from '@/components/layout/ClientLayout';
import { siteConfig } from '@/lib/site';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.heroTitle}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    'gene analysis',
    'bioinformatics',
    'gene ontology',
    'thematic GO',
    'IVCCA',
    'gene expression',
    'ChemoTox Explore',
    'Thematic GO ontology',
  ],
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.tagline,
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = clerkPublishableKeyForNode();
  const shell = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );

  if (!publishableKey) {
    return shell;
  }

  return <ClerkProvider publishableKey={publishableKey}>{shell}</ClerkProvider>;
}
