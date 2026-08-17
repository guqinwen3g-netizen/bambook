import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildCustomsRegisterLcDraft,
  validateCustomsRegisterLcDraftSemantics,
  verifyCustomsRegisterLcDraftHash,
  commitCustomsRegisterLc,
  buildCustomsUpdateDeclarationDraft,
  validateCustomsUpdateDeclarationDraftSemantics,
  commitCustomsUpdateDeclaration,
  buildCustomsFlowError,
  type CustomsFlowErrorCode,
} from '../customsFlow';

vi.mock('../../customs/customsService', () => ({
  createCustomsService: vi.fn(),
  LETTER_OF_CREDIT_CREATE_FIELDS: [
    'lcNumber', 'relationId', 'orderId', 'type', 'issueDate', 'issueBank', 'advisingBank',
    'negotiatingBank', 'confirmingBank', 'applicant', 'beneficiary', 'amount', 'currency',
    'availableAmount', 'expiryDate', 'expiryPlace', 'presentationDeadline', 'shipmentDeadline',
    'tradeTerms', 'portOfLoading', 'portOfDischarge', 'documentsRequired', 'specialConditions',
    'discrepancies', 'notes',
  ],
  CUSTOMS_DECLARATION_UPDATE_FIELDS: [
    'declarationNumber', 'shipmentId', 'orderId', 'relationId', 'type', 'declarationDate',
    'customsCode', 'declarationPort', 'tradeTerms', 'totalValue', 'currency', 'totalPackages',
    'grossWeight', 'netWeight', 'originCountry', 'destinationCountry', 'consignee', 'consignor',
    'declarant', 'agent', 'notes',
  ],
}));
import { createCustomsService } from '../../customs/customsService';

const createLetterOfCredit = vi.fn();
const updateDeclaration = vi.fn();

const lcInput = {
  lcNumber: 'LC-2026-0001',
  type: 'Irrevocable',
  amount: 120000,
  currency: 'USD',
  applicant: 'Globex Apparel',
  beneficiary: 'Bambook Textile',
  expiryDate: '2026-12-31',
};

describe('task customs-flow: buildCustomsRegisterLcDraft', () => {
  it('生成含六字段的 ProcessDraft（toolId/action/impactScope/idempotencyKey）', () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    expect(draft.subOperations[0].toolId).toBe('customs.register_lc');
    expect(draft.subOperations[0].action).toBe('create_letter_of_credit');
    expect((draft.subOperations[0].after as any).lcNumber).toBe('LC-2026-0001');
    expect(draft.beforeAfterDiff.length).toBe(Object.keys(lcInput).length);
    expect(draft.impactScope).toEqual(['customs', 'entity-links', 'audit']);
    expect(draft.irreversible).toBe(false);
    expect(draft.postCommitHooks).toEqual([]);
    expect(draft.idempotencyKey).toContain('customs.register_lc:LC-2026-0001:');
  });
});

describe('task customs-flow: buildCustomsUpdateDeclarationDraft', () => {
  it('生成含 declarationId+patch 的 ProcessDraft（before 用 currentSnapshot）', () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { declarationPort: '上海港' }, currentSnapshot: { declarationPort: '宁波港' } });
    expect(draft.subOperations[0].toolId).toBe('customs.update_declaration');
    expect((draft.subOperations[0].after as any).declarationId).toBe('CD__1');
    expect(draft.beforeAfterDiff[0]).toMatchObject({ entity: 'customsDeclaration', entityId: 'CD__1', field: 'declarationPort', before: '宁波港', after: '上海港' });
    expect(draft.idempotencyKey).toContain('customs.update_declaration:CD__1:');
  });
});

describe('task customs-flow: validateCustomsRegisterLcDraftSemantics（fail closed）', () => {
  it('缺 type → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { ...lcInput, type: undefined } }] } as any;
    const r = validateCustomsRegisterLcDraftSemantics(draft);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SEMANTIC_VALIDATION_FAILED');
  });

  it('amount <= 0 → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { ...lcInput, amount: 0 } }] } as any;
    expect(validateCustomsRegisterLcDraftSemantics(draft).ok).toBe(false);
  });

  it('amount 非有限数 → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { ...lcInput, amount: Number.NaN } }] } as any;
    expect(validateCustomsRegisterLcDraftSemantics(draft).ok).toBe(false);
  });

  it('合法 draft → ok', () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    expect(validateCustomsRegisterLcDraftSemantics(draft).ok).toBe(true);
  });
});

describe('task customs-flow: validateCustomsUpdateDeclarationDraftSemantics（fail closed）', () => {
  it('缺 declarationId → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { patch: { notes: 'x' } } }] } as any;
    expect(validateCustomsUpdateDeclarationDraftSemantics(draft).ok).toBe(false);
  });

  it('patch 为空 → SEMANTIC_VALIDATION_FAILED', () => {
    const draft = { subOperations: [{ after: { declarationId: 'CD__1', patch: {} } }] } as any;
    expect(validateCustomsUpdateDeclarationDraftSemantics(draft).ok).toBe(false);
  });

  it('合法 draft → ok', () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { notes: 'x' } });
    expect(validateCustomsUpdateDeclarationDraftSemantics(draft).ok).toBe(true);
  });
});

