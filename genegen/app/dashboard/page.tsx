'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Dna,
  Search,
  Network,
  BarChart3,
  ChevronRight,
  Activity,
  FileUp,
} from 'lucide-react';
import { PlatformPage } from '@/components/platform/PlatformPage';
import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/utils';

const modules = [
  { name: siteConfig.chemoTox, href: '/gene-search', icon: Search, stat: 'Live DB' },
  { name: siteConfig.thematicGo, href: '/gene-ontology', icon: Dna, stat: '20 themes' },
  { name: 'IVCCA', href: '/ivcca', icon: Network, stat: 'PCA · t-SNE' },
  { name: 'Upload', href: '/upload-csv', icon: FileUp, stat: 'CSV · TXT' },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'runs'>('overview');
  const [toggle, setToggle] = useState(true);

  return (
    <PlatformPage
      title="Research Dashboard"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#00FFAA]/30 to-[#22D3EE]/30 text-[#00FFAA]">
          <BarChart3 className="h-5 w-5" />
        </span>
      }
    >
      <div className="mb-6 flex gap-2">
        {(['overview', 'runs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium capitalize transition',
              activeTab === tab ? 'bg-[#00FFAA]/20 text-[#00FFAA]' : 'text-zinc-400 hover:bg-white/5'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div
          className="platform-panel lg:col-span-2 p-6"
          layout
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">Pipeline status</h2>
            <button
              type="button"
              role="switch"
              aria-checked={toggle}
              onClick={() => setToggle(!toggle)}
              className={cn(
                'relative h-7 w-12 rounded-full transition',
                toggle ? 'bg-[#00FFAA]' : 'bg-zinc-300'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                  toggle ? 'left-6' : 'left-1'
                )}
              />
            </button>
          </div>
          <p className="mt-2 text-sm text-zinc-600">
            API proxy {toggle ? 'active' : 'paused'} — same routes as production tools.
          </p>
          <motion.div
            className="mt-6 grid grid-cols-3 gap-3"
            initial={false}
            animate={{ opacity: toggle ? 1 : 0.5 }}
          >
            {[
              { value: 72, label: siteConfig.chemoTox },
              { value: 45, label: siteConfig.thematicGo },
              { value: 91, label: 'IVCCA' },
            ].map((item) => (
              <motion.div
                key={item.label}
                className="rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 p-4"
                whileHover={{ scale: 1.02 }}
              >
                <Activity className="h-5 w-5 text-indigo-600" />
                <p className="mt-2 text-2xl font-bold text-zinc-900">{item.value}%</p>
                <p className="text-xs text-zinc-500">{item.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div
          className="platform-panel p-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-lg font-semibold text-zinc-900">Quick launch</h2>
          <ul className="mt-4 space-y-2">
            {modules.map((m) => (
              <li key={m.name}>
                <Link
                  href={m.href}
                  className="group flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/80 px-4 py-3 transition hover:border-[#00FFAA]/40 hover:bg-white"
                >
                  <span className="flex items-center gap-3">
                    <m.icon className="h-5 w-5 text-indigo-600" />
                    <span className="font-medium text-zinc-900">{m.name}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-[#00FFAA]" />
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <motion.p
        className="mt-8 text-center text-xs text-zinc-500"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Interactive preview — opens the same {siteConfig.name} modules with full functionality.
      </motion.p>
    </PlatformPage>
  );
}
