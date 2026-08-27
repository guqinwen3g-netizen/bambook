# Bambook ERP Core Readiness Audit

> ⚠️ **STALE / SUPERSEDED — 历史快照，不代表当前状态**
>
> 本文档是 task_mqxv9b5q 的历史审计快照，以下结论已被后续 finance/shipping/frontend runtime QA 任务推翻：
> - Invoices/Payments = "Agent-only" → **已修正**：Finance L1 route 独立可用，FinanceManager 已消费 deletePaymentVoucher（含软删入口+runtime QA）
> - invoiceService/paymentVoucherService 死代码 → **已修正**：前端 service 已接入 FinanceManager
> - Shipments API 404 → **已修正**：`/api/v1/shipping` 已挂载，shipmentMutationService deleteShipment 含 deactivateEntityLinks
> - Relations/Products "no audit" → **已修正**：writeRouteAuditLog + deactivateEntityLinks 已实现
>
> **当前事实源：[ERP-OS-CROSS-MODULE-SMOKE-MATRIX.md](./ERP-OS-CROSS-MODULE-SMOKE-MATRIX.md)**
>
> 本文档保留仅作历史参考，**不作为当前 backlog 或排期依据**。

> Task: task_mqxv9b5q
> Owner: BAMBOOK 项目总设计师
> Scope: Read-only audit — no implementation changes
> Method: Schema + route + frontend manager evidence-based

## Executive Summary

| Module | Manual Ops | State Clarity | Recovery | Audit | Overall |
|---|---|---|---|---|---|
| Orders | GREEN | YELLOW | RED | YELLOW | Usable (delete bug) |
| Invoices | RED | RED | RED | RED | Agent-only |
| Payments | RED | RED | RED | RED | Agent-only |
| Shipments | RED | RED | YELLOW | RED | List-only |
| Relations | GREEN | GREEN | YELLOW | RED | Usable (no audit) |
| Products | GREEN | YELLOW | GREEN | RED | Usable (no audit) |
| Entity Links | RED | YELLOW | RED | N/A | Implicit-only |
| Audit Logs | N/A | YELLOW | GREEN | N/A | Coverage gap |

**Root cause**: scaffold-first后遗症 — finance/shipping route 头部注释自称"生成器只搭骨架，业务校验/审计需人工补全"（finance/route.ts:4, shipping/route.ts:1-11），但前端 types.ts/service/Manager 是另一套独立设计，两套未对齐导致 3 个模块前后端契约全面断裂。

---

## Module 1: Orders

### Evidence
- Schema: Order (schema.prisma:53-196), OrderLine (198-243), OrderStatusTransition (245-260)
- Route: server/src/orders/route.ts — 11 endpoints (GET/, POST/query, GET/:id, POST/import, POST/, PUT/:id, DELETE/:id, POST/:id/status-transition, GET/:id/timeline, PATCH/batch-status, GET/kanban/summary)
- Frontend: components/OrderManager.tsx
- VALID_ORDER_STATUSES = {Pending, Confirmed, Production, Shipping, Delivered, Alert} (route.ts:301)

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | GREEN | Create/edit/status/timeline全链路打通 |
| State clarity | YELLOW | 7 枚举+timeline表存在，但 route.ts:301 仅白名单校验不校验转移合法性（Pending→Delivered可通过） |
| Recovery | RED | OrderManager.tsx:446-453 handleDeleteOrder 只设本地tombstone，未调后端 DELETE /:id，sync后订单复活 |
| Audit | YELLOW | OrderStatusTransition有记录；但 PUT/:id/create/delete 无AuditLog；operator硬编码'Kevin' (OrderManager.tsx:169) |

### Gaps
- **P0**: handleDeleteOrder 未同步后端 (OrderManager.tsx:446-453)
- **P1**: 状态转移无前置态校验 (route.ts:301)
- **P1**: operator 硬编码 'Kevin' (OrderManager.tsx:169)
- **P2**: PUT /:id 字段patch 不写 AuditLog

---

## Module 2: Invoices