describe('task customs-flow: commitCustomsRegisterLc（复用 service）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createCustomsService as any).mockReturnValue({ createLetterOfCredit, updateDeclaration });
  });

  it('draft 缺失 → PROCESS_DRAFT_MISSING', async () => {
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('PROCESS_DRAFT_MISSING');
    expect(createLetterOfCredit).not.toHaveBeenCalled();
  });

  it('hash 篡改 → PROCESS_DRAFT_HASH_MISMATCH，service 不被调', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { ...lcInput, amount: 999999 } }] };
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: tampered } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('PROCESS_DRAFT_HASH_MISMATCH');
    expect(createLetterOfCredit).not.toHaveBeenCalled();
  });

  it('非法字段（status 不走创建通道）→ INVALID_INPUT，service 不被调', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: { ...lcInput, status: 'Issued' } });
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('INVALID_INPUT');
    expect(createLetterOfCredit).not.toHaveBeenCalled();
  });

  it('成功 commit → committed，svc.createLetterOfCredit 以 actor=agent 调用一次', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    createLetterOfCredit.mockResolvedValue({ id: 'LC__1', lcNumber: 'LC-2026-0001' });
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.feedback.status).toBe('committed');
      expect(r.feedback.entityId).toBe('LC__1');
      expect(r.feedback.documentNumber).toBe('LC-2026-0001');
      expect(r.feedback.idempotencyKey).toBe(draft.idempotencyKey);
    }
    expect(createLetterOfCredit).toHaveBeenCalledTimes(1);
    expect(createLetterOfCredit).toHaveBeenCalledWith(expect.objectContaining({ lcNumber: 'LC-2026-0001' }), 'agent');
  });

  it('service 抛「非法信用证类型」→ INVALID_LC_TYPE', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: { ...lcInput, type: 'Bad' } });
    createLetterOfCredit.mockRejectedValue(new Error('非法信用证类型: Bad'));
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('INVALID_LC_TYPE');
  });

  it('service 抛「已存在」→ DUPLICATE_LC_NUMBER', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    createLetterOfCredit.mockRejectedValue(new Error('信用证号 LC-2026-0001 已存在'));
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('DUPLICATE_LC_NUMBER');
  });

  it('service 抛未知错 → CREATE_FAILED', async () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    createLetterOfCredit.mockRejectedValue(new Error('db connection lost'));
    const r = await commitCustomsRegisterLc({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('CREATE_FAILED');
  });
});

describe('task customs-flow: commitCustomsUpdateDeclaration（复用 service）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createCustomsService as any).mockReturnValue({ createLetterOfCredit, updateDeclaration });
  });

  it('lines 不在 patch 通道 → INVALID_INPUT，service 不被调', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { lines: [{ productName: 'x' }] } });
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('INVALID_INPUT');
    expect(updateDeclaration).not.toHaveBeenCalled();
  });

  it('成功 commit → committed，svc.updateDeclaration 以 actor=agent 调用一次', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { declarationPort: '上海港' }, currentSnapshot: { declarationPort: '宁波港' } });
    updateDeclaration.mockResolvedValue({ id: 'CD__1', declarationNumber: 'CD-2026-0001' });
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.feedback.status).toBe('committed');
      expect(r.feedback.entityId).toBe('CD__1');
      expect(r.feedback.documentNumber).toBe('CD-2026-0001');
    }
    expect(updateDeclaration).toHaveBeenCalledTimes(1);
    expect(updateDeclaration).toHaveBeenCalledWith('CD__1', { declarationPort: '上海港' }, 'agent');
  });

  it('hash 篡改 → PROCESS_DRAFT_HASH_MISMATCH，service 不被调', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { notes: 'a' } });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { declarationId: 'CD__1', patch: { notes: 'b' } } }] };
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: tampered } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('PROCESS_DRAFT_HASH_MISMATCH');
    expect(updateDeclaration).not.toHaveBeenCalled();
  });

  it('service 抛「不存在」→ NOT_FOUND', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__X', patch: { notes: 'x' } });
    updateDeclaration.mockRejectedValue(new Error('报关单 CD__X 不存在'));
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('NOT_FOUND');
  });

  it('service 抛「不可编辑」→ NOT_EDITABLE', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { notes: 'x' } });
    updateDeclaration.mockRejectedValue(new Error('报关单状态 Released 不可编辑（仅 Draft 可编辑）'));
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('NOT_EDITABLE');
  });

  it('service 抛「非法报关类型」→ INVALID_CUSTOMS_TYPE', async () => {
    const draft = buildCustomsUpdateDeclarationDraft({ declarationId: 'CD__1', patch: { type: 'Bad' } });
    updateDeclaration.mockRejectedValue(new Error('非法报关类型: Bad'));
    const r = await commitCustomsUpdateDeclaration({ prisma: {} as any, approvalId: 'AP1', approvalPayload: { processDraft: draft } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.feedback as any).error.code).toBe('INVALID_CUSTOMS_TYPE');
  });
});

describe('task customs-flow: verifyCustomsRegisterLcDraftHash', () => {
  it('原始 draft hash 自洽', () => {
    const draft = buildCustomsRegisterLcDraft({ input: lcInput });
    expect(verifyCustomsRegisterLcDraftHash(draft).ok).toBe(true);
  });
});

describe('task customs-flow: error code userAction', () => {
  it('所有 code 有 userAction', () => {
    const codes: CustomsFlowErrorCode[] = [
      'APPROVAL_ID_MISSING', 'APPROVAL_NOT_FOUND', 'APPROVAL_MODIFIED_UNSUPPORTED',
      'PROCESS_DRAFT_MISSING', 'PROCESS_DRAFT_HASH_MISMATCH', 'SEMANTIC_VALIDATION_FAILED',
      'INVALID_INPUT', 'INVALID_LC_TYPE', 'INVALID_CUSTOMS_TYPE', 'NOT_FOUND',
      'DUPLICATE_LC_NUMBER', 'NOT_EDITABLE', 'CREATE_FAILED', 'UPDATE_FAILED',
    ];
    for (const code of codes) expect(buildCustomsFlowError(code, 'test').userAction.length).toBeGreaterThan(0);
  });
});
