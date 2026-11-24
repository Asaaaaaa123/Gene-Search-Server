import { siteConfig } from '@/lib/site';
import { cn } from '@/lib/utils';

type ProducerCreditProps = {
  /** "dark": on the dark shell (headers, top bars); "light": on the light tool surfaces. */
  tone?: 'dark' | 'light';
  className?: string;
};

/** "Zhimu Wang (Berezin's Lab - Washington University in Saint Louis)", shown on every tool of the platform. */
export function ProducerCredit({ tone = 'dark', className }: ProducerCreditProps) {
  const dark = tone === 'dark';
  return (
    <p className={cn('text-sm leading-snug', dark ? 'text-zinc-300' : 'text-slate-600', className)}>
      <span className={cn('font-semibold', dark ? 'text-[#00FFAA]' : 'text-teal-700')}>{siteConfig.producerName}</span>{' '}
      ({siteConfig.producerLab})
    </p>
  );
}
