# 🗺️ Bambook 知识库与架构文档索引地图

欢迎来到 Bambook (Panda Clothing Enterprise Agent OS) 架构与文档中心。为了避免认知污染，我们对项目中的存量文档进行了系统性审计与规整。

以下是目前**依然有效、具有权威参考价值**的文档谱系，以及已归档的历史文档说明。

> **🧭 单一权威源约定（2026-06-15 校准）**：文档体系内有多份"自称权威"的文档，本索引规定它们的真实分工 —— 避免冲突：
>
> | 维度 | 唯一真权威 | 备注 |
> |---|---|---|
> | **真实运行架构** | `Bambook-Agent-OS-使用说明书.md` §1 + `server/docs/macmini-data-center.md` | **客户端 + Mac Mini 数据中心两端分离**；`Master_Specification.md` 与 `ARCHITECTURE.md` 旧版"内嵌后端"描述已于 2026-06-15 修正 |
> | 业务全貌 / 数据哲学 | `Bambook_Master_Specification.md` | 静态白皮书，**不写"已完成债务"日记**（那是 CHANGELOG 职责）|
> | 新模块/新工具开发的强制 checklist | `MODULE_CONTRACT.md` | 八层契约，PR 模板和脚手架引用此文档 |
> | Agent 运行时行为约束 | `AGENT_RUNTIME_ARCHITECTURE.md` | 描述**理想的工具命名收敛方向**（`*.query/get/expand/draft/execute`），实际命名见代码 |
> | 实际工具集 / 路由 / 模型清单 | **代码本身** + [`docs/audit-2026-06-15/CODE_TRUTH.md`](./audit-2026-06-15/CODE_TRUTH.md) | 文档与代码冲突时，**以代码为准**；CODE_TRUTH.md 是 2026-06-15 的代码事实快照 |
> | 部署 / 重启 / 健康检查 | `server/docs/ops-panel-runbook.md` | OPS Panel 是默认通路，SSH 仅 fallback |
> | 短期路标 | `docs/implementation_plan.md` | 早期初稿 `docs/archive/legacy/task.md` 已归档 |

---

## 🧭 核心业务与架构设计 (Active)

以下文档承载了 Bambook 系统最核心的业务逻辑、数据边界与 Agent 运行法则，是开发新功能时的**第一真源**：

| 文档名称 | 物理路径 | 核心参考价值与说明 |
| :--- | :--- | :--- |
| **八层全栈模块契约** | [MODULE_CONTRACT.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/MODULE_CONTRACT.md) | **最高频引用！** 规定了新增一个模块或工具时，在数据层、API层、Agent层等 8 个层次必须同步修改的所有点位，含有标准的 PR 模板。 |
| **Agent 运行时架构** | [AGENT_RUNTIME_ARCHITECTURE.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/AGENT_RUNTIME_ARCHITECTURE.md) | 详解 Agent Orchestrator、MCP 工具流、三级记忆机制与审批流的底层架构。 |
| **前端模块单一源规范** | [MODULE_REGISTRY_PLAN.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/MODULE_REGISTRY_PLAN.md) | 规范了通过 `moduleRegistry.ts` 集中管理路由、菜单、权限和视图编译的逻辑。 |
| **系统核心架构说明** | [ARCHITECTURE.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/ARCHITECTURE.md) | 介绍 Bambook 的整体系统拓扑，建议重点阅读 **L1-L3 记忆机制** 章节。 |
| **遗留债务清洗清单** | [LEGACY_CLEANUP_INVENTORY.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/LEGACY_CLEANUP_INVENTORY.md) | 历史审计与已完成清理的记录；现行规则见工作区卫生契约。 |
| **项目清理地图** | [PROJECT_CLEANUP_MAP.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/PROJECT_CLEANUP_MAP.md) | 历史架构/命名审计记录；不作为当前删除清单。 |
| **工作区卫生契约** | [WORKSPACE_HYGIENE.md](./WORKSPACE_HYGIENE.md) | 定义可版本化资产、本地可再生成文件与 Git 历史治理的边界。 |

