'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { siteConfig } from '@/lib/site';

export function Testimonials() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % siteConfig.testimonials.length);
    }, 5000);
    return () => clearInterval(id);
  }, [reduce]);

  const t = siteConfig.testimonials[index];

  return (
    <section className="relative z-10 py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <motion.h2
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-3xl font-bold text-white"
        >
          Trusted in the lab
        </motion.h2>
        <motion.div
          key={index}
          ref={dragRef}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-strong mt-12 rounded-2xl p-8 sm:p-10"
        >
          <p className="text-lg leading-relaxed text-zinc-300">&ldquo;{t.quote}&rdquo;</p>
          <p className="mt-6 font-semibold text-white">{t.name}</p>
          <p className="text-sm text-zinc-500">{t.role}</p>
        </motion.div>
        <div className="mt-6 flex justify-center gap-2">
          {siteConfig.testimonials.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-8 bg-[#00FFAA]' : 'w-2 bg-white/20'
              }`}
              aria-label={`Testimonial ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
