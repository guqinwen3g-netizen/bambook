#!/usr/bin/env bash
# Web 开发入口：只启动前端。业务、账号、Agent、订单、知识库、邮件等
# 统一走 Bambook 数据中心；本地只允许偏好设置和缓存。

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# ---------- 清场 ----------
# 杀掉旧的 vite/server 进程和占用端口，避免 Vite fall-through 到 3001/3002
# 导致用户打开浏览器看到的是上次残留的实例。
echo ">>> [dev-stack] 清场旧进程"
pkill -f "apps/Bambook/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "apps/Bambook/server/.*nodemon" 2>/dev/null || true
for port in 3000 8081; do
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
        echo "    端口 $port 被占，kill: $pids"
        kill -9 $pids 2>/dev/null || true
    fi
done
sleep 0.5

echo ">>> [dev-stack] 使用数据中心 API；不启动本地后端"
trap 'true' EXIT INT TERM

# 后台等服务就绪再 open，避免浏览器打开太早看到空页面。
# 最长等 30s；超时不报错，让用户手动打开。
(
    for _ in $(seq 1 60); do
        vite_ok=0
        api_ok=0
        curl -sSf -o /dev/null --max-time 1 http://localhost:3000/ 2>/dev/null && vite_ok=1
        api_ok=1
        if [ "$vite_ok" = "1" ] && [ "$api_ok" = "1" ]; then
            open "http://localhost:3000/"
            exit 0
        fi
        sleep 0.5
    done
) &

npm run dev
