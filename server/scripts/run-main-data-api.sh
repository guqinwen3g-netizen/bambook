#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${BAMBOOK_MAIN_API_DIR:-$HOME/bambook-main-api}"
LOG_PREFIX="[bambook-main-api]"

export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:$PATH"

cd "$APP_DIR"

if [[ ! -f ".env" && ! -f ".env.local" ]]; then
  echo "$LOG_PREFIX missing .env or .env.local in $APP_DIR" >&2
  exit 1
fi

set -a
[[ -f ".env.local" ]] && source ".env.local"
[[ -f ".env" ]] && source ".env"
set +a

npm install --include=dev
npx prisma generate
npx prisma migrate deploy
npx prisma db push
npm run build

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8081}"

exec npm start
