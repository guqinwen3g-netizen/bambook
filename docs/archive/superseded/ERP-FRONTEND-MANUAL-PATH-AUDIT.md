# ERP 前端无 Agent 手动操作路径审计报告

> ⚠️ **STALE / SUPERSEDED — 历史快照，不代表当前状态**
>
> 本文档是 task_mqxv9jb2 的历史审计快照（基线 main HEAD=42e1ba5），以下结论已被后续 runtime QA 任务推翻：
> - invoices/payments "完全只读，0 写入入口" → **已修正**：FinanceManager 已消费 deletePaymentVoucher/deleteInvoice，含软删入口
> - shipments "UI 齐全但 API 路由 404" → **已修正**：`/api/v1/shipping` 已挂载，shipmentService 路由已对齐
> - "无审计" 结论 → **已修正**：Finance/Shipping/Relations/Products 均已接入 writeRouteAuditLog
>
> **当前事实源：[ERP-OS-CROSS-MODULE-SMOKE-MATRIX.md](./ERP-OS-CROSS-MODULE-SMOKE-MATRIX.md)**
>
> 本文档保留仅作历史参考，**不作为当前 backlog 或排期依据**。

> Task: task_mqxv9jb2 (ERP-frontend-manual-path-audit)
> 审计基线: main HEAD=42e1ba5
> 审计性质: 只审计不实现，输出缺口清单 + 最小补齐建议 + 风险等级
> 审计口径: 每个页面回答三问——①无 Agent 用户能否看懂状态 ②能否手动完成关键动作 ③失败/审计信息是否可见

## 渲染路径前置说明

App.tsx 采用双路径渲染：日常运行 compiled 版本（默认开启），`?xxxCompiler=0` 时回退到 Manager 组件。
- **compiled 生产路径**：`components/ui/osCompiler/compiled*.tsx`（relations/products 走此路径）
- **Manager 回退路径**：`components/*.tsx`（orders/shipments/finance 走此路径，无 compiled 版本）

审计以**生产路径**为准。

---

## 一、页面级审计汇总

| 页面 | 状态可读性 | 手动动作可达性 | 失败/审计可见性 | 风险等级 |
|---|---|---|---|---|
| **orders** | ✅ 含时间线审计 | ✅ 创建/编辑/状态流转/归档齐全 | ⚠️ 部分静默吞错 | 🟢 低 |
| **invoices** | ⚠️ 仅当前状态无流转历史 | ❌ 完全只读，0 写入入口 | ❌ 无失败可见性无审计 | 🔴 高 |
| **payments** | ⚠️ status 前后端不对齐 | ❌ 完全只读，0 写入入口 | ❌ 无失败可见性无审计 | 🔴 高 |
| **shipments** | ⚠️ 状态枚举三层不一致 | ⚠️ UI 齐全但 API 路由 404 | ⚠️ 有错误条但无审计 | 🟡 中 |
| **relations** | ✅ 7 分类清晰 | ⚠️ CRUD 齐全但缺跨模块关联 | ⚠️ 错误可见无审计 | 🟡 中 |
| **fabrics** | ✅ 字段极完整含完整度面板 | ⚠️ CRUD 齐全但供应商是文本非 FK | ⚠️ 错误可见无审计 | 🟡 中 |

---

## 二、逐页详细发现

### 1. Orders 🟢 低风险（基本完备）

**承载组件**：`components/OrderManager.tsx`（面料订单）、`components/GarmentOrders.tsx`（成衣订单）

**状态可读性 ✅**：
- 列表状态 chip（OrderManager.tsx:916-918），5 状态独立配色
- 状态流转时间线（OrderManager.tsx:1084-1126），调 `/api/v1/orders/:id/timeline`，含 from→to/operator/note

**手动动作 ✅**：创建（L674-680）/编辑（L972-974）/状态流转（L1067-1080）/归档（L1239-1241）/PDF 导入（L666-673）全部有 UI 入口

