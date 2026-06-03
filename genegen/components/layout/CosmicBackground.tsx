'use client';

import { motion, useReducedMotion } from 'framer-motion';

export function CosmicBackground() {
  const reduce = useReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <motion.div
        className="absolute -left-1/4 top-0 h-[600px] w-[600px] rounded-full bg-[#7C3AED]/30 blur-[120px]"
        animate={reduce ? undefined : { x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-1/4 top-1/3 h-[500px] w-[500px] rounded-full bg-[#00FFAA]/15 blur-[100px]"
        animate={reduce ? undefined : { x: [0, -30, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-[#22D3EE]/20 blur-[90px]"
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
