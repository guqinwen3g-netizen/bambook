# Agent Runtime Data Center Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bambook Agent answer product archive questions through Bambook data center tools instead of local databases or one-off chatbot context.

**Architecture:** The client runs only UI and sends chat to the data center. The Agent runtime plans read-only tool calls, executes structured data center endpoints, records tool runs, and sends human-readable progress back to the assistant UI. Product archive filtering is handled by a generic `POST /api/v1/products/assets/query` endpoint so future fields can be added without creating a new tool per question.

**Tech Stack:** Express, Prisma, Vitest, Vite/React, Bambook Agent Runtime.

---

### Task 1: Data Center Structured Product Query

**Files:**
- Modify: `server/src/products/route.ts`
- Test: `server/src/products/__tests__/route.test.ts`

- [x] Add a failing route test for `POST /api/v1/products/assets/query`.
- [x] Implement read-only structured filters, sorting, pagination, and count/list aggregates.
- [x] Return `dataSource: "bambook-data-center"` so Agent output can identify the source.
- [x] Verify with `npx vitest run server/src/products/__tests__/route.test.ts`.

### Task 2: Agent Remote Tool Runtime

**Files:**
- Modify: `server/src/agent/toolRuntime.ts`
- Test: `server/src/ai/runner.test.ts`

- [x] Add a failing test proving remote `products.query` uses `POST /v1/products/assets/query`.
- [x] Change remote `products.query` and `records.query` to use the structured query endpoint.
- [x] Preserve `products.count` and `products.get` behavior for broad counts and exact lookup.
- [x] Verify with `npx vitest run server/src/ai/runner.test.ts`.

### Task 3: Agent Working Feedback

**Files:**
- Modify: `server/src/ai/runner.ts`
- Modify: `components/Assistant.tsx`

- [x] Tighten the model system prompt around ToolResult priority and data center source.
- [x] Show data center runtime status in the assistant header.
- [x] Convert backend step events into user-visible Agent working steps.

### Task 4: Verification

**Commands:**
- [ ] `npx vitest run server/src/products/__tests__/route.test.ts server/src/ai/runner.test.ts`
- [ ] `npx vitest run services/apiBase.test.ts services/authService.test.ts services/assistantSessionService.test.ts server/src/agent/__tests__/route.test.ts server/src/ai/route.test.ts`
- [ ] `npm run build`

**Expected Result:** Local dev runs only the frontend; business data and Agent APIs target Bambook data center. The Agent can perform structured product archive queries without creating one tool per user question.
