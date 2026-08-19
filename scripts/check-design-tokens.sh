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

# ── W-PG 页面规格化断言作用域（M1-M5）：components/ + src/ ──
# S-FE 排他工作面；server/ops-panel 归 S-BE 不入断言；pwa/ 移动端冻结区存量不入断言。
PG_SCAN_PATHS=(components)
[ -d src ] && PG_SCAN_PATHS+=(src)

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
BASELINE_DARK_VARIANT=7        # dark: Tailwind 变体（行数口径；历史注释见 git 记录）
                               # 2026-08-17 W0 锁进度 196→182（实测回归）；批G-1 KnowledgeBase 收编 182→111；
                               # 批G-2 ProductsManager+compiledProductsTemplates 收编 111→89；
                               # 批G-3 ui/ 控件族 收编 89→64；批G-4 Relations域 收编 64→53；
                               # 批G-5 AdminPanel+DesignTuner 收编 53→44；批G-6 DataCenter+Assistant+AgentFormBlock 收编 44→33；
                               # 批G-7 UserAvatar+StepPreview+EmailEditor+NotificationCenter 收编 33→26；
                               # 批G-8a ImportWizard+QuotationImportWizard+StepUpload 收编 26→19；
                               # 批G-8b AgentDocumentRenderer+AgentTableBlock+AgentDiagramBlock 收编 19→14；
                               # 批G-8c OrderLinesTable+ImageUploader+SampleNodesPanel+BusinessTools+SplashScreen 收编 14→9；
                               # 批G-8d Sidebar+compiledPrimitives 收编 9→7（目标 ≤10 达成）
                               # 余量 7 行：App.tsx 5（W5 冻结移交 S-ARCH）+ NotificationCenter 2（levelColorFor/levelBgFor 形参 `dark: boolean` 误匹配，非 Tailwind 变体）
BASELINE_IS_DARK_TERNARY=219   # isDarkMode ? 三元（历史收拢 2439→366→226→220；
                               # 2026-08-17 W0 锁进度 220→219；
                               # 余量为 spotlight/图表数值型三元 + isDarkMode?: 类型声明 + 冻结/搁置文件，合规保留）
# ── BDS 高分收编基线（2026-08-17 W0 建立，只减不增）──
# 依据 docs/design/10-评审与决策/2026-08-17-前端设计地毯式评审报告.md 批 A-J 移交清单建立。
# 口径：出现次数（rg -o），豁免集与上文 EXCLUDE_GLOBS 一致。
BASELINE_RAW_SEMANTIC=16       # 批A：raw 语义色 → BDS 语义 token（--success-text/--warning-text/--danger-text/--accent-text）
                               # 2026-08-19 批次 3c 批 I 收敛 19→16：GarmentOrders.tsx 死代码删除（含 bg-amber-500 暖色残留）
                               # 2026-08-17 批A 收编 131→33；批H 收编 TraceabilityPanel 14（33→19，接入 §4.5 雾化分类色板 mask-*）
                               # 余量：FabricSampleInvoiceGenerator 8（豁免清单·测试锁定业务语义）/ App.tsx 5（W5 解锁）/ pwa 3（移动端冻结）/ GarmentOrders 3（批I 死代码移交 W5）
BASELINE_RAW_MASK=3            # 批B：自造遮罩 bg-black/N → var(--mask-bg)（tokens.css 唯一遮罩入口）
                               # 2026-08-17 批B 收编 17→4；批G-5 DesignTuner dark: 收编顺带移除 4→3
                               # 余量：pwa 2（移动端冻结）/ App.tsx 1（W5 解锁）
BASELINE_BARE_ROUNDED=4        # 批D：裸 rounded（非 BDS 刻度，Tailwind 默认 4px）→ rounded-bds-sm/rounded-control/rounded-field/rounded-bds-xs
                               # 2026-08-17 批D 收编 43→5；余量 5 处均为注释文本（StepUpload/Dashboard/compiledSurfacePrimitives×2/compiledDashboardTemplates），非 className
                               # 2026-08-18 Phase 0 架构收口删除 compiled 模板后 5→4
