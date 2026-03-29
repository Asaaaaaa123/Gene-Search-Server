FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Optional: docker-compose passes Coolify’s NEXT_PUBLIC_API_URL here (wins over coolify-deploy.env).
ARG COOLIFY_NEXT_PUBLIC_API_URL=""
# Bump when you need Coolify to rebuild (same commit “skip build” workaround).
LABEL genegen.coolify.deploy="2026-03-29-v3"

# All deploy config from repo file (when Coolify UI env vars are unavailable).
RUN test -f coolify-deploy.env || (echo "ERROR: Missing genegen/coolify-deploy.env — copy coolify-deploy.env.example" >&2 && exit 1)
RUN chmod +x docker-entrypoint.sh

# Do not use Clerk in middleware.ts — Edge bundle breaks Coolify health checks without build-time keys.
RUN chmod +x scripts/check-no-clerk-middleware.sh && ./scripts/check-no-clerk-middleware.sh

RUN node scripts/validate-coolify-deploy.cjs

RUN set -a \
  && . ./coolify-deploy.env \
  && set +a \
  && if [ -n "$COOLIFY_NEXT_PUBLIC_API_URL" ]; then export NEXT_PUBLIC_API_URL="$COOLIFY_NEXT_PUBLIC_API_URL"; fi \
  && npm run build

# Remove Edge middleware output so Coolify health checks never hit Clerk (fixes bad caches / old middleware.ts).
RUN node scripts/strip-edge-middleware.cjs

# Prepend boot to standalone server.js — runs even if host overrides ENTRYPOINT to `node server.js`.
RUN cp genegen-boot.cjs .next/standalone/genegen-boot.cjs \
  && mkdir -p .next/standalone/scripts \
  && cp scripts/strip-edge-middleware.cjs .next/standalone/scripts/strip-edge-middleware.cjs \
  && node -e "const fs=require('fs');const p='.next/standalone/server.js';let s=fs.readFileSync(p,'utf8');const inj=\"require('./genegen-boot.cjs');\\n\";if(!s.includes('genegen-boot.cjs'))fs.writeFileSync(p,inj+s);"

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
# Coolify / some orchestrators expect wget or curl for HEALTHCHECK overrides
RUN apk add --no-cache wget

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/coolify-deploy.env /app/.env.runtime
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
