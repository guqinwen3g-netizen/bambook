# Bambook OS 页面一致性全量台账（W-PG · 30 页）

> **依据**：`page-skeleton-spec.md`（总控审定）六区强制规格 + 纪律文档 §10.2 表头格式。
> **效力**：30 页逐页销号（CD-007/CD-008/CD-009）的全量驱动台账；「验收状态」列由总控签字置 ✅。
> **建立**：2026-08-17 S-FE · 待总控审定。

---

## §0 口径说明（审定重点）

1. **30 行组成（待总控校准确认）**：32 注册模块 − **发票管理**（别名入口，与财务管理同渲染文件 `FinanceManager.tsx` 三 tab 条件渲染，指标并入财务管理行）− **AI 助手**（对话式界面，六区规格不适用）。**设置**（nav.primary=false，经账号菜单进入）、**生产执行 MES**（可选模块，评审报告 30 页口径明示含 MesManager）、**管理后台**（adminOnly）均保留在台账。
2. **指标口径**：与 `check:tokens` M1-M5 完全同源——作用域 `components/` + `src/`，豁免集同脚本（test/mascot/Globe/邮件模板/发票模板除外）。**逐行列值为页面入口文件实测**；页面子树（如 `finance/`、`email/`、`tools/` 子组件与共享组件）存量随逐页主刀以页面为单位清零，不单列行。
3. **筛选区列**：「组合 bar」= 入口文件实测 `bds-filterbar`；「⚠️ 待走查」= 无 `bds-filterbar` 但有表单控件存量（疑自造筛选 UI，主刀时按 spec §2.1 决策树复核选型）；「—」= 无筛选控件。
4. **操作区列**：✅ = 机械断言无违例（无 bds-btn-sm / bds-btn-dark / 批E 手写主按钮余量命中）；❌ = 已登记违例。
5. **弹窗列**：`alert×N` = 原生 `alert()/confirm()` 计数（W4 BdsDialog/bdsToast 收敛对象，随逐页主刀迁移）；`bds-modal` 使用情况主刀时人工复核。
6. **dark: 残留**：30 入口文件实测均为 0（批 G 已收口；全局基线 7 = App.tsx 5 + NotificationCenter 误匹配 2）。
7. **raw 色残留**：入口文件实测均为 0（EmailManager 2 处属邮件模板豁免域）；全局基线 19 = 发票模板 8（豁免）+ App.tsx 5（W5）+ pwa 3（冻结）+ GarmentOrders 3（W5）。
8. **冻结/豁免不入台账**：App.tsx、GarmentOrders（W5 S-ARCH）、移动端冻结区、3D 地球 WebGL、macOS 三色灯、品牌 SVG、邮件/发票模板、PandaLab/DesignTuner 开发工具。

---

## §1 台账正文（30 行，按导航分组排序；★ = P2 首批四页）

> **2026-08-19 批次 3 校准**：①渲染文件列——4 页 compiled 双路径已收敛删除，全部指向 moduleRegistry entry 实际渲染源；②表单控件列——批次 3a 后 M4 守卫全局 date=0、select 真实非合规=0（bds-select/CapsuleDateInput 全合规），历史 select×N/date×N 计数全部转 ✅；③弹窗列——批次 3b 全站 ~211 处 alert/confirm 迁移 bdsToast/bdsConfirm（M6 守卫锁定=0），历史 alert×N 全部转 ✅；④M1（EmailManager PageHeader）/M3（FinanceManager filterbar 撑高）均已修复。验收状态列仍全 ⬜，待 3d 逐页深浅双主题截图走查 + 产品负责人签字。

