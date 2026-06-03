'use client';

import Link from 'next/link';
import { Dna, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { PlatformPage } from '@/components/platform/PlatformPage';

export default function GeneOntologyOptions() {
  return (
    <PlatformPage
      title="Gene Ontology Analysis"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#00FFAA]/30 to-[#22D3EE]/30 text-[#00FFAA]">
          <Dna className="h-5 w-5" />
        </span>
      }
    >
      <div className="mb-12 text-center">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          Choose your <span className="text-gradient">analysis approach</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
          Automated default themes or fully customized keyword maps—same enrichment engine underneath.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        <motion.div whileHover={{ y: -4 }} className="platform-panel p-10">
          <h3 className="text-2xl font-bold text-zinc-900">Default Theme Analysis</h3>
          <p className="mt-4 text-zinc-600">
            Pre-configured biological themes for fast, publication-ready enrichment summaries.
          </p>
          <Link
            href="/gene-ontology/default-theme"
            className="mt-8 inline-flex items-center font-semibold text-indigo-600 hover:text-[#00FFAA]"
          >
            Start default analysis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </motion.div>

        <motion.div whileHover={{ y: -4 }} className="platform-panel p-10">
          <h3 className="text-2xl font-bold text-zinc-900">Customize Theme Analysis</h3>
          <p className="mt-4 text-zinc-600">
            Define your own themes and keywords for bespoke GO narratives and overlap networks.
          </p>
          <Link
            href="/gene-ontology/customize-theme"
            className="mt-8 inline-flex items-center font-semibold text-indigo-600 hover:text-[#00FFAA]"
          >
            Build custom themes
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </PlatformPage>
  );
}
