# Bambook 竹衍 - 项目基准手册

> 生成日期: 2026-05-07 | 版本: v3.0.0 | Panda Clothing 私有

> **归档更正注记**：本文为历史归档快照，正文记载的版本 "v3.0 / v3.0.0" 系早期过度自信标注。产品当前推进版本为 **v0.8**（权威源 `docs/MILESTONE_v0.8.md`），正文中的代码行数/模型数/端点数为历史时刻数值，不代表当前状态。

---

## 1. 项目概览

Bambook (竹衍) 是为 Panda Clothing 打造的企业级 AI 数字大脑，集成 ERP、知识库和自主进化智能体于一体。定位为"Not just a Chatbot, A Digital Strategy Hub"——从面料贸易的 AI 助手进化为覆盖订单管理、关系智库、数字档案、邮件系统、市场情报的全栈业务中枢。

| 指标 | 值 |
|:---|:---|
| 当前版本 | v3.0 |
| 前端代码行 | 19K+ |
| Prisma 模型 | 15 |
| API 端点 | 40+ |
| 前端组件 | 49 |
| AI 记忆层级 | 3 |
| AI 技能 | 7 |
| 部署端 | 2 (桌面 + Mac mini) |

---

## 2. 技术架构

### 2.1 前端技术栈

| 技术 | 版本/说明 | 用途 |
|:---|:---|:---|
| React | 19.2.3 | UI 框架 |
| TypeScript | 5.8.2 | 类型安全 |
| Vite | 6.2.0 | 构建工具 + Dev Server |
| Tailwind CSS | 3.4.19 | 原子化样式 |
| Three.js + R3F | 0.182.0 / 9.5.0 | 3D 生产地球可视化 |
| Recharts | 3.6.0 | 图表库 |
| Framer Motion | 12.29.0 | 动画 |
| Electron | 41.2.1 | 桌面端封装 |
| Vercel AI SDK | 6.0.49 | AI Agent 核心 |
| react-virtuoso | 4.18.1 | 虚拟化列表 |

### 2.2 后端技术栈

| 技术 | 说明 | 用途 |
|:---|:---|:---|
| Express | Node.js 服务端 | REST API |
| Prisma | ORM | PostgreSQL 数据访问 |
| PostgreSQL | 主数据库 | 所有业务数据持久化 |
| better-sqlite3 | 遗留数据库 | 旧 PO 数据只读 + Electron 离线 |
| pdf-parse | v2 ESM | PO PDF 文本提取 |
| multer | 文件上传 | PDF 批量导入 |
| nodemailer + imap-simple | 邮件 | IMAP 收信 / SMTP 发信 |
| xlsx | Excel | 发货通知单 / 样品发票生成 |
| cheerio | HTML 解析 | DuckDuckGo 搜索代理 |

### 2.3 AI 基础设施

| 组件 | 技术 | 说明 |
|:---|:---|:---|
| Agent 核心 | Vercel AI SDK (generateText) | ReAct 循环 + 多工具调用 + 自愈重试 |
| LLM 提供商 | 腾讯云 Token-Plan + 智谱 AI | 双提供商故障切换 |
| 活跃模型 | tc-code-latest / minimax-m2.5 / kimi-k2.5 / glm-5 | 4 模型路由 |
| 意图路由 | 6 类意图 + 成本追踪 + 预算降级 | config/router-rules.json 热更新 |
| L1 工作记忆 | Upstash Redis (可降级浏览器) | 20 轮自动裁剪 |
| L2 场景记忆 | SQLite (可降级 localStorage) | 用户偏好与业务惯性 |
| L3 知识库 | ChromaDB (可降级浏览器 Mock) | 向量语义检索 |
| 知识 RAG | FastAPI + pgvector + Ollama | 独立知识 API (端口 8090) |
| 语音 TTS | Edge TTS / OpenAI TTS / Browser | 默认 Edge TTS zh-CN-XiaoxiaoNeural |
| 语音 STT | 已移除 | 当前阶段不提供语音输入 |

---

## 3. 业务模块全梳理

### 3.1 视图与功能矩阵

