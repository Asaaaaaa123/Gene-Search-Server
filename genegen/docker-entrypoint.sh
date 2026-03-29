#!/bin/sh
set -e
if [ -f /app/.env.runtime ]; then
  set -a
  # shellcheck disable=SC1091
  . /app/.env.runtime
  set +a
fi
exec "$@"
