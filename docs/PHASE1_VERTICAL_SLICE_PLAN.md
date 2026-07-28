# Bambook Phase 1: Order-to-Cash Vertical Slice 落地规划

> 版本：v1.0
> 日期：2026-07-21
> 作者：BAMBOOK 项目总设计师
> 状态：Phase 0 收尾文档 — Phase 1 执行起点
> 数据来源：[BUSINESS_CAPABILITY_MATRIX.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/BUSINESS_CAPABILITY_MATRIX.md) v1.0 的 A.1-A.5 状态评级 + 关键缺口汇总
> 上游依赖：Phase 0 W1-W4 全部完成（可信基线 / 权限审计 / Dead code 清理 / CI 建立）

---

## 目录

- [1. Phase 1 战略定位](#1-phase-1-战略定位)
- [2. Vertical Slice 定义](#2-vertical-slice-定义)
- [3. 各模块提升路径](#3-各模块提升路径)
- [4. 关键缺口优先级排序](#4-关键缺口优先级排序)
- [5. Phase 1 落地清单（8 周）](#5-phase-1-落地清单8-周)
- [6. Phase 1 验收标准](#6-phase-1-验收标准)
- [7. 风险与依赖](#7-风险与依赖)
- [8. Phase 1 完成后的下一步](#8-phase-1-完成后的下一步)

---

## 1. Phase 1 战略定位

### 1.1 Phase 0 → Phase 1 的转变

Phase 0（Truth & Release Gate）已建立**可信基线**：
- TSC 零错误（88 → 0）
- Vitest 通过率 95.6%（1266/1324，剩余 58 个非 401 失败属 Phase 1 范围）
- 权限审计统一（S1/S2 缺口全部修复）
- Dead code 清理（mcp/planner.ts 697 行 + taskGraph.ts 234 行移除）
- GitHub Actions CI 建立（typecheck + prisma + build + test 4 job）
- 配色系统重构落地（Premium blue trio + audit baseline）

Phase 1（Vertical Slice Production）的战略目标：**让 Order-to-Cash 主线从 `tested/runtime-verified` 提升至 `production-used`**，即"真实生产环境跑通一笔订单从下单到收款的完整链路"。

### 1.2 评级提升路径（6 级状态机回顾）

| 当前级别 | Phase 1 目标 | 提升关键证据 |
|----------|-------------|-------------|
| `tested` | `runtime-verified` | 真实数据流验证（非 mock tx） |
| `runtime-verified` | `production-used` | 部署日志 + 真实用户使用记录 |
| `implemented (failing)` | `tested` | 修复 58 个非 401 失败 + 通过率 ≥ 99% |
| `implemented (双轨)` | `tested` | Agent 直接工具下线或改写为 service 复用 |

### 1.3 Phase 1 不做什么

- **不做横向扩展**：不新增模块（HR/Templates/Knowledge Documents 的审计缺口属 Phase 2）
- **不做 Agent 内核升级**：Memory/Knowledge STUB 改造属 Phase 3（见矩阵 C.4/C.5）
- **不做 MCP 协议化**：manifest 驱动 LLM 工具选择属 Phase 3（见矩阵 C.7）
- **不做 modified approval 支持**：25 个 commit 工具的 modified approval 属 Phase 2（见矩阵 B.4 缺口 3）

---

## 2. Vertical Slice 定义

### 2.1 Order-to-Cash 全链路

Phase 1 的 vertical slice 是**一笔真实订单的完整生命周期**：

```
Order (A.1)              Production (A.3)          Shipping (A.4)         Finance (A.5)
─────────────────────────────────────────────────────────────────────────────────────
Pending                  order_placed              —                      —
   ↓ (confirm)
Confirmed                materials_confirmed       —                      Draft (invoice)
   ↓ (start production)     ↓ (10 阶段门禁)
Production               in_production → qc_shipped —                      Issued (invoice)
   ↓ (ship)                                          ↓ (create shipment)
Shipping                 —                         Draft → Booked → Shipped → Delivered  PartiallyPaid
   ↓ (deliver)                                       ↓ (status link)
Delivered                —                         Delivered              ↓ (allocation)
   ↓ (payment)                                                              Paid (invoice) + reconciled (voucher)
```

### 2.2 Slice 涉及的模块与状态机联动

| 联动点 | 触发方 | 接收方 | 当前实现 | Phase 1 要求 |
|--------|--------|--------|---------|-------------|
| Order → Production | order.confirm | ProductionStage 创建 | [orderLifecycleService.ts#L160-L181](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L160-L181) | 真实数据流验证 |
| Order → Shipping | order.ship | Shipment 创建 + Order 状态联动 | [shipmentMutationService.ts#L128-L133](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/shipmentMutationService.ts#L128-L133) | 真实数据流验证 |
| Shipping → Order | Shipment Delivered | Order → Delivered | linkOrderStatusFromShipment | 真实数据流验证 |
| Order → Finance | order.confirm | Invoice Draft 创建 | **当前无自动联动** | Phase 1 W3 新增 |
| Shipping → Finance | Shipment Delivered | Invoice Issued | **当前无自动联动** | Phase 1 W3 新增 |
| Finance 内部 | voucher.apply | Invoice PartiallyPaid/Paid | [allocationService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/finance/allocationService.ts) | 修复 Outstanding 不扣减 |

### 2.3 Slice 不涉及的模块

- A.2 Products：Product 数据是 Order 的前置依赖，但 Phase 1 不改造 ProductAsset 状态机（属 Phase 2）
- B.1-B.6 控制平面：Phase 0 已修复 S1/S2 缺口，Phase 1 仅使用不改造
- C.1-C.10 Agent 内核：Phase 1 使用现有 agentLoop + commitTransaction，不改造 Memory/Knowledge/Checkpoint

---

## 3. 各模块提升路径

### 3.1 A.1 Orders：`runtime-verified` → `production-used`

**当前状态**：11 API + 11 agent tools + 6-state machine + E2E runtime-verified，无生产使用证据

**Phase 1 提升路径**：
1. **W2 修复剩余缺口**：
   - "Cancelled" 状态纳入 VALID_ORDER_STATUSES（[orderLifecycleService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L13-L24)）
   - POST / 和 PUT /:id 加 writeRouteAuditLog（W2 已修复 requireRole，但审计写入未补）
2. **W6 真实数据流验证**：在 staging 环境用 Peerless PO fixtures 跑完整 import → confirm → produce → ship → deliver 链路
3. **W8 生产部署**：在 BAMBOOK_AGENT_LOOP=1 的生产环境跑通首笔真实订单

**目标评级**：`production-used`（部署日志 + 真实订单使用记录）

### 3.2 A.3 Production：`runtime-verified` → `production-used`

**当前状态**：10 阶段 + 3 道门禁 + E2E runtime-verified，无生产使用证据

**Phase 1 提升路径**：
1. **W4 修复缺口**：
   - ProductionPipeline 加独立 moduleRegistry 入口（[moduleRegistry.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/moduleRegistry.ts)）
   - dashboard 端点加 productionPlanDeadline 超期预警联动
2. **W6 真实数据流验证**：staging 环境跑完整 10 阶段门禁（含 PreCutChecklist 四项 + 双签 + passRate≥90%）
3. **W8 生产部署**：生产环境跑通首笔真实生产订单

**目标评级**：`production-used`

### 3.3 A.4 Shipping：`runtime-verified` → `production-used`

**当前状态**：5 API + 4 agent tools + 8-state machine + E2E runtime-verified，无生产使用证据

**Phase 1 提升路径**：
1. **W4 修复缺口**：
   - ShipmentLine 独立 API 端点（[shipping/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts)）
   - Agent delete_shipment 工具（[toolRuntime.ts#L2333-L2336](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2333-L2336)）
2. **W6 真实数据流验证**：staging 环境跑完整 Draft → Booked → Shipped → Arrived → Cleared → Delivered 链路 + Order 状态联动
3. **W8 生产部署**：生产环境跑通首笔真实发货

**目标评级**：`production-used`

### 3.4 A.5 Finance：`tested (failing)` → `production-used`

**当前状态**：16 API + 双轨 agent tools（direct + flow）+ 5-state invoice machine + 8 项关键缺口，**最严重业务域**

**Phase 1 提升路径**（最复杂，占 4 周）：
1. **W1-W2 修复 8 项关键缺口**（见 [§4.1](#41-a5-finance-8-项缺口优先级)）
2. **W3 修复剩余 58 个非 401 测试失败**（DB 污染/功能 bug/业务逻辑）
3. **W5 双轨工具统一**：Agent 直接工具下线，全部改写为 flow 工具（复用 service）
4. **W6 真实数据流验证**：staging 环境跑完整 Invoice Draft → Issued → PartiallyPaid → Paid + Voucher unreconciled → reconciled 链路
5. **W8 生产部署**：生产环境跑通首笔真实收款核销

**目标评级**：`production-used`

### 3.5 A.2 Products：维持 `runtime-verified`（Phase 1 不改造）

**当前状态**：8 read + 3 commit tools，无状态机，E2E runtime-verified

**Phase 1 决策**：ProductAsset 状态机缺失 + millOrganizationId 纯文本 input 属 Phase 2 范围。Phase 1 仅确保 Product 数据作为 Order 前置依赖在生产环境可用。

**目标评级**：维持 `runtime-verified`（Phase 2 提升至 `production-used`）

---

## 4. 关键缺口优先级排序

### 4.1 A.5 Finance 8 项缺口优先级

按"阻塞 production-used"的影响排序：

| 优先级 | # | 缺口 | 阻塞原因 | Phase 1 周次 |
|--------|---|------|---------|-------------|
| **P0** | 2 | Agent 直接工具绕过 service 层 | 双账本漂移，IEEE 754 不安全累加，绕过审计/校验 — **生产环境不可接受** | W1 |
| **P0** | 8 | handleFinanceQueryOutstanding 不扣减已核销金额 | outstanding 金额偏高 — **财务报表错误** | W1 |
| **P0** | 1 | PaymentVoucher 无显式状态转移 map | cancelled 状态无转移规则 — **脏数据风险** | W2 |
| **P1** | 4 | reconcileFlow split voucher Agent commit 测试失败 | 一笔凭证核销多张发票的 Agent 路径不通 | W3 |
| **P1** | 6 | 作废不可恢复（Cancelled 终态） | 无红冲/恢复机制 — **业务实操需求** | W4 |
| **P1** | 5 | ExchangeRate 仅为前端 UI 工具 | 无 Agent 工具/API/schema model — **多币种场景阻塞** | W4 |
| **P2** | 7 | 路由无审批工作流集成 | 仅 requireRole，与 Agent flow 不对称 | W5（可选） |
| **P2** | 3 | 路由测试 6/6 文件失败（63 用例） | W4-3 已修复 105 个 401，剩 58 个非 401 | W3 |

### 4.2 其他模块缺口优先级

| 模块 | # | 缺口 | Phase 1 周次 |
|------|---|------|-------------|
| A.1 Orders | 2 | "Cancelled" 状态未纳入 VALID_ORDER_STATUSES | W2 |
| A.1 Orders | 3 | POST / 和 PUT /:id 无审计写入 | W2 |
| A.3 Production | 1 | ProductionPipeline 无独立 moduleRegistry 入口 | W4 |
| A.3 Production | 2 | dashboard 无超期预警联动 | W4（可选） |
| A.4 Shipping | 2 | ShipmentLine 无独立 API 端点 | W4 |
| A.4 Shipping | 3 | Agent 无 delete_shipment 工具 | W4 |
| A.2 Products | 1 | ProductAsset 无状态机 | **Phase 2** |
| A.2 Products | 2 | millOrganizationId 纯文本 input | **Phase 2** |

### 4.3 控制平面与 Agent 内核缺口（Phase 1 不改）

属 Phase 2/3 范围，Phase 1 仅使用：
- B.4 ApprovalRequest：modified approval 不支持（25 个 commit 工具）→ Phase 2
- B.6 幂等/乐观锁：PrismaCheckpointManager 未实例化 → Phase 3
- C.3 Checkpoint/Resume：Prisma 版零测试 → Phase 3
- C.4 Memory STUB → Phase 3
- C.5 Knowledge STUB → Phase 3

---

## 5. Phase 1 落地清单（8 周）

### Week 1：Finance P0 缺口修复（双账本漂移 + Outstanding）

**目标**：消除 Finance 双账本漂移风险，确保财务数据一致性

1. **Agent 直接工具下线或改写**（[toolRuntime.ts#L5051-L5188](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L5051-L5188)）
   - `finance.create_invoice` / `create_voucher` / `apply_voucher_to_invoice` 三个直接工具
   - 方案 A（推荐）：下线直接工具，DEFAULT_AGENT_TOOLS 移除，toolDispatchRegistry 移除 handler
   - 方案 B：改写为复用 invoiceMutationService/paymentVoucherMutationService/allocationService
   - 决策依据：方案 A 更彻底，避免双轨维护；方案 B 保留工具灵活性但增加耦合
2. **handleFinanceQueryOutstanding 扣减已核销金额**（[toolRuntime.ts#L4964-L5045](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L4964-L5045)）
   - 查询 InvoiceAllocation 表，sum(amount) WHERE invoiceId IN (outstanding invoices)
   - outstanding = invoice.amount - sum(allocations)
   - 新增测试：query_outstanding_after_allocation.test.ts

**验收**：
- Agent 直接工具在 DEFAULT_AGENT_TOOLS 中标记 `deprecated` 或移除
- handleFinanceQueryOutstanding 返回的 outstanding 金额 = invoice.amount - 已核销金额
- 新增测试通过

### Week 2：Finance P0 缺口修复（Voucher 状态机）+ Orders 缺口

**目标**：PaymentVoucher 状态机显式化，Orders 审计完整性

3. **PaymentVoucher 显式状态转移 map**（[statusTransition.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts)）
   - 新增 `VALID_VOUCHER_STATUS` + `VOUCHER_TRANSITIONS`
   - 状态：`unreconciled → partially_reconciled → reconciled`，`unreconciled/partially_reconciled → cancelled`
   - validateStatusTransition('PaymentVoucher', ...) 在 paymentVoucherMutationService 调用
   - 与 Invoice 状态机对称（[statusTransition.ts#L14-L23](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L14-L23)）
4. **Orders "Cancelled" 状态纳入 VALID_ORDER_STATUSES**（[orderLifecycleService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L13-L24)）
   - ORDER_TRANSITIONS 增加 Cancelled 终态转移规则
   - Pending/Confirmed/Production/Shipping → Cancelled（业务取消）
   - Cancelled 为终态，不可回退
5. **Orders POST / 和 PUT /:id 加 writeRouteAuditLog**（[orders/route.ts#L152-L231, L239-L283](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L152-L231)）
   - 同事务写入，fail-closed
   - 新增测试：orderCreateAuditRoute.test.ts + orderUpdateAuditRoute.test.ts

**验收**：
- PaymentVoucher 状态转移受 validateStatusTransition 控制
- Orders Cancelled 状态可正常转移
- Orders POST/PUT 有审计写入，测试覆盖

### Week 3：Finance 测试修复 + reconcileFlow

**目标**：Finance 测试通过率 ≥ 99%，reconcileFlow split voucher 路径通畅

6. **修复 58 个非 401 测试失败**（DB 污染/功能 bug/业务逻辑）
   - 分类：DB 污染（setup/teardown 问题）/ 功能 bug（实现错误）/ 业务逻辑（断言错误）
   - 逐个修复，每个失败附 root cause 注释
   - 目标：vitest 通过率 ≥ 99%（1318/1324）
7. **reconcileFlow split voucher Agent commit 测试修复**（[reconcileFlow.test.ts#L348](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/finance/__tests__/reconcileFlow.test.ts#L348)）
   - 一笔凭证核销多张发票的 Agent 路径
   - 修复 mock 链下的 split voucher commit 逻辑
   - 新增测试：reconcileFlowSplitVoucherE2e.test.ts

**验收**：
- vitest 通过率 ≥ 99%
- reconcileFlow split voucher 路径测试通过

### Week 4：Production + Shipping 缺口修复

**目标**：Production/Shipping 模块完整性提升

8. **ProductionPipeline 独立 moduleRegistry 入口**（[moduleRegistry.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/moduleRegistry.ts)）
   - 新增 'production' 模块入口，ProductionPipeline 可从主导航直接进入
   - 保持 OrderManager 内嵌子组件不变（双入口）
9. **ShipmentLine 独立 API 端点**（[shipping/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts)）
   - GET /api/v1/shipping/:id/lines
   - POST /api/v1/shipping/:id/lines
   - PATCH /api/v1/shipping/:id/lines/:lineId
   - DELETE /api/v1/shipping/:id/lines/:lineId
   - 鉴权：requireRole(HIGH_RISK_ROLES)
10. **Agent delete_shipment 工具**（[toolRuntime.ts#L2333-L2336](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2333-L2336)）
    - 新增 `shipping.delete_shipment` commit 工具
    - 走 draft→approval→commit 流程，复用 shipmentMutationService
    - 仅 Draft 状态可删除（状态机约束）

**验收**：
- ProductionPipeline 可从主导航进入
- ShipmentLine CRUD API 可用
- Agent delete_shipment 工具注册并测试

### Week 5：Finance 双轨统一 + 作废恢复

**目标**：Finance Agent 工具单轨化，作废机制完善

11. **Agent 直接工具全部下线或改写**（W1 方案 A/B 决策后执行）
    - 若 W1 选方案 A（下线）：DEFAULT_AGENT_TOOLS + toolDispatchRegistry + mcp/manifest.ts 三层同步移除
    - 若 W1 选方案 B（改写）：直接工具全部改写为复用 service，新增测试覆盖
12. **Finance 作废恢复机制**（[statusTransition.ts#L22](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L22)）
    - 方案：红冲凭证（credit note）而非恢复 Cancelled
    - 新增 CreditNote 模型（或复用 Invoice + type=credit_note）
    - Invoice Cancelled 后可创建对冲 CreditNote
    - 新增测试：creditNoteFlow.test.ts

**验收**：
- Agent 工具单轨化（仅 flow 工具）
- 作废恢复机制可用（红冲凭证）

### Week 6：Staging 真实数据流验证

**目标**：在 staging 环境跑通 Order-to-Cash 全链路

13. **Order → Production → Shipping → Finance 全链路 E2E**
    - staging 环境部署（DATABASE_URL 指向 staging DB）
    - 用 Peerless PO fixtures 跑完整链路：
      - Order import → confirm → Production 10 阶段 → Shipping Draft→Delivered → Finance Invoice Issued→Paid + Voucher reconciled
    - 新增测试：orderToCashE2e.test.ts（staging only，@stage tag）
14. **跨模块状态联动验证**
    - Order → Production：order.confirm 触发 ProductionStage 创建
    - Order → Shipping：order.ship 触发 Shipment 创建 + Order 状态联动
    - Shipping → Order：Shipment Delivered 触发 Order → Delivered
    - Order → Finance：order.confirm 触发 Invoice Draft 创建（W3 新增）
    - Shipping → Finance：Shipment Delivered 触发 Invoice Issued（W3 新增）

**验收**：
- staging 环境全链路 E2E 通过
- 跨模块状态联动全部生效

### Week 7：Production 部署准备

**目标**：生产环境部署准备

15. **生产环境配置审计**
    - .env.production 配置审计（DATABASE_URL / JWT_SECRET / BAMBOOK_API_KEY 轮换）
    - 已泄露 API Key 作废（`d1db03db52e57b16b19ebb8803e38585009450dbec92bd90fed0ed44939db35f`）
    - prisma migrate deploy 生产 schema 对齐
16. **生产部署 SOP 更新**（[DEPLOY_SOP.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/DEPLOY_SOP.md)）
    - Phase 1 部署 checklist
    - 回滚预案
    - 监控告警配置（Agent loop 失败率 / Finance 双账本检测）

**验收**：
- 生产环境配置审计通过
- 部署 SOP 更新完成

### Week 8：Production 首笔订单上线

**目标**：生产环境跑通首笔真实 Order-to-Cash 订单

17. **生产环境首笔订单**
    - 选择 1 笔真实 Peerless 订单（低风险，金额可控）
    - 全链路跟踪：Order → Production → Shipping → Finance
    - 每个状态转移记录部署日志 + 用户使用记录
18. **Phase 1 验收报告**
    - 各模块评级更新（production-used 证据）
    - BUSINESS_CAPABILITY_MATRIX.md v2.0 更新
    - Phase 2 规划启动

**验收**：
- 生产环境首笔订单完整跑通
- Phase 1 验收报告完成

---

## 6. Phase 1 验收标准

### 6.1 评级证据要求

每个模块达到 `production-used` 必须提供：

| 证据类型 | 要求 |
|---------|------|
| 部署日志 | 生产环境部署时间 + commit hash + 部署人 |
| 真实使用记录 | 至少 1 笔真实订单的全链路状态转移记录 |
| 监控数据 | Agent loop 成功率 ≥ 95% / Finance 双账本检测为零 |
| 用户反馈 | 至少 1 位真实用户使用确认 |

### 6.2 各模块验收标准

| 模块 | Phase 0 评级 | Phase 1 目标 | 验收证据 |
|------|-------------|-------------|---------|
| A.1 Orders | runtime-verified | production-used | 首笔真实订单 import → confirm → ship → deliver 全链路 |
| A.3 Production | runtime-verified | production-used | 首笔真实生产订单 10 阶段门禁全通过 |
| A.4 Shipping | runtime-verified | production-used | 首笔真实发货 Draft → Delivered 全链路 |
| A.5 Finance | tested (failing) | production-used | 首笔真实收款核销 + 双账本检测为零 |
| A.2 Products | runtime-verified | runtime-verified（维持） | Phase 2 提升 |

### 6.3 测试验收标准

| 维度 | Phase 0 | Phase 1 目标 |
|------|---------|-------------|
| TSC 错误 | 0 | 0（CI 门禁） |
| Vitest 通过率 | 95.6%（1266/1324） | ≥ 99%（≥ 1310/1324） |
| Finance 测试通过率 | 63 failed | 0 failed |
| reconcileFlow split voucher | failing | passing |
| Agent 直接工具 | 双轨 | 单轨（flow only） |
| PaymentVoucher 状态机 | 无显式 map | 显式 map + validateStatusTransition |

### 6.4 安全验收标准

| 维度 | 要求 |
|------|------|
| 已泄露 API Key | 作废并轮换 |
| Agent 直接工具 | 下线或改写为 service 复用 |
| Finance 双账本检测 | 监控告警为零 |
| 审计完整性 | Orders POST/PUT + Finance 全部 writeRouteAuditLog |

---

## 7. 风险与依赖

### 7.1 阻塞型风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Agent 直接工具下线影响现有用户 | 中 | 用户工作流中断 | W1 先标记 deprecated，W5 完全下线，期间提供 flow 工具替代 |
| PaymentVoucher 状态机引入破坏现有数据 | 低 | 脏数据迁移 | W2 先数据盘点，确认无 cancelled 状态的脏数据后再上线 |
| 生产环境首笔订单失败 | 中 | Phase 1 延期 | W7 部署 SOP 含回滚预案，首笔订单选低风险订单 |
| 已泄露 API Key 被利用 | 高 | 安全事故 | W7 立即作废，不等 Phase 1 W7（**建议 Phase 0 结束后立即执行**） |

### 7.2 依赖项

| 依赖 | 提供方 | 阻塞周次 |
|------|--------|---------|
| staging 环境 | 运维 | W6 |
| 生产环境部署权限 | 决策者 | W7-W8 |
| 真实 Peerless 订单授权 | 业务方 | W8 |
| API Key 轮换审批 | 决策者 | W7（建议提前至 Phase 0 结束） |

### 7.3 假设条件

- Phase 0 W1-W4 全部完成（已确认）
- BUSINESS_CAPABILITY_MATRIX.md v1.0 评级准确（已验证）
- staging 环境与生产环境 schema 一致（W7 验证）
- Agent loop 在生产环境稳定运行（runner.ts 主路径已验证）

---

## 8. Phase 1 完成后的下一步

### 8.1 Phase 2 预告：横向扩展 + 控制平面完善

Phase 1 完成后，Phase 2 的方向：

1. **A.2 Products 提升至 production-used**
   - ProductAsset 状态机
   - millOrganizationId 改为 RelationCombobox FK
2. **B.4 ApprovalRequest 完善**
   - 25 个 commit 工具支持 modified approval
   - 审批超时/自动拒绝机制
   - 审批权限细分
3. **B.6 幂等/乐观锁**
   - AgentToolRun.idempotencyKey enforcement
   - operationId 全局幂等
4. **控制平面审计完整性**
   - HR/Templates/Knowledge Documents 审计补齐（Phase 0 S2 未完成的剩余项）
5. **多币种完善**
   - ExchangeRate schema model + API + Agent 工具

### 8.2 Phase 3 预告：Agent 内核升级

1. **C.3 Checkpoint/Resume 生产化**
   - PrismaCheckpointManager 注入 runner.ts
   - Prisma 版测试覆盖
2. **C.4 Memory STUB 改造**
   - Prisma 持久化 + embedding 向量检索
3. **C.5 Knowledge STUB 改造**
   - 向量检索 + ACL + evidence 引用链
4. **C.7 MCP 协议化**
   - 真实 stdio/SSE/JSON-RPC 协议层
   - manifest 驱动 LLM 工具选择

### 8.3 BUSINESS_CAPABILITY_MATRIX.md v2.0 更新

Phase 1 完成后，矩阵更新为 v2.0：
- A.1/A.3/A.4/A.5 评级提升至 `production-used`
- S4 业务一致性缺口（#21-#27）全部修复
- 新增 Phase 1 部署日志 + 真实使用记录作为证据
- Phase 2/3 缺口继承并细化

---

## 附录：Phase 1 与 Phase 0 的衔接

### Phase 0 已完成的 W4 项（本规划的前置条件）

| 项 | 状态 | 证据 |
|---|------|------|
| W4-0 taskFrame.ts 误判纠正 | ✅ | commit `b5731c3` |
| W4-1 GitHub Actions CI | ✅ | commit `8c96c71` |
| W4-2 配色系统重构 | ✅ | commit `b5731c3` |
| W4-3 route 测试 401 阻断修复 | ✅ | commit `d45b4a6` |
| W4-4 Phase 1 规划（本文档） | ✅ | 本文 |

### Phase 0 遗留项（Phase 1 W7 优先处理）

| 项 | 说明 | 处理时机 |
|---|------|---------|
| 已泄露 API Key 轮换 | `d1db03db52e57b16b19ebb8803e38585009450dbec92bd90fed0ed44939db35f` | **Phase 0 结束后立即**（不等 W7） |
| 58 个非 401 测试失败 | DB 污染/功能 bug/业务逻辑 | Phase 1 W3 |
| 12 个 RDL guard 测试失败 | rdlEmailFlatGuard (8) + rdlToolsSafeDecorationGuard (2) + bambookDesignSystem (2) | Phase 2（非 Phase 1 范围） |
| MapLibreProductionGlobe 2 个失败 | locationLabel 断言 | Phase 2（非 Phase 1 范围） |

---

**结语**：Phase 1 是 Bambook 从"可信基线"走向"生产可用"的关键阶段。8 周的 vertical slice 落地将验证 Order-to-Cash 主线的真实业务能力，为 Phase 2 横向扩展和 Phase 3 Agent 内核升级奠定基础。本规划严格执行 BUSINESS_CAPABILITY_MATRIX.md 的 6 级评级标准，每个模块的提升必须有文件路径 + 行号 + 部署日志 + 真实使用记录作为证据，不得使用"完整/高度可用"等模糊表述。
