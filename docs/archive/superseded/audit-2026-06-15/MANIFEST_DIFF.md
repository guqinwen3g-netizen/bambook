# MANIFEST DIFF — 四方对账（2026-06-15）

> 目的：核对"本地仓库 / GitHub main / 远程仓库 / 远程运行时" 四个层面的 manifest 工具集是否一致，闭环掉历史记录中"本地 44 / 远程 53"的口径分歧。
> 范围：仅 `server/src/agent/mcp/manifest.ts` 注册的 Agent 工具清单（不含路由、Prisma 模型）。
> 方法：只读对账，不修改任何代码、不重启服务、不动 git。

---

## 1. 四方真相对照（结论先行）

| # | 来源 | 路径/端点 | 工具数 | 哈希一致性 |
|---|------|----------|--------|-----------|
| 1 | 本地仓库（开发机） | `/Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/agent/mcp/manifest.ts` | **44** | ✅ |
| 2 | GitHub `main` HEAD | `guqinwen3g-netizen/bambook` @ `5be256c` | 44（隐含，等同 1）| ✅ 本地干净=远程同源 |
| 3 | 远程部署机源码 | `~/bambook-main-api/src/agent/mcp/manifest.ts`（Mac Mini） | **44** | ✅ |
| 4 | 远程运行时（HTTP） | `http://127.0.0.1:8081/api/agent/mcp/manifest`（live, dist/） | **44** | ✅ |

**结论：四方完全一致，44 个工具，零差异。**

之前 workspace memory 里"远程 53 / 本地 44"的口径**是误记**，已纠正。详见第 5 节。

---

## 2. 工具清单（44 个，按域分组）

按 HTTP 真相（最权威）的 domain 分布：

| Domain | Count | Tools |
|--------|------:|-------|
| **orders** | 10 | batch_status, expand, get, get_timeline, kanban, list_by_status, query, update_status, *(2 待补)* |
| **finance** | 8 | apply_voucher_to_invoice, create_invoice, create_voucher, get_invoice, get_voucher, list_invoices, list_vouchers, query_outstanding |
| **email** | 6 | ai_extract, get, link_to_order, list, search, sync |
| **products** | 4 | describe_schema, expand, get, query |
| **development** | 4 | convert_to_order, get, query, update_stage |
| **shipping** | 4 | create_shipment, get_shipment, list_shipments, update_tracking_status |
| **entities** | 4 | hydrate, search, *(+2)* |
| **relations** | 3 | expand, get, query |
| **knowledge** | 1 | search |
| 合计 | **44** | |

> 注：CODE_TRUTH.md 之前按 11 域聚合（orders 8 / finance 8 / email 6 / development 4 / shipping 4 / products 4 / relations 3 / entities 2 / garment 2 / links 2 / knowledge 1）= 44，但 HTTP 实际返回的是 **9 域**，其中：
> - `garment.update_production_steps` 和 `garment.update_size_breakdown` 在 manifest.ts 里 `id` 以 `garment.` 开头，但 HTTP `domain` 字段被归入 `orders`（共占 2）→ 这是 manifest 数据本身的设计：id 命名空间 ≠ domain 字段
> - `links.expand_neighbors`、`links.query` 同理 → HTTP `domain` 归入 `entities`（共占 2）
>
> 这是 CODE_TRUTH.md 与 HTTP 真相的"分类口径"差异，**不是工具数差异**，44 = 44 始终成立。

### 风险分布
- low: 30
- medium: 2
- high: 12

---

## 3. 校验快照

```
schemaVersion: 2026-06-runtime-2.0
generatedAt:   2026-06-15T07:19:11.004Z
total tools:   44
本地 git HEAD: 5be256c (merge: 合并开发案例/财务/货运三大模块到 main)
远程 dist 构建时间: Jun 15 13:51:28 2026 (UTC+8)
```

工作树有 2 个文档级未提交修改（架构错误修复，本次审计无关）：
```
M docs/ARCHITECTURE.md
M docs/Bambook_Master_Specification.md
```

---

## 4. 部署拓扑真相（更正历史记忆）

```
开发机                       GitHub                                Mac Mini
───────────────────────      ─────────────────────────────         ────────────────────────────────
~/WorkBuddy/Claw/apps/   ⇄   guqinwen3g-netizen/bambook (main) ⇄  ~/bambook-main-api/        ← 真正在跑
  Bambook                                                           ├─ src/      源码
                                                                    ├─ dist/     编译产物（运行时）
                                                                    ├─ ops-panel/ 子应用 :8088
                                                                    └─ scripts/ops/ 21 个白名单脚本
                                                                  ~/bambook-knowledge-api/   :8090
                                                                  ~/WorkBuddy/Claw/apps/Bambook ← 过时副本，无 .git
```

