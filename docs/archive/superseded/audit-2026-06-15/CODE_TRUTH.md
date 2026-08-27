# 🪞 CODE_TRUTH — 2026-06-15 代码事实快照

> **本文档只列事实，不下判断**。供任何审核者（同事 / 另一个 agent / 你自己未来某天）拿着它对照 49 份理想态文档做对账。
>
> **生成方式**：直接 `grep` / `find` / `git` 提取，没有 AI 总结。如果你怀疑某条目，直接复跑命令验证。
>
> **快照锚点**：
> - Git HEAD：`5be256c690e3a92ac19313d0c12d12c44e5fa31a`（2026-06-15 13:37:24 +0800）
> - 最近一次涉及 manifest 的提交：`7823cc5 feat: 开发案例/财务/货运三大模块完整实现`
> - 远程主数据 API：`https://jiangsupanda.com/bambook/api/v1/*`（部署版本可能与本地 HEAD 不一致，需通过 ops-panel 拉取）

---

## 1. Agent MCP 工具事实（44 seeds in manifest）

> 数据源：`grep -E "^    id: '" server/src/agent/mcp/manifest.ts`

按域分组：

| 域 | 数量 | 工具 ID |
|---|---:|---|
| **development** | 4 | `development.convert_to_order` `development.get` `development.query` `development.update_stage` |
| **email** | 6 | `email.ai_extract` `email.get` `email.link_to_order` `email.list` `email.search` `email.sync` |
| **entities** | 2 | `entities.hydrate` `entities.search` |
| **finance** | 8 | `finance.apply_voucher_to_invoice` `finance.create_invoice` `finance.create_voucher` `finance.get_invoice` `finance.get_voucher` `finance.list_invoices` `finance.list_vouchers` `finance.query_outstanding` |
| **garment** | 2 | `garment.update_production_steps` `garment.update_size_breakdown` |
| **knowledge** | 1 | `knowledge.search` |
| **links** | 2 | `links.expand_neighbors` `links.query` |
| **orders** | 8 | `orders.batch_status` `orders.expand` `orders.get` `orders.get_timeline` `orders.kanban` `orders.list_by_status` `orders.query` `orders.update_status` |
| **products** | 4 | `products.describe_schema` `products.expand` `products.get` `products.query` |
| **relations** | 3 | `relations.expand` `relations.get` `relations.query` |
| **shipping** | 4 | `shipping.create_shipment` `shipping.get_shipment` `shipping.list_shipments` `shipping.update_tracking_status` |
| **总计** | **44** | |

> **注意**：用户记忆里写过"远程 53 个工具"，与本地 HEAD 的 44 不一致。可能原因：
> 1. 远程后端代码版本更新（部署在前，HEAD 在后）；
> 2. defaults.ts 还会派生额外条目（需进一步核实）。
> 验证方法：`curl -H "x-bambook-api-key: ..." https://jiangsupanda.com/bambook/api/agent/mcp/manifest | jq '.tools | length'`

---

## 2. 后端路由事实（18 个 `/api*` 顶层路径）

> 数据源：`grep -nE "app\.(get|post|put|delete|patch|use)\('/api" server/src/index.ts`

| 路径 | 类型 | 文件:行 | 说明 |
|---|---|---|---|
| `/api/uploads` | static | index.ts:152 | 上传文件静态托管 |
| `/api/health` | GET | index.ts:207 | 健康检查 |
| `/api/v1/events` | GET | index.ts:282 | SSE 事件流（sdkAuth） |
| `/api/ai` | use | index.ts:292 | AI 路由 |
| `/api/v1/knowledge-documents` | use | index.ts:299 | 知识文档 |
| `/api/auth` | use | index.ts:312 | 认证 |
| `/api/admin` | use | index.ts:319 | 管理面板 |
| `/api/agent` | use | index.ts:321 | **Agent 运行时（无 v1 前缀）** |
| `/api/v1/orders` | use | index.ts:347 | 订单 |
| `/api/v1/order-lines` | use | index.ts:357 | 订单行 |
| `/api/v1/relations` | use | index.ts:367 | 关系 |
| `/api/v1/products` | use | index.ts:377 | 产品 |
| `/api/v1/development` | use | index.ts:388 | 开发案例 |
| `/api/v1/finance` | use | index.ts:398 | 财务 |
| `/api/v1/shipping` | use | index.ts:408 | 货运 |
| `/api/v1/system-assets` | use | index.ts:418 | 系统资源 |
| `/api/search` | GET | index.ts:464 | 搜索 |
| `/api/fetch-url` | GET | index.ts:545 | URL 抓取 |
| `/api/v1/email` | use | index.ts:585 | 邮件（新规范） |
| `/api/email` | use | index.ts:587 | **邮件（旧前端兼容）** |
| `/api/market/cotton` | GET | index.ts:594 | 棉花行情 |
| `/api/market/wool` | GET | index.ts:628 | 羊毛行情 |
| `/api/shipping-notice/generate` | POST | index.ts:751 | 发货通知生成 |
| `/api/shipping-notice/download` | GET | index.ts:909 | 发货通知下载 |
| `/api/orders/search` | POST | index.ts:928 | 订单搜索（旧 legacy） |
| `/api/market/all` | GET | index.ts:959 | 全市场行情 |

