# Bambook Business Capability Matrix v1.0

> 版本：v1.0
> 日期：2026-07-20
> 作者：BAMBOOK 项目总设计师
> 状态：单一事实源（Single Source of Truth）— 所有后续文档引用本矩阵
> 数据来源：4 个并行子 agent 全仓库盘点 + Truth Baseline 验证（vitest 3281 用例 / tsc 88 错误 / 工具数运行时核对）

---

## 目录

- [评级标准](#评级标准)
- [Truth Baseline 修正](#truth-baseline-修正)
- [主线 A：Order-to-Cash 业务能力](#主线-aorder-to-cash-业务能力)
- [主线 B：控制平面能力](#主线-b控制平面能力)
- [主线 C：Agent 执行内核](#主线-cagent-执行内核)
- [关键缺口汇总](#关键缺口汇总)
- [Phase 0 落地清单](#phase-0-落地清单)

---

## 评级标准

每个能力按 6 级状态评级，**每条评级必须有文件路径 + 行号证据**：

| 级别 | 定义 | 证据要求 |
|------|------|---------|
| `planned` | 只有需求/设计文档，无代码 | 设计文档路径 |
| `contracted` | 有数据模型 + API 契约（route 文件存在），无 service 实现 | schema.prisma 行号 + route.ts 行号 |
| `implemented` | 有 service 实现 + 前端组件，但无测试或测试失败 | service 文件行号 + 组件路径 |
| `tested` | 有通过的测试覆盖（test 文件存在且通过） | test 文件路径 + 用例数 + 通过率 |
| `runtime-verified` | 有运行时验证证据（E2E 通过 / 真实数据流验证） | E2E 测试路径 + 验证范围 |
| `production-used` | 有真实生产使用证据 | 部署日志 / 用户使用记录 |

**强制规则**：
- 没有证据的项一律降级为 `planned` 或 `contracted`
- 测试存在但失败，标注 `tested (failing: N)`
- 不写"完整/高度可用/全部就绪"等模糊词

---

## Truth Baseline 修正

基于 2026-07-20 全仓库盘点，对 [PRODUCT_DESIGN_AND_ROADMAP.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/PRODUCT_DESIGN_AND_ROADMAP.md) v2.0 的 6 项数据偏差进行修正：

| 维度 | v2.0 文档声称 | 实际 | 修正说明 |
|------|--------------|------|---------|
| Agent 工具数 | 83（58 simple + 25 commit） | **83（58 simple + 25 commit）** | v2.0 数据正确；Truth Baseline 阶段曾误判为 58（盘点方法漏掉 `_rct` import alias） |
| 测试用例数 | 1526 | **3281**（200 failed / 3081 passed / 通过率 93.9%） | v2.0 严重低估，且未提及 200 个失败 |
| API 端点数 | 200 | **176**（19 个 route.ts 文件） | v2.0 高估 24 个 |
| TSC 错误 | 暗示零错误 | **88 个**（69 个源于 Prisma client 未生成） | v2.0 未提及 |
| Prisma 数据模型 | 56+ | 待重新统计 | — |
| HEAD commit | `e36be6f` | `15ee60a` | v2.0 文档基线已过时 |

**关键结论**：v2.0 文档的"完整/高度可用"表述全部失效，本矩阵以证据重新评级。

---

## 主线 A：Order-to-Cash 业务能力

### A.1 Orders（订单管理）

#### 数据模型
- Order: 145+ 字段 | 证据: [schema.prisma#L53-L200](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L53-L200)
- OrderLine: 37 字段 | 证据: [schema.prisma#L202-L247](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L202-L247)
- OrderStatusTransition: 7 字段 | 证据: [schema.prisma#L249-L264](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L249-L264)

#### API 端点（11 个）
| Method | Path | 鉴权 | 证据 |
|--------|------|------|------|
| GET | /api/v1/orders | API key | [route.ts#L51-L67](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L51-L67) |
| POST | /api/v1/orders/query | API key | [route.ts#L69-L77](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L69-L77) |
| GET | /api/v1/orders/:id | API key | [route.ts#L79-L88](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L79-L88) |
| POST | /api/v1/orders/import | API key | [route.ts#L90-L145](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L90-L145) |
| POST | /api/v1/orders | API key（**无 requireRole**） | [route.ts#L152-L231](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L152-L231) |
| PUT | /api/v1/orders/:id | API key | [route.ts#L239-L283](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L239-L283) |
| DELETE | /api/v1/orders/:id | API key | [route.ts#L286-L304](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L286-L304) |
| POST | /api/v1/orders/:id/status-transition | API key | [route.ts#L317-L350](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L317-L350) |
| GET | /api/v1/orders/:id/timeline | API key | [route.ts#L353-L372](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L353-L372) |
| PATCH | /api/v1/orders/batch-status | API key | [route.ts#L375-L414](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L375-L414) |
| GET | /api/v1/orders/kanban/summary | API key | [route.ts#L417-L435](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L417-L435) |

OrderLine 端点 4 个：[orderLinesRoute.ts#L32-L153](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLinesRoute.ts#L32-L153)

#### 前端 UI
- [OrderManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/OrderManager.tsx)（1554 行，默认导出，App.tsx 直接消费）
- [GarmentOrders.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/GarmentOrders.tsx)（401 行，成衣订单子视图）
- 渲染入口: [moduleRegistry.ts#L273-L287](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/moduleRegistry.ts#L273-L287)
- **无 compiled 版本**（orders 无双路径）

#### Agent 工具（11 个）
| toolId | 性质 | 证据 |
|--------|------|------|
| orders.search | read | [toolRuntime.ts#L2302](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2302) |
| orders.query | read | [toolRuntime.ts#L2303](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2303) |
| orders.get | read | [toolRuntime.ts#L2304](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2304) |
| orders.expand | read | [toolRuntime.ts#L2305](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2305) |
| orders.list_by_status | read | [toolRuntime.ts#L2316](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2316) |
| orders.update_status | mutation | [toolRuntime.ts#L2317](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2317) |
| orders.get_timeline | read | [toolRuntime.ts#L2318](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2318) |
| orders.batch_status | mutation | [toolRuntime.ts#L2319](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2319) |
| orders.kanban | read | [toolRuntime.ts#L2320](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2320) |
| garment.update_size_breakdown | mutation | [toolRuntime.ts#L2321](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2321) |
| garment.update_production_steps | mutation | [toolRuntime.ts#L2322](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2322) |

Commit 工具 4 个：order.confirm / order.ship / order.status_transition / order.delete / order.line_update（见 [toolRuntime.ts#L2430-L2494](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2430-L2494)）

#### 状态机
- **显式状态机**：是 | 6 状态：`Pending / Confirmed / Production / Shipping / Delivered / Alert`
- 转换矩阵：[orderLifecycleService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L13-L24)
- 审计写入：[orderLifecycleService.ts#L160-L181](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L160-L181)（OrderStatusTransition.create + writeRouteAuditLog 同事务）

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| Manual UI | `implemented` | OrderManager.tsx 1554 行，调用真实 API |
| REST API | `tested` | route.test.ts (9) + orderLifecycleRoute.test.ts (18) + orderLineMutationRoute.test.ts (13) |
| Agent tool | `tested` | orderLifecycleExecuteTool.test.ts (10) + orderLifecycleFlow.test.ts (11) + orderShipFlow.test.ts (15) + orderShipExecuteTool.test.ts (7) + orderShipFlowReuseService.test.ts (6) + orderLineUpdateExecuteTool.test.ts (13) + orderLineUpdateFlow.test.ts (10) |
| Audit | `tested` | orderLifecycleService.ts#L160-L181 同事务写入，orderLifecycleRoute.test.ts 覆盖 |
| State machine | `tested` | ORDER_TRANSITIONS 显式 map + orderLifecycleRuntimeQa.test.ts (49) + orderLifecycleRoute.test.ts (18) 验证 fail-closed |
| E2E test | `runtime-verified` | orderLifecycleRuntimeQa.test.ts (49) + statusTransition.test.ts |
| Runtime proof | `无` | 无真实生产数据快照 |
| Production usage | `无` | 无部署/使用记录 |

#### 关键缺口
1. **写操作仅 API key 鉴权，无 requireRole/JWT** | 影响：多角色权限粒度不足，违反 RBAC 设计
2. **"Cancelled" 状态未纳入 VALID_ORDER_STATUSES** | 影响：schema 允许但状态机不识别，脏数据风险
3. **POST / 和 PUT /:id 无审计写入** | 影响：订单创建/修改无审计追溯

---

### A.2 Products（产品与物料）

#### 数据模型
- ProductAsset: 12 字段 | [schema.prisma#L325-L351](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L325-L351)
- FabricProfile: 27 字段 | [schema.prisma#L362-L396](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L362-L396)
- GarmentProfile: 75+ 字段 | [schema.prisma#L398-L487](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L398-L487)
- TrimmingProfile: 30 字段 | [schema.prisma#L489-L531](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L489-L531)
- 其他：ProductSubCategory / ProductClassificationLink / FabricCompositionLine / FabricCustomerCode / FabricPriceHistory / FabricCertification / ProductImage

#### API 端点（10 个）
| Method | Path | 鉴权 | 证据 |
|--------|------|------|------|
| GET | /api/v1/products/assets | API key | [route.ts#L219-L274](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L219-L274) |
| POST | /api/v1/products/assets/query | API key | [route.ts#L276-L325](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L276-L325) |
| GET | /api/v1/products/assets/:id | API key | [route.ts#L327-L368](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L327-L368) |
| POST | /api/v1/products/assets | requireWrite (JWT) | [route.ts#L370-L425](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L370-L425) |
| PATCH | /api/v1/products/assets/:id | requireWrite | [route.ts#L428-L560](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L428-L560) |
| DELETE | /api/v1/products/assets/:id | requireWrite | [route.ts#L563-L610](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L563-L610) |
| POST | /api/v1/products/assets/:id/images | requireWrite | [route.ts#L634-L716](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L634-L716) |
| DELETE | /api/v1/products/assets/:id/images/:imageId | requireWrite | [route.ts#L719-L782](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L719-L782) |
| PATCH | /api/v1/products/assets/:id/images/:imageId/primary | requireWrite | [route.ts#L785-L831](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L785-L831) |
| PATCH | /api/v1/products/assets/:id/images/reorder | requireWrite | [route.ts#L834-L866](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L834-L866) |

#### 前端 UI
- [ProductsManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ProductsManager.tsx)（fallback）
- [compiledProductsTemplates.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/osCompiler/compiledProductsTemplates.tsx)（实际渲染源，双路径）
- 渲染入口: [moduleRegistry.ts#L263-L271](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/moduleRegistry.ts#L263-L271)

#### Agent 工具（8 个 read + 3 个 commit）
- Read：products.count / search / query / describe_schema / get / expand + dictionary.query + records.query | [toolRuntime.ts#L2294-L2301](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2294-L2301)
- Commit：product_asset.create / update / delete | [toolRuntime.ts#L2510-L2518](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2510-L2518)

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| Manual UI | `implemented` | compiledProductsTemplates.tsx（实际渲染源）+ ProductsManager.tsx (fallback) |
| REST API | `tested` | route.test.ts (8) + productAssetAuditRoute.test.ts (13) + productImageAuditRoute.test.ts (11) |
| Agent tool | `tested` | productAssetMutationExecuteTool.test.ts (12) + productAssetMutationFlow.test.ts (12) |
| Audit | `tested` | route.ts 6 处 writeRouteAuditLog + productAssetAuditRoute.test.ts (13) + productImageAuditRoute.test.ts (11) |
| State machine | `不存在` | ProductAsset.status 字段无转移规则 |
| E2E test | `runtime-verified` | productAssetMutationRuntimeQa.test.ts (55) + productImageAuditRuntimeQa.test.ts (48) |
| Runtime proof | `无` | — |
| Production usage | `无` | — |

#### 关键缺口
1. **ProductAsset 无状态机** | 影响：status 字段无转移约束，脏数据风险
2. **millOrganizationId 在 compiledProductsTemplates 是纯文本 input，非 RelationCombobox FK** | 影响：与 relations 模块 Supplier 数据不打通
3. **Decimal 校验已实现**（isValidDecimal fail-closed） | [route.ts#L7-L21](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/products/route.ts#L7-L21)

---

### A.3 Production（生产管线）

#### 数据模型
- ProductionStage: 17 字段（含 signedByProduction / signedByBusiness 双签） | [schema.prisma#L1644-L1667](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1644-L1667)
- PreCutChecklist: 11 字段（四项门禁：grading/consumption/pattern/preProductionMeeting） | [schema.prisma#L1669-L1684](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1669-L1684)
- InspectionReport: 11 字段 | [schema.prisma#L1686-L1701](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1686-L1701)

#### API 端点（7 个）
| Method | Path | 鉴权 | 证据 |
|--------|------|------|------|
| GET | /api/v1/production/stats/dashboard | API key | [route.ts#L54-L135](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L54-L135) |
| GET | /api/v1/production/alerts/scan | API key | [route.ts#L139-L192](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L139-L192) |
| GET | /api/v1/production/:orderId | API key | [route.ts#L195-L202](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L195-L202) |
| POST | /api/v1/production/:orderId/advance/:stageKey | requireProductionRole | [route.ts#L205-L229](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L205-L229) |
| POST | /api/v1/production/:orderId/sign/:stageKey | requireProductionRole | [route.ts#L232-L250](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L232-L250) |
| PUT | /api/v1/production/:orderId/checklist | requireProductionRole | [route.ts#L253-L261](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L253-L261) |
| PUT | /api/v1/production/:orderId/inspection | requireProductionRole | [route.ts#L264-L272](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/route.ts#L264-L272) |

#### 前端 UI
- [ProductionPipeline.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ProductionPipeline.tsx)（292 行）
- **无独立 moduleRegistry 入口**——嵌入 [OrderManager.tsx#L1208](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/OrderManager.tsx#L1208) 作为订单详情子组件

#### Agent 工具（6 个）
| toolId | 性质 | 证据 |
|--------|------|------|
| production.get_pipeline | read | [toolRuntime.ts#L2348](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2348) |
| production.advance_stage | high-risk mutation | [toolRuntime.ts#L2352](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2352) |
| production.save_checklist | mutation | [toolRuntime.ts#L2363](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2363) |
| production.save_inspection | mutation | [toolRuntime.ts#L2375](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2375) |
| production.sign_stage | high-risk mutation（双签） | [toolRuntime.ts#L2386](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2386) |
| production.scan_alerts | read | [toolRuntime.ts#L2397](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2397) |

#### 10 阶段门禁引擎
- **阶段定义**：[stageService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L13-L24)
  - `order_placed → materials_confirmed → production_planned → in_production → materials_arrived → pre_cut_checked → pp_sample_approved → manufacturing → final_review → qc_shipped`
- **3 道门禁**：
  - ⑥ pre_cut_checked: PreCutChecklist 四项全 true | [stageService.ts#L153-L166](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L153-L166)
  - ⑦ pp_sample_approved: 双签（signedByProduction && signedByBusiness） | [stageService.ts#L168-L175](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L168-L175)
  - ⑩ qc_shipped: passRate ≥ 90% + defectRate ≤ 3% + approvedByBusiness | [stageService.ts#L177-L193](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L177-L193)
- **顺序校验**：[stageService.ts#L141-L151](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L141-L151)（STAGE_NOT_SEQUENTIAL fail-closed）
- **审计写入**：[stageService.ts#L201-L210](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L201-L210)（writeRouteAuditLog 同事务）

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| Manual UI | `implemented` | ProductionPipeline.tsx 292 行，调用 productionService 真实 API |
| REST API | `tested` | stageService.test.ts (14) + rbac.test.ts (11) |
| Agent tool | `tested` | agentProductionE2e.test.ts (10) 覆盖 advance_stage + 4 项门禁 |
| Audit | `tested` | stageService.ts#L201-L210 同事务 + auditLog.create mock 验证 |
| State machine | `tested` | 10 阶段 + 3 道门禁 + STAGE_NOT_SEQUENTIAL，agentProductionE2e.test.ts 覆盖完整门禁路径 |
| E2E test | `runtime-verified` | agentProductionE2e.test.ts (10) Agent → dispatchFromRegistry → advanceStage → 门禁检查完整链路 |
| Runtime proof | `无` | — |
| Production usage | `无` | — |

#### 关键缺口
1. **ProductionPipeline 无独立 moduleRegistry 入口** | 影响：无法在主导航直接进入生产看板
2. **dashboard 端点仅 stageDistribution 聚合，无 productionPlanDeadline 超期预警联动** | 影响：看板深度有限
3. **InspectionReport 缺陷件数推导依赖 passedUnits，未独立记录缺陷类型** | 影响：缺陷结构化分析不足

---

### A.4 Shipping（发货）

#### 数据模型
- Shipment: 40+ 字段（含 5 个日期 / 4 类费用 Decimal / customs 字段） | [schema.prisma#L1522-L1591](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1522-L1591)
- ShipmentLine: 13 字段 | [schema.prisma#L1593-L1626](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1593-L1626)

#### API 端点（5 个）
| Method | Path | 鉴权 | 证据 |
|--------|------|------|------|
| GET | /api/v1/shipping | API key + module guard | [route.ts#L108-L135](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L108-L135) |
| GET | /api/v1/shipping/:id | API key | [route.ts#L138-L146](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L138-L146) |
| POST | /api/v1/shipping | requireRole(HIGH_RISK_ROLES) | [route.ts#L150-L184](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L150-L184) |
| PATCH | /api/v1/shipping/:id | requireRole(HIGH_RISK_ROLES) | [route.ts#L188-L212](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L188-L212) |
| DELETE | /api/v1/shipping/:id | requireRole(HIGH_RISK_ROLES) | [route.ts#L216-L229](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L216-L229) |

#### 前端 UI
- [ShipmentManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ShipmentManager.tsx)（769 行）
- 渲染入口: [moduleRegistry.ts#L313-L323](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/moduleRegistry.ts#L313-L323)

#### Agent 工具（4 个）
- shipping.list_shipments / get_shipment（read）| [toolRuntime.ts#L2333-L2334](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2333-L2334)
- shipping.create_shipment / update_tracking_status（mutation）| [toolRuntime.ts#L2335-L2336](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2335-L2336)
- Commit：order.ship | [toolRuntime.ts#L2438](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2438)

#### 状态机
- **显式状态机**：是 | 8 状态：`Draft / Booked / Loading / Shipped / Arrived / Cleared / Delivered / Cancelled`
- 转换矩阵：[statusTransition.ts#L26-L38](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L26-L38)
- Order 状态联动：linkOrderStatusFromShipment | [shipmentMutationService.ts#L128-L133](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/shipmentMutationService.ts#L128-L133)
- 审计写入：[shipmentMutationService.ts#L139-L144, L195-L201, L230-L235](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/shipmentMutationService.ts#L139-L144)（同事务）

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| Manual UI | `implemented` | ShipmentManager.tsx 769 行，调用真实 API |
| REST API | `tested` | shipmentMutationRoute.test.ts (15) + routeAudit.test.ts (13) + orderLink.test.ts (25) |
| Agent tool | `tested` | shippingToolContract.test.ts (19) + shippingToolRuntime.test.ts (10) + orderShipFlow.test.ts (15) + orderShipExecuteTool.test.ts (7) + orderShipFlowReuseService.test.ts (6) |
| Audit | `tested` | shipmentMutationService.ts 同事务 writeRouteAuditLog，routeAudit.test.ts (13) + shipmentOrderRuntimeQa.test.ts (31) 验证 |
| State machine | `tested` | SHIPMENT_TRANSITIONS 显式 map + validateStatusTransition fail-closed + shipmentStatusContract.test.ts (8) + orderLink.test.ts (25) |
| E2E test | `runtime-verified` | shipmentOrderRuntimeQa.test.ts (31) 覆盖 Agent flow + manual UI + 状态联动 + 防篡改 contract |
| Runtime proof | `无` | — |
| Production usage | `无` | — |

#### 关键缺口
1. **HIGH_RISK_ROLES 重复 const 声明**（[route.ts#L102, L104](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L102)） | 影响：TypeScript 编译错误，运行时后者覆盖前者
2. **ShipmentLine 无独立 API 端点** | 影响：运单行级操作必须随主单全量更新
3. **Agent 无 delete_shipment 工具** | 影响：Agent 无法直接删除运单

---

### A.5 Finance（财务：发票/凭证/核销/作废）

#### 数据模型
- Invoice: 17 字段（status: Draft/Issued/PartiallyPaid/Paid/Cancelled） | [schema.prisma#L1404-L1442](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1404-L1442)
- PaymentVoucher: 19 字段（status: unreconciled/partially_reconciled/reconciled/cancelled） | [schema.prisma#L1444-L1486](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1444-L1486)
- InvoiceAllocation: 7 字段（**无 deletedAt，硬删除语义**） | [schema.prisma#L1495-L1507](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1495-L1507)

#### API 端点（16 个）
完整清单见 [route.ts#L104-L408](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/finance/route.ts#L104-L408)，鉴权统一为 `createModuleAuthGuard` + `requireJwtForWrite` + 写操作 `requireRole('owner','admin','manager','finance')`

#### 前端 UI
- [FinanceManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/FinanceManager.tsx)（1327 行）
- 双 tab：invoices / vouchers（allocations 在侧边栏内联）
- 调用 services/{invoiceService, paymentVoucherService, allocationService}.ts → REST API

#### Agent 工具（双轨制）

**A. 直接工具（绕过 service，无审计/无 Decimal/无校验）**：
- finance.create_invoice / create_voucher / apply_voucher_to_invoice | [toolRuntime.ts#L5051-L5188](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L5051-L5188)
- finance.list_invoices / get_invoice / list_vouchers / get_voucher / query_outstanding | [toolRuntime.ts#L4964-L5045](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L4964-L5045)

**B. Flow 工具（draft→approval→commit，复用 service）**：
- invoice.create / update / issue / cancel / delete | [toolRuntime.ts#L2458-L2474](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2458-L2474)
- payment.receive_and_reconcile | [toolRuntime.ts#L2434](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2434)
- payment_voucher.create / update / delete | [toolRuntime.ts#L2498-L2506](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2498-L2506)

#### 状态机
- **Invoice 状态机**：有 | 5 状态：`Draft / Issued / PartiallyPaid / Paid / Cancelled` | [statusTransition.ts#L14-L23](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L14-L23)
  - 转换受控：是（validateStatusTransition 在 invoiceMutationService 调用）
  - PartiallyPaid/Paid 禁止手动 PATCH，仅由 allocation 重算
- **PaymentVoucher 状态机**：**无显式转移 map** | 状态由 allocation 自动重算（recalcVoucherStatus）
  - **无 validateStatusTransition('PaymentVoucher', ...) 调用**

#### 核销关系
- **1:N 核销真实成立**：一笔 voucher 可核销多张 invoice（split），一张 invoice 可被多笔 voucher 核销
- **InvoiceAllocation 硬删除**（无 deletedAt，调整=delete+insert）
- 币种一致性 + 金额不超限校验：仅在 `applyAllocation` 实施（route + agent flow commit 复用）
- **Agent 直接工具 `handleFinanceApplyVoucherToInvoice` 未实施这些校验**

#### 审批与审计
- **审批**：路由层无审批工作流集成（仅 requireRole 角色守卫）；Agent flow 工具走 draft→approval→commit + hash 防篡改；Agent 直接工具无审批
- **审计**：路由 mutation 同事务 writeRouteAuditLog；Agent flow commit 同事务审计（复用 service）；**Agent 直接工具无审计写入**

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| Manual UI | `implemented` | FinanceManager.tsx 1327 行，发票/凭证/核销三视图齐全 |
| REST API | `tested (failing: 63)` | route 测试 6/6 文件失败（401 鉴权阻断 + entityLink.update 未调用），43/106 用例通过 |
| Agent tool | `implemented`（双轨） | flow 工具 tested；直接工具 implemented-but-bypassed（无审计/无 Decimal/无校验） |
| Audit | `implemented` | route + flow commit 同事务；直接工具缺失 |
| State machine (Invoice) | `tested` | statusTransition.ts#L14-L23 显式 map，invoiceMutationService 调用 |
| State machine (Voucher) | `implemented` | **无显式转移 map**，仅 allocation 重算 |
| 1:N 核销 | `tested (failing: 3)` | allocationRoute 37/37 通过；allocationMutationRoute 13/16 通过（3 个 401 阻断） |
| 作废可恢复 | `implemented` | **不可恢复**（Cancelled 终态，UI 明示） |
| Approval | `implemented` | Agent flow 工具走 draft→approval→commit；route 无 approval（仅 role guard） |
| E2E test | `tested (failing: 12)` | agent flow 5 文件 1 fail；agent executeTool 6 文件 4 fail；components 8 文件 350/350 全通过 |
| Runtime proof | `tested` | supertest 集成测试覆盖 route；mock tx 覆盖 service |
| Production usage | `无` | — |

#### 关键缺口（8 项，最严重的业务域）
1. **PaymentVoucher 无显式状态转移 map** | 影响：cancelled 状态无转移规则，与 Invoice 不对称
2. **Agent 直接工具绕过 service 层**（finance.create_invoice/create_voucher/apply_voucher_to_invoice）| 影响：绕过审计/状态校验/币种一致性/剩余额度校验，IEEE 754 不安全累加，产生双账本漂移
3. **路由测试 6/6 文件失败（63 用例失败）** | 影响：写操作测试全部 401 阻断，route 写入路径无回归保障
4. **reconcileFlow split voucher Agent commit 测试失败** | 影响：一笔凭证核销多张发票的 Agent 路径在 mock 链下不能完整跑通
5. **ExchangeRate 仅为前端 UI 工具** | 影响：无 Agent 工具、无 API 端点、无 schema model；query_outstanding 不做币种换算
6. **作废不可恢复** | 影响：Cancelled 为终态，无红冲/恢复机制
7. **路由无审批工作流集成** | 影响：仅 requireRole 角色守卫，与 Agent flow 工具的 draft→approval→commit 不对称
8. **agent handleFinanceQueryOutstanding 不扣减已核销金额** | 影响：outstanding 金额偏高

---

## 主线 B：控制平面能力

### B.1 AuditLog（审计日志）

#### 实现
- 中央写入器 `writeRouteAuditLog` | [routeAudit.ts#L1-L54](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/audit/routeAudit.ts#L1-L54)
- **fail-closed**（直接抛错，不 catch）
- 支持事务（input.prisma 可为 $transaction tx client）
- 51 处调用 + 多处 prisma.auditLog.create 直接调用

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `tested` | routeAudit.test.ts (302 行) 覆盖 fail-closed + 事务闭环 + sync 失败回滚 |
| Runtime proof | `部分` | 未发现 e2e 测试 |
| Production usage | `是` | 生产路径使用 |

#### 关键缺口（未写审计的 route，明确暴露）
1. **HR routes 全部 CRUD 无审计** | [hr/route.ts#L89-L512](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/hr/route.ts#L89-L512)
2. **Templates routes 全部无审计** | [templates/route.ts#L1-L178](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/templates/route.ts#L1-L178)
3. **Knowledge Documents 下载/上传无审计** | [knowledgeDocumentsRoute.ts#L53-L136](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/knowledgeDocumentsRoute.ts#L53-L136)
4. **Orders POST / 和 PUT /:id 无审计** | [orders/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts)
5. **Entity graph 查询 route 无审计** | [entities/route.ts#L1-L251](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts#L1-L251)

#### Audit 非 fail-closed（明确暴露）
- **Admin routes 用 `.catch(() => undefined)` 吞掉审计失败** | [admin/route.ts#L121-L316](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/admin/route.ts#L121-L316)（6 处）
- **Agent `/approvals/:id/resolve` 吞掉审计失败** | [agent/route.ts#L347-L424](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts#L347-L424)

---

### B.2 EntityLink / EntityReference（实体图谱）

#### 实现
- 双写 service | [entities/sync.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/sync.ts)（831 行）
- 7 实体类型：Order / DevCase / OrderLine / Relation / Invoice / PaymentVoucher / Shipment
- 软删除：`deactivateEntityLinks` 设置 status='inactive' + deletedAt
- tx 参数支持，避免嵌套 $transaction

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `tested` | sync.ts 测试 + routeAudit 集成测试 |
| Runtime proof | `部分` | — |
| Production usage | `是` | 7 实体双写生产路径使用 |

#### 关键缺口
1. **Entity graph 查询 route 鉴权弱**（仅 API-key） | [entities/route.ts#L1-L251](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts#L1-L251)
2. **linkKind 无数据库层约束**（仅代码层） | schema.prisma#L1151-L1173
3. **跨模块一致性依赖调用方 discipline**（被动调用，非 Prisma hook）
4. **status 字段无 enum 约束** | schema.prisma#L1128, L1167
5. **snapshot 字段无 schema 校验**

---

### B.3 RBAC（权限控制）

#### 实现
- 三层 guard：全局 mount + Module guard + Role guard
- 11 角色：owner/admin/manager/merchandiser/finance/sales/logistics/production_manager/factory/viewer/agent_operator
- [auth/middleware.ts#L1-L53](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/auth/middleware.ts#L1-L53)
- [auth/moduleGuard.ts#L1-L58](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/auth/moduleGuard.ts#L1-L58)

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `tested`（部分） | routeAuthGuardRealModule.test.ts (108 行) 仅覆盖 finance/shipping/development/email |
| Runtime proof | `部分` | — |
| Production usage | `是` | — |

#### 关键缺口（未 auth guard 的 route，明确暴露）
1. **Templates 模块无 module-level auth guard** | [templates/route.ts#L1-L178](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/templates/route.ts#L1-L178)
2. **Knowledge Documents 下载用 token query param 代替 middleware auth** | [knowledgeDocumentsRoute.ts#L53-L63](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/knowledgeDocumentsRoute.ts#L53-L63)
3. **Orders / OrderLines routes 仅 API-key 检查，无 JWT，无角色** | [orders/route.ts#L1-L500](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts#L1-L500)
4. **Relations routes 仅 requireWrite（JWT-only），无角色检查** | [relations/route.ts#L1-L372](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/route.ts#L1-L372)
5. **Entity graph 查询 routes 仅 API-key 检查** | [entities/route.ts#L1-L251](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts#L1-L251)
6. **Admin / HR requireRole('owner', 'admin') 无 module guard** | [admin/route.ts#L42](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/admin/route.ts#L42), [hr/route.ts#L22](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/hr/route.ts#L22)
7. **shipping/route.ts HIGH_RISK_ROLES 重复声明**（TypeScript 编译错误） | [shipping/route.ts#L102, L104](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L102)

---

### B.4 ApprovalRequest（审批）

#### 实现
- 数据模型 | [schema.prisma#L1296-L1317](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma#L1296-L1317)
- 审批创建：[toolRuntime.ts#L1650](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L1650) `createPendingApprovalRequest`
- 审批决策：[agent/route.ts#L347-L424](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts#L347-L424) `/approvals/:id/resolve`（decision: approved/rejected/modified）
- ProcessDraft 三道防线：shape validation + semantic validation + hash 防篡改 | [commitTransaction.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/commitTransaction.ts)
- what-you-approve-is-what-you-commit 契约成立 | commitTransaction.test.ts#L304-L323 验证

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `tested` | commitTransaction.test.ts + agentLoop.e2e.test.ts 6 种 fail-closed 矩阵 |
| Runtime proof | `部分` | order.confirm 全链路在 runner.ts 主路径 |
| Production usage | `是` | — |

#### 关键缺口
1. **审批决策审计非 fail-closed** | [agent/route.ts#L347-L424](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts#L347-L424)（`.catch(() => undefined)` 吞错）
2. **modified 决策路径不完整**：25 个 commit 工具**全部不支持 modified approval**（多处 `does not support modified approval`）
3. **审批无超时/自动拒绝机制**（schema 无 expiresAt 字段）
4. **审批 payload 无 schema 校验**（仅 commit 阶段 validateProcessDraftSemantics）
5. **审批权限未细分**：`/approvals/:id/resolve` 用 `authActorOrApiKey`，无 `requireRole` 限制（任何登录用户可 resolve 任意审批）

---

### B.5 状态机（State Machine）

#### 实现
- **4 个独立状态机**，无统一框架：
  - Order: 6 状态 | [orderLifecycleService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/orderLifecycleService.ts#L13-L24)
  - Invoice: 5 状态 | [statusTransition.ts#L14-L23](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L14-L23)
  - Shipment: 8 状态 | [statusTransition.ts#L26-L38](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L26-L38)
  - Production: 10 阶段门禁 | [stageService.ts#L13-L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/production/stageService.ts#L13-L24)

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `tested`（部分） | 各域独立测试覆盖 |
| Production usage | `是` | — |

#### 关键缺口
1. **无统一框架**：三套独立实现，无共享状态机抽象
2. **PaymentVoucher 无状态机**（仅 allocation 重算 + voidDeleteService cancel）
3. **状态字段无 enum 约束**（Order/Invoice/Shipment/Production.stage 均 String）
4. **OrderStatusTransition 无 fromStatus+toStatus 校验索引**（同一订单同一时间可被多次转换）

---

### B.6 幂等/乐观锁/失败恢复

#### 5 级状态评级
| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented`（部分） | 见下 |
| Runtime proof | `否` | PrismaCheckpointManager 生产未实例化 |
| Production usage | `否` | — |

#### 关键缺口
1. **AgentToolRun.idempotencyKey 字段存在但无去重 enforcement** | 设计与实现脱节
2. **PrismaCheckpointManager 生产未实例化** | [checkpoint.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/checkpoint.ts) 导出但无生产 caller，进程崩溃/重启后无法 resume
3. **无乐观锁实现**（KnowledgeDocument.version 字段存在但未用作 OCC）
4. **无 operationId 全局幂等机制**
5. **Agent 失败恢复路径不完整**（无 retry 策略，无 dead-letter queue）

---

## 主线 C：Agent 执行内核

### C.1 Agent Loop（核心循环）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `production-used` | [agentLoop.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/agentLoop.ts) 823 行真实 LLM-driven，runner.ts#L276 真实接入 |
| 配置 | maxSteps=8 / maxToolsPerStep=3 / perToolTimeoutMs=30s / totalBudgetMs=90s | [defaults.ts#L10-L27](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/defaults.ts#L10-L27) |
| tested | agentLoop.test.ts (10) + agentLoop.e2e.test.ts (8) 覆盖核心路径 + 6 种 fail-closed 矩阵 | — |
| production-used | BAMBOOK_AGENT_LOOP 默认开启 | [runner.ts#L221-L223](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/runner.ts#L221-L223) |

缺口：request_form 流程 e2e 未覆盖；PrismaCheckpointManager 无显式注入证据

---

### C.2 Tool Registry（工具注册表）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `production-used` | 58 registerTool + 25 _rct = **83 个注册调用** |
| tested | toolRegistry.test.ts + toolDispatchRegistry.test.ts 覆盖 | — |
| production-used | dispatchFromRegistry 真实分发，runner.ts 主路径 | — |

#### 三层协议
1. `DEFAULT_AGENT_TOOLS`（62 项 RBAC 配置）| [defaults.ts#L98-L591](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/defaults.ts#L98-L591)
2. `toolDispatchRegistry`（83 项 Handler）| [toolRuntime.ts#L2294-L2518](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2294-L2518)
3. `mcp/manifest.ts`（70+ 项能力声明）| [mcp/manifest.ts#L33-L807](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/mcp/manifest.ts#L33-L807)

#### 缺口
1. **三层协议不完全一致**：P0B 工具（relation.update/delete/onboard, order.confirm/ship/status_transition/delete, invoice.create/update/issue/cancel/delete, payment_voucher.create/update/delete, product_asset.create/update/delete, email.reply_and_send, payment.receive_and_reconcile）在 P0B 但不在 DEFAULT_AGENT_TOOLS，靠 toolRuntime.ts L144 merge 动态注入
2. **orders.search/relations.search 在 manifest 已替换为 orders.query/relations.query**（mcp/planner.ts mapLegacyToolCall 兼容层）

---

### C.3 Checkpoint/Resume（断点续传）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented`（部分 tested） | [checkpoint.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/checkpoint.ts) 109 行双实现 |
| tested | `部分` — 仅 InMemory 测试，Prisma 版零覆盖 | checkpoint.test.ts (6 用例) |
| runtime-verified | `否` | PrismaCheckpointManager 未在 runner.ts 注入 |
| production-used | `否` | — |

#### 缺口
1. **PrismaCheckpointManager L61 `if (!model) return;` 静默失败**（model 不存在则不持久化，不抛错）
2. **Prisma 版零测试覆盖**
3. **生产代码无显式注入 PrismaCheckpointManager 的调用**
4. **resume 逻辑仅恢复 scratchpad，未恢复 LLM 上下文 messages**

---

### C.4 Memory（记忆系统）— **STUB**

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented (stub)` | [memory.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/memory.ts) 53 行 |
| tested | `是`（基础场景） | services.test.ts |
| runtime-verified | `否` | createMemoryService 未在生产路径注入 agentLoop |
| production-used | `否` | 仅测试用 |

#### 确认是 STUB
1. **纯进程内数组**：[memory.ts#L20](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/memory.ts#L20) `const memories: MemoryRecord[] = [];`
2. **不使用 Prisma**：ProjectMemory 模型存在但 memory.ts 不引用
3. **无 embedding / 无向量检索**：仅 `content.includes(query)` 子串匹配
4. **无持久化**：重启即失忆
5. **无记忆淘汰策略**：memories 数组只增不减
6. **未接入 agentLoop**

---

### C.5 Knowledge（知识检索）— **STUB**

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented (stub)` | [knowledge.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/knowledge.ts) 88 行 |
| tested | `是`（基础场景） | services.test.ts + knowledgeIngestFlow.test.ts + knowledgeSearchGoldEval.test.ts |
| runtime-verified | `部分` | knowledge.search 工具 handler 调用生产 searchKnowledge 函数（实际查 Prisma） |
| production-used | `部分` | knowledge.search 工具被 agentLoop 使用 |

#### 确认是 STUB
1. **knowledge.ts 是 STUB**：[knowledge.ts#L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/knowledge.ts#L24) `const chunks: StoredChunk[] = [];` 纯进程内数组
2. **knowledge.ts 不使用 Prisma**：不引用 KnowledgeDocument/KnowledgeChunk
3. **存在两套实现**：knowledge.ts stub + 生产 searchKnowledge 函数（实际查询 Prisma）
4. **无向量检索**：KnowledgeChunk.embedding 字段存在但未使用
5. **无 ACL 权限控制**（仅 actor.memoryScopes 检查）
6. **无 evidence 引用链**
7. **无低置信度拒答**
8. **无版本/失效/删除传播**
9. **chunk 分块策略粗糙**（按段落/换行切分，无 overlap、无语义切分）

---

### C.6 LLM Planner（规划器）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `production-used` | [llmPlanner.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/llmPlanner.ts) 514 行真实 LLM 调用 |
| tested | agentLoop.test.ts 间接覆盖 planNextStep | — |
| production-used | agentLoop.ts#L115 真实调用 | — |

缺口：repairRetries=1（仅 1 次修复重试）；mcp/planner.ts 697 行 dead code（DEPRECATED）

---

### C.7 MCP（Model Context Protocol）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented (部分)` | manifest 是 API 契约文档非协议运行时 |
| tested | `部分` | mcp.test.ts 覆盖 manifest schema |
| production-used | `部分` | 仅 getToolManifestSafety 元数据被消费 |

#### 缺口
1. **MCP 协议实现非真实**：无 stdio/SSE/JSON-RPC 协议层，仅是内部 ToolManifest 类型 + Map 查询
2. **mcp/planner.ts 697 行 dead code**（仅 BAMBOOK_AGENT_LOOP=0 走旧路径）
3. **mcp/executor.ts 仅 47 行 thin wrapper**，非真实协议运行时
4. **manifest 不驱动 LLM 工具选择**（LLM 工具清单来自 DEFAULT_AGENT_TOOLS + P0B 合并）

---

### C.8 Events（事件系统）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `production-used` | [events.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/events.ts) 453 行真实事件发射 + 16 phase + block 派生 |
| tested | events.test.ts 覆盖 | — |
| production-used | agentLoop.ts 真实调用 emitAgentWorkEvent | — |

缺口：approvalEventBus / formEventBus 是进程内 EventEmitter，**多进程/多实例部署时失效**；无事件持久化；15 分钟审批/表单超时硬编码

---

### C.9 TaskGraph（任务图）— **DEAD CODE**

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `implemented (dead code)` | [taskGraph.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/taskGraph.ts) 234 行 |
| tested | `否` | 无独立测试 |
| runtime-verified | `否` | agentLoop 不调用 buildAgentTaskGraph |
| production-used | `否` | 仅旧 mcp/planner 路径使用 |

**不是真实任务编排**：taskGraph 不驱动 agentLoop 执行，仅是规划辅助；agentLoop 用 LLM 自主决策替代了预构建 task graph

---

### C.10 Commit Transaction（提交事务）

| 能力 | 评级 | 证据 |
|------|------|------|
| 整体 | `production-used` | [commitTransaction.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/commitTransaction.ts) 412 行真实 Prisma $transaction |
| tested | commitTransaction.test.ts + agentLoop.e2e.test.ts 6 种 fail-closed 矩阵 | — |
| production-used | order.confirm 全链路在 runner.ts 主路径 | — |

#### 三道防线
1. **shape validation**: [toolRegistry.ts#L935-L944](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRegistry.ts#L935-L944) validateProcessDraft 六字段必填
2. **semantic validation**: [commitTransaction.ts#L1-L53](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/commitTransaction.ts#L1-L53) validateProcessDraftSemantics
3. **hash 防篡改**: [commitTransaction.ts#L138-L151](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/commitTransaction.ts#L138-L151) verifyProcessDraftHash + [toolRegistry.ts#L623-L639](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRegistry.ts#L623-L639) computeProcessDraftHash（djb2 + stableStringify）

#### what-you-approve-is-what-you-commit 契约
**成立** ✓ | [commitTransaction.ts#L123-L132](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/commitTransaction.ts#L123-L132) recoverProcessDraftFromPayload 从 ApprovalRequest.payload 恢复 draft，不重新生成

#### fail-closed 语义
**实现** ✓ | L396-L411 catch 返回 `{ ok: false, committed: false, error, errorFeedback }`；6 种 fail-closed code 稳定

#### 25 个 commit 工具存在性
**全部存在（25/25）** | [toolRuntime.ts#L2419-L2518](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L2419-L2518) 的 25 个 `_rct(...)` 调用

#### 缺口
1. **仅 order.confirm 走完整 commitTransaction.ts 引擎**，其他 24 个 commit 工具走各自 commit* 函数，实现质量未全部核查
2. **25 个 commit 工具全部不支持 modified approval**（多处 `does not support modified approval`）

---

## 关键缺口汇总

按严重性排序，每项标注影响范围：

### S0 阻塞型（必须在 Phase 0 解决）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 1 | TSC 88 个错误（69 个源于 Prisma client 未生成） | 阻塞 typecheck 基线 | tsc 运行结果 |
| 2 | Vitest 200 个失败（131 个 server 端，多与 Prisma client 级联） | 阻塞测试基线 | vitest 运行结果 |
| 3 | shipping/route.ts HIGH_RISK_ROLES 重复声明 | TypeScript 编译错误 | [shipping/route.ts#L102, L104](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/shipping/route.ts#L102) |

### S1 安全/权限型（Phase 0 必须解决）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 4 | Templates 模块无 auth guard | 任何持 API-key 者可渲染任意模板 | [templates/route.ts#L1-L178](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/templates/route.ts#L1-L178) |
| 5 | Knowledge Documents 下载用 token query param | token 泄露即可下载 | [knowledgeDocumentsRoute.ts#L53-L63](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/knowledgeDocumentsRoute.ts#L53-L63) |
| 6 | Orders / OrderLines routes 仅 API-key，无 JWT/角色 | 任何持 API-key 者可创建/修改/删除订单 | [orders/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts) |
| 7 | Relations routes 仅 requireWrite，无角色检查 | 任何登录用户可创建/修改/删除 relation | [relations/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/route.ts) |
| 8 | Entity graph 查询 routes 仅 API-key | 全图谱邻居关系可被任意查询 | [entities/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts) |
| 9 | /approvals/:id/resolve 无 requireRole 限制 | 任何登录用户可 resolve 任意审批 | [agent/route.ts#L347-L424](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts#L347-L424) |

### S2 审计完整性型（Phase 0 必须解决）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 10 | HR routes 全部 CRUD 无审计 | 人事变更无追溯 | [hr/route.ts#L89-L512](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/hr/route.ts#L89-L512) |
| 11 | Templates routes 全部无审计 | 模板渲染无追溯 | [templates/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/templates/route.ts) |
| 12 | Knowledge Documents 下载/上传无审计 | 知识资产访问无追溯 | [knowledgeDocumentsRoute.ts#L53-L136](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/knowledgeDocumentsRoute.ts#L53-L136) |
| 13 | Orders POST / 和 PUT /:id 无审计 | 订单创建/修改无追溯 | [orders/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts) |
| 14 | Admin routes 用 `.catch(() => undefined)` 吞审计失败 | 审计失败不抛错，非 fail-closed | [admin/route.ts#L121-L316](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/admin/route.ts#L121-L316) |
| 15 | Agent /approvals/:id/resolve 吞审计失败 | 审批决策审计可能丢失 | [agent/route.ts#L347-L424](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts#L347-L424) |

### S3 Agent 内核能力型（Phase 0/1 解决）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 16 | Memory 是 STUB（进程内数组） | 重启即失忆，无持久化 | [memory.ts#L20](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/memory.ts#L20) |
| 17 | Knowledge 是 STUB（进程内数组） | 无向量检索，无 ACL，无 evidence | [knowledge.ts#L24](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/knowledge.ts#L24) |
| 18 | PrismaCheckpointManager 生产未实例化 | 进程崩溃/重启后无法 resume | [checkpoint.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/checkpoint.ts) |
| 19 | AgentToolRun.idempotencyKey 无去重 enforcement | 重复调用不被拒绝 | [toolRuntime.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts) |

### S4 业务一致性型（Phase 1 解决）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 21 | Agent 直接工具绕过 service 层（finance.create_invoice 等） | 双账本漂移，绕过审计/校验 | [toolRuntime.ts#L5051-L5188](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts#L5051-L5188) |
| 22 | PaymentVoucher 无显式状态机 | cancelled 状态无转移规则 | [paymentVoucherMutationService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/finance/paymentVoucherMutationService.ts) |
| 23 | 25 个 commit 工具全部不支持 modified approval | 用户修改参数后必须重新生成 draft 重新审批 | toolRuntime.ts 多处 `does not support modified approval` |
| 24 | Finance 路由测试 6/6 文件失败（63 用例失败） | 写操作测试全部 401 阻断，无回归保障 | vitest 运行结果 |
| 25 | reconcileFlow split voucher Agent commit 测试失败 | 一笔凭证核销多张发票的 Agent 路径不通 | reconcileFlow.test.ts#L348 |
| 26 | ExchangeRate 仅为前端 UI 工具 | 无 Agent 工具/API/schema model | [ExchangeRateTool.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/tools/ExchangeRateTool.tsx) |
| 27 | Finance 作废不可恢复（Cancelled 终态） | 无红冲/恢复机制 | [statusTransition.ts#L22](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/statusTransition.ts#L22) |

### S5 Dead Code / 文档型（Phase 0 清理）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 28 | mcp/planner.ts 697 行 dead code（DEPRECATED） | 维护负担 | [mcp/planner.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/mcp/planner.ts) |
| 29 | taskGraph.ts 234 行 dead code | 不驱动 agentLoop | [taskGraph.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/taskGraph.ts) |
| 30 | ~~taskFrame.ts 222 行 dead code~~（**已纠正：误判**） | 实际被 loopController/route/toolRuntime/mcp-executor 5 处引用，是 active agentLoop 路径核心依赖，禁止删除 | [taskFrame.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/taskFrame.ts)（[loopController.ts#L2-L3](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/loopController.ts#L2-L3)） |
| 31 | e2e-sse-sim.mjs 硬编码 API Key | 安全风险 | — |
| 32 | 49 份文档中部分 stale | 误导决策 | 待归档 |

---

## Phase 0 落地清单

基于关键缺口汇总，Phase 0（Truth & Release Gate，2-4 周）的具体落地项：

### Week 1：建立可信基线
1. **Prisma client 重新生成** — 解决 69 个 tsc 错误 + 级联的 131 个 server 测试失败
2. **shipping/route.ts HIGH_RISK_ROLES 重复声明修复** — 2 个 tsc 错误
3. **stageKey 联合类型对齐** — 6 个 tsc 错误
4. **tsc 零错误 + vitest 通过率 ≥ 99% 作为 CI 门禁**

### Week 2：权限与审计统一
5. **Templates 模块加 auth guard** — [templates/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/templates/route.ts)
6. **Knowledge Documents 下载改用 middleware auth** — [knowledgeDocumentsRoute.ts#L53-L63](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/ai/knowledgeDocumentsRoute.ts#L53-L63)
7. **Orders / OrderLines routes 加 requireRole + JWT** — [orders/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/orders/route.ts)
8. **Relations routes 加 requireRole** — [relations/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/route.ts)
9. **Entity graph 查询 routes 加 JWT + 角色** — [entities/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts)
10. **/approvals/:id/resolve 加 requireRole('owner','admin','manager')** — [agent/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/route.ts)
11. **HR routes 加 writeRouteAuditLog** — [hr/route.ts#L89-L512](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/hr/route.ts#L89-L512)
12. **Templates routes 加 writeRouteAuditLog**
13. **Orders POST / 和 PUT /:id 加 writeRouteAuditLog**
14. **Admin routes 移除 `.catch(() => undefined)`，改为 fail-closed** — [admin/route.ts#L121-L316](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/admin/route.ts#L121-L316)
15. **Agent /approvals/:id/resolve 移除 `.catch(() => undefined)`**

### Week 3：Dead Code 清理 + 文档归档
16. **移除 mcp/planner.ts 697 行 dead code**（确认 BAMBOOK_AGENT_LOOP=0 fallback 不再需要）
17. **移除 taskGraph.ts dead code**（taskFrame.ts 经核实为 active code，禁止删除；已纠正本矩阵第 30 项误判）
18. ~~**移除 e2e-sse-sim.mjs 硬编码 API Key**，改用 env~~ (已完成 2026-07-21)
19. ~~**归档 stale 文档**（49 份文档中标记为 stale 的移到 docs/archive/）~~ (已完成 2026-07-21：task.md 已归档)
20. ~~**修复 invoice.generate_draft** — 在 toolDispatchRegistry 注册 handler 或从 DEFAULT_AGENT_TOOLS 移除~~ (已完成 2026-07-21：从 DEFAULT_AGENT_TOOLS 移除)

### Week 4：CI 建立 + Phase 1 准备
21. **GitHub Actions CI**：typecheck + test + lint + build + migration check
22. **配色系统重构落地**（stash@{0}: phase0-color-system-refactor）+ RDL guard 测试断言更新
23. **authService 9 个失败独立排查**
24. **Phase 1 Order-to-Cash Vertical Slice 规划**（基于本矩阵的 A.1-A.5 状态评级）

---

## 附录：盘点方法说明

本矩阵的数据来源：
1. **4 个并行 general_purpose_task 子 agent** 分别盘点 Order-to-Cash 主线 / Finance / 控制平面 / Agent 内核
2. **Truth Baseline 验证**：vitest run（3281 用例）+ tsc --noEmit（88 错误）+ toolDispatchRegistry 运行时核对
3. **每条评级附文件路径 + 行号证据**，可独立验证

盘点盲点（已知）：
- 第一次盘点误判工具数为 58（漏掉 `_rct` import alias），后经子 agent 纠正为 83
- 24 个非 order.confirm 的 commit 工具实现质量未全部核查（仅确认存在性）
- 18 个 Manager 组件的 UI 完整性未逐个核查（仅核查渲染入口）

---

**结语**：本矩阵是 Bambook 项目的**单一事实源**。所有后续文档（Product Strategy / Technical Architecture / Quarterly Roadmap）必须引用本矩阵的状态评级，不得使用"完整/高度可用"等模糊表述。Phase 0 完成后，本矩阵应更新为 v2.0，反映 S0/S1/S2 缺口的修复状态。
