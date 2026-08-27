# Project Rules

## 北极星与当前波次（2026-08-27 拍板，动态行唯一住址）
- **v1.0 投产定义**：S1 双主链（面料+成衣各 14 步）实机零死胡同 ＋ S2 任一单据三击可追溯 ＋ S3 七角色权限走查通过 ＋ 追加三否决项（无占位文本/无假数据/不跳系统手工），全绿后真实订单使用 2 周记 production-used
- **波次顺序**：W-0 开工前置包（三件工件 `docs/README.md` W-0 节，2026-08-27 完成）→ W-A 主链贯通（~~四批次冒烟~~/~~结算挂接 `87cd361`~~/~~警示接线 `1f6d041`~~/~~L8回写 `0f07b13`~~/~~在途四域收尾+迁移补账 `a433e5b`/`f7cd7cb`/`bcfe1f5`~~/~~S1 代码级走查 `scripts/walkthrough/` 五路全完成~~）→ ~~W-B 数字正确（P2-6 四单对账 `e6c74f2`/P0 死胡同三修 `77919bd`/linkage 死胡同三修 `a08b1af`/P1 死胡同 DE-3/DE-5/DE-6 `990684b`/P2-7 多币种对账 `cd597fb`/断层④双状态机挂钩 DR-047 `5e46d93`，**已关闭**）~~ → **W-C 权限收口（七角色走查/30页销号/REQ2-11拍板 D-1~D-5）** → W-D 扩张（P1-5/P2-8/MRP只读/REQ2-20/债务马拉松）
- 当前波次：**W-C 权限收口启动**（W-B 全部关闭：对账双引擎交付、9 死胡同清零、4 断层全部拍板；W-C 三件事：① 七角色权限实机走查 ② 30 页权限销号 ③ REQ2-11 双抬头分账 D-1~D-5 拍板——D 系列涉及甲方业务结构，须用户仲裁）
- W-A 走查成果：五路代码级走查 139 步，验证主链+四批次全通；挖出 9 死胡同（3 P0 已修提交：`a08b1af` linkage actorId/事件总线缺省字段；3 P0 已修提交：`77919bd` 信用门禁接线/V1-V2 确认路径统一/MOQ HTTP 契约；1 已修提交：MaterialReturn stockItemId 列外科 DDL；3 P1 已修提交：`990684b` 直付旁路门禁/信用例外入口/审批 ID 透传）——9 死胡同全部清零
- W-B 开工前已拍板的 3 个断层（契约表）：① InvoiceOrderAllocation.batchId 无写入入口→整单口径（注释标注） ② 币种统一 Order.currency ③ actualPaymentAmount 仅参考（漂移记 info 建议废弃）；断层 ④ Shipment↔Batch 双状态机脱钩→已拍板 DR-047（`5e46d93` 自动联动+留痕）——4 断层全部关闭
- 条件触发沉底项：P4-12 押汇（L/C 占比>30%）、P4-13 海外代理佣金（出现代理成交结构）、P3-11 现货模式（确认存在后）

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

