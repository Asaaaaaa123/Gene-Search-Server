'use client';

import Link from 'next/link';
import {
  Dna,
  Search,
  Network,
  Upload,
  Share2,
  SlidersHorizontal,
  ArrowUpRight,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/utils';

const iconMap = {
  dna: Dna,
  search: Search,
  network: Network,
  upload: Upload,
  share: Share2,
  sliders: SlidersHorizontal,
} as const;

export function Features() {
  const reduce = useReducedMotion();

  return (
    <section id="features" className="relative z-10 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Built for <span className="text-gradient">publication-grade</span> science
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
            Every module preserves your existing workflows—now wrapped in a cinematic research interface.
          </p>
        </motion.div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {siteConfig.features.map((feature, i) => {
            const Icon = iconMap[feature.icon];
            return (
              <motion.div
                key={feature.title}
                initial={reduce ? false : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
              >
                <Link
                  href={feature.href}
                  className={cn(
                    'group glass flex h-full flex-col rounded-2xl p-6 transition-all duration-300',
                    'hover:border-[#00FFAA]/40 hover:shadow-[0_0_40px_rgba(0,255,170,0.12)] hover:-translate-y-1'
                  )}
                >
                  <motion.div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#00FFAA]/20 to-[#22D3EE]/20 text-[#00FFAA]"
                    whileHover={reduce ? undefined : { rotate: 6, scale: 1.08 }}
                  >
                    <Icon className="h-6 w-6" aria-hidden />
                  </motion.div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                    {feature.title}
                    <ArrowUpRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" />
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-500">{feature.description}</p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
