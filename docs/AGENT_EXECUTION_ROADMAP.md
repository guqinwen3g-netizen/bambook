# Bambook Agent Execution Roadmap — P0 Critical Path

> Status: active
>
> Scope: this is the Agent reliability and execution sub-roadmap within the
> product P0 roadmap. It does not replace P0 business delivery work such as the
> production-pipeline UI or production alerts.

## 1. P0 outcome

For any high-risk Agent operation, Bambook must be able to answer, with durable
evidence:

1. **Who** requested and approved it?
2. **What exact draft** was approved?
3. Was it **executed exactly once**, even after a retry, timeout, reconnect, or
   process restart?
4. What happened, and can an operator **resume or recover** it safely?

The P0 completion bar is a user-visible vertical slice, not a successful SSE
event or a unit-test-only receipt:

> A merchandiser can open a real order, see its actual production stages, ask
> the Agent to advance the next permitted stage, receive the right approval,
> and see the persisted outcome, audit record, and refreshed UI.

This flow is the product proof. The execution kernel exists to make it safe,
recoverable, and repeatable.

## 2. Execution rules

- Work follows the product vertical slice and its required safety boundary.
  Infrastructure work without a mapped user workflow is not a completion.
- Every milestone has two independent evidence lanes:
  - **Local:** tests, typecheck, schema validation, and deterministic failure
    scenarios.
  - **Mac mini:** migration state, loaded build/version, service restart,
    endpoint/UI behavior, and persisted database evidence.
- A narrow implementation must be labelled as a **slice**, not presented as a
  general Agent capability. The first `order.confirm` idempotency receipt is
  one such slice.
- A process-local event, in-memory queue, or SSE connection is never the
  source of truth for an approval, commit, or recovery decision.
- Deployment to the data-center Mac mini is not required before every local
  edit, but a milestone is not production-complete until its corresponding
  Mac mini evidence is captured. It must not be deferred to one final release
  milestone.

## 3. Milestones

### M0 — Real workflow baseline and release gate

**Purpose:** Establish the evidence model before extending behavior.

**Deliverables**

- Select a representative real order and fixture data for the Production
  Pipeline → Agent → approval → stage update flow.
- Record the exact source revision, migration set, generated Prisma client, and
  running service build for each verification deployment.
- Define a release checklist for the data-center Mac mini and keep local test
  evidence separate from production runtime evidence.

**Acceptance**

- The selected workflow has a named user role, UI entry point, API path, Agent
  tools, approval record, domain write, and audit destination.
- A deploy can be traced from source revision to loaded service and database
  migration state.
- A failed migration or stale service build stops the release gate.

**Current status:** not implemented as an automated gate.

**Observed code reality (re-verified)**

- `OrderManager` renders `ProductionPipeline`, and `ProductionPipeline` reads
  and writes `/v1/production/*` through `productionService`.
- Those UI writes currently carry the stored API key directly; they do not
  surface an Agent approval state in the pipeline UI.
- The backend Agent runner's LLM tool descriptors do not currently expose the
  `production.*` tools, so a chat request cannot yet plan this workflow.
- The approval resolver already requires `owner`, `admin`, or `manager`; the
  remaining issue is policy scope/payload/expiry, not the absence of a role
  guard.

### M1 — Usable production-stage vertical slice

**Purpose:** Make the P0 production workflow usable end to end before
generalizing the Agent kernel.

**Deliverables**

- ProductionPipeline reads real order stage data and exposes the current
  gate/blocker state.
- The Agent conversation UI renders tool progress and approval state for a
  stage-advance request.
- `production.advance_stage`, `production.save_checklist`,
  `production.save_inspection`, and `production.sign_stage` have one enforced
  approval policy and auditable execution path, shared by the Agent and any
  direct UI action.
- Expose the required production tools to the Agent planner with typed inputs,
  and make the UI render the resulting pending approval and completion state.
- The approved action refreshes the production UI from persisted state.

**Acceptance**

- A merchandiser can complete the stated P0 workflow without using a test-only
  endpoint or manually patching the database.

### M2 — Trusted principal and approval authority

**Purpose:** Every Agent request and approval has a trusted, least-privilege
principal.

**Deliverables**

