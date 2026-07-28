#!/bin/bash
# 双击：把当前代码构建成网页版并推送到 Mac mini，
# 上线地址 https://jiangsupanda.com/bambookos/。
# 首次需在终端执行: chmod +x "Bambook-部署网页版.command"
# Token 会从 keychain 自动读取，没有时弹窗输入。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
exec bash scripts/ops-upload-webapp.sh