## 渲染路径铁律（2026-08-25 更新：compiled 双路径已删除）
- **compiled 双路径已于 2026-08-18 UI 纪律重建中删除**：`App.tsx` 已无 `CompiledMainModuleSlot` / `Compiled*Page` 渲染分支（`App.test.ts` 断言废弃透明包裹器）
- **所有业务页面渲染源统一为各 Manager 文件本身**（RelationsManager.tsx / ProductsManager.tsx / Settings.tsx 即实际渲染源）
- `moduleRegistry.ts` 中残留的 `compiler` 字段仅作元数据记录，不参与渲染选择

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
- main 分支：基线 `dafd300` + 4 个修复 commit（`02ccad5`/`ee0e173`/`bd94d7b`/`98cdf9a`）+ 4 个 docs commit（`f2ef300`/`1d3af4c`/`6c8a15b`/`b6dbd9f`）+ 阶段 0 Track A/B（`2cfff97` fix(security) / `3c4f342` feat(observability)）+ 阶段 0-3 收口（`7b11cb6` chore(repo) / `a5aefdc`+`8f928ac` fix(security) / `e82ae6a` feat(observability) / `306dd7d`+`40a1076` fix(agent,finance) / `1d04647` fix(market) / `000159f` feat(knowledge)）+ 企业上线就绪（`cf002fc` fix(frontend) / `46503b8` feat(ops) / `c6d7cec` chore(repo) / `c0068a8` test(frontend)）+ BDS v2→v2.1→v2.2 设计系统收编（`dfd9e6a`/`2ae7383`/`69d47d3`/`5fddee5`/`be97694`）+ 业务深化批次（C1-C8/D2/F1-F5/H1-H3/P0-P3/a5）+ ERP Phase 0-5 全栈实现（`eb1e9a7` P0+P1 迁移 / `e388cda` Phase 1 共享内核 / `bda41a4`+`4714252` Phase 2 八域后端 / `71cd291`+`9ef80c7` Phase 3 前端 UI / `0b0d292` Phase 4 Agent 工具层 / `f553629` Phase 5 集成 / `0d2775c` 遗留修复）+ 多会话协同波次（`b009b12` W0 断言基线 / `38c622c`+`d3e4ded`+`4f6dab0` W1 三轨 / `15f224a` W2 S-QA / `6478423` W3 S-QA 一阶段 / `ef1fd06` W2-W3 S-FE 批H+批G / `2fa5a4d`+`bcdec57` S-BE QA-SEC 批+仲裁 / `b20c305` W3 S-BE DR-016 合票建模并入）+ 后续增量（ops/documents 修复若干）+ 缺失功能优先级批次（`19d3eec` P0-1 分批出运与尾款结算 / `f23f34c` P0-2 催款分级状态机 / `e243ba2` P1-3 客户专属面料规则 / `165ff39` P1-4 物料退换货）+ v0.8 定稿与单据号原子追平（`7b8495b`~`59b80f3`）+ 文档大扫除与 W-A 首日（`f9ce454` docs 治理 / `87cd361` 结算挂接 / `1f6d041` 警示接线 / `de964d9` 契约退役）+ 在途四域收尾与 L8 修复（`a433e5b` 询价+迁移补账 / `f7cd7cb` 样品间+开发 / `bcfe1f5` HR KPI / `9d3f497` 补登+gitignore / `0f07b13` L8 回写）+ W-A 收官与 W-B 首日（`77919bd` P0 死胡同三修 / `e6c74f2` P2-6 四单对账 / `a08b1af` linkage 死胡同三修 / `5954aeb` 走查脚本归档）+ W-B 对账与死胡同清零（`990684b` P1 死胡同 DE-3/DE-5/DE-6 / `cd597fb` P2-7 多币种对账 / `5e46d93` 断层④双状态机挂钩 DR-047），HEAD=`5e46d93`
- 备份分支：`backup/pre-cleanup-20260728`（保留 339 个旧 commit 历史）
- 远程：`git@github.com:guqinwen3g-netizen/bambook.git`
- 提交前必须：tsc 零错误 + 构建通过 + check:tokens 通过 + 前端 `npm test` 全绿
- 测试套件：后端 `cd server && npx vitest run`（4580/4580 全通过，327 文件，含安全/幂等/并发/KB CRUD/MOQ 双触发/交期锁死/marketing/shared 补底/信用CAS/DR-013 门禁/QA-SEC 权限收口/DR-016 合票分配/出运批次门禁+结算自动触发挂接/催款分级穿透/专属面料四入口+行级预检+询价状态机/L8 回写幂等/退换货状态机/KPI 校验/信用门禁/确认路径统一/四单对账回归/直付旁路门禁/信用例外闭环/多币种对账回归/断层④双状态机挂钩 14 例；注意 riskRoute 与 systemConfigRoute 存在偶发 flake，复跑即绿）；前端 `npm test`（2644 通过 + 6 项视觉基线 quarantine 隔离，116 文件）
- 工作区遗留：**已清空**（2026-08-27 在途四域全部合入；仅剩本 rules 动态行随每次收尾更新）
- **迁移账本断链警示（部署必读）**：迁移历史存在基线断链（FabricProfile/DevelopmentCase/Invoice/PaymentVoucher/Shipment/MaterialReturn **六表**从未被任何迁移 CREATE），本地库曾以 db push 领先账本运行。Mac Mini 部署若 migrate deploy 报 duplicate column/table，先 `npx prisma migrate resolve --applied <目录名>` 记账已有效果，再上新迁移（20260827143911_supplier_inquiry_and_sample_card_stock 已含询价+样品间+开发全部 DDL；MaterialReturn.stockItemId 列需追加外科 DDL）

