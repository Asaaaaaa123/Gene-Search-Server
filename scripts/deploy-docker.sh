#!/usr/bin/env bash
# Build and start Gene Search platform with Docker Compose.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example — edit Clerk keys before production deploy."
  else
    echo "Missing $ENV_FILE — copy .env.example and fill in values." >&2
    exit 1
  fi
fi

if grep -q 'CHANGE_ME' "$ENV_FILE" 2>/dev/null; then
  echo "Warning: $ENV_FILE still contains CHANGE_ME placeholders (Clerk keys required for auth)." >&2
fi

echo "Using compose file: $COMPOSE_FILE"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build "$@"

echo ""
echo "Frontend: http://localhost:${FRONTEND_PUBLISH_PORT:-3000}"
echo "Backend:  http://localhost:${BACKEND_PUBLISH_PORT:-8000}/api/health"
echo "Logs:     docker compose -f $COMPOSE_FILE logs -f"
