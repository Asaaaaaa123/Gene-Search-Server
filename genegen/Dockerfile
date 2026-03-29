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

# All deploy config from repo file (when Coolify UI env vars are unavailable).
RUN test -f coolify-deploy.env || (echo "ERROR: Missing genegen/coolify-deploy.env — copy coolify-deploy.env.example" >&2 && exit 1)
RUN chmod +x docker-entrypoint.sh

# Do not use Clerk in middleware.ts — Edge bundle breaks Coolify health checks without build-time keys.
RUN chmod +x scripts/check-no-clerk-middleware.sh && ./scripts/check-no-clerk-middleware.sh

RUN set -a \
  && . ./coolify-deploy.env \
  && set +a \
  && npm run build

# Fail the image if Edge middleware still bundles Clerk (stale source or clerkMiddleware).
RUN node -e "\
const fs=require('fs');\
const p='.next/server/middleware.js';\
if(!fs.existsSync(p)) process.exit(0);\
const s=fs.readFileSync(p,'utf8');\
if(/clerk|publishableKey|throwMissingPublishableKeyError/i.test(s)){\
  console.error('Build error: Clerk must not be in middleware — remove clerkMiddleware / middleware.ts');\
  process.exit(1);\
}"

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
