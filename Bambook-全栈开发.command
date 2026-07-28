#!/bin/bash
# 双击在终端中启动 Bambook（API + 前端）。首次需在终端执行: chmod +x "Bambook-全栈开发.command"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec bash scripts/dev-stack.sh
