import Link from 'next/link';
import { Dna } from 'lucide-react';
import { siteConfig } from '@/lib/site';

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 bg-[#050505]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#00FFAA] to-[#22D3EE] text-[#0A0A0A]">
                <Dna className="h-4 w-4" />
              </span>
              <span className="text-lg font-semibold text-white">{siteConfig.name}</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-500">{siteConfig.description}</p>
            <p className="mt-4 text-xs text-zinc-600">
              Produced by <span className="text-zinc-400">{siteConfig.producer}</span>
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Product</h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/gene-search" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  {siteConfig.chemoTox}
                </Link>
              </li>
              <li>
                <Link href="/gene-ontology" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  {siteConfig.thematicGo}
                </Link>
              </li>
              <li>
                <Link href="/ivcca" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  IVCCA Suite
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Account</h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/sign-in" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  Sign in
                </Link>
              </li>
              <li>
                <Link href="/sign-up" className="text-zinc-500 transition hover:text-[#00FFAA]">
                  Sign up
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-12 border-t border-white/5 pt-8 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
