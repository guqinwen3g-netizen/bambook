#!/usr/bin/env bash
# 把当前仓库里的 ops-panel + 主 API 源码打包，上传到 Mac mini 的 Ops Panel
# 使用 osascript 弹窗输入 Ops Token，避免在 shell 历史中留下密码
set -euo pipefail

OPS_URL="${BAMBOOK_OPS_URL:-https://ops.jiangsupanda.com}"
ARCHIVE="/tmp/bambook-ops-upload.tar.gz"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d server/ops-panel ]]; then
  echo "error: cannot find server/ops-panel under $REPO_ROOT" >&2
  exit 1
fi

# 从 keychain 里读 token；没有就弹窗输入
OPS_TOKEN="$(security find-generic-password -a bambook-ops -s bambook-ops-token -w 2>/dev/null || true)"
TOKEN_FROM_KEYCHAIN=0
if [[ -n "$OPS_TOKEN" ]]; then
  TOKEN_FROM_KEYCHAIN=1
fi

if [[ -z "$OPS_TOKEN" ]]; then
  OPS_TOKEN="$(osascript <<'OSA'
try
  set dlg to display dialog "请输入 Bambook Ops Panel 管理员 Token：" default answer "" with hidden answer with title "Bambook 部署" buttons {"取消", "确定"} default button "确定"
  if button returned of dlg is "确定" then return text returned of dlg
end try
return ""
OSA
  )"
fi

if [[ -z "$OPS_TOKEN" ]]; then
  echo "已取消（未输入 token）" >&2
  exit 1
fi

if [[ "$TOKEN_FROM_KEYCHAIN" != "1" ]]; then
  # 是否记到 keychain
  SAVE_CHOICE="$(osascript -e 'try' -e 'set r to button returned of (display dialog "是否把 token 保存到 macOS 钥匙串，下次免输入？" buttons {"不保存", "保存"} default button "保存" with title "Bambook 部署")' -e 'return r' -e 'end try' 2>/dev/null || echo "不保存")"
  if [[ "$SAVE_CHOICE" == "保存" ]]; then
    security delete-generic-password -a bambook-ops -s bambook-ops-token >/dev/null 2>&1 || true
    security add-generic-password -a bambook-ops -s bambook-ops-token -w "$OPS_TOKEN" >/dev/null
  fi
fi

echo "==> 打包源码..."
TAR_FILES=(
  server/ops-panel
  server/scripts
  server/docs/ops-panel-runbook.md
  server/src
  server/prisma
  server/package.json
  server/tsconfig.json
)
[[ -f server/package-lock.json ]] && TAR_FILES+=(server/package-lock.json)
[[ -f server/vitest.config.ts ]] && TAR_FILES+=(server/vitest.config.ts)

tar --exclude='node_modules' --exclude='.git' --exclude='.playwright-mcp' \
  --exclude='dist' --exclude='build' --exclude='*.log' \
  -czf "$ARCHIVE" "${TAR_FILES[@]}"

SIZE=$(stat -f%z "$ARCHIVE" 2>/dev/null || stat -c%s "$ARCHIVE")
SIZE_MB=$(awk -v b="$SIZE" 'BEGIN{ printf "%.2f", b/1024/1024 }')
echo "==> 包大小: ${SIZE_MB} MB"
echo "==> 上传到 $OPS_URL/api/admin/deploy-package ..."

HTTP_RESP=$(mktemp)
HTTP_CODE=$(curl -sS --http1.1 -m 360 -o "$HTTP_RESP" -w '%{http_code}' \
  -X POST "$OPS_URL/api/admin/deploy-package" \
  -H 'Content-Type: application/gzip' \
  -H "X-Bambook-Ops-Token: $OPS_TOKEN" \
  --data-binary "@$ARCHIVE")

unset OPS_TOKEN

echo "==> HTTP $HTTP_CODE"
if command -v jq >/dev/null 2>&1; then
  jq -r '.message // .error // .' "$HTTP_RESP" 2>/dev/null || cat "$HTTP_RESP"
else
  cat "$HTTP_RESP"
fi
echo
rm -f "$HTTP_RESP"

if [[ "$HTTP_CODE" != "200" ]]; then
  osascript -e "display notification \"HTTP $HTTP_CODE, check Ops Panel logs\" with title \"Bambook deploy failed\"" 2>/dev/null || true
  exit 2
fi

osascript -e 'display notification "Ops Panel + Main API deployed. Restart scheduled." with title "Bambook deploy complete"' 2>/dev/null || true
echo "✓ 部署成功"
