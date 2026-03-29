import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkPublishableKeyForNode } from '@/lib/clerk-env';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'GeneSearch Pro - Advanced Gene Analysis Platform',
  description: 'Professional-grade tools for researchers, scientists, and bioinformatics professionals. Analyze gene expression, explore ontology relationships, and generate publication-ready insights.',
  keywords: 'gene analysis, bioinformatics, gene ontology, gene expression, research tools, scientific analysis',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = clerkPublishableKeyForNode();
  const shell = (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );

  if (!publishableKey) {
    return shell;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      {shell}
    </ClerkProvider>
  );
}