**缺口 ⚠️**：
- [P2] 状态流转失败静默吞掉：`catch { /* ignore */ }`（OrderManager.tsx:181）——用户无法区分「已是目标状态」和「请求失败」
- [P2] 时间线加载失败静默吞掉（OrderManager.tsx:158）
- [P3] 移动端 BottomSheet 状态变更（L1276-1291）只做本地 setOrders，未走 status-transition 审计接口

---

### 2. Invoices 🔴 高风险（完全只读，依赖 Agent）

**承载组件**：`components/FinanceManager.tsx`（invoices + payments 两 Tab）

**状态可读性 ⚠️**：
- 有状态 chip（FinanceManager.tsx:347-349），7 状态枚举（L35-43）
- ❌ **无状态流转记录/时间线**（grep 全文无 timeline/InvoiceStatusTransition）
- ❌ **后端 schema 无 InvoiceStatusTransition 模型**——数据层无审计痕迹（依赖缺口）

**手动动作 ❌**：
- FinanceManager.tsx 所有 onClick 都是只读操作（选中行、切 tab、过滤）
- `setInvoices: _setInvoices`（L190）setter 下划线前缀表示故意未使用——**纯只读展示组件**
- ❌ 无创建/编辑/状态变更/作废/删除入口
- **死代码（双重错配）**：`services/invoiceService.ts` 调 `/v1/invoices`（POST/PUT/DELETE），但后端实际挂在 `/api/v1/finance`（index.ts:411）且只支持 POST/PATCH（**无 PUT/DELETE**）——service 路由错配 + method 错配，且 grep `from.*invoiceService` 全仓库**零匹配**（无组件 import）。补手动 UI 前必须先修正 service 路由（见 P0-2）

**失败/审计 ❌**：无写入操作故无失败提示；无审计日志入口

**风险理由**：发票页面完全依赖 Agent 才能做任何写入操作。Agent 不可用/失败/审批被拒时，用户对发票完全束手无策，违反"无 Agent 手动操作路径"硬要求。

---

### 3. Payments 🔴 高风险（完全只读 + status 前后端不对齐）

**承载组件**：`components/FinanceManager.tsx`（vouchers Tab，无独立 PaymentVoucherManager）

**状态可读性 ⚠️（数据契约缺口）**：
- 前端展示 4 状态 Pending/Approved/Paid/Cancelled（FinanceManager.tsx:49-55）
- ❌ **后端 schema `PaymentVoucher` model 根本没有 status 字段**（schema.prisma:1309-1349）
- 前端 types.ts:1640 声明 `status: VoucherStatus` 必填，但后端 `VOUCHER_PATCH_FIELDS`（finance/route.ts:67-71）不含 status——**前端显示的状态是无源之水**
- **依赖缺口**：需后端先补 schema status 字段，前端不可硬兜底

**手动动作 ❌**：同 invoices，0 写入入口；`paymentVoucherService.ts` 调 `/v1/payment-vouchers`（POST/PUT/DELETE），后端实际是 `/api/v1/finance/vouchers`（POST/PATCH，无 PUT/DELETE）——同样双重错配死代码（见 P0-3）

**失败/审计 ❌**：同 invoices

**风险理由**：关键财务页面没有手动操作路径；status 前后端不对齐可能误导用户做错误决策。

---

### 4. Shipments 🟡 中风险（UI 齐全但 API 路由 404）

**承载组件**：`components/ShipmentManager.tsx`

**状态可读性 ⚠️（枚举三层不一致）**：
- 有状态 chip（5 状态，ShipmentManager.tsx:27-34）
- ❌ **状态枚举三层不一致**：
  - 前端 types.ts（5 个）：Preparing, Booked, InTransit, Delivered, Cancelled
  - 后端 schema.prisma（8 个）：Draft, Booked, Loading, Shipped, Arrived, Cleared, Delivered, Cancelled
  - 后端 Agent 白名单（8 个，toolRuntime.ts:3776）：同 schema
- **后果**：用户手动新建选 Preparing → 后端 Agent 更新状态时被拒（不在白名单），形成"两套平行运单"
- **依赖缺口**：需后端/前端先对齐枚举

