# P0: Git 仓库初始化 + 项目基线保护 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Bambook 项目建立 Git 版本控制，确保代码安全、变更可追溯、可回滚，为后续所有开发工作奠定基础。

**Architecture:** 在 Bambook 项目根目录初始化 Git 仓库，扩展 .gitignore 保护敏感文件和构建产物，完成首次提交作为项目基线快照。

**Tech Stack:** Git, .gitignore

---

## 0. 文件责任边界

| 文件 | 操作 | 说明 |
|:---|:---|:---|
| `.gitignore` | 修改 | 扩展忽略规则 |
| `Bambook-Electron桌面端.command` | 不动 | 保留 |
| `Bambook-Preview生产模式.command` | 不动 | 保留 |
| `Bambook-全栈开发.command` | 不动 | 保留 |

---

## Task 1: 扩展 .gitignore

**Goal:** 确保所有敏感文件、构建产物、本地数据、业务文档不会被提交到仓库。

**Files:**
- Modify: `apps/Bambook/.gitignore`

- [ ] **Step 1: 扩展 .gitignore 规则**

在现有 `.gitignore` 末尾追加以下规则：

```gitignore
# ============ Bambook 扩展规则 ============

# Electron build output
out/

# Generated business documents (shipping notices, etc.)
output/

# Prisma build output
server/server/
server/dist/

# Knowledge API Python artifacts
server/knowledge_api/__pycache__/
server/knowledge_api/*.pyc
server/knowledge_api/.env
server/knowledge_api/venv/
server/knowledge_api/.venv/

# Knowledge base frontend build
server/knowledge-base-frontend/node_modules/
server/knowledge-base-frontend/dist/
server/knowledge-base-frontend/.next/

# Knowledge base scripts artifacts
server/knowledge-base-scripts/__pycache__/

# Local database files
*.db
*.db-journal
*.sqlite
*.sqlite3

# Business documents with sensitive data
样品发票重整/
成份符号.xls

# Agent/memory local data
.agent/

# Cursor project files
.cursor/

# macOS
.DS_Store
```

- [ ] **Step 2: 验证 .gitignore**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
cat .gitignore | wc -l
```

Expected: 60+ lines (original ~42 + new ~20)

---

## Task 2: 初始化 Git 仓库

**Goal:** 在项目根目录创建 Git 仓库，完成首次提交作为项目基线。

**Files:**
- Create: `.git/` (by git init)

- [ ] **Step 1: 初始化仓库**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git init
```

Expected: `Initialized empty Git repository in /Users/qinwengu/WorkBuddy/Claw/apps/Bambook/.git/`

- [ ] **Step 2: 检查将被追踪的文件**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git add --dry-run . 2>&1 | head -30
```

Expected: 只看到源代码文件，不应出现 node_modules/、.env.local、*.db、out/、output/ 等。

如果出现不该追踪的文件，回到 Task 1 修正 .gitignore。

- [ ] **Step 3: 检查敏感文件是否被排除**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git add --dry-run . 2>&1 | rg '\.env|\.local|\.db|node_modules|out/|output/|样品发票|成份符号|\.agent' || echo "CLEAN: no sensitive files tracked"
```

Expected: `CLEAN: no sensitive files tracked`

- [ ] **Step 4: 添加所有文件到暂存区**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git add .
```

- [ ] **Step 5: 检查暂存区统计**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git diff --cached --stat | tail -5
```

Expected: 大量源代码文件被追踪，但无 node_modules / .env / *.db 等。

- [ ] **Step 6: 创建首次提交**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git commit -m "$(cat <<'EOF'
chore: initial commit - Bambook v3.0 baseline snapshot

Complete project baseline as of 2026-05-07. Includes:
- React 19 + Vite frontend with 49 components
- Express + Prisma + PostgreSQL backend (13 models, 40+ API endpoints)
- AI Agent system (ReAct loop, 7 skills, 3-tier memory)
- Electron desktop integration
- PDF import pipeline (Peerless Clothing)
- Email IMAP/SMTP integration
- Market data (commodities + forex)
- Business tools (sample invoices, shipping notices)
- Knowledge base + RAG API (FastAPI + pgvector)

Reference: docs/Bambook-项目基准手册-v1.0.md
EOF
)"
```

- [ ] **Step 7: 验证提交**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git log --oneline -1
git status
```

Expected: 1 commit, clean working tree.

---

## Task 3: 配置远程仓库（需用户操作）

**Goal:** 将本地仓库推送到远程，确保代码有异地备份。

**Files:** 无代码文件变更

- [ ] **Step 1: 提示用户创建远程仓库**

告知用户：

> 请在 GitHub/GitLab 上创建一个私有仓库（例如 `panda-clothing/bambook`），然后提供远程 URL。我不会自动创建远程仓库，因为这是 Panda Clothing 的私有财产。

- [ ] **Step 2: 添加远程并推送（等用户提供 URL）**

Run (替换 `<REMOTE_URL>`):

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git remote add origin <REMOTE_URL>
git branch -M main
git push -u origin main
```

Expected: 推送成功。

---

## Task 4: 验证与自检

**Goal:** 确认仓库状态健康，敏感文件未泄露。

**Files:** 无代码文件变更

- [ ] **Step 1: 确认敏感文件不在仓库中**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git ls-files | rg '\.env|\.local|\.db|node_modules|\.DS_Store' || echo "PASS: no sensitive files in repo"
```

Expected: `PASS: no sensitive files in repo`

- [ ] **Step 2: 确认源代码完整性**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
echo "Tracked files:" && git ls-files | wc -l
echo "Source code files:" && git ls-files | rg '\.(tsx?|css|json|prisma|py|sh)$' | wc -l
```

Expected: 100+ tracked files, 60+ source code files.

- [ ] **Step 3: 确认 git status 干净**

Run:

```bash
cd /Users/qinwengu/WorkBuddy/Claw/apps/Bambook
git status
```

Expected: `nothing to commit, working tree clean` (或仅有 .agent/ 等已忽略文件的未追踪提示)
