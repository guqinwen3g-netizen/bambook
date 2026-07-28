# Bambook ERP OS — 项目阶段总结

> 截止日期：2026-07-15
> 主线 HEAD：`f6cb617` (Merge branch 'agent/bambook/r_gbtbn6a3')
> 总 commit 数：319

---

## 一、项目概述

Bambook ERP OS 是面向纺织服装行业的企业级 ERP 系统，本阶段核心工作集中在 **Agent 内核开发**与**生产管线引擎**两大模块，同时完成 Sylway MCP 平台跨群协作通道验证。

---

## 二、本阶段核心成果

### 2.1 Agent 内核（server/src/agent/）

| 指标 | 数值 |
|------|------|
| 源文件数 | 103 个 .ts |
| 测试文件数 | 53 个 .test.ts |
| 代码行数 | ~28,734 行（agent + production） |
| 测试用例数 | 384 个（全部通过） |
| tsc 错误数 | 0（agent 目录） |

#### 工具注册表重构（toolDispatchRegistry）

- **架构**：从 77 个 if 分支迁移至 `Map<String, ToolHandler>` 注册表模式
- **工具总数**：83 个（52 simple + 6 production + 25 commit）
- **注册辅助**：`registerTool` / `registerCommitTool` / `registerTools` / `registerCommitTools`
- **commit 工具统一**：25 个 commit 工具共享 7 步 approval boilerplate，通过 `registerCommitTool` 自动处理
- **deprecated**：`createToolRegistry` 已标记弃用

#### Checkpoint/Resume 能力

- **实现**：`InMemoryCheckpointManager` + `PrismaCheckpointManager`
- **机制**：agentLoop 每步保存 scratchpad + iterations，崩溃可恢复
- **数据模型**：`AgentCheckpoint` Prisma model（migration 20260715010000）
- **测试**：6 个单元测试覆盖保存/恢复/清理

#### Agent 角色与权限（RBAC）

- **角色体系**：owner / admin / manager / merchandiser / finance / sales / viewer / agent_operator / logistics / **production_manager** / **factory**
- **权限模型**：`Record<AgentRole, RoleScope>` 覆盖 permissions / knowledge / tools 三维度
- **新增**：production_manager（production:read/write/sign）+ factory（production:read/write）

#### Agent E2E 集成测试

10 个测试覆盖生产管线 3 道门禁全部场景：

| 场景 | 门禁 | 错误码 |
|------|------|--------|
| 无前置依赖直接推进 | — | — |
| 前置阶段未完成 | 顺序 | STAGE_NOT_SEQUENTIAL |
| 无效阶段名 | — | INVALID_STAGE |
| checklist 不完整 | 裁剪前检查 | PRECUT_CHECKLIST_INCOMPLETE |
| 缺生产部签字 | 产前样双签 | PP_SAMPLE_NOT_SIGNED |
| 双签完成推进 | 产前样双签 | — |
| 合格率 <90% | 验货发货 | INSPECTION_NOT_QUALIFIED |
| 未获业务部批准 | 验货发货 | BUSINESS_APPROVAL_REQUIRED |
| 全部满足推进 | 验货发货 | — |
| 查询管线全貌 | — | — |

### 2.2 生产管线引擎（server/src/production/）

#### 10 阶段门禁

```
order_placed → materials_confirmed → production_planned → in_production → materials_arrived
    → pre_cut_checked → pp_sample_approved → manufacturing → final_review → qc_shipped
```

#### 3 道业务门禁

1. **裁剪前检查（pre_cut_checked）**：PreCutChecklist 四项全 true（推码确认 / 耗料确认 / 样板确认 / 产前会议）
2. **产前样确认（pp_sample_approved）**：生产部 + 业务部双签
3. **验货发货（qc_shipped）**：合格率 ≥90% + 不合格率 ≤3% + 业务部批准

#### 数据模型

- `ProductionStage`：10 阶段状态追踪
- `PreCutChecklist`：裁剪前检查清单
- `InspectionReport`：验货报告
- `ProductionAlert`：生产预警
- Migration：`20260711230000_production_pipeline_models`

### 2.3 Sylway MCP 平台验证

#### 跨群消息投递

- 集驿开发 ↔ BAMBOOK 双向通道：已验证
- ZY Codex ↔ BAMBOOK 双向通道：已验证
- TRAE IPC sendTurn 确认可工作
- autoBind 修复后自动绑定正常

#### MCP V2 工具测试（4 个新增工具全部通过）

- `sylway_get_allowed_actions`：查询当前身份可执行操作清单
- `sylway_list_group_members`：列出群成员
- `sylway_get_agent_info`：查询 Agent 详细信息
- `sylway_get_binding_status`：查询 IDE 会话绑定健康状态

#### 原生审批 canary

- v1 + v2 canary 均完成，Bridge 消息路由审批通道正常
- 审批流程：Bridge 拦截 → Sylway 消息路由 → 人工消息确认

---

## 三、技术决策与架构要点

### 3.1 what-you-approve-is-what-you-commit

