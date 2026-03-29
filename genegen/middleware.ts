import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/upload-csv(.*)",
  "/add-gene(.*)",
]);

const clerk = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

/**
 * Edge only inlines NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Set it as a Docker **build arg**
 * for production (Coolify). If it is missing at build, we skip Clerk here so health checks
 * still pass; `/upload-csv` and `/add-gene` stay protected by client redirects + API auth.
 */
function clerkKeyPresentOnEdge(): boolean {
  const v = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return typeof v === "string" && v.trim().length > 0;
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!clerkKeyPresentOnEdge()) {
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
