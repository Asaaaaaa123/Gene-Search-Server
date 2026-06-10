FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG COOLIFY_NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARG CLERK_PUBLISHABLE_KEY=""
ARG CLERK_SECRET_KEY=""

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV GENERATE_SOURCEMAP=false

# Prefer Coolify build arg, then generic ARG, then existing coolify-deploy.env in context
RUN API_URL="${COOLIFY_NEXT_PUBLIC_API_URL:-${NEXT_PUBLIC_API_URL:-}}" \
  && if [ -z "$API_URL" ] && [ -f coolify-deploy.env ]; then \
       echo "Using coolify-deploy.env from build context"; \
     elif [ -n "$API_URL" ]; then \
       printf '%s\n' \
         "NEXT_PUBLIC_API_URL=${API_URL}" \
         "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
         "CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY:-${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}}" \
         "CLERK_SECRET_KEY=${CLERK_SECRET_KEY}" \
         > coolify-deploy.env; \
     elif [ ! -f coolify-deploy.env ]; then \
       echo "ERROR: Set NEXT_PUBLIC_API_URL build arg or provide coolify-deploy.env" >&2; exit 1; \
     fi

RUN chmod +x docker-entrypoint.sh
RUN chmod +x scripts/check-no-clerk-middleware.sh && ./scripts/check-no-clerk-middleware.sh
RUN node scripts/validate-coolify-deploy.cjs

RUN set -a \
  && . ./coolify-deploy.env \
  && set +a \
  && if [ -n "$COOLIFY_NEXT_PUBLIC_API_URL" ]; then export NEXT_PUBLIC_API_URL="$COOLIFY_NEXT_PUBLIC_API_URL"; fi \
  && npm run build -- --no-lint

RUN node scripts/strip-edge-middleware.cjs

RUN cp genegen-boot.cjs .next/standalone/genegen-boot.cjs \
  && mkdir -p .next/standalone/scripts \
  && cp scripts/strip-edge-middleware.cjs .next/standalone/scripts/strip-edge-middleware.cjs \
  && node -e "const fs=require('fs');const p='.next/standalone/server.js';let s=fs.readFileSync(p,'utf8');const inj=\"require('./genegen-boot.cjs');\\n\";if(!s.includes('genegen-boot.cjs'))fs.writeFileSync(p,inj+s);"

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache wget

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/coolify-deploy.env /app/.env.runtime
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
