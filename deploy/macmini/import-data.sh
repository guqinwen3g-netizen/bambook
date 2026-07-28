#!/bin/bash
# Bambook Mac mini - Database export/import
#
# Export on laptop:
#   bash deploy/macmini/import-data.sh export
#
# Import on Mac mini:
#   bash deploy/macmini/import-data.sh import bambook_dump.sql

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# deploy/macmini/ -> Bambook 项目根 (含 package.json)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

# Read DATABASE_URL from .env.local
if [ -f "$SERVER_DIR/.env.local" ]; then
    DATABASE_URL=$(grep '^DATABASE_URL=' "$SERVER_DIR/.env.local" | sed 's/DATABASE_URL=//' | tr -d '"')
    export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "Error: DATABASE_URL not found in $SERVER_DIR/.env.local"
    exit 1
fi

# Parse postgresql://user:pass@host:port/dbname
DB_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*@[^:]+:([0-9]+).*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')

DUMP_FILE="${2:-bambook_dump.sql}"

case "${1:-}" in
    export)
        echo "Exporting database $DB_NAME -> $DUMP_FILE"
        PGPASSWORD="$DB_PASS" pg_dump \
            -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
            -d "$DB_NAME" \
            --no-owner --no-privileges \
            --clean --if-exists \
            > "$DUMP_FILE"
        echo "Done: $(wc -l < "$DUMP_FILE") lines, $(du -h "$DUMP_FILE" | cut -f1)"
        echo "Copy $DUMP_FILE to Mac mini, then run:"
        echo "  bash deploy/macmini/import-data.sh import $DUMP_FILE"
        ;;

    import)
        if [ ! -f "$DUMP_FILE" ]; then
            echo "Error: $DUMP_FILE not found"
            exit 1
        fi
        echo "Importing $DUMP_FILE -> database $DB_NAME"
        PGPASSWORD="$DB_PASS" psql \
            -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
            -d "$DB_NAME" \
            < "$DUMP_FILE"
        echo "Done. Verify with: curl http://localhost:8081/api/v1/orders"
        ;;

    *)
        echo "Usage:"
        echo "  bash $0 export [dump.sql]   - Export from local Postgres"
        echo "  bash $0 import [dump.sql]   - Import to Mac mini Postgres"
        exit 1
        ;;
esac
