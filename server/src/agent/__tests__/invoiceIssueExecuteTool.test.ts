import { describe, expect, it, vi } from 'vitest';
import { executeTool, executeAgentTool } from '../toolRuntime';
import { buildInvoiceIssueDraft } from '../invoiceIssueFlow';

function makeCommitTx() {
  return {
    invoice: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id })) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe('task invoice-issue: executeTool commit 路径', () => {
  it('skipApprovalCheck + approved → committed (Issued)', async () => {
    const draft = buildInvoiceIssueDraft({ invoiceNumber: 'INV-1', amount: 1000 });
    const tx = makeCommitTx();
    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'approved', payload: { processDraft: draft } }) },
    } as any;
    const result: any = await executeTool(prisma, { toolId: 'invoice.issue', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('committed');
    expect(result.invoiceStatus).toBe('Issued');
  });

  it('无 approvalId → APPROVAL_ID_MISSING', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn() } } as any;
    const result: any = await executeTool(prisma, { toolId: 'invoice.issue', input: {} } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_ID_MISSING');
  });

  it('approval modified → APPROVAL_MODIFIED_UNSUPPORTED', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'modified', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'invoice.issue', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_MODIFIED_UNSUPPORTED');
  });

  it('approval pending → APPROVAL_PENDING', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'pending', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'invoice.issue', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_PENDING');
  });
});

describe('task invoice-issue: executeAgentTool draft→approval', () => {
  it('首次调用 → approval_required + payload 含 processDraft', async () => {
    let createdApproval: any = null;
    const prisma = {
      approvalRequest: { create: vi.fn().mockImplementation(async ({ data }: any) => { createdApproval = data; return data; }) },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'invoice.issue',
      toolInput: { invoiceNumber: 'INV-1', amount: 1000, currency: 'CNY' },
      sessionId: 's1',
    });
    expect(result.status).toBe('approval_required');
    expect(result.processDraft).toBeTruthy();
    expect((result.processDraft.subOperations[0].after as any).status).toBe('Issued');
    expect(createdApproval.payload.processDraft).toBeTruthy();
  });

  it('首次调用缺 amount → preconditions_failed', async () => {
    const prisma = { agentToolRun: { create: vi.fn().mockResolvedValue({}) } } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'invoice.issue',
      toolInput: { invoiceNumber: 'INV-1' },
      sessionId: 's1',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(result.message).toContain('INVOICE_ISSUE_PRECONDITIONS_FAILED');
  });
});


describe('task invoice-issue review-fix: executeAgentTool email 输入生成双 subOperation', () => {
  it('首次调用含 email → approval_required + 双 subOperation（invoice + outbox email）', async () => {
    let createdApproval: any = null;
    const prisma = {
      approvalRequest: { create: vi.fn().mockImplementation(async ({ data }: any) => { createdApproval = data; return data; }) },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'invoice.issue',
      toolInput: {
        invoiceNumber: 'INV-1', amount: 1000, currency: 'CNY',
        email: { to: ['c@d.com'], subject: '发票', bodyText: 'INV-1' },
      },
      sessionId: 's1',
    });
    expect(result.status).toBe('approval_required');
    // 双 subOperation
    expect(result.processDraft.subOperations).toHaveLength(2);
    expect(result.processDraft.subOperations[0].toolId).toBe('finance.create_invoice');
    expect(result.processDraft.subOperations[1].toolId).toBe('email.reply_and_send');
    // outbox email payload
    expect((result.processDraft.subOperations[1].after as any).direction).toBe('outbound');
    expect((result.processDraft.subOperations[1].after as any).mailbox).toBe('Outbox');
    expect((result.processDraft.subOperations[1].after as any).to).toEqual(['c@d.com']);
    // impactScope 含 emails
    expect(result.processDraft.impactScope).toContain('emails');
    // approval payload 含双 subOperation
    expect(createdApproval.payload.processDraft.subOperations).toHaveLength(2);
  });
});


describe('task invoice-issue review-fix: toolRegistry composedOf 防回退', () => {
  it('invoice.issue processSpec.composedOf 含 finance.create_invoice + email.reply_and_send', () => {
    const fs = require('fs');
    const path = require('path');
    const reg = fs.readFileSync(path.resolve(__dirname, '../../agent/toolRegistry.ts'), 'utf-8');
    // 找到 invoice.issue 条目，断言 composedOf 含两个工具
    const invIdx = reg.indexOf("id: 'invoice.issue'");
    expect(invIdx).toBeGreaterThan(-1);
    const invSection = reg.slice(invIdx, invIdx + 1200);
    expect(invSection).toContain("composedOf: ['finance.create_invoice', 'email.reply_and_send']");
  });
});