**手动动作 ⚠️（API 路由错配）**：
- UI 按钮齐全：新建（L393-405）/编辑（L537-544）/删除（L545-552）
- ❌ **shipmentService 路由全部错配**：
  - service 调 `/v1/shipments`，后端挂在 `/api/v1/shipping`（index.ts:421）
  - createShipment/updateShipment/deleteShipment 全部 **404**
  - 唯独 GET 列表（dataHubService 调 `/v1/shipping`）路径对——所以页面能加载但无法操作
- **最小补齐（前端可做）**：shipmentService.ts 路径 `/v1/shipments` → `/v1/shipping`，update PUT → PATCH

**失败/审计 ⚠️**：有 errorMessage 状态（L196）和错误条（L411-418），但只显示 error.message 字符串（如 "HTTP 404"），用户无法判断根因；无审计入口

---

### 5. Relations 🟡 中风险（CRUD 完备但缺跨模块关联）

**承载组件（生产路径）**：`components/ui/osCompiler/compiledRelationsTemplates.tsx`

**状态可读性 ✅**：7 大分类清晰（Supplier/Customer/Agent/Partner/Government/Internal/Other，L78-86），多排序模式，详情 6 大分区

**手动动作 ⚠️**：
- CRUD 齐全：新建组织（L1233）/新建联系人（L1236）/编辑/删除/多联系人/标签管理
- ❌ **违反 MODULE_CONTRACT R8.3**：详情面板未接入 `<RelatedEntitiesPanel>`（grep compiled 版 0 匹配），用户无法在一个客户档案下看到其历史订单/发票/样品——跨模块数据被切断
- ❌ 无"从客户详情跳转到其订单列表"入口

**失败/审计 ⚠️**：保存/删除失败有红色文本（L1596-1600、L2179）；无审计日志分区

---

### 6. Fabrics 🟡 中风险（字段齐全但供应商是文本非 FK）

**承载组件（生产路径）**：`components/ui/osCompiler/compiledProductsTemplates.tsx`（面料是 products 中 mainCategory='Fabric' 子集）

**状态可读性 ✅**：6 种主分类视图，面料档案字段极完整（articleNo/millQuality/construction/yarnCount/成分/克重/门幅/MOQ 三档），完整度面板，PDML 原始库，关联订单展示

**手动动作 ⚠️**：
- CRUD 齐全：新建 SKU/编辑/成分克重门幅 MOQ 编辑/图片上传/PDML 同步/QR 码
- ⚠️ **供应商关联是文本字段而非 FK**（compiledProductsTemplates.tsx:2172）：`millOrganizationId` 是纯 `<input>`，不是 RelationCombobox——用户手敲工厂名，与 relations 模块 Supplier 数据不打通，违反关系完整性
  - 同样问题波及 garment.customer/factory、trimming.supplier（系统性缺陷）
- ❌ 同样违反 R8.3：仅 fabric 有自实现 RelatedOrders，garment/trimming 无关联展示

**失败/审计 ⚠️**：写入错误顶部条（L2771-2774）；成分校验硬阻断；无审计日志

---

## 三、系统性问题（跨模块共现）

### S1. MODULE_CONTRACT R8.3 集体违反（compiled 生产路径）
MODULE_CONTRACT.md:300 要求详情面板必须接入 `<RelatedEntitiesPanel>`。实际：compiled relations/products 全部未接入（只存在于 Manager fallback 路径）。日常运行时用户看不到任何跨模块实体关联。

### S2. 财务模块（invoices + payments）完全依赖 Agent
FinanceManager 是纯只读展示组件，0 写入入口。invoiceService/paymentVoucherService 是死代码（无组件 import）。Agent 不可用时用户对财务数据完全束手无策。

### S3. 状态字段前后端契约不一致
- payments: 前端有 status，后端 schema 无 status 字段（依赖缺口）
- shipments: 前端 5 状态，后端 8 状态，Agent 白名单 8 状态（依赖缺口）
- invoices: 无 InvoiceStatusTransition 审计表（依赖缺口）

### S4. 模块级审计日志全缺
仅 AdminPanel 有全局 audit-logs（需管理员权限）。各模块详情面板无"操作历史/变更记录"分区，普通用户看不到记录何时被谁改过。

