import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
          ← Back to home
        </Link>
      </div>
      <SignIn
        appearance={{ elements: { rootBox: "mx-auto" } }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </div>
  );
}