| 视图 | 组件 | 代码行 | 功能完成度 | 说明 |
|:---|:---|:---:|:---|:---|
| Dashboard | Dashboard.tsx | 992 | 高 | KPI 卡片 + Recharts 图表 + 3D 地球 + 大宗行情 + 简报 |
| AI 助手 | Assistant.tsx | 829 | 高 | 流式对话 + 工具调用进度 + 思维链展示 + TTS + 附件 |
| 数字档案 | ProductsManager.tsx | 2181 | 中 | 面料主档 + 成分/价格/认证/客户编码 + 详情卡片 |
| 关系智库 | RelationsManager.tsx | 1441 | 中 | 组织/联系人 CRM + 组织图 + 信用等级 + ship-to |
| 大货生产 | OrderManager.tsx | 1476 | 高 | 订单列表 + 详情卡 + 行内编辑 + 字段溯源 + 集群分组 |
| 样品管理 | SampleManager.tsx | 75 | 低 | 占位页面，尚未形成独立数据模型 |
| 邮件系统 | EmailManager.tsx | 1737 | 高 | IMAP 收信/SMTP 发信/搜索/星标/移动/附件 |
| 知识库 | KnowledgeBase.tsx | 252 | 中 | 6 类业务知识浏览 (Product/Policy/Customer/...) |
| 业务工具 | BusinessTools.tsx | 247 | 中 | 样品发票/发货通知/汇率工具入口 |
| 设置 | Settings.tsx | 437 | 高 | 云端端点/AI 模型/TTS/API 密钥/主题配置 |
| UI 实验室 | UiLab.tsx | 425 | -- | 组件展示 / 设计系统调试 |

### 3.2 核心业务流程

| 流程 | 涉及模块 | 当前状态 | 关键能力 |
|:---|:---|:---|:---|
| PO PDF 导入 | Import -> Orders | 生产可用 | Peerless 客户 PDF 自动解析 + 客户识别 + 字段级覆盖保护 |
| 订单管理 | OrderManager + Server | 生产可用 | CRUD + 搜索 + 软删除 + SSE 实时通知 |
| 面料档案 | ProductsManager + Server | 开发中 | 主档 + FabricProfile + 成分/价格/认证独立表 |
| 关系管理 | RelationsManager + Server | 开发中 | 组织 + 人员 + 多联系方式 + ship-to + 财务 |
| 邮件收发 | EmailManager + Server | 生产可用 | IMAP/SMTP + 文件夹 + 附件 + 星标 |
| 市场行情 | Dashboard + Server | 生产可用 | 棉花/羊毛期货 + 汇率 + Yahoo Finance |
| AI 对话 | Assistant + Agent | 生产可用 | 多模型路由 + 7 工具 + 三级记忆 + RAG |
| 样品发票 | FabricSampleInvoiceGenerator | 生产可用 | PDF/Excel 生成 + 品名行 + 条款 + 印章 |
| 发货通知 | ShippingNoticeGenerator | 生产可用 | Excel 生成 + 自动填充 PO 数据 |
| 知识检索 | KnowledgeBase + RAG API | 部分可用 | pgvector 语义搜索 + DeepSeek RAG |

---

## 4. 数据模型现状

### 4.1 Prisma 模型全景 (13 模型)

| 模型 | 核心用途 | 字段数 | 关系 | 状态 |
|:---|:---|:---|:---|:---|
| Order | 采购订单主表 | 80+ | -> OrderLine[] | Phase 2 完成 |
| OrderLine | 订单行项目 | ~17 | -> Order | Phase 2 完成 |
| Relation | 组织/联系人 CRM | ~40 | 自引用(parentId) | Phase 2 扩展中 |
| ProductAsset | 产品/面料主档 | 12 | -> FabricProfile? + 5 个子表 | 新建中 |
| FabricProfile | 面料技术参数 | 20 | -> ProductAsset | 新建 |
| ProductClassification | 多维分类维度 | 6 | -> ClassificationLink[] | 新建 |
| ProductClassificationLink | 产品-分类 M2M | 4 | 桥接表 | 新建 |
| MaterialCompositionTerm | 成分词条库 | 5 | -> CompositionLine[] | 新建 |
| FabricCompositionLine | 面料成分行 | 6 | 桥接 ProductAsset-Term | 新建 |
| FabricCustomerCode | 客户编码映射 | 7 | -> ProductAsset | 新建 |
| FabricPriceHistory | 面料价格历史 | 11 | -> ProductAsset | 新建 |
| FabricCertification | 面料认证 | 7 | -> ProductAsset | 新建 |
| KnowledgeItem | 业务知识文章 | 6 | 独立 | 稳定 |
| Insight | 业务洞察/事实 | 5 | 独立 | 稳定 |
| BusinessProfile | 通用配置对象 | 6 | 独立(JSON payload) | 稳定 |
| ProductSubCategory | 旧版子分类 | 5 | 将被 Classification 取代 | 兼容保留 |
| ProjectMemory | 遗留项目记忆 | 8 | 独立 | 标记 deprecated |

