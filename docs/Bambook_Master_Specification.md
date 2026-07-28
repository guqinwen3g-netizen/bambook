# Bambook Master Specification (Bambook 核心全栈与 Agent OS 超级白皮书)

> **注意**: 本文档部分内容已过时。当前单一事实源为 [BUSINESS_CAPABILITY_MATRIX.md](./BUSINESS_CAPABILITY_MATRIX.md)。

> **版本**: V3.0 (2026-06-15 版)  
> **定位**: 本文档为 Bambook 全栈架构设计、视觉标准、业务规范和开发流程的**终极权威单一源 (Single Source of Truth)**。

> ⚠️ **2026-06-15 架构事实修订（§1.1 已重写）**
>
> 历史版本将 Electron 离线 fallback 错误地写成"本地内嵌后端 (Local Sovereign Server) — Embedded Server: Child process managed by Main Process"作为主架构。**这是错误的**。真实架构是「**桌面客户端 + Mac Mini 数据中心**」**两端分离**：
>
> - **客户端**：仅 UI / 交互 / 本地 STT / 缓存。**不持业务真源**。
> - **数据中心**（Mac Mini，公网域 `jiangsupanda.com`）：承载主数据 API、PostgreSQL、Agent OS、Ops Panel、LLM 网关转发。
> - **`startEmbeddedServer()`** 是**离线降级 fallback**，不是日常运行模式。
>
> 已在 §1.1 用真实拓扑替换；其它章节（§3 业务模块、§4 脚手架）的**业务逻辑**仍然有效。但凡涉及"内嵌后端"的文字，请以本警告 + §1.1 新拓扑 + [`Bambook-Agent-OS-使用说明书.md` §1](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/Bambook-Agent-OS-使用说明书.md) + [`server/docs/macmini-data-center.md`](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/docs/macmini-data-center.md) 为准。

---

# 📖 目录 (Table of Contents)

