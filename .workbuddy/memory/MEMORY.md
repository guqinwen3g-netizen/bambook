# Bambook 项目长期记忆

## 架构红线（必须遵守）
- **Mac Mini 数据中心 = 所有计算和数据**，客户端只是展示层
- Agent 运行在 Mac Mini 上，通过 Cloudflare Tunnel 公网暴露
- **绝不在本地搭建数据库或启动后端服务器**
- 公网 API 基地址：`https://jiangsupanda.com/bambook/api`
- 认证方式：`X-Bambook-API-Key` header 或 Bearer auth token

## 设计语言体系
- 项目严格遵循 BAMBOOK_OS 设计令牌系统
- 所有 UI 必须通过 osCompiler / osVNext 原语构建
- 任何改动不能让 Agent 部分偏离设计语言

## Agent 中栏渲染铁律（Phase 12，2026-06-15 确立）
从 WorkBuddy/Codex/Trae/OpenAI Work 四款主流 Agent 截图提取的 7 条铁律，所有中栏改动必须遵守：
1. **工具调用 = 行内注解**（图标+单行文字+▼可折叠），无背景无边框无圆角容器
2. **整条消息 = 一份流式文档**，不是堆叠的独立功能模块
3. **身份锚点必须存在**：头像+名字+badge（思考中/时间）
4. **答案不被包裹**：markdown 直接渲染为裸段落，不包 container div
5. **操作栏常驻底部**：复制/👍👎/分享 固定在消息最下方
6. **代码/数据 = monospace 轻底色**，与正文拉开层级但不抢戏
7. **空白是唯一分隔符**，不用 border/divider/横线
- 渲染器：`AgentDocumentRenderer.tsx`（Phase 12 新建，取代 `AgentResponseRenderer`）
- 旧的 `<!-- agent-process -->` 机制和 AgentTimeline 折叠面板已在 Phase 11 退役

## Agent 工具调用机制（关键，修订版）
- **生产路径** = `runner.ts → orchestrator.run() → knowledge.search() → searchContext() → planMcpToolCalls() + runMcpPlan()`，**完全规则化**，LLM 不参与工具调用决策
- LLM 看到的工具描述是 `runner.ts.AGENT_LOOP_TOOL_DESCRIPTORS` —— **但仅在 `BAMBOOK_AGENT_LOOP=1` 时**才走 agentLoop/llmPlanner 路径。生产环境（Mac Mini launchd）该环境变量**未设置**
- 规则化 planner 入口：`agent/mcp/planner.ts.planMcpToolCalls()`，内部用 `extractOrderQuery` / `inferOrderFilters` / `extractRelationSubject` / `buildRelationQueryInput` 等结构化抽取函数生成入参
- 已知坑：`agent/toolRuntime.ts.planAgentToolCalls()` 是早期 legacy 规划器，曾经会把整句 query 透传给工具（已于 2026-06-14 删除订单/关系分支）；`SINGLE_STEP_TOOLS` 去重器会让先入队的步骤覆盖后入队的精确步骤
- 工具调用历史存在 PostgreSQL 的 `AgentToolRun` 表（input/output 完整 JSON），是 debug Agent 行为的首选信源
- **判定走哪条路径的指纹**：审计表里 `input.limit=5` + `input.query=整句中文` 是 legacy `mapLegacyToolCall` 的特征；`input.filters` 字段齐全是 `planMcpToolCalls` 主路径

