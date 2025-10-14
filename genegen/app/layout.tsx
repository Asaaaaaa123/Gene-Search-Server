import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}
