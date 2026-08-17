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
BASELINE_ROUNDED=1        # 2026-08-16 批 1 收拢 3→1：Sidebar/Settings 2 处改语义类；
                          # 余 1 处为 pwa/mobile/MobileWebNavigation.tsx rounded-[20px]（移动端冻结区，搁置不动）
BASELINE_HEX_TAILWIND=0   # 全部 hex 颜色已 token 化（bg-app-dark/bg-app-light/text-deep 等）
BASELINE_HEX_INLINE=8     # 内联 style 中的灰色（已 token 化的排除）
# ── BDS v2.2 新增守卫基线（2026-08-16 批 2 建立，只减不增）──
# v2.2 同心层级刻度收编后，裸 Tailwind 圆角刻度类（rounded-xs/sm/md/lg/xl/2xl/3xl）
# 与 font-medium/semibold/bold 写法（全局 Light 300 纪律，机制已坍缩 300 但写法必须统一
# 为 font-light）均属违例；现存基线全部为 pwa/mobile 移动端冻结区存量（搁置不动）。
BASELINE_BARE_RADIUS=4    # pwa/mobile 裸圆角档：MobileWebNavigation 3 + MobileWebApp 1
BASELINE_FONT_WEIGHT=3    # pwa/mobile 字重写法：MobileWebNavigation 2 + MobileWebApp 1
# ── BDS v2 主题耦合基线（2026-08-13 建立，只减不增）──
# v2 纪律：新组件对主题机制透明（无 isDarkMode 三元），
# 暗色优先由 tokens.css [data-theme] 覆盖承载；
# P2 收口（2026-08-15）允许单写自适应类内使用 Tailwind `dark:` 变体
# （.dark 根 class，替代旧 isDarkMode JS 三元 + _DARK/_LIGHT 双写常量），
# dark: 变体因此成为合规载体并一次性上调基线，此后只减不增。
BASELINE_DARK_VARIANT=14       # dark: Tailwind 变体（行数口径；历史注释见 git 记录）
                               # 2026-08-17 W0 锁进度 196→182（实测回归）；批G-1 KnowledgeBase 收编 182→111；
                               # 批G-2 ProductsManager+compiledProductsTemplates 收编 111→89；
                               # 批G-3 ui/ 控件族 收编 89→64；批G-4 Relations域 收编 64→53；
                               # 批G-5 AdminPanel+DesignTuner 收编 53→44；批G-6 DataCenter+Assistant+AgentFormBlock 收编 44→33；
                               # 批G-7 UserAvatar+StepPreview+EmailEditor+NotificationCenter 收编 33→26；
                               # 批G-8a ImportWizard+QuotationImportWizard+StepUpload 收编 26→19；
                               # 批G-8b AgentDocumentRenderer+AgentTableBlock+AgentDiagramBlock 收编 19→14；批 G 目标 ≤10
BASELINE_IS_DARK_TERNARY=219   # isDarkMode ? 三元（历史收拢 2439→366→226→220；
                               # 2026-08-17 W0 锁进度 220→219；
                               # 余量为 spotlight/图表数值型三元 + isDarkMode?: 类型声明 + 冻结/搁置文件，合规保留）
# ── BDS 高分收编基线（2026-08-17 W0 建立，只减不增）──
# 依据 docs/design/10-评审与决策/2026-08-17-前端设计地毯式评审报告.md 批 A-J 移交清单建立。
# 口径：出现次数（rg -o），豁免集与上文 EXCLUDE_GLOBS 一致。
BASELINE_RAW_SEMANTIC=19       # 批A：raw 语义色 → BDS 语义 token（--success-text/--warning-text/--danger-text/--accent-text）
                               # 2026-08-17 批A 收编 131→33；批H 收编 TraceabilityPanel 14（33→19，接入 §4.5 雾化分类色板 mask-*）
                               # 余量：FabricSampleInvoiceGenerator 8（豁免清单·测试锁定业务语义）/ App.tsx 5（W5 解锁）/ pwa 3（移动端冻结）/ GarmentOrders 3（批I 死代码移交 W5）
BASELINE_RAW_MASK=3            # 批B：自造遮罩 bg-black/N → var(--mask-bg)（tokens.css 唯一遮罩入口）
                               # 2026-08-17 批B 收编 17→4；批G-5 DesignTuner dark: 收编顺带移除 4→3
                               # 余量：pwa 2（移动端冻结）/ App.tsx 1（W5 解锁）
