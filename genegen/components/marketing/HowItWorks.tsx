'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { siteConfig } from '@/lib/site';

export function HowItWorks() {
  const reduce = useReducedMotion();

  return (
    <section id="how-it-works" className="relative z-10 border-y border-white/5 bg-black/30 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-3xl font-bold text-white sm:text-4xl"
        >
          How it works
        </motion.h2>
        <div className="mt-16 grid gap-8 md:grid-cols-4">
          {siteConfig.steps.map((item, i) => (
            <motion.div
              key={item.step}
              initial={reduce ? false : { opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="relative"
            >
              {i < siteConfig.steps.length - 1 && (
                <div className="absolute left-8 top-12 hidden h-px w-full bg-gradient-to-r from-[#00FFAA]/50 to-transparent md:block" />
              )}
              <span className="text-4xl font-bold text-[#00FFAA]/30">{item.step}</span>
              <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm text-zinc-500">{item.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
