# Agent Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/ai/chat` use a backend-owned Agent Runtime instead of frontend-owned chatbot history.

**Architecture:** Introduce a server-side Agent Runtime service that owns session recovery and message persistence, while existing `createAiRuntime` continues to provide concurrency lanes. The UI becomes an interaction surface: it sends the current message and session id, but the backend is responsible for durable Agent state.

**Tech Stack:** Express, Prisma, Vitest, existing Bambook Agent OS models.

---

### Task 1: Backend Agent Runtime Session Ownership

**Files:**
- Create: `server/src/agent/runtime.ts`
- Modify: `server/src/ai/route.ts`
- Test: `server/src/ai/route.test.ts`

- [ ] Add `createAgentRuntimeService` with `prepareChatRun` and `saveAssistantMessage`.
- [ ] Resolve chat actor from token/body fallback.
- [ ] Ensure or create `AgentSession` for logged-in users.
- [ ] Load history from `AgentMessage`, trimming current duplicate user message.
- [ ] Save user message before model run and model message after model run.
- [ ] Keep frontend-provided history only as fallback.
- [ ] Verify route test covers empty frontend history plus backend persisted history.

### Task 2: Frontend Assistant Becomes Runtime Client

**Files:**
- Modify: `components/Assistant.tsx`
- Modify: `services/assistantSessionService.ts` only if needed

- [ ] Keep session creation/list/load UI.
- [ ] Stop saving user/model messages directly around `/api/ai/chat`.
- [ ] Refresh sessions after successful backend run.
- [ ] Keep local optimistic UI rendering.

### Task 3: Tool Execution Moves Behind Runtime Boundary

**Files:**
- Modify: `server/src/ai/runner.ts`
- Modify: `server/src/agent/tools.ts`
- Test: `server/src/ai/runner.test.ts`, `server/src/agent/__tests__/services.test.ts`

- [ ] Keep `products.count` as first real read tool.
- [ ] Ensure tool directory persists to DB.
- [ ] Ensure tool runs write `AgentToolRun`.
- [ ] Preserve `ToolResult` context output for the model.

### Task 4: Verification

**Commands:**
- `cd server && npm test -- src/ai/route.test.ts src/ai/runner.test.ts src/agent/__tests__/services.test.ts src/agent/__tests__/foundation.test.ts`
- `cd server && npm run build`
- `npm run deploy:server`
- `curl`线上 `/api/agent/status`
- `curl`线上 `/api/ai/chat` asking fabric count

---
