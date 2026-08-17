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

| 页面 | 渲染文件 | 标题区 | 筛选区 | 操作区 | 表单控件 | 内容区 | dark:残留 | raw色残留 | 弹窗 | 问题记录 | 验收状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 全景看板 | components/ui/osCompiler/compiledDashboardTemplates.tsx | ⚠️ 无 PageHeader（定制全景头部，豁免与否待总控校准） | — | ✅ | ✅ | compiled 模板 | 0 | 0 | 0 | compiled 双路径；手写主按钮余量 5 处均为装饰性 accent 填充（批E 余量，非按钮） | ⬜ |
| 经营驾驶舱 | components/CockpitManager.tsx | ✅ | 组合 bar×1 | ✅ | date×2 | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 报表中心 | components/ReportCenter.tsx | ✅ | ⚠️ 待走查 | ⚠️ 手写主按钮×4（批E 余量） | select×8 | ⚠️ 待走查 | 0 | 0 | alert×1 | — | ⬜ |
| 关系智库 ★ | components/ui/osCompiler/compiledRelationsTemplates.tsx | ✅ | ❌ 自造 toolbar（点名④） | ✅ | date×1 | compiled 模板 | 0 | 0 | 0 | **点名④**：功能 bar 整体设计不合格——搜索 icon 外挂框外、非 BDS 范式（证据见 §2-④）；修复：icon 内置 leading icon + 对齐开发/货运/财务管理基准范式 | ⬜ |
| 客户关系管理 | components/CrmManager.tsx | ✅ | 组合 bar×1 | ✅ | select×10 + date×7 | ⚠️ 待走查 | 0 | 0 | alert×15 | — | ⬜ |
| 供应商管理 | components/SuppliersManager.tsx | ✅ | ⚠️ 待走查 | ✅ | select×7 + date×4 | ⚠️ 待走查 | 0 | 0 | alert×19 | — | ⬜ |
| 智能邮箱 | components/EmailManager.tsx | ❌ 缺 PageHeader（M1） | ⚠️ 待走查 | ✅ | ✅ | ⚠️ 待走查 | 0 | 2（豁免域） | alert×2 | M1：缺 PageHeader/bds-pagehead；颜色 token 属邮件模板豁免域，骨架不豁免；子组件 email/SignatureManager.tsx 同缺 PageHeader（M1 基线 3 之二） | ⬜ |
| 季节性与趋势 | components/SeasonsManager.tsx | ✅ | 组合 bar×1 | ✅ | select×12 + date×7 | ⚠️ 待走查 | 0 | 0 | alert×23 | — | ⬜ |
| 营销推广 | components/MarketingManager.tsx | ✅ | ⚠️ 待走查 | ✅ | select×3 | ⚠️ 待走查 | 0 | 0 | alert×9 | — | ⬜ |
| 数字档案 | components/ui/osCompiler/compiledProductsTemplates.tsx | ✅ | — | ⚠️ 手写主按钮×2（批E 余量） | ✅ | compiled 模板 | 0 | 0 | alert×2 | compiled 双路径 | ⬜ |
| 开发管理 | components/DevelopmentManager.tsx | ✅ | 组合 bar×1（基准范式页） | ✅ | select×4 + date×1 | ⚠️ 待走查 | 0 | 0 | alert×7 | **filterbar 选型基准实现之一**（spec 附录 A） | ⬜ |
| 报价管理 ★ | components/QuotationManager.tsx | ✅ | ❌ 纯单搜索误套组合 bar（点名③） | ✅ | select×3 + date×2 | ⚠️ 待走查 | 0 | 0 | 0 | **点名③**：filterbar 内仅单搜索框+刷新按钮、状态过滤为独立 segment 行（证据见 §2-③）；修复：拆为 `.bds-search + .bds-input` 单层搜索 | ⬜ |
| 订单管理 ★ | components/OrderManager.tsx | ✅（结构违例见筛选区） | ❌ 双行撑高（点名②） | ❌ toggle active 实心黑×4（点名⑤） | select×1 | ⚠️ 待走查 | 0 | 0 | alert×10 | **点名②**：PageHeader center 槽塞 filterbar+视图 toggle、下方再叠独立类型 tab 行（证据见 §2-②）；**点名⑤**：`bds-btn-dark`×4（证据见 §2-⑤） | ⬜ |
| 生产跟单 | components/ProductionBoard.tsx | ✅ | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 采购管理 | components/ProcurementManager.tsx | ✅ | 组合 bar×1 | ✅ | select×4 + date×3 | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 库存管理 | components/InventoryManager.tsx | ✅ | 组合 bar×1 | ✅ | select×8 + date×1 | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| BOM 成本核算 | components/BomManager.tsx | ✅ | 组合 bar×1 | ✅ | select×4 | ⚠️ 待走查 | 0 | 0 | alert×1 | — | ⬜ |
| QC 工作台 | components/QcWorkbenchManager.tsx | ✅ | 组合 bar×1 | ✅ | select×1 + date×3 | ⚠️ 待走查 | 0 | 0 | alert×31 | 原生 alert 存量全站最高，W4 收敛重点页 | ⬜ |
| 货运管理 | components/ShipmentManager.tsx | ✅ | 组合 bar×1（基准范式页） | ✅ | select×2 | ⚠️ 待走查 | 0 | 0 | alert×1 | **filterbar 选型基准实现之一**（spec 附录 A） | ⬜ |
| 外贸与报关 | components/CustomsManager.tsx | ✅ | 组合 bar×1 | ✅ | select×1 + date×6 | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 单据中心 ★ | components/DocumentCenter.tsx | ✅ | ⚠️ 待走查 | ❌ small buttons 尺寸不一（点名①） | select×4 + date×2 | ⚠️ 待走查 | 0 | 0 | alert×3 | **点名①**：操作区按钮 h-7/h-8/h-9 三档高度 + rounded-full/rounded-control 两种圆角混用（证据见 §2-①）；修复：统一 `bds-btn` 默认 40px（行内操作白名单除外）；子组件 tools/DocumentTemplateManager.tsx 缺 PageHeader（M1 基线 3 之三） | ⬜ |
| 财务管理（含发票管理 tab） | components/FinanceManager.tsx | ✅ | ❌ filterbar 撑高（M3 违例） | ✅ | select×11 + date×8（入口文件口径） | ⚠️ 待走查 | 0 | 0 | alert×17 | **M3**：`FinanceManager.tsx:1935` filterbar 手写 `h-auto min-h-11` 撑高；子面板 finance/FinanceCreditPanel.tsx:367、finance/FinancePaymentRequestsPanel.tsx:422 同型违例（M3 基线 3 全在本页子树）；发票管理别名入口并入本行 | ⬜ |
| 定价与利润 | components/PricingManager.tsx | ✅ | ⚠️ 待走查 | ✅ | select×5 + date×3 | ⚠️ 待走查 | 0 | 0 | alert×27 | — | ⬜ |
| 风险管理与合规 | components/RisksManager.tsx | ✅ | ⚠️ 待走查 | ✅ | select×3 + date×1 | ⚠️ 待走查 | 0 | 0 | alert×20 | — | ⬜ |
| 数据中心 | components/DataCenter.tsx | ✅ | ⚠️ 待走查 | ✅ | select×1 | ⚠️ 待走查 | 0 | 0 | 0 | — | ⬜ |
| 人事管理 | components/HRManager.tsx | ✅ | ⚠️ 待走查 | ✅ | select×7 + date×3 | ⚠️ 待走查 | 0 | 0 | alert×3 | — | ⬜ |
| 业务工具 | components/BusinessTools.tsx | ✅ | — | ✅ | ✅ | ⚠️ 待走查 | 0 | 0 | 0 | MES 入口页（工具集形态） | ⬜ |
| 生产执行 MES | components/MesManager.tsx | ✅ | ⚠️ 待走查 | ✅ | date×5 | ⚠️ 待走查 | 0 | 0 | 0 | 可选模块（nav.primary=false，经业务工具页进入）；评审报告 30 页口径明示含 MesManager 六 tab | ⬜ |
| 管理后台 | components/AdminPanel.tsx | ✅ | ⚠️ 待走查 | ✅ | select×13 | ⚠️ 待走查 | 0 | 0 | alert×6 | adminOnly；原生 select 存量全站最高（13），主刀重点 | ⬜ |
| 设置 | components/ui/osCompiler/compiledSettingsTemplates.tsx | ✅ | — | ✅ | ✅ | compiled 模板 | 0 | 0 | 0 | compiled 双路径；nav.primary=false（经账号菜单进入）；含账号设置/系统设置子视图 | ⬜ |

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
