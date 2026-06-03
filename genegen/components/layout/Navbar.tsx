'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Dna } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { UserButton, useUser } from '@clerk/nextjs';
import { siteConfig } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/gene-search', label: siteConfig.chemoTox },
  { href: '/gene-ontology', label: siteConfig.thematicGo },
  { href: '/ivcca', label: 'IVCCA' },
  { href: '/upload-csv', label: 'Upload' },
  { href: '/dashboard', label: 'Dashboard' },
];

export function Navbar({ marketing = false }: { marketing?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const { isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
        scrolled || !marketing
          ? 'border-b border-white/10 bg-[#0A0A0A]/85 backdrop-blur-xl'
          : 'bg-transparent'
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Main">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#00FFAA] to-[#22D3EE] text-[#0A0A0A] shadow-[0_0_24px_rgba(0,255,170,0.35)] transition-transform group-hover:scale-105">
            <Dna className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">{siteConfig.name}</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === link.href || pathname?.startsWith(link.href + '/')
                  ? 'text-[#00FFAA]'
                  : 'text-zinc-400 hover:text-white'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {isLoaded && !isSignedIn && (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={siteConfig.links.thematicGo}>Get Started</Link>
              </Button>
            </>
          )}
          {isLoaded && isSignedIn && <UserButton />}
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-zinc-300 hover:bg-white/10 md:hidden"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/10 bg-[#0A0A0A]/95 backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-3 text-base font-medium text-zinc-200 hover:bg-white/10"
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-4">
                <Button variant="outline" asChild>
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href={siteConfig.links.thematicGo}>Get Started</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