BASELINE_BARE_ROUNDED=5        # 批D：裸 rounded（非 BDS 刻度，Tailwind 默认 4px）→ rounded-bds-sm/rounded-control/rounded-field/rounded-bds-xs
                               # 2026-08-17 批D 收编 43→5；余量 5 处均为注释文本（StepUpload/Dashboard/compiledSurfacePrimitives×2/compiledDashboardTemplates），非 className
BASELINE_HANDWRITTEN_BTN=22    # 批E：手写主按钮（rounded-full + bg-[var(--os-vnext-brand-blue)] 组合，双序合计）→ bds-btn bds-btn-primary
                               # 2026-08-17 批E 收编 35→22（13 处按钮：DocumentCenter×4 / ReportCenter×4 / ImportWizard / Register / QuotationImportWizard / compiledProductsTemplates×2）；
                               # 余量 21 处均非按钮：进度条/圆点/头像/徽章等装饰性 accent 填充（Dashboard×5 / compiledDashboardTemplates×5 / ProductsManager×2 / compiledProductsTemplates×3 / AdminPanel / RelationsManager / ImageUploader / QuotationImportWizard 链接 / DesignTuner 开发工具）+ FabricSampleInvoiceGenerator 1（测试锁定业务语义豁免）
BASELINE_TEXT_WHITE=34         # 批E 伴随项：accent 填充上 text-white 直用 → var(--on-accent)（警告级，不计 errors）
                               # 2026-08-17 批E 伴随收编 48→34（13 处手写主按钮改 bds-btn-primary 后文字色由组件类 --on-accent 承载）
# 批F（2026-08-17）：font-black 唯一残留 ProductionGlobe.tsx:654（DOM 覆盖层）已改 font-light；
# 字重断言同步扩展 font-(medium|semibold|bold) → font-(medium|semibold|bold|black)，基线维持 3（pwa 存量）

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