### 4.2 关键设计模式

| 模式 | 实现方式 | 影响范围 |
|:---|:---|:---|
| 软删除 | deletedAt: BigInt? 全局 | 所有模型统一 |
| 字段级溯源 | fieldSources: JSONB (pdf/manual/imported-then-edited) | Order 模型 |
| BigInt 时间戳 | updatedAt: BigInt (毫秒 epoch) | 所有模型 |
| 主档引用 + 业务快照 | orderId + *RelationId + 独立快照字段 | Order / Sample |
| 多维分类 | ProductClassification + Link M2M | ProductAsset |
| 双币种 | purchaseCurrency(CNY) + salesCurrency(USD) | Order |

---

## 5. API 端点盘点

### 5.1 v1 结构化 API

| 路由前缀 | 方法 | 端点数 | 功能 |
|:---|:---|:---:|:---|
| /api/v1/orders | GET/POST/PUT/DELETE + /import | 5 | 订单 CRUD + PDF 批量导入 + 字段溯源 |
| /api/v1/import | POST | 1 | PDF 上传解析(1-20 文件, max 10MB) |
| /api/v1/relations | GET/POST/PUT/DELETE | 4 | 关系 CRUD + 自动初始化 Peerless |
| /api/v1/products | GET/POST/PATCH/DELETE | 5 | 产品主档 CRUD + 面料子表嵌套 |
| /api/v1/business-profiles | GET/POST/DELETE | 3 | 通用配置对象 CRUD |
| /api/v1/events | GET (SSE) | 1 | 实时数据变更推送 |

### 5.2 顶层内联 API (server/src/index.ts)

| 类别 | 端点 | 说明 |
|:---|:---|:---|
| 邮件 | 7 端点 (fetch/send/mark_*/move/attachment/image/detail) | IMAP+SMTP 完整闭环 |
| 市场 | 3 端点 (cotton/wool/all) | Yahoo Finance + 估算 |
| 搜索 | /api/search + /api/fetch-url | DuckDuckGo 代理 + URL 内容代理 |
| 发货 | /api/shipping-notice/generate + /download | Excel 生成 |
| 健康 | /api/health | DB 连通性检查 |
| 遗留同步 | 7 端点 (orders/knowledge/relations/products/insights/dev-memory/product-categories) | 旧版全量同步 |

---

## 6. 部署架构

### Mac mini 生产服务器

**Main Data API (端口 8081)**
- Express + Prisma + PostgreSQL
- LaunchAgent: com.bambook.main-data-api
- 路径: ~/bambook-main-api

**Knowledge API (端口 8090)**
- FastAPI + pgvector + Ollama (nomic-embed-text)
- DeepSeek RAG (可选)

