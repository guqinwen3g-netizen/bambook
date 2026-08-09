#!/usr/bin/env bash
# 本地构建 Bambook 网页端，把 dist/ 打成 tar.gz 上传到 Mac mini 的 Ops Panel。
# Mac mini 收到后解压到 ~/bambook-main-api/webapp/，
# 主 API serve 在 https://jiangsupanda.com/bambook/api/app/ （复用 /bambook/api ingress）。
#
# 无需额外 Cloudflare Tunnel ingress 规则：/bambook/api/app/* 走已有的 /bambook/api → 8081 规则，
# 主 API 中间件 strip /bambook 前缀后，/api/app/* 由 webapp 静态中间件 serve。
#
# Token 处理与 ops-upload-package.sh 一致：先从 keychain 读，没有就弹窗。
set -euo pipefail

OPS_URL="${BAMBOOK_OPS_URL:-https://ops.jiangsupanda.com}"
ARCHIVE="/tmp/bambook-webapp-upload.tar.gz"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  echo "error: cannot find package.json under $REPO_ROOT" >&2
  exit 1
fi

# 1) 构建：
#    - BAMBOOK_WEB_DEPLOY=1 让 vite.config.ts 把 base 切到 /bambook/api/app/
#    - VITE_API_BASE_URL 写死 API 根路径，避免网页端误连非数据中心 API
#      (网页端跟主 API 同域，用相对路径即可)
#    - /bambook/api/app/ 复用已有 /bambook/api Cloudflare Tunnel ingress，无需额外配置
echo "==> 构建 webapp (BAMBOOK_WEB_DEPLOY=1, base=/bambook/api/app/, API → /bambook/api)..."
BAMBOOK_WEB_DEPLOY=1 VITE_API_BASE_URL=/bambook/api npm run build

if [[ ! -d dist ]]; then
  echo "error: build did not produce dist/" >&2
  exit 1
fi

if [[ -d dist/wallpapers && -x /usr/bin/sips ]]; then
  BEFORE_WALLPAPERS_KB=$(du -sk dist/wallpapers | awk '{print $1}')
  echo "==> 压缩发布包壁纸（仅 dist/wallpapers，源素材不变）..."
  # 壁纸格式归一：照片类内容统一 JPG（PNG 无损体积过大，曾致上传包超 Cloudflare 100MB 限制）
  while IFS= read -r -d '' image; do
    lower_image="$(printf '%s' "$image" | tr '[:upper:]' '[:lower:]')"
    case "$lower_image" in
      *.jpg|*.jpeg)
        /usr/bin/sips -Z 1920 -s formatOptions 70 "$image" >/dev/null || true
        ;;
      *.png)
        # PNG 壁纸转 JPG（体积降一个数量级）；原地替换并删原 PNG
        base_no_ext="${image%.*}"
        if /usr/bin/sips -s format jpeg -s formatOptions 85 -Z 1920 "$image" --out "${base_no_ext}.jpg" >/dev/null 2>&1; then
          rm -f "$image"
        else
          /usr/bin/sips -Z 1920 "$image" >/dev/null || true
        fi
        ;;
    esac
  done < <(find dist/wallpapers -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0)
  AFTER_WALLPAPERS_KB=$(du -sk dist/wallpapers | awk '{print $1}')
  echo "==> 壁纸发布体积: $(awk -v kb="$BEFORE_WALLPAPERS_KB" 'BEGIN{printf "%.2f", kb/1024}') MB → $(awk -v kb="$AFTER_WALLPAPERS_KB" 'BEGIN{printf "%.2f", kb/1024}') MB"
fi

# 2) 打包 dist 内容（不含 dist 目录本身这层，方便服务器端直接展开为 webapp/）
# 轻量模式（BAMBOOK_WEB_LIGHT=1）：不打包 data/ 与 wallpapers/（3D 地图瓦片+壁纸，内容稳定），
# 服务器端 deploy-webapp 会自动从上一版本沿用这些目录。用于隧道质量差时把 ~90MB 包降到 ~4MB。
echo "==> 打包 dist/ → $ARCHIVE"
TAR_EXCLUDES=(--exclude='*.map')
if [[ "${BAMBOOK_WEB_LIGHT:-0}" == "1" ]]; then
  # data/wallpapers 为目录级沿用；assets 下 woff/woff2 字体（content-hash 命名，~35MB）文件级沿用
  TAR_EXCLUDES+=(--exclude='./data' --exclude='./wallpapers' --exclude='*.woff' --exclude='*.woff2')
  echo "==> 轻量模式：跳过 dist/data、dist/wallpapers 与字体文件（服务器沿用现有版本）"
fi
tar "${TAR_EXCLUDES[@]}" -czf "$ARCHIVE" -C dist .
SIZE=$(stat -f%z "$ARCHIVE" 2>/dev/null || stat -c%s "$ARCHIVE")
SIZE_MB=$(awk -v b="$SIZE" 'BEGIN{ printf "%.2f", b/1024/1024 }')
echo "==> 包大小: ${SIZE_MB} MB"

# 3) 取 token（与 ops-upload-package.sh 共用 keychain 条目）
OPS_TOKEN="$(security find-generic-password -a bambook-ops -s bambook-ops-token -w 2>/dev/null || true)"
if [[ -z "$OPS_TOKEN" ]]; then
  OPS_TOKEN="$(osascript <<'OSA'
try
  set dlg to display dialog "请输入 Bambook Ops Panel 管理员 Token：" default answer "" with hidden answer with title "Bambook 网页端部署" buttons {"取消", "确定"} default button "确定"
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

# 4) 上传
echo "==> 上传到 $OPS_URL/api/admin/deploy-webapp ..."
HTTP_RESP=$(mktemp)
HTTP_CODE=$(curl --http1.1 -sS -m 360 -o "$HTTP_RESP" -w '%{http_code}' \
  -X POST "$OPS_URL/api/admin/deploy-webapp" \
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
  osascript -e "display notification \"HTTP ${HTTP_CODE}, 去面板看日志\" with title \"网页端部署失败\"" 2>/dev/null || true
  exit 2
fi

osascript -e 'display notification "网页端已部署，访问 https://jiangsupanda.com/bambook/api/app/" with title "Bambook 网页端"' 2>/dev/null || true
echo "✓ 部署成功 — https://jiangsupanda.com/bambook/api/app/"
