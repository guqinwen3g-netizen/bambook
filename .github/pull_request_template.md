<!--
  Bambook PR Template
  规范来自 docs/MODULE_CONTRACT.md。
  新增模块/工具/跨实体关系 → 对应章节自查；纯修 bug 可只填 §A + §G。
-->

## §A 改动概要

<!-- 一句话说明：这个 PR 解决什么问题/加什么能力。 -->

**类型**（勾选）：
- [ ] 🐛 Bug 修复
- [ ] ✨ 新增模块（走 §B 全栈契约）
- [ ] 🔧 新增 MCP 工具（走 §C Agent 4 处同步）
- [ ] 🔗 新增跨实体关系（走 §D linkKind 登记）
- [ ] ♻️ 重构 / 性能 / 文档

**关联 issue / 任务**：

---

## §B 新增模块自查（如果 type = 新增模块）

> 完整契约见 `docs/MODULE_CONTRACT.md` §3 PR 模板。可用 `npx tsx scripts/scaffold-module.ts --spec=<name>` 生成 PR Checklist 后粘贴在这里。

### L1 数据层
- [ ] `prisma/schema.prisma` 新增 model
- [ ] `npx prisma migrate dev --name add_<module>` 已跑
- [ ] seed/demo 数据已补（如需要）

### L2 API 层
- [ ] `server/src/<module>/route.ts` 已建
- [ ] `server/src/index.ts` 已注册路由
- [ ] mutation 端点接入对应 `sync<Module>References`
- [ ] 错误码使用统一格式（CREATE_FAILED / NOT_FOUND / 业务码）

### L3 EntityLink 同步
- [ ] `server/src/entities/sync.ts` 已新增 `sync<Module>References`
- [ ] 新增 linkKind 已登记到 `MODULE_CONTRACT.md §L3 R3.1` 表格
- [ ] EntityLink ↔ EntityReference **1:1 双写**（不能只写一边）

### L4 审批
- [ ] 高风险 mutation 工具的 `manifest.safety.approval = 'required'`
- [ ] approvalRoles 在 defaults.ts 已设置

### L5 Agent 4 处同步（最易踩坑）
> 这是历史 P0 问题集中区。**任意 1 处漏 → TOOL_NOT_REGISTERED 或 planner 不触发**。

- [ ] `server/src/agent/mcp/manifest.ts` MANIFEST_SEEDS 增加工具定义
- [ ] `server/src/agent/defaults.ts` DEFAULT_AGENT_TOOLS 增加 RBAC 注册（**最常漏**）
- [ ] `server/src/agent/toolRuntime.ts` dispatch + 实现函数
- [ ] `server/src/agent/mcp/planner.ts` 中英对照触发规则（如果是新 domain）

### L7 测试
- [ ] `server/scripts/e2e-agent-test.ts` EXECUTOR_CASES 加用例
- [ ] `server/scripts/e2e-agent-test.ts` PLANNER_CASES 加触发用例（如果是新 domain）
- [ ] `npx tsx scripts/e2e-agent-test.ts` **全绿**

### L8 前端
- [ ] 模块组件 `<Module>Manager.tsx` 已建
- [ ] moduleRegistry 已注册
- [ ] DetailPanel "关联视图"已识别本模块 entity type

---

## §C 新增 MCP 工具自查（如果只加工具不加新模块）

参考 `docs/MODULE_CONTRACT.md §4` 的 5 行版 checklist：

- [ ] manifest.ts: 加 ToolManifest（含 description / inputHint / example）
- [ ] defaults.ts: 加 DEFAULT_AGENT_TOOLS RBAC 项
- [ ] toolRuntime.ts: 加 dispatch case + 实现函数
- [ ] planner.ts: 触发规则（如果是该 domain 第一个工具或新触发场景）
- [ ] e2e-agent-test.ts: 加 1 个 executor 用例

---

## §D 新增跨实体关系自查（如果加新 linkKind）

参考 `docs/MODULE_CONTRACT.md §L3`：

- [ ] linkKind 命名遵循驼峰 + 动词起头（`aboutX` / `belongsToX`）
- [ ] `entities/sync.ts` 双写 EntityLink + EntityReference
- [ ] `MODULE_CONTRACT.md §L3 R3.1` 登记表格已更新
- [ ] 反向查询路径（`links.query` 双向）已验证

---

## §E 反模式自查

参考 `docs/MODULE_CONTRACT.md §6`：

- [ ] 没有用大小写不一致的 type 字面量（如 `'Contact'` vs `'contact'`）
- [ ] 没有用 demo 风格的硬编码 ID（如 `DEMO-LINK-*`）
- [ ] EntityLink 不是单写（必须 link + reference 一起写）
- [ ] 没有为单测加特例补丁（参考用户全局原则：避免狭窄规则）

---

## §F 踩坑沉淀（强制）

> **这个 PR 如果踩了任何意料之外的坑**，必须在合并前把它写到 `docs/MODULE_CONTRACT.md §6 反模式表` 或新建一条 R 规则。

- 本 PR 踩坑：（如无可填"无"）

---

## §G 验收

- [ ] `npx tsc --noEmit` 在 server / desktop-app 均通过
- [ ] `npx vite build`（前端）通过
- [ ] `npx tsx scripts/e2e-agent-test.ts` 通过（如果改了 Agent）
- [ ] 数据回归：EntityLink ↔ EntityReference 1:1 对齐（如果改了关系）
- [ ] 自测过的关键场景：

---

## §H 截图 / 日志（可选）

<!-- 前端改动建议放截图；Agent 改动建议放 e2e 输出。 -->
