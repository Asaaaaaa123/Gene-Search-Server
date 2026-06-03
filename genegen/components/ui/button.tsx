'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFAA]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-[#00FFAA] to-[#22D3EE] text-[#0A0A0A] hover:scale-[1.03] hover:shadow-[0_0_32px_rgba(0,255,170,0.45)] active:scale-[0.98]',
        outline:
          'border border-white/20 bg-white/5 text-white hover:border-[#00FFAA]/50 hover:bg-white/10',
        ghost: 'text-zinc-300 hover:bg-white/10 hover:text-white',
        secondary: 'bg-white/10 text-white hover:bg-white/15',
      },
      size: {
        default: 'h-11 px-6 py-2',
        sm: 'h-9 px-4 text-xs',
        lg: 'h-12 px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
