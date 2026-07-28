#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Bambook Mac mini 数据中心一键部署脚本
#
# 用法：
#   1. 把整个 Bambook 项目 rsync 到 Mac mini
#   2. 在 Mac mini 上运行：bash deploy/macmini/setup.sh
#
# 它会做：
#   ✓ 检查 Homebrew，装 Node 22 + Postgres 16
#   ✓ 创建数据库和用户
#   ✓ 跑 Prisma 迁移建表
#   ✓ 生成 .env.local
#   ✓ 安装 npm 依赖
#   ✓ 注册 launchd 开机自启（Postgres + Express）
#   ✓ 可选：从笔记本导入已有数据
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }

# ── 路径 ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# deploy/macmini/ -> Bambook 项目根 (含 package.json)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

# ── 配置（改这里就行）─────────────────────────────────────────────
DB_USER="${BAMBOOK_DB_USER:-bambook}"
DB_PASS="${BAMBOOK_DB_PASS:-bambook_local}"
DB_NAME="${BAMBOOK_DB_NAME:-panda_hub_local}"
DB_PORT="${BAMBOOK_DB_PORT:-5432}"
SERVER_PORT="${BAMBOOK_SERVER_PORT:-8081}"

# ── Step 1: Homebrew ─────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    warn "Homebrew 未安装，正在安装..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # M 系列芯片需要加 PATH
    if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
fi
info "Homebrew 就绪"

# ── Step 2: Node.js 22 ──────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
    warn "安装 Node.js 22..."
    brew install node@22
    brew link node@22 --overwrite --force 2>/dev/null || true
fi
info "Node.js $(node -v)"

# ── Step 3: PostgreSQL 16 ───────────────────────────────────────
if ! command -v psql &>/dev/null; then
    warn "安装 PostgreSQL 16..."
    brew install postgresql@16
    brew link postgresql@16 --overwrite --force 2>/dev/null || true
fi

# 确保 Postgres 在跑
if ! brew services list | grep postgresql@16 | grep -q started; then
    brew services start postgresql@16
    sleep 3
fi
info "PostgreSQL $(psql --version | head -1 | awk '{print $3}')"

# ── Step 4: 创建数据库和用户 ────────────────────────────────────
# 检查用户是否存在
if psql -U "$USER" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; then
    info "数据库用户 '$DB_USER' 已存在"
else
    warn "创建数据库用户 '$DB_USER'..."
    psql -U "$USER" -d postgres -c "CREATE USER $DB_USER PASSWORD '$DB_PASS';" 2>/dev/null || \
    createuser "$DB_USER" 2>/dev/null && \
    psql -U "$USER" -d postgres -c "ALTER USER $DB_USER PASSWORD '$DB_PASS';" 2>/dev/null
fi

# 赋予 CREATEDB 权限（Prisma 迁移需要）
psql -U "$USER" -d postgres -c "ALTER ROLE $DB_USER CREATEDB;" 2>/dev/null || true

# 创建数据库
if psql -U "$DB_USER" -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    info "数据库 '$DB_NAME' 已存在"
else
    warn "创建数据库 '$DB_NAME'..."
    createdb -O "$DB_USER" "$DB_NAME" 2>/dev/null || \
    psql -U "$USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null
fi
info "数据库就绪"

# ── Step 5: npm 依赖 + Prisma ───────────────────────────────────
warn "安装后端依赖..."
cd "$SERVER_DIR"
npm install --production=false

warn "运行 Prisma 迁移..."
# 临时写 .env.local 让 prisma migrate 能连上
cat > .env.local <<EOF
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:$DB_PORT/$DB_NAME?schema=public"
PORT=$SERVER_PORT
BAMBOOK_REQUIRE_AUTH=false
EOF

npx prisma migrate deploy
npx prisma generate
info "Prisma 迁移完成，表结构就绪"

# ── Step 6: launchd 自启 ────────────────────────────────────────
warn "注册开机自启服务..."

# 6a. Postgres（Homebrew brew services 已经管了）
brew services restart postgresql@16

# 6b. Express 后端
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.bambook.server.plist"
cat > "$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bambook.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$SERVER_DIR/node_modules/.bin/ts-node</string>
        <string>$SERVER_DIR/src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(brew --prefix)/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$SERVER_DIR/logs/bambook-server.log</string>
    <key>StandardErrorPath</key>
    <string>$SERVER_DIR/logs/bambook-server-error.log</string>
</dict>
</plist>
EOF

mkdir -p "$SERVER_DIR/logs"
launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
launchctl load "$LAUNCHD_PLIST"
info "Express 后端已注册开机自启 (launchd)"

# ── Step 7: 验证 ────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Bambook Mac mini 数据中心部署完成！${NC}"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  数据库：postgresql://$DB_USER:***@localhost:$DB_PORT/$DB_NAME"
echo "  后端API：http://localhost:$SERVER_PORT"
echo "  日志：  $SERVER_DIR/logs/bambook-server.log"
echo ""
echo "  快速验证："
echo "    curl http://localhost:$SERVER_PORT/api/health"
echo ""
echo "  客户端连接：在 Electron 设置里填 Mac mini 的 IP + $SERVER_PORT"
echo ""
echo "  如需导入数据："
echo "    bash deploy/macmini/import-data.sh dump.sql"
echo "════════════════════════════════════════════════════════"
