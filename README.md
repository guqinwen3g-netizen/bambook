# 🐼 Bambook (Panda Clothing Enterprise Agent OS)

Bambook 是 Panda Clothing 内部的**企业智能代理操作系统**。它通过融合 Electron 桌面端、全栈 API 与本地部署的 Agent 运行时（Orchestrator），实现人机协同的跟单、报价、财务核销和样品管理。

---

## 🚀 快速启动

在运行以下命令前，请确保已配置本地环境变量 `.env.local`。

### 1. 开发模式启动桌面端
```bash
npm run dev:desktop
```

### 2. 启动 UI 实验室 (Panda UI Lab)
用于预览和调试符合 Bambook 材质规范（毛玻璃 Glassmorphism）的 UI 组件：
```bash
npm run dev:panda-lab
```

### 3. 一键部署后端 API 与运维面板
```bash
npm run deploy:all
```

---

## 🗺️ 文档与知识库中心

项目的所有设计、架构、开发契约与运维指南已进行系统性整理：

👉 **请首先阅读 [Bambook 文档索引地图 (docs/README.md)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/README.md)** 👈

通过文档地图，你可以快速访问：
- **[八层全栈模块契约 (MODULE_CONTRACT.md)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/MODULE_CONTRACT.md)** (新增模块/工具的开发规范与 PR 模板)
- **[Agent 运行时架构 (AGENT_RUNTIME_ARCHITECTURE.md)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/AGENT_RUNTIME_ARCHITECTURE.md)** (Agent 决策与 MCP 机制)
- **[前端设计系统总览 (docs/design-system/README.md)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/docs/design-system/README.md)** (毛玻璃 OS 视觉规范)
- **[后端开发与运维指南 (server/BACKEND_GUIDE.md)](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/BACKEND_GUIDE.md)**

---

## 🛡️ 代码开发与提交流程
当修改代码、新增工具或关系时，请务必参考根目录下 `.github/pull_request_template.md` 模板中的自查 Checklist，确保覆盖数据层、API层、Agent层等同步点位，避免漏同步产生的 Bug。