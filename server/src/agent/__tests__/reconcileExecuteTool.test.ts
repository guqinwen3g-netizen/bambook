import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { executeTool } from '../toolRuntime';
import { buildPaymentReconcileDraft } from '../reconcileFlow';

// ============================================================================
// task Agent-P1: payment.receive_and_reconcile 真实 executeTool 行为测试
// 覆盖竹衍codex 要求：approvalId commit / 无 approvalId fail / modified fail / not approved fail
// ============================================================================

function makeCommitTx() {
  const voucher = { id: 'V1', amount: new Prisma.Decimal(1000), deletedAt: null, status: 'active', currency: 'USD' };
  const invoices = { I1: { id: 'I1', amount: new Prisma.Decimal(600), deletedAt: null, status: 'Issued', currency: 'USD' } };
  // applyAllocation 的 select 子句包含 voucherId + invoiceId（用于幂等再申请的排除过滤器）
  const allocsForRecalc = [{ appliedAmount: new Prisma.Decimal(600), voucherId: 'V1', invoiceId: 'I1' }];
  return {
    paymentVoucher: {
      findUnique: vi.fn().mockResolvedValue(voucher),
      update: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => invoices[where.id as keyof typeof invoices] ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
    invoiceAllocation: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(allocsForRecalc),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  };
}

describe('task Agent-P1: executeTool payment.receive_and_reconcile commit 路径', () => {
  it('skipApprovalCheck + approvalId + approved payload → committed', async () => {
    const draft = buildPaymentReconcileDraft({
      voucherId: 'V1', voucherAmount: 1000, currency: 'USD',
      allocations: [{ invoiceId: 'I1', appliedAmount: 600 }],
    });
    const tx = makeCommitTx();
    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'AP1', status: 'approved', payload: { processDraft: draft },
        }),
      },
    } as any;

    const result = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: { voucherId: 'V1', voucherAmount: 1000, currency: 'USD', allocations: [{ invoiceId: 'I1', appliedAmount: 600 }] },
      approvalId: 'AP1',
    } as any);

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('status', 'committed');
    expect(result).toHaveProperty('voucherId', 'V1');
  });

  it('无 approvalId → fail closed（APPROVAL_ID_MISSING）', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn() } } as any;
    const result: any = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: {},
    } as any);

    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_ID_MISSING');
    // 不调用 commit
    expect(prisma.approvalRequest.findUnique).not.toHaveBeenCalled();
  });

  it('approval 不存在 → fail closed（APPROVAL_NOT_FOUND）', async () => {
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any;
    const result: any = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: {},
      approvalId: 'NOPE',
    } as any);

    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_NOT_FOUND');
  });

  it('approval status=modified → fail closed（APPROVAL_MODIFIED_UNSUPPORTED）', async () => {
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'modified', payload: {} }) },
    } as any;
    const result: any = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: {},
      approvalId: 'AP1',
    } as any);

    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_MODIFIED_UNSUPPORTED');
  });

  it('approval status=pending（未审批）→ fail closed（APPROVAL_PENDING）', async () => {
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'pending', payload: {} }) },
    } as any;
    const result: any = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: {},
      approvalId: 'AP1',
    } as any);

    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_PENDING');
  });

  it('approval payload 无 processDraft → fail closed（PROCESS_DRAFT_MISSING，不伪成功）', async () => {
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'approved', payload: {} }) },
      $transaction: vi.fn(),
    } as any;
    const result: any = await executeTool(prisma, {
      toolId: 'payment.receive_and_reconcile',
      input: {},
      approvalId: 'AP1',
    } as any);
    // fail-closed：返回结构化错误（不 throw），不伪成功
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('PROCESS_DRAFT_MISSING');
    // $transaction 不调用（no service bypass）
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});


// ============================================================================
// task Agent-P1: executeAgentTool 首次调用 → approval_required + processDraft
// ============================================================================
import { executeAgentTool } from '../toolRuntime';

