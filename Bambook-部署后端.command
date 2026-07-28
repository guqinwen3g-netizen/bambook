#!/bin/bash
# 双击：把当前 server/ 代码打包推送到 Mac mini 并自动重启主 API。
# 影响 https://jiangsupanda.com/bambook/api/* 与 /bambookos/ 后端。
# 首次需在终端执行: chmod +x "Bambook-部署后端.command"
# Token 会从 keychain 自动读取，没有时弹窗输入。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec bash scripts/ops-upload-package.sh