BASELINE_HANDWRITTEN_BTN=8    # 批E：手写主按钮（rounded-full + bg-[var(--os-vnext-brand-blue)] 组合，双序合计）→ bds-btn bds-btn-primary
                               # 2026-08-18 W4 组8 ImportWizard 收编 9→8
                               # 2026-08-18 W1 组2 ReportCenter 收编 10→9（W0 已收至 9，基线随 W1 一并纠正）
                               # 2026-08-17 批E 收编 35→22（13 处按钮：DocumentCenter×4 / ReportCenter×4 / ImportWizard / Register / QuotationImportWizard / compiledProductsTemplates×2）；
                               # 2026-08-17 W4-Dashboard余量 收编 22→17：compiledDashboardTemplates×5 装饰性 accent 填充
                               # （装饰下划杠×2 / 进度条 fill×2 / 指示圆点×1）bg-[var(--os-vnext-brand-blue)] → bg-[var(--accent)] 主题自适应；
                               # 余量 16 处均非按钮：进度条/圆点/头像/徽章等装饰性 accent 填充（Dashboard×5 / ProductsManager×2 / compiledProductsTemplates×3 / AdminPanel / RelationsManager / ImageUploader / QuotationImportWizard 链接 / DesignTuner 开发工具）+ FabricSampleInvoiceGenerator 1（测试锁定业务语义豁免）
                               # 2026-08-18 Phase 0 架构收口删除 compiled 模板（compiledProductsTemplates 等 7 文件）后 17→10
BASELINE_TEXT_WHITE=11         # 批E 伴随项：accent 填充上 text-white 直用 → var(--on-accent)（警告级，不计 errors）
                               # 2026-08-18 W4 组8 手写主按钮组件化后 28→11（ImportWizard/ContractGenerator/PackingListGenerator text-white → text-[var(--on-accent)]）
                               # 2026-08-17 批E 伴随收编 48→34（13 处手写主按钮改 bds-btn-primary 后文字色由组件类 --on-accent 承载）；
                               # 批G-8d Sidebar active 文字 text-deep-alt dark:text-white → text-[var(--text-primary)]，34→33；
                               # W-PG-P2 Relations 主刀：删除确认弹窗 accent 按钮 text-white → text-[var(--on-accent)]；
                               # 同步实测校准 33→28（期间批G/批H 收编未回写警告级基线，只减不增原则下按实测值入库）
# 批F（2026-08-17）：font-black 唯一残留 ProductionGlobe.tsx:654（DOM 覆盖层）已改 font-light；
# 字重断言同步扩展 font-(medium|semibold|bold) → font-(medium|semibold|bold|black)，基线维持 3（pwa 存量）

# ── W-PG 页面规格化断言基线（2026-08-17 W-PG-P0 建立，只减不增）──
# 依据 docs/design-system/page-skeleton-spec.md §8（总控审定）+ 纪律文档 §10.3。
# 作用域 PG_SCAN_PATHS（components/ + src/）。
BASELINE_PAGEHEAD_MISSING=0   # M1: *Manager.tsx 缺 PageHeader/bds-pagehead 文件数（24 文件清单断言；
                              # 骨架为页面级规格，颜色 token 豁免不适用 → 仅豁免 node_modules/测试；
                              # 2026-08-17 W-PG-P2 DocumentCenter 主刀：tools/DocumentTemplateManager 补 PageHeader（3→2）；
                              # 2026-08-18 P2-W3 组6 收编 2→0：EmailManager + email/SignatureManager 补 PageHeader）
BASELINE_BDS_BTN_SM=0         # M2: bds-btn-sm 计数（行尾注释 `// bds-sm-ok: <原因>` 白名单豁免，
                              # 白名单仅限表格行内操作，spec §3.1）
BASELINE_FILTERBAR_H=0        # M3: bds-filterbar 行手写非 h-10 高度覆盖（行数口径，单行 className 约定；
                              # 2026-08-18 W1 组2 收编 3→0：FinanceManager:1935 / FinanceCreditPanel:367 / FinancePaymentRequestsPanel:422 均删 h-auto min-h-11）