describe('task Agent-P1: executeAgentTool payment.receive_and_reconcile draft→approval', () => {
  it('首次调用 → approval_required + payload 含 processDraft', async () => {
    // mock prisma: createPendingApprovalRequest 写 approvalRequest
    let createdApproval: any = null;
    const prisma = {
      approvalRequest: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          createdApproval = data;
          return data;
        }),
      },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    } as any;

    const actor = { userId: 'user1', role: 'admin', id: 'user1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma,
      actor,
      toolId: 'payment.receive_and_reconcile',
      toolInput: {
        voucherId: 'V1', voucherAmount: 1000, currency: 'USD',
        allocations: [{ invoiceId: 'I1', appliedAmount: 600 }],
      },
      sessionId: 's1',
    });

    // 首次调用被 approval 拦截
    expect(result.status).toBe('approval_required');
    expect(result.approvalRequired).toBe(true);
    // processDraft 存在（payment 的 6 字段）
    expect(result.processDraft).toBeTruthy();
    expect(result.processDraft.subOperations).toHaveLength(1);
    expect(result.processDraft.impactScope).toEqual(['vouchers', 'invoices', 'allocations']);
    // approvalRequest.create 写入 payload 含 processDraft
    expect(createdApproval).toBeTruthy();
    expect(createdApproval.payload.processDraft).toBeTruthy();
    expect(createdApproval.payload.processDraft.subOperations).toHaveLength(1);
  });

  it('首次调用缺失 allocations → preconditions_failed fail closed', async () => {
    const prisma = {
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
    } as any;
    const actor = { userId: 'user1', role: 'admin', id: 'user1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma,
      actor,
      toolId: 'payment.receive_and_reconcile',
      toolInput: { voucherId: 'V1', voucherAmount: 1000, currency: 'USD' }, // 无 allocations
      sessionId: 's1',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(result.message).toContain('PAYMENT_RECONCILE_PRECONDITIONS_FAILED');
  });
});

// ============================================================================
// task Agent-P1-payment-receive-and-reconcile-service-reuse: Decimal-safe 公开契约
// ============================================================================
describe('task reconcile-service-reuse: Decimal string draft preservation + manifest/toolRegistry contract', () => {
  it('executeAgentTool 输入高精度 Decimal string → approval processDraft 保持原字符串', async () => {
    const prisma = {
      approvalRequest: { create: vi.fn().mockImplementation(async ({ data }: any) => data) },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    } as any;
    const actor = { userId: 'user1', role: 'admin', id: 'user1', roles: ['admin'], toolScopes: ['finance'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma,
      actor,
      toolId: 'payment.receive_and_reconcile',
      toolInput: {
        voucherId: 'V1', voucherAmount: 1000, currency: 'USD',
        allocations: [{ invoiceId: 'I1', appliedAmount: '123456789012345.1234' }],
      },
      sessionId: 's1',
    });
    expect(result.status).toBe('approval_required');
    expect(result.processDraft.subOperations[0].after.appliedAmount).toBe('123456789012345.1234');
    const createdData = prisma.approvalRequest.create.mock.calls[0][0].data;
    expect(createdData.payload.processDraft.subOperations[0].after.appliedAmount).toBe('123456789012345.1234');
  });

  it('manifest inputHint 推荐 Decimal string', () => {
    const manifest = fs.readFileSync(path.resolve(__dirname, '../mcp/manifest.ts'), 'utf-8');
    const entry = manifest.slice(manifest.indexOf("id: 'payment.receive_and_reconcile'"), manifest.indexOf("id: 'order.ship'"));
    expect(entry).toContain('appliedAmount: string');
    expect(entry).toContain("'600.0000'");
  });

  it('toolRegistry schema appliedAmount 描述 Decimal string', () => {
    const registry = fs.readFileSync(path.resolve(__dirname, '../toolRegistry.ts'), 'utf-8');
    const entry = registry.slice(registry.indexOf("id: 'payment.receive_and_reconcile'"), registry.indexOf("id: 'order.ship'"));
    expect(entry).toContain("appliedAmount");
    expect(entry).toContain("Decimal string");
    expect(entry).toContain("type: ['string', 'number']");
  });
});
