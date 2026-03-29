#!/bin/sh
set -e
cd /app 2>/dev/null || true
# Refuse Clerk in Edge middleware (breaks Coolify health checks).
for f in $(find . -name middleware.ts -not -path "*/node_modules/*"); do
  if grep -qE 'clerkMiddleware|@clerk/nextjs' "$f"; then
    echo "ERROR: $f uses Clerk on the Edge. Remove clerkMiddleware / @clerk/nextjs from middleware." >&2
    exit 1
  fi
done