## 远程运维能力（已掌握）
- **OPS Token**: 存在 macOS Keychain，service=`bambook-ops-token`，用 `security find-generic-password -s "bambook-ops-token" -w` 读取
- **OPS Panel 公网地址**: `https://ops.jiangsupanda.com`，所有 API 都需要 `X-Bambook-Ops-Token` header
- **远程命令**: `POST /api/dev/jobs` body `{command, label}` → 返回 `job.id` → `GET /api/dev/jobs/{id}` 取结果。返回字段叫 `output`（不是 stdout/stderr），里面同时合并 stdout 和 stderr。**注意**：output 字段含未转义换行符，jq/python json 解析会失败，建议用 OPS Files API 中转：把结果重定向到 `/Users/panda1/bambook-main-api/_xxx.txt`，再 `GET /api/dev/files?path=_xxx.txt&workspace=server`
- **远程文件**: `/api/dev/files` 是 GET only；写文件要用 `POST /api/dev/files/write`，**workspace 限定**在 server/repo/opsPanel 三个根目录里（`/tmp` 不允许）
- **Main API 端口与路径**: Mac Mini 内网监听 `127.0.0.1:8081`（来自 `.env.local` 的 PORT=8081），路由前缀 `/api/agent/...`；公网经 Cloudflare 暴露后路径前缀变成 `/bambook/api/agent/...`
- **API Key**: Main API 认证 header 是 `X-Bambook-API-Key`，值来自 `.env.local` 的 **`BAMBOOK_SDK_KEY`**（不是 `BAMBOOK_API_KEY`）
- **部署**: 本地跑 `bash scripts/ops-upload-package.sh` → 自动 keychain 取 token → 打包 server 源码 → POST `/api/admin/deploy-package` → Mac Mini 自动重启 Main API
  - **关键事实**：deploy hook **在远端自动跑 tsc 编译 src/→dist/**，本地不需要预先 build。验证方式是看 dist/ 时间戳是否新于 src/ 时间戳一两秒
  - 部署后探测 schemaVersion / API 行为变化时，**必须从 Mac Mini 内网 `127.0.0.1:8081` 走真 API key**（用 OPS Jobs API 跑 curl），不要走公网 `jiangsupanda.com`，因为本地没有 `.env.local` 的真 key，会被认证中间件容错放行成精简版响应误导你
- Mac Mini 主 API 路径: `/Users/panda1/bambook-main-api`（不是 git 仓库，靠上传包同步）
- launchd 服务名: `com.bambook.main-data-api`，KeepAlive=true（自动拉起），plist 在 `~/Library/LaunchAgents/`

## Agent 开发纪律（必须遵守）
- **严禁在 Agent 调教、planner、prompt、inputHint、示例、测试验证脚本里写入真实客户名/公司名/PO/物料号等具体业务实体作为特例或示例**
- 做 Agent 能力修复时只能使用通用占位符、抽象 schema、泛化语法规则和跨场景验证；不得以单个客户/订单成功作为能力证明
- 若发现历史改动里有真实业务实体示例，必须移除或替换为占位符后再部署

## 交付战略（2026-08-20 Kevin 决策，重大）
- **产品定位**：Bambook = Agent OS（自带 Agent 的系统），但 **Agent 不是第一轮验收的必交付物**。
- **第一轮（上线优先）**：先把软件上线，业务由业务员**人工录入/跑流程**驱动；目标是「能用、数据准、不崩」，UI 美观度（配色/大小/圆角）可降级后续精修。
- **第二轮**：再把 Agent 智能体接入实现自动化。因此所有为 Agent 服务的增强（Agent 门禁引擎、通知中心、planner/中栏铁律打磨、C 方案）第一轮一律后置/降级。
- **背景压力**：项目已延期交付约 1 个月，甲方（接收方公司）非常急迫，必须最快上线让人用。
- **质量红线（可降级 UI 但不可降级）**：数据不丢不串、金额/汇率/单位换算(米/码/公斤)正确、人工操作留痕。
- **对 coding Agent 的 KPI 调整**：从「L3 生产打磨」切到「L1/L2 人工能跑通」，避免每功能过度打磨拖慢整体上线。
- **验收清单原则**：从甲方主链路（打样→大货订单→生产跟进→质检→出货→收付款）倒推最小集，不做「需求池全做」；非核心域（Tech Pack 花式解析、破产货权、离职交接、HR 页面、通知中心）第一轮砍/缓。

## 长期改造待办
- **C 方案**: 把规则化 planner (`planMcpToolCalls` + `planAgentToolCalls`) 替换为 LLM-based planner，ToolManifest.inputSchema 升级为真正的 JSON Schema，让 LLM 看 schema 自主规划
- 触发条件: 当窄规则补丁数量增加到 3+ 处时启动 C 改造
- 也可以考虑：为生产环境打开 `BAMBOOK_AGENT_LOOP=1`，让流量直接走已经升级好 inputHint 的 llmPlanner 路径，淘汰旧 orchestrator

## Agent Command Center 升级进度（Phase 1-7 已完成，2026-06-14）
- Phase 1：Response Blocks 协议 + 后端 SSE block_start/block_delta/block_patch/block_end 输出
- Phase 2：AgentSessionContext 统一前端状态机（idle/running/streaming/blocked_for_approval/editing_artifact/awaiting_user_input/completed/failed）
- Phase 3：`GET /api/agent/tool-runs/:id` 审计接口；Reference Workspace 真实 ToolRun hydration
- Phase 3.2-5：Tool / Evidence / Table 联动；Artifact Workspace；前端 HITL Action Dispatcher
- Phase 5.1：审批态 placeholder/banner、ToolRun risk pill 高亮、刷新审计 loading 防连击、editableFields 模板
- Phase 6：`POST /api/agent/approvals/:id/resolve` 接口 + AuditLog 落地；ToolRun 详情同源返回 approval；前端 approval dispatcher 真实落库
- Phase 7：ToolManifest 升级（name/inputHint/safety），manifest 与 LLM ToolDescriptor 同源；`/api/agent/mcp/manifest` 暴露 schemaVersion + summary（total/byDomain/byRisk/approvalRequired）
- 严格红线：未打开 `BAMBOOK_AGENT_LOOP`，未改动生产 `planMcpToolCalls`，所有真实业务实体已脱敏