# ── 5. BDS v2 采用度 + 主题耦合基线（只减不增）──
echo "▸ 检查 BDS v2 主题耦合基线（dark: 变体 / isDarkMode 三元）..."
dark_variant_count=$(rg -c 'dark:' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
is_dark_ternary_count=$(rg -c 'isDarkMode\s*\?' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
bds_adopt_files=$(rg -l 'bds-(btn|card|input|badge|table|modal|toast|pagehead|segment|tabs|switch|check|listrow|setrow|formrow|progress|skeleton|empty|tag|avatar|tooltip|filterbar|divider)' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
coupling_errors=0
if [ "$dark_variant_count" -gt "$BASELINE_DARK_VARIANT" ]; then
  echo "  ❌ dark: 变体增加（基线 ${BASELINE_DARK_VARIANT} → 当前 ${dark_variant_count}）"
  echo "     BDS v2 组件应对主题透明，暗色由 tokens.css [data-theme] 覆盖承载"
  coupling_errors=$((coupling_errors + 1))
fi
if [ "$is_dark_ternary_count" -gt "$BASELINE_IS_DARK_TERNARY" ]; then
  echo "  ❌ isDarkMode 三元增加（基线 ${BASELINE_IS_DARK_TERNARY} → 当前 ${is_dark_ternary_count}）"
  echo "     禁止新增 isDarkMode 分支，请使用 BDS v2 语义 token（bg-bds-card/text-bds-ink 等）"
  coupling_errors=$((coupling_errors + 1))
fi
if [ "$coupling_errors" -eq 0 ]; then
  echo "  ✅ 主题耦合维持或低于基线（dark: ${dark_variant_count} / isDarkMode: ${is_dark_ternary_count}）"
fi
echo "  📊 BDS v2 采用度：${bds_adopt_files} 个 tsx 文件已使用 .bds-* 组件类"
errors=$((errors + coupling_errors))
echo ""

# ── 6. 检查裸 Tailwind 圆角刻度类（BDS v2.2 同心层级刻度收编后属违例）──
echo "▸ 检查裸 Tailwind 圆角刻度类（rounded-xs/sm/md/lg/xl/2xl/3xl）..."
bare_radius_count=$(rg -c 'rounded-(xs|sm|md|lg|xl|2xl|3xl)\b' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$bare_radius_count" -gt "$BASELINE_BARE_RADIUS" ]; then
  echo "  ❌ 裸 Tailwind 圆角刻度类增加（基线 ${BASELINE_BARE_RADIUS} → 当前 ${bare_radius_count}）"
  echo "  请使用 BDS v2.2 语义类：rounded-panel/card/card-lg/inset/control/field/compact/floating"
  echo "  或同心刻度 var 引用类：rounded-bds-xs/sm/compact/md/control/inset/lg/card-lg/xl/2xl/pill"
  rg -n 'rounded-(xs|sm|md|lg|xl|2xl|3xl)\b' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$bare_radius_count" -lt "$BASELINE_BARE_RADIUS" ]; then
  echo "  ✅ 裸圆角刻度类减少（基线 ${BASELINE_BARE_RADIUS} → 当前 ${bare_radius_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ 裸圆角刻度类维持基线（$bare_radius_count 处，均为移动端冻结区存量）"
fi
echo ""

# ── 7. 检查 font-medium/semibold/bold/black 字重写法（全局 Light 300 纪律）──
echo "▸ 检查 font-medium/semibold/bold/black 字重写法..."
font_weight_count=$(rg -c 'font-(medium|semibold|bold|black)\b' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$font_weight_count" -gt "$BASELINE_FONT_WEIGHT" ]; then
  echo "  ❌ 过重字重写法增加（基线 ${BASELINE_FONT_WEIGHT} → 当前 ${font_weight_count}）"
  echo "  全局 Light 300 纪律：请写 font-light（机制已坍缩 font-medium→300，但写法必须统一）"
  rg -n 'font-(medium|semibold|bold|black)\b' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$font_weight_count" -lt "$BASELINE_FONT_WEIGHT" ]; then
  echo "  ✅ 过重字重写法减少（基线 ${BASELINE_FONT_WEIGHT} → 当前 ${font_weight_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ 字重写法维持基线（$font_weight_count 处，均为移动端冻结区存量）"
fi
echo ""

# ── 8. 批A：raw 语义色 → BDS 语义 token（出现次数口径）──
echo "▸ 检查 raw 语义色（red/emerald/blue/amber…未走 BDS 语义 token）..."
RAW_SEMANTIC_RE='(text|bg|border|ring|from|to|via)-(red|emerald|blue|rose|amber|orange|yellow|sky|cyan|teal|violet|pink|indigo|green)-[0-9]'
raw_semantic_count=$(rg -o "$RAW_SEMANTIC_RE" --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
if [ "$raw_semantic_count" -gt "$BASELINE_RAW_SEMANTIC" ]; then
  echo "  ❌ raw 语义色增加（基线 ${BASELINE_RAW_SEMANTIC} → 当前 ${raw_semantic_count}）"
  echo "  请使用 BDS 语义 token：--success-text / --warning-text / --danger-text / --accent-text"
  rg -n "$RAW_SEMANTIC_RE" --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$raw_semantic_count" -lt "$BASELINE_RAW_SEMANTIC" ]; then
  echo "  ✅ raw 语义色减少（基线 ${BASELINE_RAW_SEMANTIC} → 当前 ${raw_semantic_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ raw 语义色维持基线（$raw_semantic_count 处，批A 收编对象）"
fi
echo ""

# ── 9. 批B：自造遮罩 → var(--mask-bg) ──
echo "▸ 检查自造遮罩（bg-black/N，应统一 --mask-bg）..."
raw_mask_count=$(rg -o 'bg-black/[0-9]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
if [ "$raw_mask_count" -gt "$BASELINE_RAW_MASK" ]; then
  echo "  ❌ 自造遮罩增加（基线 ${BASELINE_RAW_MASK} → 当前 ${raw_mask_count}）"
  echo "  tokens.css 定义 --mask-bg 为全系统唯一遮罩入口"
  rg -n 'bg-black/[0-9]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$raw_mask_count" -lt "$BASELINE_RAW_MASK" ]; then
  echo "  ✅ 自造遮罩减少（基线 ${BASELINE_RAW_MASK} → 当前 ${raw_mask_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ 自造遮罩维持基线（$raw_mask_count 处，批B 收编对象）"
fi
echo ""

# ── 10. 批D：裸 rounded（非 BDS 刻度）──
echo "▸ 检查裸 rounded（Tailwind 默认 4px，不在 BDS 刻度内）..."
bare_rounded_count=$(rg -o -P 'rounded(?![\w-])' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
if [ "$bare_rounded_count" -gt "$BASELINE_BARE_ROUNDED" ]; then
  echo "  ❌ 裸 rounded 增加（基线 ${BASELINE_BARE_ROUNDED} → 当前 ${bare_rounded_count}）"
  echo "  微件用 rounded-bds-sm / rounded-compact，控件用 rounded-control"
  rg -n -P 'rounded(?![\w-])' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | head -10
  errors=$((errors + 1))
elif [ "$bare_rounded_count" -lt "$BASELINE_BARE_ROUNDED" ]; then
  echo "  ✅ 裸 rounded 减少（基线 ${BASELINE_BARE_ROUNDED} → 当前 ${bare_rounded_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ 裸 rounded 维持基线（$bare_rounded_count 处，批D 收编对象）"
fi
echo ""

# ── 11. 批E：手写主按钮 → bds-btn bds-btn-primary（双序组合）──
echo "▸ 检查手写主按钮（rounded-full + brand-blue 组合，绕过 bds-btn 组件类）..."
hw_a=$(rg -o 'rounded-full[^"'"'"']*bg-\[var\(--os-vnext-brand-blue\)\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
hw_b=$(rg -o 'bg-\[var\(--os-vnext-brand-blue\)\][^"'"'"']*rounded-full' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
handwritten_btn_count=$((hw_a + hw_b))
if [ "$handwritten_btn_count" -gt "$BASELINE_HANDWRITTEN_BTN" ]; then
  echo "  ❌ 手写主按钮增加（基线 ${BASELINE_HANDWRITTEN_BTN} → 当前 ${handwritten_btn_count}）"
  echo "  主按钮 100% 走 bds-btn bds-btn-primary（统一高度/字重/hover/disabled 规格）"
  errors=$((errors + 1))
elif [ "$handwritten_btn_count" -lt "$BASELINE_HANDWRITTEN_BTN" ]; then
  echo "  ✅ 手写主按钮减少（基线 ${BASELINE_HANDWRITTEN_BTN} → 当前 ${handwritten_btn_count}）— 恭喜！请更新基线。"
else
  echo "  ✅ 手写主按钮维持基线（$handwritten_btn_count 处，批E 收编对象）"
fi
echo ""

# ── 12. 批E 伴随项：text-white 直用 → var(--on-accent)（警告级）──
echo "▸ 检查 text-white 直用（accent 填充上应走 --on-accent）..."
text_white_count=$(rg -o 'text-white' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
if [ "$text_white_count" -gt "$BASELINE_TEXT_WHITE" ]; then
  echo "  ⚠️  text-white 增加（基线 ${BASELINE_TEXT_WHITE} → 当前 ${text_white_count}）"
  echo "  accent 填充上的文字请用 text-[var(--on-accent)]（深色模式语义可能不同）"
  # 警告级，不计 errors
else
  echo "  ✅ text-white 维持或低于基线（$text_white_count 处）"
fi
echo ""

# ── 总结 ──
echo "═══ 总结 ═══"
if [ "$errors" -gt 0 ]; then
  echo "❌ 发现 $errors 项硬编码回退（新增的 rounded/hex/裸刻度/过重字重/raw语义色/自造遮罩/裸rounded/手写主按钮）"
  echo "   基线：rounded=$BASELINE_ROUNDED, hex_tailwind=$BASELINE_HEX_TAILWIND, bare_radius=$BASELINE_BARE_RADIUS, font_weight=$BASELINE_FONT_WEIGHT, raw_semantic=$BASELINE_RAW_SEMANTIC, raw_mask=$BASELINE_RAW_MASK, bare_rounded=$BASELINE_BARE_ROUNDED, handwritten_btn=$BASELINE_HANDWRITTEN_BTN"
  echo "   如需更新基线，请编辑 scripts/check-design-tokens.sh 并在 commit 中说明"
  exit 1
else
  echo "✅ 设计 token 防回退检查通过（基线模式 · BDS v2.2 + 高分收编 W0）"
  echo "   当前：rounded=$rounded_count, hex_tailwind=$hex_tailwind_count, hex_inline=$hex_inline_count, bare_radius=$bare_radius_count, font_weight=$font_weight_count"
  echo "   收编：raw_semantic=$raw_semantic_count, raw_mask=$raw_mask_count, bare_rounded=$bare_rounded_count, handwritten_btn=$handwritten_btn_count, text_white=$text_white_count"
  exit 0
fi
