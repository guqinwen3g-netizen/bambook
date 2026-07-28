# P0-B: Tool Registry Schema Acceptance Baseline

> Status: **ACCEPTED** — locked as implementation verification baseline
> Owner: BAMBOOK 项目总设计师
> Reviewer: 竹衍codex
> Task: task_mqwmt9fa

## 1. Design Principles

1. **Flow API != replacement for atomic tools.** Flow APIs encapsulate cross-module transactions as auditable business actions via composedOf, approvalPolicy, idempotencyKey, partialFailurePolicy, rollback/compensationPolicy. Audit subjects are derived from subOperations and impactScope (no separate auditSubjects field).
2. **What you approve is what you commit.** commitTransaction may only consume an already-approved ProcessDraft. No state drift window between approval and commit.
3. **ERP data integrity first.** Prefer draft -> approval -> Prisma $transaction atomic commit. Saga compensation only for unwrappable operations (e.g., external.run).
4. **Post-commit notifications are best-effort.** Email/SMS failures do not roll back committed main data; they enter a retry queue.

## 2. ToolDefinition Required Fields

Upgrades the current ToolDescriptor (which only has id/name/scope/risk/description/inputHint).

```typescript
interface ToolDefinition {
  id: string;           // dot-notated, globally unique (e.g., "products.search")
  name: string;         // human-readable
  scope: string;        // permission domain
  risk: 'low' | 'medium' | 'high';
  description: string;

  inputSchema: object;  // JSON Schema (replaces inputHint string)
  outputSchema: object; // JSON Schema (NEW)

  approvalPolicy: 'never' | 'auto' | 'always';  // NEW

  processSpec?: ProcessSpec;  // optional, flow APIs only (NEW)
}
```

**Changes from current ToolDescriptor:**
- inputHint (string) -> inputSchema (JSON Schema object)
- NEW: outputSchema (JSON Schema object)
- NEW: approvalPolicy ('never' | 'auto' | 'always')
- NEW: processSpec (optional, flow APIs only)
- DEPRECATED: inputHint

## 3. approvalPolicy: Precise Definition + Four Slice Mapping

| Value | Definition | Audit | Slice |
|---|---|---|---|
| never | Strictly read-only / no side effects | No audit needed | products.search |
| auto | Has side effects but not high-risk | Audit recorded, no approval gate | knowledge.ingest (medium-risk write) |
| always | High-risk write or flow action | Approval gate mandatory | orders.update_status, order.confirm |

**Evaluation rule:**
- approvalPolicy = 'always' -> unconditional approval
- approvalPolicy = 'auto' -> evaluate by risk: low -> skip, medium -> skip approval but record audit, high -> escalate to approval
- approvalPolicy = 'never' -> skip approval entirely

**Note:** orders.update_status uses 'always' in P0-B to verify the unconditional approval path. Whether high-risk atomic writes should migrate to auto -> risk-based approval will be decided during the 74-tool bulk migration.

## 4. ProcessDraft Required Structure

ProcessDraft is the single source of truth for both the approval card content AND the commit transaction input.

```typescript
interface ProcessDraft {
  subOperations: SubOperation[];     // every child operation
  beforeAfterDiff: FieldDiff[];      // field-level diff
  impactScope: string[];             // affected modules
  irreversible: boolean;             // cannot rollback post-commit
  postCommitHooks: PostCommitHook[]; // best-effort post-commit actions
  idempotencyKey: string;            // canonical hash, prevents duplicate
}

interface SubOperation {
  toolId: string;
  entityId: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface FieldDiff {
  entity: string;
  entityId: string;
  field: string;
  before: unknown;
  after: unknown;
}

interface PostCommitHook {
  type: 'email' | 'sms' | 'webhook' | 'notification';
  payload: Record<string, unknown>;
}
```

**Hard acceptance: all six fields required, no half-baked drafts.**

## 5. ProcessSpec (Flow API Only)

```typescript
interface ProcessSpec {
  composedOf: string[];
  draftPhase: { produces: 'ProcessDraft' };
  approvalPhase: {
    consumes: 'ProcessDraft';
    approvalCard: {
      changeList: boolean;        // must show all sub-operations
      irreversibleMarkers: boolean; // mark non-rollbackable
      impactScope: boolean;       // cross-module impact
    };
  };
  commitTransaction: {
    consumes: 'ProcessDraft';
    wrapper: 'prisma_transaction';
  };
  postCommitHooks: Array<{
    type: 'email' | 'sms' | 'webhook' | 'notification';
    failurePolicy: 'queue_retry';
    rollbackOnFailure: false;
  }>;
  partialFailurePolicy: {
    draftFail: 'abort_no_approval';
    transactionFail: 'rollback';
    postCommitFail: 'queue_retry';
  };
  rollbackPolicy?: {
    strategy: 'none' | 'compensation';
    appliesTo: string[];
  };
}
```

**Failure strategy (locked):**
- Draft phase failure -> abort, do not enter approval flow
- Transaction failure -> automatic rollback via Prisma $transaction, no dirty data
- Post-commit failure -> main data preserved, notification enters retry queue, no rollback

**Rollback/compensation only for unwrappable operations** (e.g., external.run). Main flow APIs do not require saga.

## 6. P0-B Scope Boundary: draftPhase Only

| Phase | P0-B | P1 |
|---|---|---|
| ToolDefinition schema (registry + fallback) | YES | - |
| Four vertical slices | YES | - |
| ProcessDraft structured output | YES (output only) | - |
| ApprovalRequest.payload (ProcessDraft as content) | - | YES |
| Frontend approval card (renders ProcessDraft) | - | YES |
| commitTransaction (Prisma $transaction) | - | YES |
| postCommitHooks execution engine | - | YES |

**Key:** P0-B outputs complete ProcessDraft as input for P1. No half-baked output.

## 7. Approval Iron Law (Unchanged)

Six categories always high-risk, no exceptions:
1. Financial: create_invoice, create_voucher, apply_voucher
2. Outbound: email.send, email.sync
3. Status transitions: update_status, batch_status, update_stage, convert_to_order
4. Master data creation: products.create, relations.create
5. External execution: external.run
6. AI extraction: email.ai_extract

**Flow API rule:** If a flow API contains any of the above, the entire flow is high-risk with mandatory approval.

## 8. Flow API Priority (Post P0-B)

| Priority | Flow API | Composed Of |
|---|---|---|
| P1 | order.confirm | update_status(Confirmed) + email.send + finance.create_invoice |
| P1 | payment.receive_and_reconcile | create_voucher + apply_voucher_to_invoice |
| P2 | order.ship | create_shipment + update_status(Shipping) |
| P2 | invoice.issue | create_invoice + email.send |
| P3 | relation.onboard | relations.create + relations.create(contact) + email.send |
| P3 | email.reply_and_send | email.draft_reply + email.send |
