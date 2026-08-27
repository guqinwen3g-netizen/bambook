# 📋 Bambook 项目状态对账（PROJECT_STATE）— 2026-06-15

> ⚠️ **2026-06-15 14:44 — 本文档降级为参考草稿，不再作为 audit 主交付物**
>
> 原因：Kevin 在审稿时指出，连两份"权威"文档（`Bambook_Master_Specification.md` + `ARCHITECTURE.md`）都把"本地内嵌后端"这条**离线 fallback** 错误标成了**主架构**。这意味着 agent 单方面给 49 份文档打 live/stale/drift 标签的方法论本身有缺陷 —— **agent 用一份可能错的文档去校对另一份可能错的文档，结果只能是错上加错**。
>
> 正确做法是**只列代码事实，不打文档对错**，把判断留给人或外部审核者。
>
> **请改用 [`CODE_TRUTH.md`](./CODE_TRUTH.md)** —— 它只列从代码 grep 出来的事实（44 工具 / 18 路由 / 54 模型 / 4 LaunchAgent），任何审核者都能复跑命令验证。
>
> 本文件保留作为参考（其中识别的"多权威源"、"task.md 重复"、"路线图未回写 4a/4b/5a" 等观察仍然有效），但**不再扩写、不再 review、不再作为决策依据**。

---

# 📋 Bambook 项目状态对账（PROJECT_STATE）— 2026-06-15（参考草稿）

> **目的**：把 49 份现有文档与代码 ground truth 做一次系统对账，划分每份文档的真实生命周期状态。本文件是 **2026-06-15 的快照**，不是要长期维护的活文档；下次盘点时新建 `PROJECT_STATE_<日期>.md`，本份归档。
>
> **不做什么**：不补写新设计文档、不下战略判断、不建议大重构。只做诊断 + 标签。
>
> **作者**：AI agent（基于 Read/Grep/Bash 只读扫描）+ Kevin review。
>
> **覆盖范围**：49 份 Markdown（排除 node_modules / dist / scaffold-output / models / .workbuddy 自动记忆）。

---

## 0. 状态标签定义

| 标签 | 含义 | 行动建议 |
|---|---|---|
| 🟢 **LIVE** | 文档与代码一致，仍是有效参考 | 保留，例行维护 |
| 🟡 **DRIFT** | 文档承诺与代码现状部分脱节，但核心仍可用 | 在文档顶部加"代码现状与本节描述差异"备注；不立即重写 |
| 🟠 **STALE** | 文档明显落后代码或被新文档替代，仍在 active 区误导读者 | 移到 `archive/` 或合并进权威源 |
| 🔵 **ORPHAN** | 文档没有从 `docs/README.md` 索引地图链入，半失踪状态 | 登记进索引或归档 |
| ⚫ **ARCHIVED** | 已在 `archive/` 目录，仅作历史参考 | 不动 |
| 🔴 **CONFLICT** | 多份文档在同一主题上互相冲突 | 必须合并或明确分工 |

---

## 1. 关键发现（Top 8，按严重度）

### 🔴 1.1 多份文档同时声称"权威单一源"

| 文档 | 自称 |
|---|---|
| `docs/Bambook_Master_Specification.md` | "项目超级白皮书 / 终极权威单一源" |
| `docs/MODULE_CONTRACT.md` | "PR review 的勾选清单 + scaffold 生成器的 source of truth" |
| `docs/README.md` | "文档索引地图 / 第一真源" |
| `手动输入修改计划备忘录.md` | "最高战略真源" |

**已修正**（本轮）：在 `docs/README.md` 顶部加了"单一权威源约定"表格，明确各自分工，告知"代码冲突时以代码为准"。

---

### 🟡 1.2 `Bambook_Master_Specification.md` 把"已完成债务"当日记写

证据：`§5.2 遗留概念债务与优化排程` 同时陈述"金额精度债（已完成）"、"开发管理命名债务（已完成）"——这是**事件性记录**，不属于静态白皮书的内容。一旦未来再有"X 债已完成"的条目，白皮书会越长越乱。

**建议**：剥离 §5.2 中已完成项到 `CHANGELOG.md`（新建，5 行就够）；白皮书只留"未完成债务"。**本轮不动**，留待 Kevin 决策。

---

### 🟡 1.3 `AGENT_RUNTIME_ARCHITECTURE.md` 描述的"理想工具集"与代码命名分裂

文档（§4.2，第 102-116 行）承诺工具应收敛到：
```
relations.query / relations.get / relations.expand
products.query / products.get / products.expand
orders.query / orders.get / orders.expand
knowledge.search
email.query / email.draft / email.execute
```

代码 `manifest.ts` 实际工具命名（44 个 seed）：
```
✅ 已对齐：relations.{query,get,expand}, products.{query,get,expand}, orders.{query,get,expand}, knowledge.search
⚠️ email 子域命名不一致：
   email.list / email.search / email.get / email.sync / email.link_to_order / email.ai_extract
   ↑ 没有按 query/draft/execute 三段收敛，是动作粒度而非语义粒度
⚠️ 新增的子域文档未提及：
   development.* (4 个)
   finance.* (8 个)
   shipping.* (4 个)
   garment.* (2 个)
   entities.* (2 个)
   links.* (2 个)
   orders.{batch_status, get_timeline, kanban, list_by_status, update_status}（不在 query/get/expand 之列）
```

**结论**：文档是"理想态目标"，代码是"实际演进态"。两者都不是错的，但**索引文档要明确说"理想态命名是方向，实际命名以代码为准"**——已在 `docs/README.md` 顶部加注。

