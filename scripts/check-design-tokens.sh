#!/usr/bin/env bash
# ═══ Bambook Design Token 防回退检查（基线模式） ═══
# 检查 tsx 文件中是否有新增的硬编码颜色/圆角，防止设计 token 回退。
# 基线模式：记录当前残留基线，只对"新增"硬编码报错。
# 豁免：吉祥物、3D 地图、邮件模板、发票模板（SVG/Canvas/邮件客户端不支持 CSS 变量）。
# 用法：bash scripts/check-design-tokens.sh
# CI 集成：npm run check:tokens
# 不用 set -e：rg 无匹配返回 1，脚本有自己的 errors 计数逻辑
set -uo pipefail

cd "$(dirname "$0")/.."

# ── 豁免文件清单 ──
EXCLUDE_GLOBS=(
  -g '!**/node_modules/**'
  -g '!**/__tests__/**'
  -g '!**/*.test.*'
  -g '!**/mascot/**'           # 吉祥物 SVG 动画
  -g '!**/*Globe*'              # 3D 地图 WebGL
  -g '!**/EmailManager*'        # 邮件 HTML 模板
  -g '!**/SampleInvoice*'       # 发票模板
  -g '!**/fabricSampleInvoice*' # 面料发票模板
)

# ── 基线（2026-08-06 根背景色 token 化后收拢，只减不增）──
BASELINE_ROUNDED=3        # 壁纸缩略图 17px / checkbox 等豁免边缘值（2026-08-06 阶段 B 收拢 4→3）
BASELINE_HEX_TAILWIND=0   # 全部 hex 颜色已 token 化（bg-app-dark/bg-app-light/text-deep 等）
BASELINE_HEX_INLINE=8     # 内联 style 中的灰色（已 token 化的排除）

errors=0

echo "═══ Bambook Design Token 防回退检查 ═══"
echo ""

# ── 1. 检查 rounded-[Npx] 硬编码圆角 ──
echo "▸ 检查 rounded-[Npx] 硬编码圆角..."
rounded_count=$(rg -c 'rounded-\[[0-9]+px\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$rounded_count" -gt "$BASELINE_ROUNDED" ]; then
  echo "  ❌ rounded-[Npx] 硬编码增加（基线 ${BASELINE_ROUNDED} → 当前 ${rounded_count}）"
  echo "  请使用语义类：rounded-panel/card/inset/control/field/compact/floating/card-lg"
  rg -n 'rounded-\[[0-9]+px\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$rounded_count" -lt "$BASELINE_ROUNDED" ]; then
  echo "  ✅ rounded-[Npx] 减少（基线 ${BASELINE_ROUNDED} → 当前 ${rounded_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ rounded-[Npx] 维持基线（$rounded_count 处，均为已知边缘值）"
fi
echo ""

# ── 2. 检查 Tailwind 类中的 hex 颜色 ──
echo "▸ 检查 Tailwind 类中的 hex 颜色..."
hex_tailwind_count=$(rg -c '(bg|text|border|ring|from|to|via|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$hex_tailwind_count" -gt "$BASELINE_HEX_TAILWIND" ]; then
  echo "  ❌ Tailwind 类中的 hex 颜色增加（基线 ${BASELINE_HEX_TAILWIND} → 当前 ${hex_tailwind_count}）"
  echo "  请使用语义类：bg-deep/text-link/border-action/accent-cyan 等"
  rg -n '(bg|text|border|ring|from|to|via|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$hex_tailwind_count" -lt "$BASELINE_HEX_TAILWIND" ]; then
  echo "  ✅ Tailwind hex 颜色减少（基线 ${BASELINE_HEX_TAILWIND} → 当前 ${hex_tailwind_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ Tailwind hex 颜色维持基线（$hex_tailwind_count 处，均为已知残留）"
fi
echo ""

# ── 3. 检查内联 style 中的 hex 颜色 ──
echo "▸ 检查内联 style 中的 hex 颜色..."
hex_inline_count=$(rg -c "style=\{[^}]*(color|background|borderColor|fill|stroke)[^}]*#[0-9a-fA-F]{3,8}" --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$hex_inline_count" -gt "$BASELINE_HEX_INLINE" ]; then
  echo "  ⚠️  内联 style hex 颜色增加（基线 ${BASELINE_HEX_INLINE} → 当前 ${hex_inline_count}）"
  echo "  建议使用 var(--bambook-*-*) token"
  rg -n "style=\{[^}]*(color|background|borderColor|fill|stroke)[^}]*#[0-9a-fA-F]{3,8}" --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -5
  # 内联 style 是警告，不计入 errors
else
  echo "  ✅ 内联 style hex 颜色维持或低于基线（$hex_inline_count 处）"
fi
echo ""

# ── 4. 检查 box-shadow 硬编码（flat 设计应无阴影）──
echo "▸ 检查 box-shadow 硬编码（flat 设计应无阴影）..."
# 正则用 \s+（至少一个空格）确保 [^nv] 匹配值首字符，排除 none（n）和 var()（v）
shadow_count=$(rg -c 'box-shadow:\s+[^nv]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$shadow_count" -gt 0 ]; then
  echo "  ⚠️  发现 $shadow_count 处 box-shadow 硬编码（flat 设计应使用 var(--bambook-flat-shadow)）"
  rg -n 'box-shadow:\s+[^nv]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -5
  # box-shadow 是警告
else
  echo "  ✅ 无 box-shadow 硬编码"
fi
echo ""

# ── 总结 ──
echo "═══ 总结 ═══"
if [ "$errors" -gt 0 ]; then
  echo "❌ 发现 $errors 项硬编码回退（新增的 rounded/hex Tailwind 类）"
  echo "   基线：rounded=$BASELINE_ROUNDED, hex_tailwind=$BASELINE_HEX_TAILWIND"
  echo "   如需更新基线，请编辑 scripts/check-design-tokens.sh 并在 commit 中说明"
  exit 1
else
  echo "✅ 设计 token 防回退检查通过（基线模式）"
  echo "   当前：rounded=$rounded_count, hex_tailwind=$hex_tailwind_count, hex_inline=$hex_inline_count"
  exit 0
fi