### S5. 供应商关联普遍是文本而非 FK
RelationCombobox 组件存在但仅 OrderManager 在用。products 模块 supplier/factory/customer 全是裸 input，破坏关系完整性。

---

## 四、最小补齐建议（按优先级，不做大 UI 改造）

### P0 阻塞手动操作（前端可独立完成，纯 service 路由修正）
| # | 缺口 | 最小补齐 | 依赖 |
|---|---|---|---|
| P0-1 | shipments API 路由 404 | shipmentService.ts: `/v1/shipments` → `/v1/shipping`，update PUT → PATCH | 无（纯前端 service 路由修正） |
| P0-2 | invoiceService 路由错配（死代码） | invoiceService.ts: `/v1/invoices` → `/v1/finance`，PUT → PATCH，**移除 DELETE**（后端无此端点） | 无（纯前端 service 路由修正） |
| P0-3 | paymentVoucherService 路由错配（死代码） | paymentVoucherService.ts: `/v1/payment-vouchers` → `/v1/finance/vouchers`，PUT → PATCH，**移除 DELETE**（后端无此端点） | 无（纯前端 service 路由修正） |

> **重要事实（review 修正）**：invoiceService 和 paymentVoucherService 与 shipmentService 一样是**路由错配的死代码**，不是"已就绪"。后端 finance 路由（index.ts:411 挂载 `/api/v1/finance`）实际支持：
> - invoices: `GET /`、`POST /`、`GET /:id`、`PATCH /:id`（**无 DELETE、无 PUT**）
> - vouchers: `GET /vouchers`、`POST /vouchers`、`GET /vouchers/:id`、`PATCH /vouchers/:id`（**无 DELETE、无 PUT**）
>
> 原文档 P0-2 写"service+后端已就绪"不准确，特此修正。补 invoices/payments 手动 UI 入口**必须先完成 P0-2/P0-3 的 service 路由统一**，否则会 404。

### P1 依赖缺口（需后端先改，前端不硬兜底）
| # | 缺口 | 需后端做什么 | 前端跟进 |
|---|---|---|---|
| P1-1 | payments status 无源 | schema 补 PaymentVoucher.status 字段 + VOUCHER_PATCH_FIELDS 加 status | 前端枚举对齐 |
| P1-2 | shipments 状态枚举不一致 | 确认权威 8 状态集合 | 前端 types.ts 对齐 |
| P1-3 | invoices 无流转审计 | 建 InvoiceStatusTransition 模型（对齐 OrderStatusTransition） | 前端补时间线展示 |
| P1-4 | invoices 0 写入入口 | P0-2 service 路由修正完成后即可 | FinanceManager 补「新建发票」按钮（复用修正后的 invoiceService） |
| P1-5 | payments 0 写入入口 | P1-1 status 字段 + P0-3 service 路由修正完成后即可 | FinanceManager 补凭证 CRUD UI |

### P2 体验/契约补齐（增量改进）
| # | 缺口 | 最小补齐 |
|---|---|---|
| P2-1 | orders 状态流转失败静默 | OrderManager.tsx:181 的 catch 加错误提示 |
| P2-2 | compiled relations/products 违反 R8.3 | 详情面板接入 `<RelatedEntitiesPanel>` |
| P2-3 | 供应商字段文本→FK | products 模块 millOrganizationId 等换用 RelationCombobox |
| P2-4 | 模块级审计日志缺失 | 详情面板加「操作历史」分区（复用 AdminPanel audit log 接口） |

---

## 五、风险等级总览

| 风险等级 | 页面 | 核心问题 |
|---|---|---|
| 🔴 高 | invoices, payments | 完全只读，0 写入入口，强依赖 Agent，违反硬要求 |
| 🟡 中 | shipments, relations, fabrics | UI 部分可用但有契约不一致/跨模块断裂/关系完整性问题 |
| 🟢 低 | orders | 基本完备，仅失败提示静默 |

**最高优先级**：invoices/payments 的手动写入路径补齐（P0-2 + P1-1/P1-4），这是"无 Agent 手动操作路径"硬要求的核心缺口。
