/**
 * Clerk keys in Docker / Coolify:
 * - Edge middleware only sees NEXT_PUBLIC_* and it is inlined at **build** time.
 * - Node (layout, RSC) can read CLERK_PUBLISHABLE_KEY at **runtime** (same value as the public key).
 */

export function clerkPublishableKeyForEdge(): string {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
}

export function clerkPublishableKeyForNode(): string {
  return (
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}