**长期修复**（不在本轮）：要么把代码命名收敛回理想态（成本高，破坏前端）；要么修订 ARCHITECTURE 文档承认实际命名（成本低）。**推荐后者**。

---

### 🟠 1.4 `docs/task.md`（23 行）是 `implementation_plan.md` 的早期初稿

二者目的完全重叠（都是路线图），task.md 内容是 implementation_plan 的早期子集，且都没反映 Phase 4a/4b/5a 的真实进展。

**建议**：移到 `archive/legacy/task.md`，并在 `implementation_plan.md` 顶部追加 Phase 4a/4b/5a 真实进展。**本轮不动**。

---

### 🔵 1.5 `.agent/rules.md` 与 `.agent/UI_STANDARD.md` 是孤儿文档

这两份文档（IDE 助手核心准则 + UI 审查标准）在 Bambook 项目内未被任何其他文档引用，也没出现在 `docs/README.md` 索引地图中。

**建议**：在 `docs/README.md` 添加"IDE 助手规范"小节登记。**本轮可选立刻做**。

---

### 🟠 1.6 `docs/DEPLOY_SOP.md`（我今天写的）已修正，但仍有"功能重叠"嫌疑

修正后已是"路标文件"指向 `ops-panel-runbook.md`，但严格说一份"路标短文档"也是认知负担。

**建议**：观察 1-2 周，如果新成员入职时确实更倾向于先看 `DEPLOY_SOP.md`（短）再点开 runbook（长），就保留；否则合并进 `docs/README.md` 的 Backend & Ops 段落。

---

### 🟢 1.7 设计系统 12 份文档体系完整，无明显漂移

`docs/design-system/` 下 12 份文档（README + 11 份具体规范）相互引用一致，与 `components/ui/bambookOsTokens.ts` 等代码 token 同步。

**结论**：设计系统是**唯一一个文档/代码完全对齐的子领域**。可以作为其他领域的参照。

---

### 🔴 1.8 文档"产出能力"远超"维护能力"

证据：
- 49 份 Markdown，其中 **30 份在 2026-06-15 当天被 touched**（mtime）—— 说明今天大量文档被批量更新过，更新质量不可知。
- `Bambook-Agent-OS-使用说明书.md` 598 行（用户手册）+ `Bambook_Master_Specification.md` 316 行（白皮书）+ `MODULE_CONTRACT.md` 508 行 —— 三份核心都在 ~300-600 行量级，**没有任何一份能在 5 分钟内读完**。
- 没有任何"自动从代码生成的文档"（如工具清单、路由清单）—— 全部靠人手维护。

**根因**：缺少"代码现状反向回写文档"的机制。

**长期修复**（推荐 Phase 5+ 优先）：建立 `npm run docs:state` 脚本，每次跑：
1. 扫 `manifest.ts` → 输出工具清单 markdown
2. 扫 `index.ts app.use` → 输出路由清单 markdown
3. 扫 `schema.prisma` → 输出模型清单 markdown
4. 写到 `docs/STATE_AUTO.md`（带 mtime 戳）

这是**唯一从根本上解决文档/代码漂移**的方法。

---

## 2. 49 份文档完整对账表

### 2.1 项目根目录（4 份）

| # | 文件 | 行数 | 状态 | 备注 |
|---|---|---:|---|---|
| 1 | `README.md` | — | 🟢 LIVE | 项目入口 |
| 2 | `手动输入修改计划备忘录.md` | — | 🟡 DRIFT | 自称"最高战略真源"，但实际多入口录入自愈逻辑大部分已落地代码，文档需要回写"已完成"标记 |
| 3 | `主数据字段边界盘点.md` | — | 🟢 LIVE | 业务规范，与 schema 对齐 |
| 4 | `.github/pull_request_template.md` | — | 🟢 LIVE | 八层契约 checklist，与 MODULE_CONTRACT 一致 |

### 2.2 `docs/`（顶层 11 份）

| # | 文件 | 行数 | 状态 | 备注 |
|---|---|---:|---|---|
| 5 | `docs/README.md` | 70 | 🟢 LIVE（本轮已增补权威源约定 + DEPLOY_SOP 登记 + Backend 段落重写） | — |
| 6 | `docs/Bambook_Master_Specification.md` | 316 | 🟡 DRIFT | §5.2 含已完成债务日记，建议剥离到 CHANGELOG |
| 7 | `docs/MODULE_CONTRACT.md` | 508 | 🟢 LIVE | 八层契约权威 |
| 8 | `docs/AGENT_RUNTIME_ARCHITECTURE.md` | 257 | 🟡 DRIFT | §4.2 工具命名理想态与代码实际命名分裂（见 §1.3） |
| 9 | `docs/MODULE_REGISTRY_PLAN.md` | 345 | 🟢 LIVE（last reviewed 2026-06-11） | — |
| 10 | `docs/ARCHITECTURE.md` | — | 🟢 LIVE | L1-L3 记忆机制描述 |
| 11 | `docs/Bambook-Agent-OS-使用说明书.md` | 598 | 🟢 LIVE | 用户手册，覆盖完整 |
| 12 | `docs/PROJECT_CLEANUP_MAP.md` | 248 | 🟢 LIVE | Samples→Development 重命名地图 |
| 13 | `docs/LEGACY_CLEANUP_INVENTORY.md` | 143 | 🟡 DRIFT | 与 PROJECT_CLEANUP_MAP 关系未明示，需要在两份文档顶部互链 |
| 14 | `docs/implementation_plan.md` | 99 |