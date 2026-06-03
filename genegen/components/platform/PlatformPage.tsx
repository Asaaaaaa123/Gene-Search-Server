'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

type PlatformPageProps = {
  title: string;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export function PlatformPage({ title, icon, headerRight, children }: PlatformPageProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-[#00FFAA]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Home
            </Link>
            <div className="flex items-center gap-3 border-l border-white/10 pl-4">
              {icon}
              <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{title}</h1>
            </div>
          </div>
          {headerRight ? <div className="flex flex-wrap items-center gap-2">{headerRight}</div> : null}
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
    </motion.div>
  );
}
