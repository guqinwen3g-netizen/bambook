#!/bin/bash
# 双击：先推后端、再推网页端。一次完成全量发布。
# 首次需在终端执行: chmod +x "Bambook-一键全量部署.command"
# Token 会从 keychain 自动读取，没有时弹窗输入。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

echo "==> [1/2] 部署后端 ..."
bash scripts/ops-upload-package.sh

echo
echo "==> [2/2] 部署网页端 ..."
bash scripts/ops-upload-webapp.sh

echo
echo "✓ 全量部署完成"
echo "  网页端: https://jiangsupanda.com/bambookos/"
echo "  后端:   https://jiangsupanda.com/bambook/api/"