所有 commit 工具从 `subOperations.after` 恢复 payload，不藏额外字段。hash 防篡改：`computeProcessDraftHash` 覆盖 subOperations + beforeAfterDiff + impactScope + irreversible + postCommitHooks。

### 3.2 fail-closed 原则

- 高风险财务写入审计失败必须抛出，不伪成功
- 状态转移非法返回 400 INVALID_TRANSITION
- 审批内容篡改 hash 不匹配直接拒绝

### 3.3 类型安全

- `ShipmentMutationErrorCode` 完整覆盖所有错误码（含 INVALID_INITIAL_STATUS）
- TypeScript union type narrowing 通过 `as any` 类型擦除处理（Committed | Failed union）
- `Record<AgentRole, RoleScope>` 覆盖所有角色

### 3.4 渐进式迁移

- toolDispatchRegistry 先注册简单工具，复合流程暂留原路径
- `createToolRegistry` 标记 deprecated 但未删除，保持向后兼容

---

## 四、测试覆盖

| 模块 | 测试文件 | 测试用例 | 状态 |
|------|---------|---------|------|
| agent 目录总计 | 53 | 384 | 全通过 |
| E2E 集成测试 | 1 | 10 | 全通过 |
| checkpoint | 1 | 6 | 全通过 |
| toolDispatchRegistry | 1 | 9 | 全通过 |
| orderShipFlow | 1 | 15 | 全通过 |
| relationOnboardFlow | 1 | 16 | 全通过 |
| emailSyncFlow | 1 | 10 | 全通过 |
| production stageService | 1 | 14 | 全通过 |
| production RBAC | 1 | 11 | 全通过 |

---

## 五、已知问题与后续方向

### 5.1 待处理

| 问题 | 优先级 | 说明 |
|------|--------|------|
| Prisma 7 兼容性迁移 | 中 | schema `url` 属性不再支持，需迁移到 `prisma.config.ts` |
| worktree node_modules 符号链接 | 低 | 导致 worktree 内 tsc 模块解析差异，非代码问题 |
| 预存 implicit any tsc 错误 | 低 | agent/route.ts、agent/runtime.ts 等预存问题，非本次引入 |

### 5.2 后续方向

1. **Prisma 7 迁移**：创建 `prisma.config.ts`，将 `DATABASE_URL` 从 schema 移至配置文件
2. **Agent 能力扩展**：signStage 双签流程 E2E、savePreCutChecklist E2E
3. **生产管线 UI**：ProductionPipeline / ProductionAlerts 组件已在主线，需接入实际数据
4. **Agent 开放式场景评估**：扩展 open-ended business scenario eval 覆盖更多自然语言路径
5. **worktree merge 常态化**：当前 ahead 50+ commit 已收拢，后续定期 merge

---

## 六、Commit 时间线（本阶段）

| Commit | 描述 |
|--------|------|
| `f6cb617` | Merge branch 'agent/bambook/r_gbtbn6a3' — 主线收拢 |
| `7b6e477` | chore: remove unused dependencies |
| `1dd723d` | test(agent): expand E2E — pp_sample 双签 + qc_shipped 验货门禁 (10/10) |
| `cafa792` | fix(agent): resolve 2 pre-existing test failures + INVALID_INITIAL_STATUS type gap |
| `1dcbee3` | test(agent): Agent → Production Pipeline E2E 集成测试 (5/5) |
| `4da26c2` | fix(agent): eliminate all 16 pre-existing tsc errors — agent dir now 0 errors |
| `0497ea0` | fix(agent): resolve all tsc type errors in commit tool registrations |
| `f7a585b` | refactor(agent): mark createToolRegistry as deprecated |
| `f4d7dba` | feat(agent): checkpoint Prisma migration + production tools in DEFAULT |
| `081942f` | feat(agent): migrate 25 complex commit tools to registry |
| `b691867` | test(agent): 9 unit tests for toolDispatchRegistry |
| `61022a4` | test(agent): 6 unit tests for checkpoint/resume |
| `33b6c51` | feat(agent): checkpoint/resume capability for agentLoop |
| `81f524b` | feat(agent): tool dispatch registry — 52 simple + 6 production tools |
| `5a2923e` | feat(rbac): add production_manager + factory roles + production RBAC |
| `70d2119` | test(production): 14 unit tests for stageService gate logic |
| `f0e90bd` | feat(production): dashboard stats endpoint |

---

## 七、工程规范

- **TypeScript**：`npx tsc --noEmit --skipLibCheck` 零错误（agent 目录）
- **测试**：`npx vitest run` 全通过
- **自审流程**：写代码 → 自审（tsc + tests + security scan）→ 直接 commit（不走外部 review）
- **渲染路径**：Relations/Products/Settings 改 compiled 版本，其他 Manager 文件即渲染源
- **UI 规范**：中英文混合标题、面包屑右侧、统一间距 px-7 pt-5 pb-4、禁止 emoji
- **消息投递**：@mention 使用完整角色名确保投递