### Evidence
- Schema: Invoice (schema.prisma:1270-1307) — status注释 Draft|Issued|PartiallyPaid|Paid|Cancelled 无enum校验
- Route: server/src/finance/route.ts — GET/, POST/, GET/:id, PATCH/:id (4 endpoints). **无DELETE, 无status-transition, 无作废/冲销**
- Frontend: components/FinanceManager.tsx — **纯展示组件，零写入按钮**；setInvoices prop被别名_ignore (FinanceManager.tsx:190)
- Service: services/invoiceService.ts — **完全死代码**（端点/v1/invoices不存在，应是/v1/finance）
- Type mismatch: types.ts:1604 status=Draft|Sent|Paid|Partial|Overdue|Cancelled vs Prisma注释 Draft|Issued|PartiallyPaid|Paid|Cancelled

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | RED | UI零写入；FinanceManager无create/edit/cancel按钮 |
| State clarity | RED | 三重不一致：Prisma注释 vs types.ts:1604 vs FinanceManager.tsx:35-43 |
| Recovery | RED | 无DELETE端点；无冲销工作流；GET/不过滤deletedAt (route.ts:90) |
| Audit | RED | 无InvoiceStatusTransition表；mutations不写AuditLog |

### Gaps
- **P0**: 前端Invoice接口含supplierName/taxAmount/totalAmount等字段，Prisma完全没有 (types.ts:1607-1631)
- **P0**: FinanceManager UI零写入能力，发票只能靠Agent/API
- **P0**: 状态枚举三重不一致
- **P1**: 无作废/冲销endpoint
- **P1**: 无DELETE（录入错误无法软删）
- **P1**: GET不过滤deletedAt (route.ts:90)
- **P2**: invoiceService.ts死代码

---

## Module 3: Payments (PaymentVoucher)

### Evidence
- Schema: PaymentVoucher (schema.prisma:1309-1349) — **无status字段**，但前端types.ts:1633强依赖status
- Route: server/src/finance/route.ts — GET/vouchers, GET/vouchers/:id, POST/vouchers, PATCH/vouchers/:id. **无DELETE, 无审批, 无核销专用endpoint**
- Frontend: FinanceManager.tsx — VOUCHER_STATUSES展示Pending/Approved/Paid/Cancelled (L49-55) **在数据层不存在**
- 核销靠 PATCH invoiceId + appliedAmount，无InvoiceAllocation中间表（schema注释L1265承认1:N不支持）

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | RED | UI零写入 |
| State clarity | RED | Prisma无status字段，前端强依赖 (types.ts:1633-1659) |
| Recovery | RED | 无DELETE；无反核销；无审批撤回 |
| Audit | RED | 无审计表；核销动作不写中间表 |

### Gaps
- **P0**: Schema/UI契约断裂 — PaymentVoucher无status字段但前端强依赖
- **P0**: UI显示"待审批/已审批"但无API/DB字段/审批流
- **P0**: 无1:N核销（appliedAmount只能关联单张invoiceId）
- **P0**: UI零写入
- **P1**: 无DELETE
- **P1**: GET不过滤deletedAt (route.ts:127)
- **P1**: 无核销endpoint POST /vouchers/:id/allocate

---

## Module 4: Shipments

### Evidence
- Schema: Shipment (schema.prisma:1364-1433), ShipmentLine (1435-1468). ShipmentLine**未加onDelete Cascade**
- Route: server/src/shipping/route.ts — GET/, GET/:id, POST/, PATCH/:id, DELETE/:id (5 endpoints, CRUD完整，正确过滤deletedAt)
- Frontend: components/ShipmentManager.tsx — UI表单齐全(create/edit/delete)
- Service: services/shipmentService.ts — **三个写入端点全错**：POST/v1/shipments(应/v1/shipping), PUT(应PATCH), 响应壳{shipment}(不存在)
- Type mismatch: types.ts:1661 status=Preparing|Booked|InTransit|Delivered|Cancelled(5态) vs Prisma 8态；字段重合度<30%（前端direction/billType/trackingNumber vs Prisma type/vesselOrFlight/etd/eta）

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | RED | UI完整但shipmentService端点全错，手动CRUD全404 |
| State clarity | RED | 5态vs8态；前端默认Preparing后端不识别 |
| Recovery | YELLOW | 后端DELETE软删正确；但ShipmentLine无Cascade变孤儿；前端因service错无法触发 |
| Audit | RED | 无ShipmentStatusTransition表；报关单号变更无审计 |

