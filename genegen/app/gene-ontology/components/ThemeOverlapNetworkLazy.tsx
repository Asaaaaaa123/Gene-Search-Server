'use client';

import dynamic from 'next/dynamic';
import type { ThemeOverlapData } from './ThemeOverlapNetwork';

export type { ThemeOverlapData };

const ThemeOverlapNetwork = dynamic(() => import('./ThemeOverlapNetwork'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-gray-200 bg-white p-8">
      <p className="text-sm text-gray-600">Loading theme overlap visualization…</p>
    </div>
  ),
});

export default ThemeOverlapNetwork;
