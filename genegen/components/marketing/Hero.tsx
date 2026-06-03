'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { siteConfig } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { CosmicBackground } from '@/components/layout/CosmicBackground';
import { GeneClusterVisualization } from '@/components/marketing/GeneClusterVisualization';

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative flex min-h-screen flex-col justify-center overflow-hidden pt-16">
      <CosmicBackground />
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-4xl text-center"
        >
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#00FFAA]/30 bg-[#00FFAA]/10 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#00FFAA]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {siteConfig.producer}
          </span>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="block text-sm font-medium uppercase tracking-widest text-zinc-500 sm:text-base">
              {siteConfig.name}
            </span>
            <span className="mt-3 block text-gradient">{siteConfig.heroTitle}</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-zinc-400 sm:text-xl">
            {siteConfig.description}
          </p>
          <div className="mx-auto mt-12 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            <Button size="lg" asChild className="group h-12 w-full">
              <Link
                href={siteConfig.links.geneSearch}
                className="flex w-full items-center justify-center gap-2"
              >
                {siteConfig.chemoTox}
                <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild className="h-12 w-full">
              <Link href={siteConfig.links.thematicGo} className="flex w-full items-center justify-center">
                {siteConfig.thematicGo}
              </Link>
            </Button>
            <Button variant="secondary" size="lg" asChild className="h-12 w-full">
              <Link href={siteConfig.links.ivcca} className="flex w-full items-center justify-center">
                IVCCA
              </Link>
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="mx-auto mt-20 max-w-3xl"
        >
          <motion.div
            className="glass-strong relative aspect-[16/9] overflow-hidden rounded-3xl p-1 glow-accent"
            whileHover={reduce ? undefined : { scale: 1.01 }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#7C3AED]/25 via-[#0A0A0A]/40 to-[#00FFAA]/15" />
            <div className="relative h-full min-h-[220px] w-full rounded-[22px] bg-[#0A0A0A]/90">
              <GeneClusterVisualization />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0A0A0A] to-transparent"
                aria-hidden
              />
            </div>
          </motion.div>
          <p className="mt-4 text-center text-sm font-medium tracking-wide text-zinc-400">
            3D Version of PCA for sampple DataA
          </p>
        </motion.div>
      </div>
    </section>
  );
}