| 页面 | 渲染文件 | 标题区 | 筛选区 | 操作区 | 表单控件 | 内容区 | dark:残留 | raw色残留 | 弹窗 | 问题记录 | 验收状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 全景看板 | components/Dashboard.tsx | ⚠️ 无 PageHeader（定制全景头部，豁免与否待总控校准） | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | 2026-08-19 校准：compiledDashboardTemplates 双路径已删除，渲染源=Dashboard.tsx；装饰性 accent 填充已收编（W4 · d808a3b，手写主按钮基线 22→17）；Dashboard.tsx 本体 5 处手写主按钮余量现为**真实渲染路径**（原"非渲染路径遗留"口径作废），待 3d 走查判定 | ⬜ |
| 经营驾驶舱 | components/CockpitManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（date×2→CapsuleDateInput，2026-08-18 P2-W4） | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 报表中心 | components/ReportCenter.tsx | ✅ | ⚠️ 待走查 | ⚠️ 手写主按钮×4（批E 余量） | ✅（select×8 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×1→bdsConfirm，批次 3b） | — | ⬜ |
| 关系智库 ★ | components/RelationsManager.tsx | ✅ | ✅ 已主刀（P2 · e5c77a5） | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | 2026-08-19 校准：compiledRelationsTemplates 双路径已删除，渲染源=RelationsManager.tsx。**点名④ 已修复**：搜索 icon 内置 leading icon（spec §2.3）；toolbar h-10 刻度对齐；font-light。排序 compact 触发器 34px 刻度专项已销（240ea81） | ⬜ |
| 客户关系管理 | components/CrmManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×10 已 bds-select + date 已 CapsuleDateInput） | ⚠️ 待走查 | 0 | 0 | ✅（alert×15→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 供应商管理 | components/SuppliersManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×7 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×19→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 智能邮箱 | components/EmailManager.tsx | ✅（PageHeader 已补，M1 清零） | ⚠️ 待走查 | ✅ | ✅ | ⚠️ 待走查 | 0 | 2（豁免域） | ✅（confirm×2→bdsConfirm，批次 3b） | 颜色 token 属邮件模板豁免域，骨架不豁免；子组件 email/SignatureManager.tsx PageHeader 已补（M1 基线 3→0） | ⬜ |
| 季节性与趋势 | components/SeasonsManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×12 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×23→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 营销推广 | components/MarketingManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×3 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×9→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 数字档案 | components/ProductsManager.tsx | ✅ | — | ⚠️ 手写主按钮×2（批E 余量） | ✅ | ⚠️ 待走查 | 0 | 0 | ✅（alert×2→bdsToast.warning，批次 3b） | 2026-08-19 校准：compiledProductsTemplates 双路径已删除，渲染源=ProductsManager.tsx | ⬜ |
| 开发管理 | components/DevelopmentManager.tsx | ✅ | 组合 bar×1（基准范式页） | ✅ | ✅（select×6 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×7→bdsToast/bdsConfirm，批次 3b） | **filterbar 选型基准实现之一**（spec 附录 A） | ⬜ |
| 报价管理 ★ | components/QuotationManager.tsx | ✅ | ✅ 已主刀（P2 · 088cd10） | ✅ | ✅（select×3 + date×2 已 BDS 化） | ⚠️ 待走查 | 0 | 0 | 0 | **点名③ 已修复**：状态 segment 并入搜索行单条 filterbar（spec §2.1 决策树第二支）；报价日期/有效期至迁 CapsuleDateInput | ⬜ |
| 订单管理 ★ | components/OrderManager.tsx | ✅ | ✅ 已主刀（P2 · cd54d96） | ✅（M5 清零 4→0） | ✅（select 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×10→bdsToast/bdsConfirm，批次 3b） | **点名②⑤ 已修复**：类型 tab 并入 filterbar 单行；视图 toggle 冷墨洗。bar 三区同槽已修（ac39d30）。alert×10 已随批次 3b 收敛 | ⬜ |
| 生产跟单 | components/ProductionBoard.tsx | ✅ | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 采购管理 | components/ProcurementManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×4 已 bds-select） | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 库存管理 | components/InventoryManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×8 已 bds-select） | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| BOM 成本核算 | components/BomManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×4 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（confirm×1→bdsConfirm，批次 3b） | — | ⬜ |
| QC 工作台 | components/QcWorkbenchManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×11 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×31→bdsToast/bdsConfirm，批次 3b） | 原生 alert 存量全站最高页，批次 3b 已清零 | ⬜ |
| 货运管理 | components/ShipmentManager.tsx | ✅ | 组合 bar×1（基准范式页） | ✅ | ✅（select×2 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（confirm×1→bdsConfirm，批次 3b） | **filterbar 选型基准实现之一**（spec 附录 A） | ⬜ |
| 外贸与报关 | components/CustomsManager.tsx | ✅ | 组合 bar×1 | ✅ | ✅（select×6 已 bds-select） | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 单据中心 ★ | components/DocumentCenter.tsx | ✅ | ✅ 已主刀（P2 · 19ed21a） | ✅ | ✅（select×4 + date×2 全 BDS 化） | ⚠️ 待走查 | 0 | 0 | ✅（alert×3→BdsDialog，P2 主刀） | **点名① 已修复**：操作区按钮统一 bds-btn 40px；filterbar 基准范式；子组件 tools/DocumentTemplateManager.tsx 已补 PageHeader + 类型筛选 bds-toggle | ⬜ |
| 财务管理（含发票管理 tab） | components/FinanceManager.tsx | ✅ | ✅（M3 filterbar 撑高已修，2026-08-18 W1 组2） | ✅ | ✅（select×11 已 bds-select + date×8 已 CapsuleDateInput） | ⚠️ 待走查 | 0 | 0 | ✅（alert×17→bdsToast/bdsConfirm，批次 3b） | M3 三处违例（主文件:1935 + FinanceCreditPanel:367 + FinancePaymentRequestsPanel:422）已清零；「已落库但刷新失败」warning 口径见批次 3b commit | ⬜ |
| 定价与利润 | components/PricingManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×5 已 bds-select，变量类名已内联字面量，批次 3a） | ⚠️ 待走查 | 0 | 0 | ✅（alert×27→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 风险管理与合规 | components/RisksManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×7 已 bds-select） | ⚠️ 待走查 | 0 | 0 | ✅（alert×20→bdsToast/bdsConfirm，批次 3b） | — | ⬜ |
| 数据中心 | components/DataCenter.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×1 已 bds-select） | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 人事管理 | components/HRManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×7 已 bds-select + date×3→CapsuleDateInput，批次 3a） | ⚠️ 待走查 | 0 | 0 | ✅（confirm×3→bdsConfirm danger，批次 3b） | — | ⬜ |
| 业务工具 | components/BusinessTools.tsx | ✅ | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | MES 入口页（工具集形态） | ⬜ |
| 生产执行 MES | components/MesManager.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×12 已 bds-select + date×5→CapsuleDateInput，批次 3a） | ⚠️ 待走查 | 0 | 0 | 0 | 可选模块（nav.primary=false，经业务工具页进入）；评审报告 30 页口径明示含 MesManager 六 tab | ⬜ |
| 管理后台 | components/AdminPanel.tsx | ✅ | ⚠️ 待走查 | ✅ | ✅（select×19 全 bds-select，批次 3a 收敛 13 处存量） | ⚠️ 待走查 | 0 | 0 | ✅（alert/confirm×7→bdsToast/bdsConfirm，批次 3b；密码重置改驻留弹窗保全临时密码复制） | adminOnly；原生 select 存量全站最高页，批次 3a 已清零 | ⬜ |
| 设置 | components/Settings.tsx | ✅ | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | ✅（alert×1→bdsToast.danger，批次 3b） | 2026-08-19 校准：compiledSettingsTemplates 双路径已删除，渲染源=Settings.tsx；nav.primary=false（经账号菜单进入）；含账号设置/系统设置子视图 | ⬜ |