- Reject Agent execution without explicit roles.
- Map API keys to controlled service principals; never trust body-supplied
  identities in authenticated mode.
- Enforce approval reviewer authority and scope; reviewers cannot resolve
  arbitrary approvals.
- Validate approval payload shape at creation and define expiry/escalation.

**Current local progress**

- Complete: explicit Agent roles; API-key service-principal mapping; JWT actor
  wins over request-body identity; approval resolution is role-guarded for
  `owner`/`admin`/`manager`.
- Remaining: reviewer scope policy, payload schema validation,
  expiry/escalation, and production verification.

**Acceptance**

- Unauthorized, cross-scope, expired, and body-spoofed approval attempts are
  rejected and audited.

### M3 — Durable run and approval state machine

**Purpose:** A run can pause for human input and resume safely across SSE
disconnects, process restarts, and multiple service instances.

**Deliverables**

- Persist an Agent run state with a stable run ID, pending action, approved
  draft reference, continuation input, and terminal outcome.
- Replace `approvalEventBus` as the only continuation mechanism with a
  database-backed state transition and a resumable worker/claim protocol.
- Make checkpoint state sufficient for recovery, not only a scratchpad snapshot.

**Current local progress**

- Complete slices: tool timeout abort propagation; Prisma checkpoint manager is
  wired into the production runner.
- Remaining: durable pending-approval run state, safe resume claim, and
  reconnect/restart/multi-instance scenarios.

**Acceptance**

- Approve an action after the original SSE disconnects or service restarts; it
  executes once and produces a terminal run record.

### M4 — Exactly-once commit kernel

**Purpose:** Approved business writes are replay-safe and atomic.

**Deliverables**

- Use an idempotency receipt with a database uniqueness constraint inside the
  same transaction as domain writes and audit records.
- Return the original committed result for a duplicate request; make an active
  receipt explicitly recoverable/retryable.
- Expand the kernel by operation family, with transaction boundaries reviewed
  before each migration.

**Current local progress**

- Complete slice: `order.confirm` now uses `AgentCommitReceipt` in the same
  transaction as its order, invoice, and audit writes.
- Remaining: deploy the migration; handle active/incomplete receipt recovery;
  extend to the other high-risk commit families.

**Acceptance**

- Concurrent/retried `order.confirm` produces one order transition, one
  invoice, one audit record, and stable returned output.

### M5 — One orchestration and tool contract

**Purpose:** One canonical Agent execution path owns policy, dispatch, audit,
approval, and recovery.

**Deliverables**

- Remove duplicate registry/dispatch paths and static/dynamic tool drift.
- Define one typed tool lifecycle: planned → validated → approval_required →
claimed → committed/failed/cancelled.
- Move process-specific `if` chains behind explicit operation adapters.

**Acceptance**

- Every exposed tool has one policy source, one execution path, and consistent
audit/error/approval behavior.

### M6 — Knowledge, evaluation, and operations evidence

**Purpose:** The Agent can justify its decisions and operators can detect gaps.

**Deliverables**

- Enforce actor-aware ACL filtering for knowledge retrieval.
- Replace stub memory/knowledge paths with durable retrieval where applicable.
- Add multi-scenario evaluation covering read, write, approval, timeout,
restart, retry, and permission failure paths.
- Expose run/approval/commit health and recovery state to operators.

**Acceptance**

- Evaluation covers the complete lifecycle, and no user sees knowledge or run
data outside their permitted scope.

## 4. Current execution point

The critical path is **M0 → M1 → M2 → M3 → M4 → M5 → M6**.

Current work has implemented local enabling slices now belonging to M2, M3,
and M4, but no milestone is production-complete. That is useful groundwork,
not a reason to bypass the product proof.

The next active task is **M0: map and verify the current Production Pipeline →
Agent → approval → stage update workflow**, then close the highest-risk gap in
M1: expose the required `production.*` tools to the Agent and replace the
direct UI write path with the same enforced approval/operation contract. M2
reviewer scope/payload validation and M3 durable continuation follow that
concrete user path.

## 5. Current local evidence

- Targeted Agent regression suite: **158 tests passed**.
- TypeScript: `npx tsc --noEmit` passed.
- Prisma schema: `npx prisma validate` passed.
- Production status: **not deployed to the data-center Mac mini**.
