#!/bin/bash
# 双击在终端中启动 Bambook UI Lab Electron Dev（热更新 Electron 窗口）。
# 用独立 Dock 图标和独立 userData，可与主程序 Electron 同时打开。
# 修改代码后会通过 electron-vite dev 热更新，不需要每次重新 build。
# 首次需在终端执行: chmod +x "Bambook-UI Lab Electron.command"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec npm run electron:ui-lab