### Gaps
- **P0**: shipmentService.ts三写入方法端点+方法+响应壳全错
- **P0**: 前端Shipment字段(direction/billType/trackingNumber等) vs Prisma(type/vesselOrFlight/etd等) 重合度<30%
- **P0**: 状态枚举5态vs8态不一致
- **P0**: type字段(Export/Import/Domestic)前端表单缺失
- **P1**: ShipmentLine无onDelete Cascade (schema.prisma:1435)
- **P1**: 无状态轨迹审计表

---

## Module 5: Relations

### Evidence
- Schema: Relation (schema.prisma:262-319) — category 7类, isOrganization双态, deletedAt软删
- Route: server/src/relations/route.ts — GET/, POST/query, GET/:id/expand, GET/:id, POST/, PUT/:id, DELETE/:id(软删). 7 endpoints.
- Frontend: compiledRelationsTemplates.tsx — create/edit/delete全链路
- VALID_CATEGORIES强校验 (toolRuntime.ts:3643-3646)

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | GREEN | POST/PUT/DELETE齐全；UI覆盖全链路 |
| State clarity | GREEN | category 7类强校验；type允许细分 |
| Recovery | YELLOW | 软删到位；但EntityLink(belongsTo)不随软删失效 |
| Audit | RED | **relations路由POST/PUT/DELETE完全不写AuditLog** |

### Gaps
- **P0**: 手动CRUD无审计日志
- **P1**: 软删后EntityLink残留active
- **P1**: PUT/:id不校验category枚举
- **P2**: ensureDefaultRelations硬编码"Peerless Clothing" (route.ts:14-67)

---

## Module 6: Products-Fabrics

### Evidence
- Schema: ProductAsset(321), FabricProfile(358), GarmentProfile(394), TrimmingProfile(485), FabricPriceHistory(607), FabricCertification(630), FabricCompositionLine(574), FabricCustomerCode(590)
- Route: server/src/products/route.ts — GET/assets, POST/assets/query, GET/assets/:id, POST/assets, PATCH/assets/:id, DELETE/assets/:id(级联软删), images CRUD
- Frontend: compiledProductsTemplates.tsx — 三类表单齐全

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Manual completeness | GREEN | 创建面料/成衣/辅料+子档案+图片全链路 |
| State clarity | YELLOW | GarmentProfile价格字段是String(schema设定)无法数值比较 |
| Recovery | GREEN | DELETE级联软删(ProductAsset+3profile+4集合+images) |
| Audit | RED | **products路由全链路零AuditLog** |

### Gaps
- **P0**: FabricPriceHistory.amount用Number(p.amount)写入Decimal字段 (route.ts:129) — 违反金额Decimal铁律
- **P0**: products路由全链路无AuditLog
- **P1**: GarmentProfile/TrimmingProfile价格字段String类型
- **P1**: PATCH嵌套集合全量替换易误删
- **P2**: productAssetInclude不返回classificationLinks

---

## Module 7: Entity Links

### Evidence
- Schema: EntityLink (schema.prisma:1024-1046), EntityReference(981), EntityAlias(1005)
- Route: server/src/entities/route.ts — **全部只读**（GET/registry, POST/search, POST/hydrate, POST/resolve-batch, GET/links, GET/neighbors）
- Sync: server/src/entities/sync.ts — 7个sync函数（syncOrderEntityReferences等），16种linkKind
- **无POST/PATCH/DELETE /links路由；Agent无links.create工具**
- Email模块sync未实现（schema注释L1483承诺sentBy/receivedFrom但代码缺失）

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Cross-module linking | YELLOW | 16种linkKind覆盖9实体类型；但Email未入图 |
| linkKind enum | YELLOW | 无schema enum约束；枚举散落sync.ts无单一权威源 |
| Manual linking | RED | 无写入路由；用户无法修正误关联 |
| Cascade delete | RED | **完全缺失** — 软删源实体EntityLink不失效 |

### Gaps
- **P0**: 无级联软删 — EntityLink永远不随源实体软删失效
- **P0**: 无手动link创建/删除路由 + Agent无links.create工具
- **P1**: Email EntityLink sync未实现
- **P1**: linkKind无schema enum约束
- **P1**: relationId变更旧link残留

---

## Module 8: Audit Logs

### Evidence
- Schema: AuditLog (schema.prisma:1594-1610) — actorId FK, action, targetType, detail Json, createdAt
- Query: GET /api/v1/admin/audit-logs (admin/route.ts:445) — 支持page/actor/action过滤，**不支持targetType/targetId/时间范围**
- 写入覆盖：auth(3处) + admin用户/角色/权限/审批(13处) + agent toolRuntime(每工具) + commitTransaction(事务内强写)
- **业务路由零审计**：relations/products/orders/finance/shipping/email/development全链路无AuditLog

