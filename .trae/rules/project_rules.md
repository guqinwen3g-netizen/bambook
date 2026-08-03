# Project Rules

## Dev Server HMR 注意事项
- 修改代码后如果 Electron 没有变化，可能是 HMR 断了
- 重启方法: `pkill -f "bambook-intelligent-hub"; pkill -f "electron-vite"; sleep 2; nohup npm run electron:dev > /tmp/bambook-dev.log 2>&1 &`
- 等待 10 秒后检查 `tail /tmp/bambook-dev.log` 确认启动

## Lint/Typecheck 命令
- 前端 TypeScript: `npx tsc --noEmit --skipLibCheck`（根 tsconfig 已排除 `server/`，仅检查 Electron/React 客户端）
- 后端 TypeScript: `cd server && npx tsc --noEmit --skipLibCheck`（独立 tsconfig）
- OPS Panel TypeScript: `cd server/ops-panel && npx tsc --noEmit --skipLibCheck`（独立 tsconfig + 独立 node_modules）
- Build: `npx electron-vite build`
- Design token 防回退: `npm run check:tokens`

## 渲染路径铁律
- Relations/Products/Settings 有 compiled 双路径: 改 UI 只改 compiled 版本
- 其他页面 Manager 文件即实际渲染源
- `CompiledMainModuleSlot` className="contents" 是透明包裹器

## 设计系统
- **权威 token 源**：`styles/os-vnext.css`（320 个 CSS 变量）
- **实际渲染准源**：`styles/flat-experimental.css`（最新 flat 设计载体，无阴影/无 rim/大圆角）
- **flat 设计特征**：完全无阴影、无 rim、大圆角（22-34px）、保留半透明膜色（blur + saturate）
- **Tailwind 语义类**（tailwind.config.js）：
  - borderRadius: `rounded-panel/card/card-lg/inset/floating/control/field/compact`
  - colors: `bg-deep/text-link/border-action` 等（支持 alpha 修饰符）
- **禁止**：tsx 中硬编码 `rounded-[Npx]`、hex 颜色（`#xxx`）、`box-shadow` 硬编码
- **防回退**：`scripts/check-design-tokens.sh` 基线模式检查新增硬编码
- **可豁免**：吉祥物 SVG/Canvas 颜色、3D 地图 WebGL 颜色、邮件/发票模板（CSS 变量在邮件客户端不可靠）

## Git 工作流
- main 分支：基线 `dafd300` + 4 个修复 commit（`02ccad5`/`ee0e173`/`bd94d7b`/`98cdf9a`）+ 4 个 docs commit（`f2ef300`/`1d3af4c`/`6c8a15b`/`b6dbd9f`）+ 阶段 0 Track A/B（`2cfff97` fix(security) / `3c4f342` feat(observability)）+ 阶段 0-3 收口（`7b11cb6` chore(repo) / `a5aefdc`+`8f928ac` fix(security) / `e82ae6a` feat(observability) / `306dd7d`+`40a1076` fix(agent,finance) / `1d04647` fix(market) / `000159f` feat(knowledge)），HEAD=`000159f`
- 备份分支：`backup/pre-cleanup-20260728`（保留 339 个旧 commit 历史）
- 远程：`git@github.com:guqinwen3g-netizen/bambook.git`
- 提交前必须：tsc 零错误 + 构建通过 + check:tokens 通过
- 测试套件：`cd server && npx vitest run`（1438/1438 全通过，含安全/幂等/并发/KB CRUD 回归测试）

## Mac Mini 部署
- **不要用 SSH**，用 OPS Panel（ops.jiangsupanda.com）更稳定
- **部署方式**：push-based — 开发机打包 tarball → 上传 OPS Panel → Mac Mini 本地解压部署
- **一键部署**：`npm run deploy:web`（Ops Token 从 macOS Keychain 自动读取）
- Mac Mini 不从 GitHub 拉取代码
- 后续可打通 GitHub 自动更新（com.bambook.ops-panel-auto 每分钟轮询）

## 审计报告
- 位置：`.trae/documents/bambook-comprehensive-project-scan.md`
- 版本：v22.0，~13,300 行，158 章 + 第一百五十九章增补 + 第一百六十章增补（阶段 0-3 全量收口凭证），~235 项技术债务（D512-D517 全部已解决；GAP-1/GAP-2 幂等与并发已修复）
- 包含：前端/后端/Agent/数据库/设计系统/安全/可观测性/架构全维度扫描 + Mac Mini 生产环境修复记录 + 中期验收测试回归修复记录 + 阶段 0-3 收口记录
- 中期验收交付文档：`.trae/documents/mid-project-acceptance-delivery.md`（独立交付凭证，含环境搭建 / 验证命令 / 部署流程 / 交接清单）

## 项目架构
- **两端分离**：桌面客户端（Electron + React）+ Mac Mini 数据中心
- 客户端：UI 展示/交互/本地 STT（sherpa-onnx）/本地缓存（IndexedDB），不持业务真源
- Mac Mini：Express + Prisma + PostgreSQL + Agent Runtime + LLM 网关 + TTS + OPS Panel
- 离线 fallback：客户端探活失败时启动本地 Express（只读模式，非日常运行）