---

## §2 首批点名问题详录（6 条，含文件行号证据与修复方向）

| # | 页面 | 问题 | 文件证据 | 修复方向 |
|---|---|---|---|---|
| ① | 单据中心 | 操作区 small buttons 尺寸不统一 | `DocumentCenter.tsx`：`:306` `h-7 px-3 rounded-control text-[11px]`（actionBtnCls 模板）、`:319`/`:325` `h-8 px-3.5 rounded-full`、`:365` `h-9 px-3 rounded-control`、`:684`/`:803` `h-8 px-4 rounded-full`（弹窗按钮）、`:905` `h-7 px-3 rounded-control` —— h-7/h-8/h-9 三档高度 + rounded-full/rounded-control 两种圆角混用 | 全部改为 `bds-btn` 默认 40px（表内行操作白名单除外，spec §3.1） |
| ② | 订单管理 | filterbar 双行撑高页面上边距 | `OrderManager.tsx:941-986`：PageHeader center 槽塞入 filterbar + 视图 toggle，下方再叠独立类型 tab 胶囊行（全部/面料/成衣/其他/Capsule），双行结构抬高整个标题区 | 重构为单行结构：类型 tab 上移并入 filterbar（或移除独立行），消除双行（spec §1 center 槽禁令 + §2.2 单行/禁撑高） |
| ③ | 报价管理 | 纯单搜索误用组合嵌套 bar | `QuotationManager.tsx:809-817`：filterbar 内仅一个搜索输入 + 一个刷新按钮，无任何筛选下拉共行；状态过滤为下方独立 `bds-segment` 行（`:820-826`） | 拆为简单搜索框 `.bds-search + .bds-input`（spec §2.1 决策树：单输入无筛选时禁套组合 bar） |
| ④ | 关系智库 | 功能 bar 整体设计不合格 | `compiledRelationsTemplates.tsx:767-781`：搜索 icon 置于绝对定位独立 `span`（`left-0 top-0 h-9 w-9`）外挂输入框左缘，非 leading-icon 内置；input 手写 `h-9 w-full rounded-control border pl-10 ... font-normal`——h-9 非 34/40 刻度、`font-normal` 违字重 ≤300 纪律、未走 bds-search/bds-input 范式 | 搜索 icon 内置输入框（leading icon）；整体对齐开发管理/货运管理/财务管理 filterbar 基准范式（spec §2.3 + 附录 A） |
| ⑤ | 订单管理 | toggle active 态实心黑圆按钮 | `OrderManager.tsx:972`/`:981`/`:996`/`:1005`：视图切换 toggle active 态用 `bds-btn-dark`（`--invert-bg` 实心黑填充），浅色雾面环境中突兀（M5 基线 4 全部在此） | 替换为冷墨洗 tint/inset 态（spec §3.2：图标型 → `.bds-toggle` active = `--accent-tint` + `--accent-text`；分段胶囊 → `.bds-segment .seg` active = `--bg-raised` 浮面） |
| ⑥ | 全局 | `<select>` / `type="date"` 原生渲染未 BDS 化 | 粗口径 321（全仓 `<select` 213 + `type="date"` 108）；**入库精确口径 281**（components/src 作用域 · 豁免集生效 · 剔除已 bds-select 化 33 处；粗口径把 BDS 化组件计入总数、收敛后总数不变，无法感知进展，故不采用）。入口文件分布 TOP5：AdminPanel 13 / SeasonsManager 12 / FinanceManager 11+8 / CrmManager 10+7 / InventoryManager 8+1 | 逐页接入 `bds-select` / `CapsuleDateInput`（spec §4）；每页主刀时该页子树存量清零，M4 基线只减不增 |

