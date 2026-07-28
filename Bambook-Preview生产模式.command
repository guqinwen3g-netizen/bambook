#!/bin/bash
# 双击在终端中启动 Bambook Production Preview（API + 已 build 的 Electron 窗口）。
# 性能等同最终 DMG。修改代码后需要重新双击这个文件来重新构建。
# 首次需在终端执行: chmod +x "Bambook-Preview生产模式.command"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec bash scripts/electron-preview.sh