BASELINE_NATIVE_CONTROLS=77   # M4: 原生 <select（无 bds-select 类）57 + type="date" 20 = 77
                              # 2026-08-18 P2-W4 组7+组8 收编 102→77：CockpitManager 2 date（-2）+
                              # crmRelationSections/DetailPanel/import 等 select→bds-select + date→CapsuleDateInput（-23）
                              # 2026-08-18 W2 遗留清零：RelationsManager 联系人生日 type=date → CapsuleDateInput（+hidden 兼容 FormData），date 35→34
                              # 2026-08-18 W1 组1+组2 收编 261→205→203：订单/财务/定价/关务/报表域 M4 清零
                              # 2026-08-18 W2 组3+组4 收编 203→148：采购/库存/BOM/生产（-9）+ 关系/CRM/供应商/季节/风险/营销（-46）
                              # 2026-08-18 P2-W3 组5+组6 收编 148→102：Products/Development/SampleNodes/QC（-29）
                              # + HR/hr×5/DataCenter/BusinessTools/AdminPanel/EmailManager（-17）
                              # 粗口径对账：全仓 `<select` 213 + `type="date"` 108 = 321（产品负责人点名⑥）；
                              # 粗口径把已 bds-select 化 33 处也计入总数，BDS 化后总数不变、无法感知进展，
                              # 故入库采用精确口径 281，随逐页主刀只减不增。
                              # 2026-08-17 W-PG-P2 DocumentCenter 主刀收编 281→273：
                              # DocumentCenter 工具栏 select×2 + 表单 select×2 + date×2（→CapsuleDateInput）
                              # + tools/DocumentTemplateManager select×2（共 select 178→172 / date 103→101）。
                              # 2026-08-17 W-PG-P2 OrderManager 主刀收编 273→272：状态 select className 前置
                              # （断言前瞻被 onChange 箭头 `=>` 截断的存量误计修正）。
                              # 2026-08-17 W-PG-P2 QuotationManager 主刀收编 272→267：
                              # 报价日期/有效期至 date×2（→CapsuleDateInput）+ 客户 select + 行单位 select className 前置
                              # + 币种 select className 前置（共 select 171→168 / date 101→99）。
                              # 注：select 标签 className 须置首属性（onChange 箭头 `=>` 会截断断言前瞻）。
                              # 2026-08-17 W-PG-P2 Relations 主刀收编 267→266：
                              # compiledRelationsTemplates 生日 date×1（→CapsuleDateInput，date 99→98）。
BASELINE_BDS_BTN_DARK=0       # M5: bds-btn-dark 计数（行尾注释 `// bds-dark-ok: <原因>` 白名单豁免）
                              # 2026-08-17 W-PG-P2 OrderManager 主刀清零（4→0）：视图 toggle 实心黑
                              # → bds-toggle active 冷墨洗（accent-tint + accent-text，spec §3.2 点名⑤）

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

# ── 13. W-PG 页面规格化断言 M1-M5（page-skeleton-spec §8 / 纪律 §10.3）──
echo "▸ 检查 W-PG 页面规格化断言（M1 PageHeader / M2 btn-sm / M3 filterbar 高度 / M4 原生控件 / M5 btn-dark）..."
pg_errors=0

# M1: 每个 *Manager.tsx 必含 PageHeader 或 bds-pagehead（24 文件清单；缺失数只减不增）
# 口径：骨架为页面级规格，邮件模板等颜色 token 豁免不适用 → 仅豁免 node_modules/测试。
pg_missing_pagehead=0
pg_missing_list=""
for f in $(rg --files -g '*Manager.tsx' -g '!**/node_modules/**' -g '!**/__tests__/**' -g '!**/*.test.*' "${PG_SCAN_PATHS[@]}" 2>/dev/null | sort); do
  if ! rg -lq 'PageHeader|bds-pagehead' "$f" 2>/dev/null; then
    pg_missing_pagehead=$((pg_missing_pagehead + 1))
    pg_missing_list="$pg_missing_list $f"
  fi
done
if [ "$pg_missing_pagehead" -gt "$BASELINE_PAGEHEAD_MISSING" ]; then
  echo "  ❌ M1: 缺 PageHeader/bds-pagehead 的 Manager 文件增加（基线 ${BASELINE_PAGEHEAD_MISSING} → 当前 ${pg_missing_pagehead}）"
  echo "     缺失文件:$pg_missing_list"
  pg_errors=$((pg_errors + 1))
elif [ "$pg_missing_pagehead" -lt "$BASELINE_PAGEHEAD_MISSING" ]; then
  echo "  ✅ M1: PageHeader 缺失减少（基线 ${BASELINE_PAGEHEAD_MISSING} → 当前 ${pg_missing_pagehead}）— 恭喜！请更新基线。"
else
  echo "  ✅ M1: PageHeader 缺失维持基线（${pg_missing_pagehead} 个，逐页主刀清零对象）"
fi

