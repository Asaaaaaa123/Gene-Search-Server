import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { Dna } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="cosmic-bg relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-zinc-400 transition hover:text-[#00FFAA]">
        <Dna className="h-5 w-5" />
        <span className="text-sm">Back to home</span>
      </Link>
      <div className="glass-strong w-full max-w-md rounded-2xl p-6">
        <SignIn
          appearance={{
            elements: {
              rootBox: 'mx-auto w-full',
              card: 'bg-transparent shadow-none',
            },
          }}
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