---

## §3 机器断言基线快照（2026-08-17 建立，check:tokens §13）

| 断言 | 基线 | 现存违例分布 | 清零路径 |
|---|---|---|---|
| M1 PageHeader 缺失 | 3 | EmailManager（台账页）/ email/SignatureManager（智能邮箱子组件）/ tools/DocumentTemplateManager（单据中心子组件） | 随对应页主刀清零 |
| M2 bds-btn-sm | 0 | — | 维持（白名单注释豁免） |
| M3 filterbar 高度违例 | 3 | 财务管理页子树（FinanceManager:1935 / FinanceCreditPanel:367 / FinancePaymentRequestsPanel:422） | 财务管理页主刀清零 |
| M4 原生控件 | 281 | 30 页入口文件 + 页面子树 + 共享组件 | 逐页清零，只减不增 |
| M5 bds-btn-dark | 4 | OrderManager:972/981/996/1005 | P2 OrderManager 主刀清零 |
| 既有 dark: 基线 | 7 | App.tsx 5（W5）/ NotificationCenter 2（误匹配） | W5 收口 |
| 既有 raw 语义色基线 | 19 | 发票模板 8（豁免）/ App.tsx 5（W5）/ pwa 3（冻结）/ GarmentOrders 3（W5） | W5 收口 |

---

## §4 P2 推进规程（CD-009 校准点）

1. **顺序**：DocumentCenter → OrderManager → QuotationManager → Relations。
2. **每页一次全维主刀**：骨架对齐 + dark: 清零 + raw 色清零 + 按钮尺寸统一 + filterbar 选型 + 原生控件替换 + 弹窗检查（页面子树整体，含子组件）。
3. **每页一个 commit**，前缀 `wave(fe): W-PG-P2-页面名`；改前/改后深浅双主题截图；三绿（tsc + check:tokens + npm test）。
4. **四页销号后暂停**：截图汇总报总控 → 产品负责人校准 → 校准通过后放量其余 26 页（按本台账逐行推进）。