## Mac Mini 部署
- **不要用 SSH**，用 OPS Panel（ops.jiangsupanda.com）更稳定
- **部署方式**：push-based — 开发机打包 tarball → 上传 OPS Panel → Mac Mini 本地解压部署
- **一键部署**：`npm run deploy:web`（Ops Token 从 macOS Keychain 自动读取）
- Mac Mini 不从 GitHub 拉取代码
- 后续可打通 GitHub 自动更新（com.bambook.ops-panel-auto 每分钟轮询）

## 审计报告
- 位置：`.trae/documents/bambook-comprehensive-project-scan.md`
- 版本：v31.1，~14,700 行，158 章 + 第一百五十九~一百九十三章增补（共 193 章），~235 项技术债务（D512-D517 全部已解决；GAP-1/GAP-2 幂等与并发已修复）
- 包含：前端/后端/Agent/数据库/设计系统/安全/可观测性/架构全维度扫描 + Mac Mini 生产环境修复记录 + 中期验收测试回归修复记录 + 阶段 0-3 收口记录 + 目录全量校准 + 甲方投产验收专项
- 中期验收交付文档：`.trae/documents/mid-project-acceptance-delivery.md`（独立交付凭证，含环境搭建 / 验证命令 / 部署流程 / 交接清单）
- 2026-08-17 综合审计（四轨并行，综合 ≈84/100）+ 前端设计地毯式评审（6.4/10，高分线 ≥9.0）：结论与批 A-J 修复清单见 `docs/design/10-评审与决策/2026-08-17-前端设计地毯式评审报告.md`

## 多会话协同推进（2026-08-17 起生效）
- 唯一协调真源：`docs/design/10-评审与决策/2026-08-17-多会话协同推进纪律.md`（分工矩阵 / worktree 隔离 / 三绿门禁 / 断言先行 / W0-W5 波次）
- 铁律：任何会话不得跨分工边界改文件；`App.tsx` 冻结至 W5（FR-004 专项独占）；`schema.prisma`、check 脚本、package.json 各有单写者
- 防回退：`scripts/check-design-tokens.sh` 已扩展高分收编基线（raw 语义色 131 / 自造遮罩 17 / 裸 rounded 43 / 手写主按钮 35 / text-white 48，只减不增）

## 文档治理（2026-08-27 起生效，最高优先）
- **唯一导航入口：`docs/README.md`**——真源地图 / 动态状态住址 / 写作纪律均以此表为准；"唯一真源"称号只能由该表授予
- **收尾禁产新文档**：会话结束禁止默认新建收尾报告/阶段清单/规划类文档；产出只允许：更新现有真源小节、向 DR 台账（10-评审与决策/2026-08-16-设计评审决策记录.md）追加、更新本文件动态行
- 一次性快照/历史产物一律进 `docs/archive/superseded/`（2026-08-27 大扫除已迁入 27 份），不进主视线
- 动态状态（HEAD/测试基线/波次进展）只住本文件，不在其他文档中重复记录
- 并行 subagent 不受"4 个"限制（虚假约束），按任务需要直接派十几个

## 项目架构
- **两端分离**：桌面客户端（Electron + React）+ Mac Mini 数据中心
- 客户端：UI 展示/交互/本地 STT（sherpa-onnx）/本地缓存（IndexedDB），不持业务真源
- Mac Mini：Express + Prisma + PostgreSQL + Agent Runtime + LLM 网关 + TTS + OPS Panel
- 离线 fallback：客户端探活失败时启动本地 Express（只读模式，非日常运行）
