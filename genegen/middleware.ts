import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Do not import @clerk/nextjs here. Edge middleware cannot use Coolify runtime-only env the way
 * Node does; a Clerk middleware bundle throws Missing publishableKey when the key was not inlined
 * at `next build`. Auth UI uses ClerkProvider in app/layout.tsx with CLERK_PUBLISHABLE_KEY at runtime.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