# M2: bds-btn-sm 计数（行尾 `// bds-sm-ok: <原因>` 白名单豁免；仅表格行内操作可用）
pg_btn_sm=$(rg -n 'bds-btn-sm' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | grep -vF 'bds-sm-ok' | rg -o 'bds-btn-sm' 2>/dev/null | wc -l | tr -d ' ')
if [ "$pg_btn_sm" -gt "$BASELINE_BDS_BTN_SM" ]; then
  echo "  ❌ M2: bds-btn-sm 增加（基线 ${BASELINE_BDS_BTN_SM} → 当前 ${pg_btn_sm}）"
  echo "     操作区主操作一律 bds-btn 默认 40px；bds-btn-sm 仅表格行内操作白名单（spec §3.1）"
  rg -n 'bds-btn-sm' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | grep -vF 'bds-sm-ok' | head -10
  pg_errors=$((pg_errors + 1))
else
  echo "  ✅ M2: bds-btn-sm 维持或低于基线（${pg_btn_sm} 处）"
fi

# M3: bds-filterbar 行手写非 h-10 高度覆盖（行数口径；总控校准：仅 h-10 白名单；
# 单行 className 约定，多行拼接场景随逐页主刀人工复核）
pg_filterbar_h=$(rg -n 'bds-filterbar' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | rg -P '(?<![\w-])(min-h|max-h|h)-(?!10\b)[0-9a-z\[]' 2>/dev/null | wc -l | tr -d ' ')
if [ "$pg_filterbar_h" -gt "$BASELINE_FILTERBAR_H" ]; then
  echo "  ❌ M3: filterbar 手写非 h-10 高度覆盖增加（基线 ${BASELINE_FILTERBAR_H} → 当前 ${pg_filterbar_h}）"
  echo "     filterbar 内禁任何手写 h- 覆盖（仅 h-10 白名单）；禁撑高筛选行抬高页面上边距"
  rg -n 'bds-filterbar' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | rg -P '(?<![\w-])(min-h|max-h|h)-(?!10\b)[0-9a-z\[]' | head -10
  pg_errors=$((pg_errors + 1))
elif [ "$pg_filterbar_h" -lt "$BASELINE_FILTERBAR_H" ]; then
  echo "  ✅ M3: filterbar 高度违例减少（基线 ${BASELINE_FILTERBAR_H} → 当前 ${pg_filterbar_h}）— 恭喜！请更新基线。"
else
  echo "  ✅ M3: filterbar 高度违例维持基线（${pg_filterbar_h} 行，逐页主刀清零对象）"
fi

