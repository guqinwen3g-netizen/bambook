import { describe, expect, it, vi } from 'vitest';
import {
  buildRelationOnboardDraft,
  validateRelationOnboardDraftSemantics,
  verifyRelationOnboardDraftHash,
  commitRelationOnboard,
  buildRelationOnboardError,
  type RelationOnboardErrorCode,
} from '../relationOnboardFlow';

describe('task relation-onboard: buildRelationOnboardDraft', () => {
  it('org-only 生成 1 个 subOperation', () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'Test', category: 'Customer' } });
    expect(draft.subOperations).toHaveLength(1);
    expect(draft.subOperations[0].toolId).toBe('relations.create');
    expect(draft.impactScope).toEqual(['relations']);
    expect(draft.idempotencyKey).toContain('relation.onboard:O1');
  });

  it('org+contact 生成 2 个 subOperation，contact parentId 指向 org', () => {
    const draft = buildRelationOnboardDraft({
      organization: { id: 'O1', name: 'Test', category: 'Customer' },
      contact: { id: 'C1', name: 'Zhang', email: 'z@t.com' },
    });
    expect(draft.subOperations).toHaveLength(2);
    expect((draft.subOperations[1].after as any).parentId).toBe('O1');
    expect((draft.subOperations[1].after as any).isOrganization).toBe(false);
  });
});

describe('task relation-onboard: hash 防篡改', () => {
  it('原始 draft hash 通过', () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    expect(verifyRelationOnboardDraftHash(draft).ok).toBe(true);
  });
  it('篡改 name → hash 不匹配', () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { ...draft.subOperations[0].after, name: 'HACKED' } }] };
    expect(verifyRelationOnboardDraftHash(tampered).ok).toBe(false);
  });
});

describe('task relation-onboard: validateRelationOnboardDraftSemantics（fail closed）', () => {
  it('非法 category → INVALID_CATEGORY', () => {
    const draft = { subOperations: [{ after: { id: 'O1', name: 'T', category: 'Flying' } }], idempotencyKey: 't' } as any;
    const r = validateRelationOnboardDraftSemantics(draft);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('INVALID_CATEGORY');
  });
  it('缺 org name → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { id: 'O1', category: 'Customer' } }], idempotencyKey: 't' } as any;
    const r = validateRelationOnboardDraftSemantics(draft);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SEMANTIC_VALIDATION_FAILED');
  });
  it('合法 draft → ok', () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    expect(validateRelationOnboardDraftSemantics(draft).ok).toBe(true);
  });

  it('缺 category → 默认 Other（draft 合法，不 fail）', () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: '' } });
    expect((draft.subOperations[0].after as any).category).toBe('Other');
    expect(validateRelationOnboardDraftSemantics(draft).ok).toBe(true);
  });
});

describe('task relation-onboard: 9 error code userAction', () => {
  it('所有 code 有 userAction', () => {
    const codes: RelationOnboardErrorCode[] = ['APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED', 'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED', 'INVALID_CATEGORY', 'COMMIT_TRANSACTION_FAILED', 'UNKNOWN_ERROR'];
    for (const code of codes) {
      expect(buildRelationOnboardError(code, 'test').userAction.length).toBeGreaterThan(0);
    }
  });
});

// commit 集成测试
function makeOnboardTx(opts: { upsertFail?: boolean; syncFail?: boolean } = {}) {
  const relationUpsert = opts.upsertFail
    ? vi.fn().mockRejectedValue(new Error('UPSERT_FAIL'))
    : vi.fn().mockImplementation(async ({ where, create }: any) => ({ ...where, ...create, id: where.id }));
  const entityRefUpsert = opts.syncFail
    ? vi.fn().mockRejectedValue(new Error('SYNC_FAIL'))
    : vi.fn().mockResolvedValue({});
  const entityLinkUpsert = vi.fn().mockResolvedValue({});
  const entityLinkFindMany = vi.fn().mockResolvedValue([]);
  const auditCreate = vi.fn().mockResolvedValue({});
  return {
    tx: {
      relation: { upsert: relationUpsert },
      auditLog: { create: auditCreate },
      entityReference: { upsert: entityRefUpsert },
      entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: vi.fn().mockResolvedValue({}) },
    },
    relationUpsert, auditCreate, entityRefUpsert,
  };
}

describe('task relation-onboard: commitRelationOnboard', () => {
  it('draft 缺失 → PROCESS_DRAFT_MISSING', async () => {
    const prisma = { $transaction: vi.fn() } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('PROCESS_DRAFT_MISSING');
  });
  it('hash 篡改 → PROCESS_DRAFT_HASH_MISMATCH', async () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    const tampered = { ...draft, idempotencyKey: 'relation.onboard:O1:pd:bogus' };
    const prisma = { $transaction: vi.fn() } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: tampered } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('PROCESS_DRAFT_HASH_MISMATCH');
  });
  it('成功 commit（org+contact）→ committed（org + contact + sync + audit）', async () => {
    const draft = buildRelationOnboardDraft({
      organization: { id: 'O1', name: 'T', category: 'Customer' },
      contact: { id: 'C1', name: 'Zhang', email: 'z@t.com' },
    });
    const { tx, relationUpsert, auditCreate } = makeOnboardTx();
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.feedback.status).toBe('committed');
      expect(r.feedback.organizationId).toBe('O1');
      expect(r.feedback.contactId).toBe('C1');
      // org + contact 各 upsert 一次
      expect(relationUpsert).toHaveBeenCalledTimes(2);
      // audit 事务内
      expect(auditCreate).toHaveBeenCalledTimes(1);
    }
  });
  it('org-only commit（无 contact）→ committed + contactId null', async () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    const { tx } = makeOnboardTx();
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feedback.contactId).toBeNull();
  });
  it('sync reject → COMMIT_TRANSACTION_FAILED（不伪成功）', async () => {
    const draft = buildRelationOnboardDraft({
      organization: { id: 'O1', name: 'T', category: 'Customer' },
      contact: { id: 'C1', name: 'Zhang', category: 'Customer' },
    });
    const { tx } = makeOnboardTx({ syncFail: true });
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('COMMIT_TRANSACTION_FAILED');
  });
  it('upsert reject → COMMIT_TRANSACTION_FAILED', async () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    const { tx } = makeOnboardTx({ upsertFail: true });
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const r = await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('COMMIT_TRANSACTION_FAILED');
  });

  it('org-only（无 contact）不产生 belongsTo EntityLink（sync 语义边界）', async () => {
    const draft = buildRelationOnboardDraft({ organization: { id: 'O1', name: 'T', category: 'Customer' } });
    const { tx, entityRefUpsert, relationUpsert } = makeOnboardTx();
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    await commitRelationOnboard({ prisma, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    // org-only: 仅 1 次 upsert（org），syncRelationEntityReferences 对 organization 直接 return（不产生 link）
    expect(relationUpsert).toHaveBeenCalledTimes(1);
    expect(entityRefUpsert).not.toHaveBeenCalled();
  });
});
