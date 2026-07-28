#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

BACKUP_DIR="${BAMBOOK_BACKUP_DIR:-/Users/Shared/BambookBackups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/bambook-panda-hub-$STAMP.dump"

# Prisma accepts `?schema=public`, but pg_dump does not. Strip only that
# Prisma-specific query parameter while preserving other libpq parameters.
DUMP_DATABASE_URL="$(node -e '
const raw = process.env.DATABASE_URL;
const url = new URL(raw);
url.searchParams.delete("schema");
process.stdout.write(url.toString());
')"

pg_dump "$DUMP_DATABASE_URL" --format=custom --no-owner --no-acl --file="$OUT"

echo "Backup written: $OUT"
echo "Verify with: pg_restore --list \"$OUT\" >/dev/null"