---

## §5 P2 四页主刀收口记录（2026-08-17 · 待总控签字 / 产品负责人校准）

| 页 | commit | 点名修复 | 通用项结果 | 三绿 |
|---|---|---|---|---|
| 单据中心 | `19ed21a` | ① 按钮三档混用 → bds-btn 40px 统一 | bds-filterbar 落地；select×4+date×2 清零；alert×3+删除确认 → BdsDialog；tools/DocumentTemplateManager 补 PageHeader（M1 3→2）+ 类型筛选 bds-toggle | tsc ✓ / tokens ✓ / test ✓ |
| 订单管理 | `cd54d96` | ② 双行 → 单行（类型 tab 并入 filterbar）；⑤ bds-btn-dark×4 → bds-toggle 冷墨洗（M5 4→0） | 状态 select 前置修正（M4 273→272）；alert×10 遗留 W4 | tsc ✓ / tokens ✓ / test ✓ |
| 报价管理 | `088cd10` | ③ 评估后 segment 并入搜索行（搜索+segment 共行 = 组合 bar 合法形态，spec §2.1 第二支） | date×2→CapsuleDateInput；select×3 前置修正（M4 272→267） | tsc ✓ / tokens ✓ / test ✓ |
| 关系智库 | `e5c77a5` | ④ icon 内置 leading icon + toolbar h-9→h-10 刻度 + font-normal→font-light | date×1→CapsuleDateInput（M4 267→266）；accent 按钮 text-white→--on-accent（实测校准 33→28）；CustomSelect compact 触发器 h-9 遗留 W4 共享组件专项 | tsc ✓ / tokens ✓ / test ✓ |

**改前/改后证据**：改前状态以 §2 详录文件行号 + 各页父 commit（`git show <commit>^`）为准；改后深浅双主题截图按 spec §9.2 由产品负责人验收 pass 亲截（关键 4 页口径）。
**验收状态**：四行验收列留空（⬜），待总控逐页签字销号；签字通过前暂停放量其余 26 页。

---

## §6 W4 组件级专项收口记录（2026-08-17 · P2 校准等待期执行）

> 范围纪律：仅组件层 + compiledDashboardTemplates，未触碰四页主刀文件以外的页面文件；alert→BdsDialog 页面迁移不做（并入后续逐页主刀）。

| 专项 | commit | 内容 | 基线变化 | 三绿 |
|---|---|---|---|---|
| 订单管理 bar 三区同槽（P2 追加） | `ac39d30` | bar 包裹层 px-4 pt-2 → px-7 pt-2 pb-4（与 PageHeader/表格共享 28px 内容栅格 + 16px 呼吸间距）；ProductionAlerts 预警横幅全宽出血同族修复（包 shrink-0 px-7） | 不变 | tsc ✓ / tokens ✓ / test ✓ |
| 共享 CustomSelect 刻度 | `240ea81` | compact 触发器 h-9(36px 旧刻度) → h-[var(--h-input-sm)]=34px（BDS 规格刻度）；34px = 双消费上下文安全交集（Relations 40px 工具条内符合 filterbar 官方范式；Products 36px 共享 recipe 工具条内 2px 差、inline 透明视觉连续）；RelationsManager.test 断言同步 | 不变 | tsc ✓ / tokens ✓ / test ✓ |
| Dashboard 手写主按钮余量 | `d808a3b` | compiledDashboardTemplates 5 处装饰性 accent 填充（下划杠×2/进度条 fill×2/指示圆点×1）bg-[var(--os-vnext-brand-blue)] → bg-[var(--accent)] 主题自适应 | 手写主按钮 22→17 | tsc ✓ / tokens ✓ / test ✓ |

**双主题截图验证**：OrderManager bar 与表格左右边界对齐 + 间距清晰（浅/深）；关系智库 + 数字档案工具条 inline 触发器垂直对齐自然（浅/深）；全景看板 accent 元素双主题协调可见。
**遗留登记**：CustomSelect default size（form 场景 h-9）随逐页主刀表单区处理；Dashboard.tsx 非渲染路径 5 处装饰填充（W5/逐页主刀）；四页 alert 迁移并入逐页主刀流程。
