import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeTool } from '../toolRuntime';
import {
  registerOrderChangesFlowTools,
  buildOrderChangeCreateDraft,
  buildOrderChangeWithdrawDraft,
} from '../orderChangesFlow';

const mocks = vi.hoisted(() => ({
  createChangeRequest: vi.fn(),
  withdrawChangeRequest: vi.fn(),
}));

vi.mock('../../orderChanges/orderChangeRequestService', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createOrderChangeRequestService: () => ({
      createChangeRequest: mocks.createChangeRequest,
      withdrawChangeRequest: mocks.withdrawChangeRequest,
    }),
  };
});
vi.mock('../../approvals/approvalRoutingService', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, createApprovalRoutingService: () => ({}) };
});
vi.mock('../../approvals/approvalCreateService', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, createApprovalCreateService: () => ({}) };
});

registerOrderChangesFlowTools();

const createInput = {
  orderId: 'ORD-1',
  changeType: 'quantity',
  beforeSnapshot: { quantity: 200 },
  afterDelta: { quantity: 180 },
  changeReason: '客户要求减少订单数量以匹配实际产能',
  impactSummary: '数量减少 20 件，金额同步下调',
  requesterId: 'usr_1',
};

describe('order_changes create/withdraw executeTool commit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('order_changes.create approved → committed', async () => {
    const draft = buildOrderChangeCreateDraft({ input: createInput });
    mocks.createChangeRequest.mockResolvedValue({ ok: true, data: { changeRequest: { id: 'OCR_1', requestNumber: 'OCR-1' }, approvalRequestId: 'AR-BIZ-1' } });
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-1', status: 'approved', actionType: 'tool:order_changes.create', payload: { processDraft: draft } }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.create', input: {}, approvalId: 'AP-1' } as any);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('committed');
    expect(result.changeRequestId).toBe('OCR_1');
    expect(mocks.createChangeRequest).toHaveBeenCalledTimes(1);
  });

  it('order_changes.withdraw approved → committed', async () => {
    const draft = buildOrderChangeWithdrawDraft({ changeRequestId: 'OCR_1', actorId: 'usr_1' });
    mocks.withdrawChangeRequest.mockResolvedValue({ ok: true, data: { changeRequest: { id: 'OCR_1', status: 'Cancelled' } } });
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-2', status: 'approved', actionType: 'tool:order_changes.withdraw', payload: { processDraft: draft } }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.withdraw', input: {}, approvalId: 'AP-2' } as any);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('committed');
    expect(mocks.withdrawChangeRequest).toHaveBeenCalledTimes(1);
  });

  it('approval missing → APPROVAL_ID_MISSING，service 不调用', async () => {
    const result: any = await executeTool({} as any, { toolId: 'order_changes.create', input: {} } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_ID_MISSING');
    expect(mocks.createChangeRequest).not.toHaveBeenCalled();
  });

  it('pending approval → APPROVAL_PENDING，service 不调用', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-1', status: 'pending', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.create', input: {}, approvalId: 'AP-1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_PENDING');
    expect(mocks.createChangeRequest).not.toHaveBeenCalled();
  });

  it('modified approval → APPROVAL_MODIFIED_UNSUPPORTED，service 不调用', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-2', status: 'modified', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.withdraw', input: {}, approvalId: 'AP-2' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_MODIFIED_UNSUPPORTED');
    expect(mocks.withdrawChangeRequest).not.toHaveBeenCalled();
  });

  it('approved 但 draft hash 被篡改 → PROCESS_DRAFT_HASH_MISMATCH，service 不调用', async () => {
    const draft = buildOrderChangeCreateDraft({ input: createInput });
    const tampered = { ...draft, subOperations: [{ ...draft.subOperations[0], after: { ...(draft.subOperations[0].after as any), changeReason: '篡改后的理由xxxxxxxxxxxx' } }] };
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-1', status: 'approved', actionType: 'tool:order_changes.create', payload: { processDraft: tampered } }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.create', input: {}, approvalId: 'AP-1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('PROCESS_DRAFT_HASH_MISMATCH');
    expect(mocks.createChangeRequest).not.toHaveBeenCalled();
  });

  it('重复注册保持幂等（重复调用 register 不破坏分发）', async () => {
    registerOrderChangesFlowTools();
    const draft = buildOrderChangeWithdrawDraft({ changeRequestId: 'OCR_9', actorId: 'usr_1' });
    mocks.withdrawChangeRequest.mockResolvedValue({ ok: true, data: { changeRequest: { id: 'OCR_9', status: 'Cancelled' } } });
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP-9', status: 'approved', actionType: 'tool:order_changes.withdraw', payload: { processDraft: draft } }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'order_changes.withdraw', input: {}, approvalId: 'AP-9' } as any);
    expect(result.ok).toBe(true);
    expect(result.changeRequestId).toBe('OCR_9');
  });
});