**前缀拓扑（非常重要）**：
- **`/api/v1/*`** — 业务核心（orders/relations/products/development/finance/shipping/email/events/knowledge-documents/system-assets）
- **`/api/*`**（无 v1）— 三类：基础设施（health/uploads/auth/admin/ai/agent/search/fetch-url）+ 旧前端兼容（email/orders/shipping-notice/market/*）+ Agent 运行时
- **关键不一致**：Agent 运行时挂在 `/api/agent`（**无 v1 前缀**），但业务路由都是 `/api/v1/*`。任何把 agent 路径写成 `/api/v1/agent` 的文档都是错的。

---

## 3. Prisma 模型事实（54 个模型）

> 数据源：`grep -E "^model " server/prisma/schema.prisma`

按域分组：

| 域 | 数量 | 模型 |
|---|---:|---|
| **Agent 运行时** | 9 | `AgentJob` `AgentMemory` `AgentMessage` `AgentPolicy` `AgentSession` `AgentSuggestion` `AgentTool` `AgentToolPermission` `AgentToolRun` |
| **沙盒/审计** | 2 | `ApprovalRequest` `AuditLog` |
| **业务主体** | 5 | `Order` `OrderLine` `OrderStatusTransition` `Relation` `BusinessProfile` |
| **开发** | 1 | `DevelopmentCase` |
| **财务** | 2 | `Invoice` `PaymentVoucher` |
| **货运** | 2 | `Shipment` `ShipmentLine` |
| **邮件** | 2 | `Email` `EmailAttachment` |
| **图谱** | 3 | `EntityAlias` `EntityLink` `EntityReference` |
| **产品/面料/辅料** | 14 | `FabricCertification` `FabricCompositionLine` `FabricCustomerCode` `FabricPriceHistory` `FabricProfile` `GarmentProfile` `MaterialCompositionTerm` `PdmlRawFabric` `ProductAsset` `ProductClassification` `ProductClassificationLink` `ProductImage` `ProductSubCategory` `TrimmingProfile` |
| **知识库** | 4 | `KnowledgeAcl` `KnowledgeChunk` `KnowledgeDocument` `KnowledgeItem` `KnowledgeRelation` |
| **RBAC/账户** | 6 | `Department` `Permission` `Role` `RolePermission` `UserAccount` `UserRole` |
| **业务洞察/系统** | 3 | `Insight` `ProjectMemory` `SystemAsset` |
| **总计** | **54** | |

---

## 4. Ops Panel 与运维脚本事实

> 数据源：`ls server/scripts/ops/` + `grep ops-*.sh server/ops-panel/src/index.ts`

### 4.1 LaunchAgent plist（4 个）

| plist | 作用 |
|---|---|
| `com.bambook.main-data-api.plist` | 主数据 API 服务 |
| `com.bambook.ops-panel.plist` | Ops Panel 服务（端口 8088） |
| `com.bambook.ops-panel-auto.plist` | 每分钟轮询 GitHub main 自动部署 |
| `com.bambook.public-probe.plist` | 每 5 分钟公网探针 |

### 4.2 Ops 脚本白名单

由 `server/ops-panel/src/index.ts` 的 `OPS_ACTIONS` 注册。详见 `server/docs/ops-panel-runbook.md`。

### 4.3 server/scripts/ 顶层脚本（25+）

包含 `e2e-agent-test.ts`（E2E 回归）、`scaffold-module.ts`（脚手架生成器）、`post-deploy-verify.ts`（**今天 5a 加的，仍待并入 ops-panel 体系**）等。

---

## 5. 桌面客户端架构事实

> 数据源：`electron/main.ts:481-507` `startEmbeddedServer()` 注释

- **真实运行模式**：客户端通过 HTTP 调用 `https://jiangsupanda.com/bambook/api/v1/*` 访问 Mac Mini 数据中心。
- **离线 fallback**：`startEmbeddedServer()` 的注释明确写："如果 /api 请求连不上外部服务器（Mac mini 等），就在本机起一个。" — **这是 fallback，不是主架构**。
- **客户端唯一在本地运行的 AI 组件**：sherpa-onnx STT (paraformer-zh-en-int8 ONNX 模型)。
- **客户端不直连**：大模型（豆包/GLM）、PostgreSQL、外部 SaaS。所有模型调用由 Mac Mini 转发。

---

## 6. 已知文档与代码事实冲突清单（仅列出，不打分）

| # | 文档（路径:行） | 文档表述 | 代码事实 | 严重度提示 |
|---:|---|---|---|---|
| 1 | `docs/ARCHITECTURE.md:9`（已修） | "桌面客户端、本地内嵌后端服务及智能 Agent OS 混合架构" | `electron/main.ts:481` 注释明确说"内嵌后端"是离线 fallback；真实主架构是远程 Mac Mini | 🔴 主架构错误（已修） |
| 2 | `docs/Bambook_Master_Specification.md:42` 旧版（已修） | "本地内嵌后端 (Local Sovereign Server) — Embedded Server: Child process managed by Main Process" | 同上 | 🔴 主架构错误（已修） |
| 3 | `docs/Bambook_Master_Specification.md` §5.2 | 把"Float→Decimal 迁移已完成"等**事件性记录**写进了"权威白皮书"的债务节 | 这类内容应在 CHANGELOG，不在权威规格 | 🟡 文档分层错误 |
| 4 | `docs/AGENT_RUNTIME_ARCHITECTURE.md` | 描述工具命名应收敛到 `*.query/get/expand/draft/execute` | 实际工具集是 `email.list / email.search / email.ai_extract / email.link_to_order` 等不规则命名 | 🟡 理想态 vs 现实 |
| 5 | `docs/implementation_plan.md` | 列了 Phase 1-6 的路线图，但对 Phase 4a（邮件接收）/ 4b（AI 抽取）/ 5a（post-deploy-verify）**完全没有记录** | 这三 Phase 是 2026-06-15 当天完成的，应回写 | 🟠 路线图过时 |
| 6 | `docs/task.md` | 23 行任务清单 | 100% 是 `implementation_plan.md` 的子集，无新增信息 | 🟠 重复文档 |
| 7 | `docs/PROJECT_CLEANUP_MAP.md` + `docs/LEGACY_CLEANUP_INVENTORY.md` | 两份都在维护"待清理列表" | 没说彼此关系 | 🟡 双轨管理 |
| 8 | `docs/Bambook_Master_Specification.md:4` | 自称 "终极权威单一源 (Single Source of Truth)" | `docs/MODULE_CONTRACT.md` 也自称 "scaffold 生成器的 source of truth" | 🟡 多源声明 |
| 9 | `docs/DEPLOY_SOP.md`（今天写的） | 顶部已修正为指向 ops-panel-runbook | 与 `server/docs/ops-panel-runbook.md` 关系仍只在 SOP 顶部说明，索引地图刚加上 | 🟡 历史遗留（已修） |
| 10 | manifest 工具数 vs 用户记忆 | 用户记忆"远程 53 个工具" | 本地 HEAD = 44 | ❓ 需以远程 `/api/agent/mcp/manifest` 实际响应为准 |

---

## 7. 验证命令（任何审核者可重跑）

```bash
# 工具计数
cd apps/Bambook && grep -cE "^    id: '" server/src/agent/mcp/manifest.ts
# 路由计数
grep -cE "app\.(get|post|put|delete|patch|use)\('/api" server/src/index.ts
# 模型计数
grep -cE "^model " server/prisma/schema.prisma
# 远程工具数（需 API key）
curl -s -H "x-bambook-api-key: $KEY" https://jiangsupanda.com/bambook/api/agent/mcp/manifest | jq '.tools | length'
# REST 探针
curl -s -o /dev/null -w "%{http_code}\n" https://jiangsupanda.com/bambook/api/v1/development
```

---

## 8. 本快照不做的事

- ❌ 不打"应该删 / 应该改"的判断 —— 留给 Kevin 或外部审核者
- ❌ 不重写理想态文档 —— 那是另一项工作
- ❌ 不评估 49 份文档的"价值" —— 价值需结合业务目标，不是事实层判断

---

*Snapshot generated: 2026-06-15 14:44 GMT+8*
*Next snapshot: 待 Kevin 触发，新建 `CODE_TRUTH_<日期>.md`*