**公网访问**
- Cloudflare Tunnel: https://jiangsupanda.com/bambook
- Knowledge API 内含 /api/* 反向代理到 8081

### 客户端部署

**Web 浏览器 (主要)**
- Vite dev server: localhost:3000
- 生产构建: vite build -> dist/

**Electron 桌面端**
- 无框窗口 1440x900, macOS traffic lights 隐藏
- 内嵌 Server: 启动时自动 execFile 后端进程
- 本地 SQLite: po_database.db 离线访问

**多端适配**
- 同一网址入口根据设备动态加载 desktop/tablet 或 phone PWA bundle
- 手机 PWA 使用 `pwa/mobile` 下的新组件树，旧 mobiledev 路线已移除

---

## 7. 代码规模统计

| 指标 | 值 |
|:---|:---|
| 前端组件代码行 | ~19.2K |
| AI Agent 代码行 | ~3.4K |
| Server 入口代码行 | ~1.5K |
| App.tsx 主文件 | 700 |
| types.ts 类型定义 | 719 |
| index.css 全局样式 | 1162 |

### 最大组件 Top 5

| 组件 | 代码行 | 复杂度评估 |
|:---|:---:|:---|
| ProductsManager | 2181 | 极高 - 多子表 CRUD + 详情卡片 |
| EmailManager | 1737 | 高 - 完整邮件客户端 |
| OrderManager | 1476 | 高 - 字段溯源 + 集群编辑 |
| FabricSampleInvoiceGenerator | 1499 | 高 - PDF/Excel 生成 |
| RelationsManager | 1441 | 高 - 组织图 + 多地址/财务 |

---

## 8. 进度与里程碑

### 8.1 已完成阶段

| 阶段 | 时间线 | 核心交付物 |
|:---|:---|:---|
| Phase 0: 基础搭建 | 2026 Q1 | React + Vite 脚手架, 基础 UI, AI 对话 |
| Phase 1: 核心业务 | 2026-04 上旬 | Order CRUD, Relation CRUD, PDF 导入 (Peerless), 市场行情 |
| Phase 2: 统一订单 | 2026-04-20 | 50+ 新字段, 角色快照(mill/consignee/billTo), 双币种, 字段溯源, SSE 实时通知 |
| Phase 3: AI 增强 | 2026-04 中 | ReAct Agent, 7 工具, 三级记忆, 意图路由, TTS；STT 已在当前阶段移除 |
| Phase 4: 面料主档 | 2026-04 下旬~05 | FabricProfile + 成分/价格/认证/客户编码 + 多维分类 + 后端 API |
| Phase 5: 关系升级 | 2026-05 进行中 | 组织结构化(中英文名/信用/shipTo/财务), 组织图, 备用联系方式 |

### 8.2 Prisma 迁移记录

| 迁移 ID | 日期 | 内容 |
|:---|:---|:---|
| 20260418002201 | 04-18 | 初始化: 创建所有基础表 (Order/OrderLine/Relation/ProductAsset 等) |
| 20260418002400 | 04-18 | 对齐: 删 9 废弃 OrderLine 列, 加 12 新列匹配 Peerless 解析 |
| 20260420120000 | 04-20 | Phase 2: 加 50+ 列到 Order (角色/溯源/样品追踪/双币种/采购销售分离) |

### 8.3 当前进度 - 按实施计划 Task 对照

| Task | 内容 | 状态 | 说明 |
|:---|:---|:---|:---|
| Task 1 | 数据模型盘点与边界标注 | 完成 | 已输出 主数据字段边界盘点.md |
| Task 2 | Prisma Schema 扩展面料主档 | 完成 | FabricProfile + 6 子表已落库 |
| Task 3 | 后端 API 增加数字档案接口 | 完成 | products route 5 端点已上线 |
| Task 4 | 前端类型与服务层接入 | 完成 | types.ts + apiService 已扩展 |
| Task 5 | 面料档案列表与详情第一版 | 进行中 | 面料卡片展示 + 录入窗口, 详情页待完善 |
| Task 6 | 关系智库结构化升级 | 进行中 | 后端已扩展, 前端组织详情增强中 |
| Task 7 | 大货/样品主档引用预埋 | 待开始 | 计划中 |
| Task 8 | 验证与迁移检查 | 待开始 | 计划中 |

---

## 9. 风险审计

### 9.1 高风险

**R1: 无版本控制**
项目不在任何 Git 仓库中。代码丢失、变更不可追溯、无法回滚。这是最严重的运维风险。

**R2: 单点部署 - Mac mini 生产服务器**
PostgreSQL + Express + Knowledge API 全在一台 Mac mini 上运行。硬件故障即全站下线，无容灾无备份自动化(仅手动 pg_dump)。

**R3: 样品管理模块完全缺失**
SampleManager 仅 75 行占位代码，无独立数据模型。这是业务闭环的关键缺口 - 面料调样、寄样记录、客户反馈均无法管理。

### 9.2 中风险

**R4: 巨型组件 - 维护困难**
ProductsManager (2181行), EmailManager (1737行), OrderManager (1476行) 等组件过大，职责过重，难以独立测试和维护。

**R5: 前端缓存与 API 双写不一致**
storageService (localStorage) 与 apiService (REST) 存在双写路径，离线/在线切换时可能出现数据不一致。缺少统一的缓存失效策略。

**R6: Phase 6 Cleanup 未执行**
Order 表仍有 6 个 deprecated 字段 (factoryName, buyerName 等) 和相关代码。延迟清理增加技术债和迁移风险。

**R7: AI 记忆降级路径过多**
L1/L2/L3 每层都有"服务端 -> 浏览器 fallback"降级，逻辑分支复杂。ChromaDB 和 better-sqlite3 在前端用 Mock 替代，可能掩盖运行时错误。

**R8: PDF 解析仅支持单一客户**
目前仅 Peerless Clothing 的 PO 格式有解析器。新客户需要手写正则解析器，无法快速扩展。

### 9.3 低风险

**R9: 遗留代码残留**
POImportPanel.tsx (被 ImportWizard 替代但仍被引用), savedRowToOrder firstLine fallback, ProjectMemory 模型 deprecated 但仍在 schema 中。

**R10: 测试覆盖不均**
Import pipeline 测试较好 (5+ 测试文件), 但前端组件 0 测试, relations/products route 各仅 1 测试, 邮件/市场 API 无测试。

**R11: CSS 单文件膨胀**
index.css 已达 1162 行且仍在增长，缺乏 CSS Modules 或组件级样式隔离。

---

## 10. 技术债务清单

| 债务项 | 位置 | 优先级 | 建议 |
|:---|:---|:---:|:---|
| Order 表 deprecated 字段 | schema.prisma + 6 处代码引用 | P1 | 执行 Phase 6 Cleanup: 删列 + 清理代码 |
| POImportPanel 残留 | BusinessTools.tsx 引用 | P2 | 替换为 ImportWizard 调用 |
| ProductSubCategory 兼容表 | schema.prisma | P2 | 等 Classification 迁移完成后废弃 |
| ProjectMemory 废弃模型 | schema.prisma | P3 | 确认无引用后删除 |
| localStorage 双写 | storageService + apiService | P1 | 统一为 API-first + 本地缓存 fallback |
| 巨型组件拆分 | ProductsManager/EmailManager/OrderManager | P2 | 抽取子组件 + Hooks |
| 前端零测试 | components/ | P2 | 核心组件至少加集成测试 |
| 邮件/市场 API 无测试 | server/src/index.ts 内联 | P3 | 抽取独立 route 文件后加测试 |
| index.css 膨胀 | index.css | P3 | 逐步迁移到 Tailwind 组件级类 |

---

## 11. 下一阶段路线图

| 优先级 | 模块 | 目标 | 关键交付物 |
|:---|:---|:---|:---|
| P0 | Git 仓库初始化 | 代码安全与变更追溯 | .gitignore + 初始提交 + 远程仓库 |
| P0 | 面料档案完善 | 数字档案全面可用 | 详情页 + 分类切换 + 搜索筛选排序 + 缺失提醒 |
| P0 | 关系智库增强 | 组织/人员可被业务引用 | 组织详情 Tab(联系人/财务/shipTo/互动) + 多地址/多联系方式 |
| P1 | 样品管理搭建 | 业务闭环 | 数据模型 + 录入 + 面料/客户关联 + 寄样追踪 |
| P1 | Phase 6 Cleanup | 技术债清理 | 删 deprecated 字段 + 清理残留代码 |
| P1 | 大货/样品主档引用 | 消除数据重复 | Order/Sample 关联 ProductAsset + Relation ID |
| P2 | 组件拆分重构 | 可维护性 | 巨型组件拆子组件 + 自定义 Hooks |
| P2 | 新客户 PDF 解析器 | 扩展性 | 可配置的解析器框架 + 新客户接入 |
| P3 | 统计与智能能力 | 业务洞察 | 销量/热度/品质风险统计 + AI 推荐 |
| P3 | 容灾与备份 | 可靠性 | 自动备份 + 健康监控 + 故障切换 |

---

## 12. 关键配置参考

### 12.1 环境变量

| 变量 | 必需 | 说明 |
|:---|:---:|:---|
| VITE_ZHIPU_API_KEY | 是 | 智谱 AI API 密钥 |
| DATABASE_URL | 是 | PostgreSQL 连接串 |
| UPSTASH_REDIS_REST_URL | 否 | Redis L1 记忆 (不配则降级浏览器) |
| UPSTASH_REDIS_REST_TOKEN | 否 | Redis Token |
| BAMBOOK_API_KEY | 否 | API 认证密钥 (生产模式必需) |
| BAMBOOK_SDK_KEY | 否 | SDK 认证密钥 |
| BAMBOOK_REQUIRE_AUTH | 否 | 强制 API 认证 (默认 dev-key-2024) |
| CHROMA_HOST | 否 | ChromaDB 地址 (默认 localhost:8000) |
| PORT | 否 | 服务端口 (默认 8081) |

### 12.2 NPM 脚本速查

| 命令 | 用途 |
|:---|:---|
| npm run dev | Web 开发 (localhost:3000) |
| npm run dev:stack | 全栈开发 (前端 + 后端) |
| npm run build | 生产构建 |
| npm run electron:dev | Electron 桌面端开发 |
| npm run electron:build | Electron 桌面端构建 |

---

*文档结束 | Bambook 竹衍 Project Baseline Manual v1.0 | 2026-05-07*
