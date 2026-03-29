import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

/**
 * Edge middleware only sees NEXT_PUBLIC_* (inlined at build). Do not static-import
 * @clerk/nextjs here — the bundle still runs Clerk and throws Missing publishableKey on
 * every request when the key was empty at build time (e.g. Coolify runtime-only env).
 */
function edgePublishableKeyPresent(): boolean {
  const v = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return typeof v === "string" && v.trim().length > 0;
}

let clerkMw: NextMiddleware | null = null;
let clerkLoadFailed = false;

async function getClerkMiddleware(): Promise<NextMiddleware | null> {
  if (!edgePublishableKeyPresent()) return null;
  if (clerkLoadFailed) return null;
  if (clerkMw) return clerkMw;
  try {
    const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
    const isProtectedRoute = createRouteMatcher([
      "/upload-csv(.*)",
      "/add-gene(.*)",
    ]);
    clerkMw = clerkMiddleware(async (auth, request) => {
      if (isProtectedRoute(request)) {
        await auth.protect();
      }
    });
    return clerkMw;
  } catch {
    clerkLoadFailed = true;
    return null;
  }
}

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!edgePublishableKeyPresent()) {
    return NextResponse.next();
  }
  const clerk = await getClerkMiddleware();
  if (!clerk) {
    return NextResponse.next();
  }
  return clerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
