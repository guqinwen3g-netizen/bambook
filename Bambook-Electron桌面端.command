#!/bin/bash
# 双击在终端中启动 Bambook Electron 桌面端（API + Electron 窗口）。
# 首次需在终端执行: chmod +x "Bambook-Electron桌面端.command"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec bash scripts/electron-stack.sh
