#!/bin/sh
set -e
# If you do not see this line in Coolify logs, you are not running this image.
printf '%s\n' "[genegen] starting (Clerk via Node layout + .env.runtime; no Clerk Edge middleware)"
if [ -f /app/.env.runtime ]; then
  set -a
  # shellcheck disable=SC1091
  . /app/.env.runtime
  set +a
fi
exec "$@"
