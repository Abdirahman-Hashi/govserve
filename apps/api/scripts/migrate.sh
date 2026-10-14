#!/bin/sh
# One-off release job (never run on API start): migrations as the owner, then the application's
# login role, then idempotent reference data. Secrets arrive as files under /run/secrets.
set -eu
read_secret() { [ -n "${1:-}" ] && [ -f "$1" ] && cat "$1"; }
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then
  DATABASE_URL="$(read_secret "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi
# Binaries are called directly: pnpm would re-check the workspace before every exec.
cd "$(dirname "$0")/.."
bin=node_modules/.bin
echo "migrate: applying migrations"
"$bin/prisma" migrate deploy
echo "migrate: ensuring the application role"
"$bin/ts-node" --swc scripts/db-app-role.ts
echo "migrate: reference data"
"$bin/ts-node" --swc prisma/seed.ts
echo "migrate: done"
