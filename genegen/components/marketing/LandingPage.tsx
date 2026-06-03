'use client';

import { CosmicBackground } from '@/components/layout/CosmicBackground';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Hero } from './Hero';
import { Features } from './Features';
import { HowItWorks } from './HowItWorks';
import { Testimonials } from './Testimonials';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function LandingPage() {
  return (
    <div className="cosmic-bg relative min-h-screen">
      <CosmicBackground />
      <Navbar marketing />
      <Hero />
      <Features />
      <HowItWorks />
      <Testimonials />
      <section className="relative z-10 py-24">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready for your next figure?</h2>
          <p className="mt-4 text-zinc-400">Open the same powerful tools—reimagined for 2026.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/sign-up">Create account</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/gene-ontology">View demo</Link>
            </Button>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
