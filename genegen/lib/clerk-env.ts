/**
 * Clerk keys in Docker / Coolify:
 * - Node (layout, RSC) can read CLERK_PUBLISHABLE_KEY at **runtime** (same value as the public key).
 * - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is optional; used when set at build for client bundles.
 */

export function clerkPublishableKeyForNode(): string {
  return (
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}
