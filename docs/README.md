# Bambook 文档导航唯一入口

> 本文件是全仓工程文档的**唯一导航真源**（2026-08-27 重建，经 16 路并行全文评审后收编）。
> "唯一真源 / 权威"称号只能由本表授予；不在表内的文档一律视为参考或历史。
> 文档与代码冲突时，**以代码为准**——数据结构看 `server/prisma/schema.prisma`，渲染看各 Manager 组件。

---

## 一、真源地图（按"你要回答什么问题"找文档）

| 你要回答的问题 | 唯一真源 | 说明 |
|---|---|---|
| 产品是什么 / 不做什么 | `docs/design/01-产品总览/1. 产品定位与愿景.md` + `docs/design/08-集成与边界/系统边界声明.md` | 定位叙事 + 5 项永不清单 |
| 系统现在有哪些能力 | `docs/BUSINESS_CAPABILITY_MATRIX.md` | 能力矩阵 v2.0（v0.8 十九板块验收口径） |
| 验收标准是什么 | `docs/design/09-路线图与技术债务/2026-08-21-v0.8交付验收剧本.md` | S1 主链闭环 / S2 可追溯 / S3 权限三条铁律 + 走查矩阵 |
| 代码在哪里 / 怎么跑 | `docs/CODE_WIKI.md` | 32 模块注册表 + 197 模型地图，HEAD 基线随增量滚动刷新 |
| 新增模块要改哪几层 | `docs/MODULE_CONTRACT.md` | 八层契约 + 反模式存照表，工程宪法 |
| 业务规则怎么办 | `docs/design/03-业务规则/业务规则总览.md`（22 条矩阵）+ 同目录 MOQ / 价格审批 / 信用控制 / 质量门禁 / 订单变更 / 交期生产 / 事件联动七篇 | 行业规则的裁决出处 |
| 数据结构是什么 | 代码即真源：`server/prisma/schema.prisma`；导航用 `docs/design/02-数据模型/实体关系总览.md` | 总览的模型计数滞后，分组框架仍有效 |
| 页面长什么样 / 怎么交互 | UI 铁律见 `.trae/rules/project_rules.md`「设计系统」节；规格用 `docs/design-system/component-application-spec.md` + `page-skeleton-spec.md` + `page-consistency-ledger.md` | BDS v2.2 三主干；token 权威 = `styles/os-vnext.css`，渲染准源 = `styles/flat-experimental.css` |
| 组件怎么选 | `docs/design/06-组件规格/BDS组件族7规格.md` + `布局构建语言.md` | 含 check-design-tokens 守卫断言映射 |
| 这个模块的设计细节 | `docs/design/04-模块设计/<域>/<模块>/模块概述.md` | 每域一篇入口，实现状态注记基本可信 |
| 为什么这样设计 | `docs/design/10-评审与决策/2026-08-16-设计评审决策记录.md` | DR 决策台账，只追加不重写 |
| 多会话怎么协作 | `.trae/rules/project_rules.md` + `docs/design/10-评审与决策/2026-08-17-多会话协同推进纪律.md`（机制层：三绿/单写者/worktree/断言先行） | W0-W5 波次表已走完，机制仍然生效 |
| Agent 能力边界 | `docs/design/04-模块设计/07-AI助手/Agent能力分层L0-L6.md` + `写操作工具集.md` + `审批与human-in-the-loop.md` | L0-L6 分层 + ProcessDraft 三阶段幂等闭环 |
| 部署怎么做 | `.trae/rules/project_rules.md`「Mac Mini 部署」节 + `docs/design/08-集成与边界/OPSPanel与MacMini部署拓扑.md` | push-based tarball，勿用 SSH，勿信 GitHub-pull 旧 SOP |
| 成功指标怎么定 | `docs/design/09-路线图与技术债务/成功指标.md` | B1-B4 / S1-S3 定义与阈值 |
| 外部集成 / 移动端 | `docs/design/08-集成与边界/`（5 篇全为长期契约） | Webhook / 开放 API / QC PWA 边界 |
| 工作区纪律 | `docs/WORKSPACE_HYGIENE.md` | 版本化资产边界，长期生效 |

## 二、动态状态住址（防止状态类信息腐化）

- **当前 HEAD / 测试基线 / 波次进展** → 只住在 `.trae/rules/project_rules.md`（每会话强制注入）
- **缺口优先级与剩余项** → `docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md` 的未消费部分
- **待拍板决策** → DR 台账追加；REQ2-11 双抬头分账待决点 D-1~D-5

## 三、写作纪律（关水龙头）

1. 会话收尾**禁止默认新建**收尾报告 / 阶段清单 / 规划类新文档。产出只允许三种：更新现有真源的对应小节、向 DR 台账追加条目、更新 project_rules.md 动态行。
2. 一次性快照确需留存 → 直接写入 `docs/archive/superseded/` 或该目录同级新快照目录，不进主视线。
3. 新文档若自封权威而未登记本表 → 无效，评审时直接归档。

## 四、归档

`docs/archive/superseded/`（2026-08-27 大扫除迁入 27 份失效文档：旧权威 ×3、一次性报告 ×12、compiled 时代产物 ×8、无锚点前瞻稿 ×4）。判定依据见该目录 README。git 历史完整保留，可追溯恢复。

## 五、已知欠账（按需排队，不阻塞主线）

1. `docs/design/00-索引.md` 进度表失真（停在 08-17 且自相矛盾），需一次校准或降级移除
2. compiled 双路径叙述残留在约 8 篇 KEEP-REF 文档（产品总览 2/3/9 号、Relations、Dashboard、UiLab 等），须统一清创
3. 近两批业务能力（出运批次门禁 / 催款四级 / 专属面料 / 退换货）在业务规则、数据模型、模块设计三处均待增补
4. 自动评分两套交期扣分口径冲突（factoryService vs REQ2-10 文档），需以代码为准修正其一