### Assessment
| Dimension | Rating | Evidence |
|---|---|---|
| Coverage | RED | 核心业务写入模块全部不写AuditLog |
| Actor recording | YELLOW | auth/admin用actor?.userId||'system'兜底；API Key场景无UserAccount行 |
| Timestamp | GREEN | createdAt DateTime @default(now())；commitTransaction事务内一致 |
| Queryability | YELLOW | 不支持targetType/targetId/时间范围；非admin无法查自己审计 |

### Gaps
- **P0**: 业务路由零审计（系统性缺口）
- **P0**: toolRuntime.ts:2086-2089 recordAuditLog是catch non-fatal（与commitTransaction强写矛盾）
- **P1**: API Key场景actorId FK约束问题
- **P1**: 查询不支持targetType/targetId过滤
- **P2**: 无retention/归档策略；id高并发碰撞风险

---

## P0/P1/P2 Priority Matrix

### P0 (Must fix — production broken or data integrity risk)
| # | Gap | Module | Evidence |
|---|---|---|---|
| P0-1 | Orders handleDeleteOrder未同步后端 | Orders | OrderManager.tsx:446-453 |
| P0-2 | Shipments service端点全错 | Shipments | shipmentService.ts全文件 |
| P0-3 | Shipments前后端字段重合度<30% | Shipments | types.ts:1681 vs schema.prisma:1364 |
| P0-4 | Invoice UI零写入 | Invoices | FinanceManager.tsx纯展示 |
| P0-5 | Invoice状态枚举三重不一致 | Invoices | types.ts:1604 vs Prisma vs FinanceManager |
| P0-6 | PaymentVoucher无status字段但前端强依赖 | Payments | schema.prisma:1309 vs types.ts:1633 |
| P0-7 | 业务路由零审计 | Audit Logs | relations/products/orders/finance/shipping |
| P0-8 | EntityLink无级联软删 | Entity Links | entities/sync.ts只有upsert无delete |
| P0-9 | EntityLink无手动link操作 | Entity Links | entities/route.ts无写入端点 |
| P0-10 | FabricPriceHistory.amount用Number()写Decimal | Products | route.ts:129 |

### P1 (Should fix — significant UX/reliability gap)
| # | Gap | Module |
|---|---|---|
| P1-1 | Orders状态转移无合法性校验 | Orders |
| P1-2 | Invoice无作废/冲销endpoint | Invoices |
| P1-3 | Invoice/Payment无DELETE软删 | Finance |
| P1-4 | Finance GET不过滤deletedAt | Finance |
| P1-5 | Shipment状态枚举5态vs8态 | Shipments |
| P1-6 | ShipmentLine无onDelete Cascade | Shipments |
| P1-7 | Relations手动CRUD无审计 | Relations |
| P1-8 | Products价格字段String类型 | Products |
| P1-9 | Email EntityLink sync未实现 | Entity Links |
| P1-10 | linkKind无schema enum约束 | Entity Links |
| P1-11 | Audit查询不支持targetType过滤 | Audit Logs |

### P2 (Nice to have — code quality / tech debt)
| # | Gap | Module |
|---|---|---|
| P2-1 | operator硬编码'Kevin' | Orders |
| P2-2 | invoiceService/shipmentService死代码 | Finance/Shipping |
| P2-3 | ensureDefaultRelations硬编码业务实体 | Relations |
| P2-4 | AuditLog无retention策略 | Audit Logs |
| P2-5 | EntityReference.confidence恒为1 | Entity Links |

---

## Recommended Fix Order

1. **P0-2/P0-3 (Shipments service+字段对齐)** — 线上立即坏，手动CRUD全404
2. **P0-1 (Orders delete同步后端)** — 线上立即坏，删除只是本地假象
3. **P0-7 (业务路由审计中间件)** — 系统性基础设施，一次修复覆盖全模块
4. **P0-5/P0-6 (Invoice/Payment契约统一)** — status枚举+字段集收敛为一套
5. **P0-8/P0-9 (EntityLink级联+手动操作)** — 跨模块图查询数据漂移
6. **P0-10 (FabricPriceHistory Decimal)** — 金额精度风险
