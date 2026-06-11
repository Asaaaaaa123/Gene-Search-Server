#!/bin/sh
# Merge Coolify build args with coolify-deploy.env (if present). Never blank out existing keys.
set -e

API_URL="${COOLIFY_NEXT_PUBLIC_API_URL:-${NEXT_PUBLIC_API_URL:-}}"
NPK="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
CPK="${CLERK_PUBLISHABLE_KEY:-}"
SK="${CLERK_SECRET_KEY:-}"

if [ -f coolify-deploy.env ]; then
  echo "[prepare-coolify-deploy-env] Loading existing coolify-deploy.env as defaults"
  # shellcheck disable=SC1091
  set -a
  . ./coolify-deploy.env
  set +a
  [ -z "$API_URL" ] && API_URL="${NEXT_PUBLIC_API_URL:-}"
  [ -z "$NPK" ] && NPK="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
  [ -z "$CPK" ] && CPK="${CLERK_PUBLISHABLE_KEY:-}"
  [ -z "$SK" ] && SK="${CLERK_SECRET_KEY:-}"
fi

[ -z "$CPK" ] && CPK="$NPK"

if [ -z "$API_URL" ]; then
  echo "[prepare-coolify-deploy-env] ERROR: Set NEXT_PUBLIC_API_URL (Coolify build variable)." >&2
  exit 1
fi

printf '%s\n' \
  "# Generated for Docker build — merged from build args + coolify-deploy.env" \
  "NEXT_PUBLIC_API_URL=${API_URL}" \
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NPK}" \
  "CLERK_PUBLISHABLE_KEY=${CPK}" \
  "CLERK_SECRET_KEY=${SK}" \
  > coolify-deploy.env

echo "[prepare-coolify-deploy-env] Wrote coolify-deploy.env (API=${API_URL})"