- [§1. 全局架构与技术白皮书 (Technical Whitepaper)](#1-全局架构与技术白皮书-technical-whitepaper)
  - [1.1 系统全栈拓扑](#11-系统全栈拓扑)
  - [1.2 Agent OS 与 MCP 2.0 运行机制](#12-agent-os-与-mcp-20-运行机制)
  - [1.3 跨模块图谱拓扑设计 (EntityLink & Reference)](#13-跨模块图谱拓扑设计-entitylink--reference)
    - [1.3.1 多模块共用单品主档 (SKU) 与自动同步原则](#131-多模块共用单品主档-sku-与自动同步原则)
  - [1.4 沙盒化审批与权限流 (RBAC & Safety Control)](#14-沙盒化审批与权限流-rbac--safety-control)
- [§2. 视觉与交互设计白皮书 (Design Specification)](#2-视觉与交互设计白皮书-design-specification)
  - [2.1 BAMBOOK_OS 全局视觉令牌与材质规范](#21-bambook_os-全局视觉令牌与材质规范)
  - [2.2 主程序视口与经典三栏布局规范](#22-主程序视口与经典三栏布局规范)
  - [2.3 动态流光 (Spotlight) 与高性能渲染优化 (Compiled Templates)](#23-动态流光-spotlight-与高性能渲染优化-compiled-templates)
- [§3. 业务模块与操作白皮书 (User Guide)](#3-业务模块与操作白皮书-user-guide)
  - [3.1 关系智库 (Relations)](#31-关系智库-relations)
  - [3.2 数字档案 (Products)](#32-数字档案-products)
  - [3.3 生产管理 (Orders)](#33-生产管理-orders)
  - [3.4 开发管理 (Development)](#34-开发管理-development)
  - [3.5 财务管理 (Finance)](#35-财务管理-finance)
  - [3.6 业务工具箱 (BusinessTools) 与业务孵化逻辑](#36-业务工具箱-businesstools-与业务孵化逻辑)
  - [3.7 数据中心 (DataCenter)](#37-数据中心-datacenter)
- [§4. 全栈模块开发指南与脚手架契约 (Scaffold & Dev Guide)](#4-全栈模块开发指南与脚手架契约-scaffold--dev-guide)
  - [4.1 新增模块八层契约清单](#41-新增模块八层契约清单)
  - [4.2 零新依赖脚手架生成器使用规范](#42-零新依赖脚手架生成器使用规范)
  - [4.3 E2E 自动化回归框架 (e2e-agent-test.ts)](#43-e2e-自动化回归框架-e2e-agent-testts)
- [§5. 物理目录与全库概念债务清单 (Codebase Directory & Technical Debts)](#5-物理目录与全库概念债务清单-codebase-directory--technical-debts)
  - [5.1 核心代码物理目录指引](#51-核心代码物理目录指引)
  - [5.2 遗留概念债务与优化排程](#52-遗留概念债务与优化排程)

---

# §1. 全局架构与技术白皮书 (Technical Whitepaper)

## 1.1 系统全栈拓扑

Bambook 是一个面向 AI Agent 时代设计的「**桌面客户端 + Mac Mini 数据中心**」两端分离的全栈供应链管理系统 —— 业务真源全部在公司数据中心，客户端只负责展示、交互、本地语音输入与缓存：

```
┌──────────────────────────────────────────────────────────────────────────┐
│  桌面客户端 (Client) ─ 任意员工设备，可重装/换机不丢业务数据              │
│  - React 19 / Electron 41 / Vite 6                                       │
│  - UI: Glassmorphism Material / Compiled Templates                       │
│  - 本地能力：STT (sherpa-onnx Paraformer-zh-en) / IndexedDB 缓存          │
│  - 数据真源：HTTPS → https://jiangsupanda.com/bambook/api/v1/*            │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │  HTTPS over Cloudflare Tunnel
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Mac Mini 数据中心 (公司机房, jiangsupanda.com)                            │
├──────────────────────────────────────────────────────────────────────────┤
│  Bambook Agent OS (manifest / defaults / toolRuntime / planner)          │
│  - MCP 2.0 工具集 (44 seeds: orders / development / finance /            │
│                    shipping / email / relations / products / …)          │
│  - Sandbox Approval / RBAC                                               │
├──────────────────────────────────────────────────────────────────────────┤
│  主数据 API (Express + Prisma) ─ launchctl com.bambook.main-data-api     │
│  PostgreSQL (panda_hub_local) ─ 业务真源；ops-backup-postgres.sh 备份    │
│  Ops Panel (ops.jiangsupanda.com, 独立 launchctl) ─ 21 个白名单脚本      │
│  TTS Engine: melo-tts / Edge-TTS                                         │
└──────────────────────────────────────────┬───────────────────────────────┘
                                           │ HTTPS
                                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  外部大模型与智能网络 (Cognitive Gateway) ─ 仅由数据中心后端访问            │
│  - Doubao-code-latest / GLM-4 / OpenAI API                              │
│  - Volcengine Ark (火山引擎) & Vector KB (知识库托管)                     │
└──────────────────────────────────────────────────────────────────────────┘

⚠️ 离线 fallback：客户端探活 Mac Mini 失败时，由 electron/main.ts:481
   startEmbeddedServer() 启动一个本地 Express + 本地 Postgres，
   仅维持只读体验，**不参与业务真源同步**。
```

## 1.2 Agent OS 与 MCP 2.0 运行机制

Bambook 内置了完整的 Agent 运行时，基于 **MCP 2.0 (Model Context Protocol)** 进行开发：

```
自然语言输入 ➜ LLM Planner 规划 ➜ 生成工具调用链 (Plan) ➜ 执行器 Executor ➜ 安全/审批拦截 ➜ 执行 DB 变更 ➜ 返回 Block 格式化输出
```

1. **LLM Planner (智能路由规划)**:
   在 [llmPlanner.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/llmPlanner.ts) 和 [planner.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/mcp/planner.ts) 中实现，利用正则和强逻辑将用户的意图分类映射 to 具体的 domain 域，输出工具序列；
2. **MCP Manifest (单一能力源)**:
   在 [manifest.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/mcp/manifest.ts) 中声明全部工具（ID/描述/入参规范/安全性）。
3. **ToolRuntime (能力 dispatch 与执行)**:
   在 [toolRuntime.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/toolRuntime.ts) 中，将工具参数提取并翻译为本地 Prisma 的数据库调用。

## 1.3 跨模块图谱拓扑设计 (EntityLink & Reference)

为了避免各个业务板块信息孤立，Bambook 采用**两张基础表**构建跨实体拓扑图谱，所有业务变更必须保证 `EntityLink` 与 `EntityReference` 的双写对齐：

```
                    ┌──────────────────────────────┐
                    │      业务实体 (e.g. Order)    │
                    └──────────────┬───────────────┘
                                   │
                     Prisma Mutation / sync.ts
                                   │
            ┌──────────────────────┴──────────────────────┐
            ▼                                             ▼
┌─────────────────────────────┐               ┌─────────────────────────────┐
│    EntityLink (图谱拓扑)     │               │   EntityReference (缓存)     │
│ - fromType, fromId          │               │ - ownerType, ownerId        │
│ - toType, toId              │               │ - fieldKey                  │
│ - linkKind (关系种类)       │               │ - targetType, targetId      │
│ - status (active)           │               │ - snapshot (内含快照 label) │
└─────────────────────────────┘               └─────────────────────────────┘
```

* **EntityLink**: 表达拓扑上的邻居关系，用于回答“X 实体有哪些关联的开发单和发票”；
* **EntityReference**: 在关系建立时将目标对象的最重要属性（如 `name` 作为 `label`）序列化进 `snapshot`，实现**一键带入与联动**，避免了前后台大量的连表 Join 查询。

### 1.3.1 多模块共用单品主档 (SKU) 与自动同步原则

Bambook 采用“**单品唯一主档，多端业务引用**”的数据对齐哲学，以避免数据碎片化（如开发、生产、财务、发运各自输入相同面料，产生命名和规格漂移）：

1. **唯一 SKU 主档 (Products 域)**：
   面料/成衣的物理规格（成分克重、幅宽、纱支、花型、品质认证等）属于资产主档（`ProductAsset` / `FabricProfile` / `GarmentProfile`）。系统只允许基于唯一的主档 ID 或全局唯一 SKU 进行操作；
2. **多源自动匹配与同步**：
   当面料或成衣信息在开发（Development）或大货订单（Orders）中首次被录入时，如果系统中已存在该 Mill Quality / Client Code，数据将自动匹配并关联至完整主档档案，实现全局信息同步；若不存在，支持在业务侧创建的同时注册为新档案，其他页面能实时同步该面料的克重、组织结构等，无需重复录入；
3. **订单/发运的快照隔离与实体关联**：
   * **服装与面料的级联关联**：成衣订单（以服装主档为准）与面料订单（以面料主档为准）在物理上是分开的业务实体，但它们通过数据关联（如“这套服装使用了哪块面料” / “这块面料应用在哪套成衣”）进行绑定；
   * **快照数据**：订单和发票上的单价、折扣等业务价格属于特定交易时刻的“业务快照”，与 Products 中的物理规格主档隔离开，保证历史数据的真实不可篡改性，但可以通过外键关联一键跳回面料主档。

## 1.4 沙盒化审批与权限流 (RBAC & Safety Control)

在 Bambook 中，Agent 不是绝对可信的，所有写操作必须受到沙盒化安全审批的保护：

1. **RBAC 鉴权**: 所有工具必须在 [defaults.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/defaults.ts) 的 `DEFAULT_AGENT_TOOLS` 里进行角色和范围授权。
2. **高风险拦截 (Risk Interceptor)**: 标注有 `risk: 'high'` 和 `safety.approval: 'risk_based'` 的工具在执行时，并不会直接操作数据库，而是会在数据库中落盘一条 `ApprovalRequest`。
3. **宿主决策交互**: 前端 UI 渲染审批气泡（附带修改参数输入框），只有当真实用户决策同意后，下一轮 Agent 循环中才会真正执行。

---

# §2. 视觉与交互设计白皮书 (Design Specification)

## 2.1 BAMBOOK_OS 全局视觉令牌与材质规范

Bambook 采用了前沿的 **磨砂玻璃态 (Glassmorphism)** 视觉语言，设计规范收口于 [bambookOsTokens.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/bambookOsTokens.ts) 与 [osMaterial.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/osMaterial.ts)。

* **层级关系与色值**:
  * 暗色模式 (`dark`): 背景为 `rgba(26, 28, 32, 0.45)` 的磨砂玻璃，搭配 `backdrop-blur: 16px`；
  * 明色模式 (`light`): 背景为 `rgba(255, 255, 255, 0.55)`，搭配 `backdrop-blur: 12px`；
  * 细线边框 (`border`): 采用 `white/[0.045]` (暗色) / `slate-200/55` (明色) 以提供极致的边缘对比感。
* **主要样式定义 (Tailwind)**:
  * 侧边详情容器: `border rounded-2xl p-4 bg-white/36 backdrop-blur-md`；
  * 卡片容器: `group relative isolate overflow-hidden rounded-2xl transition-all duration-300`。

## 2.2 主程序视口与经典三栏布局规范

主程序视口拥有严格的最小宽高限制：**最小宽度 1080px，最小高度 760px**（由 Electron `main.ts` 与 CSS `--desktop-min-width: 1080px` 统一约束）。
常规业务板块采用**三栏自适应布局**以呈现极佳的可读性：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Nav Rail]  │   [Table Shell / List Panel]      │   [Surface Detail]    │
│  - 宽度 64px │   - 宽度 flex-1                   │   - 宽度 320px         │
│  - 主导航   │   - 包含过滤器/搜索框/主数据表格     │   - 详细属性           │
│  - 固定层   │   - 边缘滚动淡入淡出遮罩          │   - 内嵌关联面板       │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2.3 动态流光 (Spotlight) 与高性能渲染优化 (Compiled Templates)

为实现高级感，交互卡片与面板全部挂载了 `Spotlight` 指针移动流光效。
* **Spotlight 效果**: 使用 [SpotlightCard.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/SpotlightCard.tsx) 通过 CSS `mask-image` 实现动态渐变跟随；
* **高性能编译 (Compiled Templates)**: 
  对于全景看板、关系智库等需要渲染数千条记录的页面，不直接调用通用 React 虚拟 DOM，而是由 [osCompiler](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/osCompiler/) 编译出静态模板（如 `compiledRelationsTemplates.tsx`），消除大列表渲染时的帧率下降。

---

# §3. 业务模块与操作白皮书 (User Guide)

## 3.1 关系智库 (Relations)

* **概念**: 整合客户、供应商、联系人、外贸代理和货运服务商的拓扑网。
* **用户入口**: 关系智库面板。
* **业务规则**:
  * 组织（如 atlas、peerless）作为主实体，标签包含 `customer`/`supplier`；
  * 联系人（Contact）通过 `parentId` 挂载在主组织下，建立 `belongsTo` 有向图谱；
  * 支持记录历史信用额度（Credit Limit）、账期和付款偏好。

## 3.2 数字档案 (Products)

* **概念**: 维护生产物料和最终成衣的数字身份证。
* **分类**: 面料 (`Fabric`)、成衣 (`Garment`)、辅料 (`Trimmings`)。
* **业务规则**:
  * 面料资产记录成分明细表（`CompositionLine`），支持 `RWS`、`GRS` 认证标注；
  * 成衣资产关联对应的客户编码，记录 EXW / FOB 历史报价；
  * 每项资产都包含完整的上传图片和客户编码（`FabricCustomerCode`）快照。

## 3.3 生产管理 (Orders)

* **概念**: 处理大货生产排产、物流追踪及交期预警。
* **业务规则**:
  * 状态流转: `Pending` ➜ `Confirmed` ➜ `Production` ➜ `Shipping` ➜ `Delivered` ➜ `Alert` (非正常延误)；
  * 提供 `OrderStatusTransition` 审计表，每一次状态变更都会强制产生操作日志和 timeline 时间线；
  * 成衣订单可单独配置尺码配比表（Size Breakdown）和生产工序控制（裁剪、缝纫、包装、送检）。

## 3.4 开发管理 (Development)

* **概念**: 负责面料打样、成衣样、PP样开发轮次（`currentRound`）和寄样状态的生命周期。
* **业务规则**:
  * 开发轮次从 `S1` 自动迭代升级，目标寄样日期受目标日（`targetDate`）倒计时报警约束；
  * **一键大货联动**: 当开发样被客户确认后，可以在面板上一键点击“转为大货订单”，后端会自动派生 `Order` 和 `OrderLine` 实例，并将阶段（`stage`）同步更新为 `approved`。

## 3.5 财务管理 (Finance) [计划实施 - 后端及MCP工具已实装，前端页面待开发]

* **概念**: 财务应收（`Receivable`）与应付（`Payable`）发票与实际收付款动作的核销。
* **业务规则**:
  * **Invoice (发票)**: 关联具体的订单（`aboutOrder`）和结算客户（`billTo`）。在录入时对美金/外币进行实时汇率（`exchangeRate`）冻结。
  * **PaymentVoucher (收付款凭证)**: 用于记录收款或付款动作，支持分批核销。
  * **核销机制**: 在凭证中填入发票 ID 和核销金额（`appliedAmount`），后端在同一 `$transaction` 中：
    1. 计算发票的历史总核销金额之和；
    2. 若核销完毕，自动将 `Invoice.status` 重算并更新为 `Paid`；
    3. 产生 `settlesInvoice` 图谱连线。

## 3.6 业务工具箱 (BusinessTools) 与业务孵化逻辑

* **概念**: 临时插件的“孵化器”和自定义脚本运行中心。
* **定位与生命周期**:
  1. **未整合工具的孵化区**：项目开发中临时引入的、尚未与正式核心页面（如开发、生产、财务）深度整合的各类工具和插件（如发票生成、尺码快速换算等），统一挂载在“业务工具箱”；
  2. **业务发票生成定位**：现有的“发票生成工具”在业务流程上主要**供业务员/销售使用**，用于向客户或供应商快速生成临时/预售发票（Proforma Invoice）以收款或付款；真正的税务/法税发票在公司外部的独立财务系统中进行开具与审计；
  3. **向核心板块的归纳演进 [计划实施]**：一旦某些工具在工具箱中运行稳定、使用高频，且对应的核心功能板块也开发完毕，这些临时插件将会被系统性地归类并迁移至正式模块（例如：将业务员常用的“发票生成”流程未来挪至 `Finance` 财务管理或大货订单中做原生整合）。

## 3.7 数据中心 (DataCenter) [计划实施 - 概念已确定，等待代码底层 View.KnowledgeBase 重构对齐]

* **概念**: 企业级知识与数据检索的统一看板（统一替代原 KnowledgeBase / DataTwin 命名）。
* **核心职责**:
  * **统一数据入口**：汇聚企业主数据、SOP、工艺规范、质量审计和决策报告；
  * **Agent RAG 支持**：提供向量级别（Chroma/火山引擎）的数据检索，帮助 LLM 在回答复杂供应链问题时引入事实参考；
  * **归档处理**：已正式弃用移动端的旧 `KnowledgeBase` 界面，桌面端统一使用编译化 `DataTwinCenter.tsx` 面板进行数据检索。

---

# §4. 全栈模块开发指南与脚手架契约 (Scaffold & Dev Guide)

## 4.1 新增模块八层契约清单

开发或 review 任何业务模块，**必须**严格遵循 [MODULE_CONTRACT.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/MODULE_CONTRACT.md) 的八层自查清单：

```markdown
- [ ] 1. 数据层: schema.prisma 声明模型 (BigInt 时间戳 + String ID + 关联字段快照)
- [ ] 2. API 层: 蛇形命名端点 (写动作加审计日志，单段字面量路径前置于 /:id)
- [ ] 3. 同步层: entities/sync.ts 增加双写函数，限制使用 9 种规范 linkKind
- [ ] 4. 审批层: 敏感/写操作工具默认加 risk='high' + safety.approval='risk_based' 拦截
- [ ] 5. Agent层: 4 处同步 (manifest.ts + defaults.ts + toolRuntime.ts + e2e-agent-test.ts)
- [ ] 6. Planner: planner.ts 注册中英双语正则触发路由规则
- [ ] 7. 测试层: npx tsx scripts/e2e-agent-test.ts 执行回归，确认无 TOOL_NOT_REGISTERED 错误
- [ ] 8. 前端层: 镜像 types ➜ 页面组件 ➜ RelatedEntitiesPanel 跨模块跳转 ➜ 模块注册
```

## 4.2 零新依赖脚手架生成器使用规范

* **脚手架路径**: [scaffold-module.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/scripts/scaffold-module.ts)
* **技术核心**: 基于原生 TypeScript 模板字符串拼接，不引入外部庞大模板库，生成文件自带 checklist。
* **开发流程**:
  1. 依据 spec 规则，在 `scaffold-module.ts` 顶部的 spec 对象中填入要开发模块的结构；
  2. 运行 dry-run 确认输出代码结构无误：
     ```bash
     npx tsx scripts/scaffold-module.ts --spec=<module_name>
     ```
  3. 执行生成写入（写至 `scaffold-output/` 目录，避免直接破坏高频修改的代码共用文件，杜绝 Git 冲突）：
     ```bash
     npx tsx scripts/scaffold-module.ts --spec=<module_name> --write
     ```
  4. 按照命令行输出的 **“待手动 Patch 的片段清单”**，人肉拷贝写入主干，完成最后接入。

## 4.3 E2E 自动化回归框架 (e2e-agent-test.ts)

* **路径**: [e2e-agent-test.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/scripts/e2e-agent-test.ts)
* **重要意义**: `tsc` 全绿和 `vite build` 成功并不能证明 Agent 侧能够合理工作（容易出现 RBAC 没漏注册但 Planner 正则错配，或者 executor 的参数解析不兼容等深水炸弹）。
* **使用守则**:
  - 每当新增新 MCP 工具或新模块，必须在此文件的 `results.push` 中新增一条用例；
  - 直接执行验证：
    ```bash
    NODE_PATH=node_modules npx tsx scripts/e2e-agent-test.ts
    ```
  - 确认所有的 Executor 回归均显示为 `success` 或 `approval_required`。

---

# §5. 物理目录与全库 concept 债务清单 (Codebase Directory & Technical Debts)

## 5.1 核心代码物理目录指引

* `/components/`: 前端主页面与视图组件
  * `Assistant.tsx` (AI 助手大页面 / 流式渲染控制)
  * `OrderManager.tsx` (大货订单管理 / 生产)
  * `DevelopmentManager.tsx` (开发管理)
  * `RelationsManager.tsx` (关系智库)
  * `ProductsManager.tsx` (数字档案)
* `/services/`: 前端对接后端的 REST 请求类服务层
* `/electron/`: Electron 主进程配置、生命周期与视口最小参数控制
* `/server/src/`: 后端核心逻辑
  * `agent/`: MCP、规划器、RBAC、安全审批及 toolRuntime 核心逻辑所在
  * `entities/`: 实体级检索、快照和跨实体 sync 双写模块所在
  * `orders/`, `development/`, `products/`, `relations/`, `finance/`: 核心业务 REST 接口

## 5.2 遗留概念债务与优化排程

为了防止随着项目扩大而导致概念漂移，在接下来的版本迭代中必须优先清理以下技术债：

```
                    Bambook 遗留概念债务三关
                       │
                       ├─► [金额精度债] (Float ➜ Decimal 改造，消解浮点核销隐患)
                       │
                       ├─► [命名脱节债] (Samples 统一更名为 Development)
                       │
                       └─► [测试覆盖债] (补齐 Garment 等子工具的 E2E 校验覆盖)
```

1. **金额精度债 (已完成)**:
   * **当前状态**: 已于 2026-06-15 完成全库金额字段从 Float 到 `Decimal @db.Decimal(18, 4)` 的重构与迁移，包含大货订单（`Order`, `OrderLine`）和开发管理等全量历史模型，从底层彻底清除了浮点数舍入核销误差隐患。
2. **开发管理命名债务 (已完成)**:
   * **当前状态**: 已成功将 `SampleManager` 重命名为 `DevelopmentManager`，并将 `View.Samples` 整体重构为 `View.Development`，完全移除了 `Samples` 相关的旧命名空间。
3. **测试覆盖债**:
   * **当前隐患**: 存量中 `garment` 等子工具的 `e2e-agent-test.ts` 还没有完整编写校验例。
   * **整改排程**: 下一次回归测试前，在 `e2e-agent-test.ts` 补齐该板块。