---

## 🎨 前端设计系统规范 (Active - Design System)

所有前端视觉、布局、材质（Glassmorphism 毛玻璃质感）的渲染依据全部收口在 `docs/design-system/` 目录下：

* **全局索引**: [设计系统总览 (README)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/README.md)
* **核心规范**:
  * [材质语法 (Material Grammar)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/material-grammar.md) — 规定了不同深度层级的毛玻璃和暗色背景渲染。
  * [布局语法 (Layout Grammar)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/layout-grammar.md) — 网格系统、侧边栏以及卡片间距。
  * [组件语法 (Component Grammar)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/component-grammar.md) — 按钮、表单、表格和态势指示灯的样式。
  * [类名所有权控制 (Class Ownership)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/class-ownership.md) — 规定哪些 CSS 类名被严格保护，不能随意更改。
  * [渲染已知问题与避坑](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/known-rendering-issues.md) — 处理毛玻璃发光和重叠阴影时的 CSS 避坑指南。

---

## ⚙️ 后端与运维部署指南 (Active - Backend & Ops)

> **部署默认路径**：所有"远程后端部署 / 重启 / 健康检查"任务，**第一选择都是 OPS Panel**（`https://ops.jiangsupanda.com/ops`），不要绕回 SSH 手工操作。详见下表 ops-panel-runbook。

| 文档 | 物理路径 | 定位 |
| :--- | :--- | :--- |
| **后端开发指南** | [BACKEND_GUIDE.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/BACKEND_GUIDE.md) | Prisma 数据库操作、API 编写、测试 |
| **演示数据填充** | [demo-data-seed-runbook.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/docs/demo-data-seed-runbook.md) | demo seed 的 Dry-run 与回滚指南 |
| **Mac mini 数据中心** | [macmini-data-center.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/docs/macmini-data-center.md) | 硬件拓扑 + SenseVoice 部署 |
| **OPS Panel 运维面板（**真权威 runbook**）** | [ops-panel-runbook.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/docs/ops-panel-runbook.md) | 21 个白名单 ops-*.sh 脚本 + 3 个 LaunchAgent + 自动部署机制 |
| **部署 SOP 路标（短文档）** | [DEPLOY_SOP.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/DEPLOY_SOP.md) | 三段式速查：① 默认走 OPS Panel ② push 后等自动部署 ③ SSH 仅作 fallback。所有详细步骤指向 ops-panel-runbook |

---

## 📂 历史归档与备忘录 (Archived)

为了防止陈旧、失效的配置和模块进度统计对新成员产生误导，我们已将以下文档移至 `archive/` 目录下。**仅作历史溯源参考，切勿作为当前开发指标**：

* **历史项目基准 (v1.0)**: [Bambook-项目基准手册-v1.0.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/archive/legacy/Bambook-%E9%A1%B9%E7%9B%AE%E5%9F%BA%E5%87%86%E6%89%8B%E5%86%8C-v1.0.md) (包含过时的模型配置与已废弃的语音说明)。
* **旧演示种子数据**: [DEMO_DATA_SEED.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/archive/legacy/DEMO_DATA_SEED.md) (已被新的 demo-data-seed-runbook 替代)。
* **临时调试备忘**: [debug-sidebar-ghost-glow.md](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/archive/legacy/debug-sidebar-ghost-glow.md) (关于侧边栏幽灵发光调试的临时记录)。
* **早期开发执行计划**: [superpowers-plans/](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/archive/superpowers-plans/) 目录下记录了 2026 年 5 月和 6 月的具体微观修复计划（如 git 初始化、orderLine 修复等），这些变动已 100% 合并入代码主线。
* **早期设计规格书**: [superpowers-specs/](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/archive/superpowers-specs/) 目录。

---

> **文档维护规范**：任何新模块、新工具或架构调整落地后，请务必同步更新对应的活动文档（如 `MODULE_CONTRACT.md`），并在此索引地图中进行登记，以保持文档与代码库的绝对一致。