# M4: 原生 <select（无 bds-select 类）+ type="date" 合计（精确口径 281，spec §8 M4 对账注释）
pg_native_select=$(rg -o '<select(?![^>]*bds-select)[^>]*>' --pcre2 -U --multiline-dotall --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | grep -c '<select')
pg_native_date=$(rg -o 'type="date"' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
pg_native_total=$((pg_native_select + pg_native_date))
if [ "$pg_native_total" -gt "$BASELINE_NATIVE_CONTROLS" ]; then
  echo "  ❌ M4: 原生表单控件增加（基线 ${BASELINE_NATIVE_CONTROLS} → 当前 ${pg_native_total}）"
  echo "     select → bds-select；date → CapsuleDateInput（spec §4）；禁新增原生渲染"
  pg_errors=$((pg_errors + 1))
elif [ "$pg_native_total" -lt "$BASELINE_NATIVE_CONTROLS" ]; then
  echo "  ✅ M4: 原生控件减少（基线 ${BASELINE_NATIVE_CONTROLS} → 当前 ${pg_native_total}，select ${pg_native_select} + date ${pg_native_date}）— 恭喜！请更新基线。"
else
  echo "  ✅ M4: 原生控件维持基线（${pg_native_total} 处 = select ${pg_native_select} + date ${pg_native_date}，逐页清零对象）"
fi

# M5: bds-btn-dark 计数（行尾 `// bds-dark-ok: <原因>` 白名单豁免；toggle active 禁实心黑，spec §3.2）
pg_btn_dark=$(rg -n 'bds-btn-dark' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | grep -vF 'bds-dark-ok' | rg -o 'bds-btn-dark' 2>/dev/null | wc -l | tr -d ' ')
if [ "$pg_btn_dark" -gt "$BASELINE_BDS_BTN_DARK" ]; then
  echo "  ❌ M5: bds-btn-dark 增加（基线 ${BASELINE_BDS_BTN_DARK} → 当前 ${pg_btn_dark}）"
  echo "     toggle active 态禁用实心黑填充，改用冷墨洗 tint/inset（spec §3.2）"
  rg -n 'bds-btn-dark' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | grep -vF 'bds-dark-ok' | head -10
  pg_errors=$((pg_errors + 1))
elif [ "$pg_btn_dark" -lt "$BASELINE_BDS_BTN_DARK" ]; then
  echo "  ✅ M5: bds-btn-dark 减少（基线 ${BASELINE_BDS_BTN_DARK} → 当前 ${pg_btn_dark}）— 恭喜！请更新基线。"
else
  echo "  ✅ M5: bds-btn-dark 维持基线（${pg_btn_dark} 处，P2 OrderManager 主刀清零对象）"
fi
errors=$((errors + pg_errors))
echo ""

# ── 14. L1-L8 布局构建语言守卫（Phase 1 建仓 2026-08-18，只减不增）──
# 依据 docs/design/06-组件规格/布局构建语言.md §1-8。
# 作用域 PG_SCAN_PATHS（components/）；基线 = Phase 1 建仓实测值（排除 test/豁免集），Phase 2 逐页收编只减不增。
echo "▸ 检查 L1-L8 布局原语守卫（间距刻度 L2 / 容器尺寸 L3 / 表格行高 L5 / icon 尺寸 L6 / 错误态 L7 / 暖色 hover L8）..."
layout_errors=0
layout_guard() {
  local name="$1" baseline="$2" current="$3" hint="$4"
  if [ "$current" -gt "$baseline" ]; then
    echo "  ❌ ${name} 增加（基线 ${baseline} → 当前 ${current}）"
    echo "     ${hint}"
    layout_errors=$((layout_errors + 1))
  elif [ "$current" -lt "$baseline" ]; then
    echo "  ✅ ${name} 减少（基线 ${baseline} → 当前 ${current}）— 恭喜！请更新基线。"
  else
    echo "  ✅ ${name} 维持基线（${current} 处）"
  fi
}

# L2 间距刻度：非刻度数值（p-9/p-11 等）与任意值（px-[15px]/gap-[7px] 等）
# p-0/m-0/gap-0 为去边距 reset 语义豁免；刻度值 = 4/8/12/16/20/24/28/32/40/48/64（--space-1/2/3/4/5/6/7/8/10/12/16）
# 注意：正则以 - 开头，必须用 -e 传参（rg 会把以 - 开头的独立参数当 flag 解析报错，2>/dev/null 吞掉后恒报 0）
# 2026-08-18 W1 修复 flag 缺陷后实测真实基线 = 11（l2_a 4 + l2_b 7）：-mt-28×4（compiledPrimitives×2/RelationsManager/OrderManager）
#   + -mb-[1px]（AgentMarkdownBlock）/ -mt-[112px]×4（ShipmentManager/RelationsManager/ProductsManager/DevelopmentManager）
#   + -mt-[8px]/-mt-[10px]（Assistant）；均为间距刻度外债务，随逐页重建清零
l2_a=$(rg -o -P -e '-(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-(?!0\b|1\b|2\b|3\b|4\b|5\b|6\b|7\b|8\b|10\b|12\b|16\b)[0-9]+' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
l2_b=$(rg -o -P -e '-(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\[[0-9]+px\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
l2_count=$((l2_a + l2_b))
layout_guard "L2 间距刻度越界" 6 "$l2_count" "间距只取刻度 4/8/12/16/20/24/28/32/40/48/64（--space-*），禁 p-9/p-11/px-[15px]"

# L3 容器与长宽比：硬编码 h/min-h/w/min-w px 尺寸 → bds-well/bds-thumb/尺寸族
# 豁免：模态 max-h-[85vh/88vh]、Agent 滚动区 max-h-[Npx]、图片预览 max-h-[90vh]（均为 max-h，本正则不含）
l3_count=$(rg -o '(h|min-h|w|min-w)-\[[0-9]+px\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
# 2026-08-19 批次 3c 批 I 收敛 59→57：GarmentOrders.tsx 死代码删除（含 2 处 h-[Npx]）
layout_guard "L3 硬编码尺寸" 57 "$l3_count" "卡片/图表/缩略图统一 .bds-well/.bds-thumb/尺寸族，禁 h-[Npx]/w-[Npx] 手写"

# L5 表格密度：行高 40-99px 硬编码 → .bds-table 密度修饰符（compact 40 / standard 48 / cozy 56）
l5_count=$(rg -o 'h-\[[4-9][0-9]px\]' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
layout_guard "L5 表格行高硬编码" 1 "$l5_count" "行高走 .bds-table 密度修饰符，禁行内 h-[Npx]"

# L6 icon 尺寸体系：size 非刻度（∉{14,16,18,20,24}）+ strokeWidth 自由数值（∉ --icon-w-* 档）
l6_size=$(rg -o --no-filename 'size=\{[0-9]+\}' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | rg -o '[0-9]+' | rg -v '^(14|16|18|20|24)$' | wc -l | tr -d ' ')
l6_stroke=$(rg -o --no-filename 'strokeWidth=\{[0-9.]+\}' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | rg -o '[0-9.]+' | rg -v '^(1\.75|2|1\.5|1\.25)$' | wc -l | tr -d ' ')
# 2026-08-19 批次 3c 批 I 收敛 72→65：GarmentOrders.tsx 死代码删除（含 7 处非刻度 size）
layout_guard "L6 icon size 非刻度" 65 "$l6_size" "icon size 只取 14/16/18/20/24（--icon-xs/sm/md/lg/xl）"
layout_guard "L6 icon strokeWidth 自由数值" 14 "$l6_stroke" "strokeWidth 走 --icon-w-* 档：≤18px 默认 1.75 / ≥20px 默认 2 / 细 1.5 / 极细 1.25，禁自由数值"

# L7 错误态：raw 错误色 → .bds-error-banner（--danger-tint/--danger-text）
l7_count=$(rg -o 'text-red-[0-9]+|bg-red-[0-9]+|border-red-[0-9]+' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
layout_guard "L7 raw 错误色" 0 "$l7_count" "错误横幅统一 .bds-error-banner，字段级走 .bds-formfield.error"

# L8 视觉反馈：暖色 hover → 统一 --hover-darken
l8_count=$(rg -o 'hover:(bg|text|border)-(amber|orange|yellow)' --glob '*.tsx' "${EXCLUDE_GLOBS[@]}" "${PG_SCAN_PATHS[@]}" 2>/dev/null | wc -l | tr -d ' ')
layout_guard "L8 暖色 hover" 0 "$l8_count" "hover 统一 --hover-darken，禁 amber/orange/yellow 暖色"

errors=$((errors + layout_errors))
echo ""

# ── 总结 ──
echo "═══ 总结 ═══"
if [ "$errors" -gt 0 ]; then
  echo "❌ 发现 $errors 项硬编码回退（新增的 rounded/hex/裸刻度/过重字重/raw语义色/自造遮罩/裸rounded/手写主按钮/页面规格化 M1-M5/L1-L8 布局守卫）"
  echo "   基线：rounded=$BASELINE_ROUNDED, hex_tailwind=$BASELINE_HEX_TAILWIND, bare_radius=$BASELINE_BARE_RADIUS, font_weight=$BASELINE_FONT_WEIGHT, raw_semantic=$BASELINE_RAW_SEMANTIC, raw_mask=$BASELINE_RAW_MASK, bare_rounded=$BASELINE_BARE_ROUNDED, handwritten_btn=$BASELINE_HANDWRITTEN_BTN"
  echo "   W-PG：pagehead_missing=$BASELINE_PAGEHEAD_MISSING, bds_btn_sm=$BASELINE_BDS_BTN_SM, filterbar_h=$BASELINE_FILTERBAR_H, native_controls=$BASELINE_NATIVE_CONTROLS, bds_btn_dark=$BASELINE_BDS_BTN_DARK"
  echo "   如需更新基线，请编辑 scripts/check-design-tokens.sh 并在 commit 中说明"
  exit 1
else
  echo "✅ 设计 token 防回退检查通过（基线模式 · BDS v2.2 + 高分收编 W0 + W-PG 页面规格化 M1-M5 + L1-L8 布局守卫）"
  echo "   当前：rounded=$rounded_count, hex_tailwind=$hex_tailwind_count, hex_inline=$hex_inline_count, bare_radius=$bare_radius_count, font_weight=$font_weight_count"
  echo "   收编：raw_semantic=$raw_semantic_count, raw_mask=$raw_mask_count, bare_rounded=$bare_rounded_count, handwritten_btn=$handwritten_btn_count, text_white=$text_white_count"
  echo "   W-PG：pagehead_missing=$pg_missing_pagehead, bds_btn_sm=$pg_btn_sm, filterbar_h=$pg_filterbar_h, native_controls=$pg_native_total, bds_btn_dark=$pg_btn_dark"
  echo "   L1-L8：spacing=$l2_count, hardcoded_size=$l3_count, row_h=$l5_count, icon_size=$l6_size, stroke_width=$l6_stroke, err_color=$l7_count, warm_hover=$l8_count"
  exit 0
fi