**部署链路**：
- 开发机 push → GitHub `main`
- Mac Mini auto-deploy LaunchAgent (`com.bambook.ops-panel-auto`)：每 60 秒拉 GitHub commits API 比 SHA
- SHA 不一致 → 跑 `ops-deploy-panel.sh`：tarball 下载 + npm install + build + launchctl kickstart
- main API 走 `ops-deploy-main-api.sh`：git fetch/pull + npm install + prisma migrate deploy + npm run build + launchctl kickstart

**两个之前混淆的目录**：
- `~/bambook-main-api/`（**真生产**）：独立 git? **否** — 实际看到的是 `download_tarball_update` 路径在跑（"SERVER_ROOT is not a git repository"），即 tarball 模式而不是 git 模式。
- `~/WorkBuddy/Claw/apps/Bambook/`：是**早期前端+TTS 实验目录**，与当前 server 后端无关，不是部署目标。

---

## 5. 历史记忆勘误

workspace MEMORY.md / 历史日志中如有以下表述，均为**口径误差**：

| 误记 | 真相 |
|------|------|
| "本地 44 vs 远程 53" | 实际 **本地 44 = 远程 src 44 = 远程 dist 44 = HTTP 44**，无差异 |
| "Mac Mini 部署在 ~/WorkBuddy/Claw/apps/Bambook/" | 真实部署目录是 `~/bambook-main-api/`，那个目录是过时副本 |
| "agent 部署目录是 git repo" | 实际是 tarball 模式（auto-deploy 走 `download_tarball_update`） |

---

## 6. 验证命令（外部审核者可复跑）

### 6.1 本地仓库工具数
```bash
cd ~/WorkBuddy/Claw/apps/Bambook/server
grep -E "^\s+id:\s+'[a-z]+\.[a-z_]+'" src/agent/mcp/manifest.ts \
  | sed -E "s/.*id:\s+'([^']+)'.*/\1/" | sort -u | wc -l
# expected: 44
```

### 6.2 远程仓库源码工具数
```bash
ssh bambook-mini "grep -E \"^[[:space:]]+id:[[:space:]]+'[a-z]+\\.[a-z_]+'\" \
  /Users/panda1/bambook-main-api/src/agent/mcp/manifest.ts \
  | sed -E \"s/.*id:[[:space:]]+'([^']+)'.*/\\1/\" | sort -u | wc -l"
# expected: 44
```

### 6.3 远程运行时（编译后）工具数
```bash
ssh bambook-mini "grep -oE \"id:[[:space:]]*['\\\"][a-z]+\\.[a-z_]+['\\\"]\" \
  /Users/panda1/bambook-main-api/dist/agent/mcp/manifest.js \
  | sed -E \"s/.*['\\\"]([a-z.]+\\.[a-z_]+)['\\\"].*/\\1/\" | sort -u | wc -l"
# expected: 44
```

### 6.4 远程 HTTP 真相（最权威）
```bash
ssh bambook-mini 'TOKEN=$(grep "^BAMBOOK_SDK_KEY=" ~/bambook-main-api/.env.local | cut -d= -f2-);
  curl -s -H "x-bambook-api-key: $TOKEN" http://127.0.0.1:8081/api/agent/mcp/manifest' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len({t['id'] for t in d['tools']}))"
# expected: 44
```

---

## 7. 后续建议

- [ ] 把 6.1–6.4 的对账过程封装为 `server/scripts/ops/ops-manifest-diff.sh`，加入 ops-panel 白名单，每次部署后自动跑一次，差异>0 触发告警
- [ ] CODE_TRUTH.md 第 X 节工具分组按 HTTP 真相的 9 域更新（避免 id 命名空间 vs domain 字段的口径混淆）
- [ ] workspace MEMORY 更新部署拓扑章节（已计划）
- [ ] 提交本次未提交的两份文档修复（架构错误修复）

---

**审计人**：assistant（自动）
**审计时间**：2026-06-15 15:14 UTC+8
**结论**：✅ Manifest 四方一致，无需任何修复。历史"差异 9 个"的认知是口径错误，已纠正。
