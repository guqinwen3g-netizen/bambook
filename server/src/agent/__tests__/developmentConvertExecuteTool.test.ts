import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeTool, executeAgentTool } from '../toolRuntime';
import { buildDevConvertDraft } from '../developmentConvertFlow';

vi.mock('../../development/convertService', () => ({
  convertDevCaseToOrder: vi.fn(),
}));
import { convertDevCaseToOrder } from '../../development/convertService';

describe('task dev-convert-flow: executeTool commit 路径', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skipApprovalCheck + approved → committed', async () => {
    const draft = buildDevConvertDraft({ caseId: 'DC__1', mode: 'autoCreate' });
    (convertDevCaseToOrder as any).mockResolvedValue({ ok: true, data: { case: { id: 'DC__1', linkedOrderId: 'ORD-NEW' }, order: { id: 'ORD-NEW' }, auditId: 'a1' } });
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'approved', payload: { processDraft: draft } }) },
    } as any;
    const result: any = await executeTool(prisma, { toolId: 'development.convert_to_order', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('committed');
    expect(result.caseId).toBe('DC__1');
  });

  it('无 approvalId → APPROVAL_ID_MISSING', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn() } } as any;
    const result: any = await executeTool(prisma, { toolId: 'development.convert_to_order', input: {} } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_ID_MISSING');
  });

  it('approval modified → APPROVAL_MODIFIED_UNSUPPORTED', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'modified', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'development.convert_to_order', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_MODIFIED_UNSUPPORTED');
  });

  it('approval pending → APPROVAL_PENDING', async () => {
    const prisma = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'pending', payload: {} }) } } as any;
    const result: any = await executeTool(prisma, { toolId: 'development.convert_to_order', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(false);
    expect(result.errorFeedback.code).toBe('APPROVAL_PENDING');
  });

  it('service 失败（CONVERT_FAILED）→ failed（不伪 committed）', async () => {
    const draft = buildDevConvertDraft({ caseId: 'DC__1', mode: 'autoCreate' });
    (convertDevCaseToOrder as any).mockResolvedValue({ ok: false, error: { code: 'CONVERT_FAILED', message: 'sync reject' } });
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'approved', payload: { processDraft: draft } }) },
    } as any;
    const result: any = await executeTool(prisma, { toolId: 'development.convert_to_order', input: {}, approvalId: 'AP1' } as any);
    expect(result.ok).toBe(false);
    expect((result as any).error?.code || (result as any).errorFeedback?.code).toBe('CONVERT_FAILED');
  });

  it('no service bypass：executeTool 只调 convertDevCaseToOrder', async () => {
    const draft = buildDevConvertDraft({ caseId: 'DC__1', mode: 'autoCreate' });
    (convertDevCaseToOrder as any).mockResolvedValue({ ok: true, data: { case: { id: 'DC__1', linkedOrderId: 'ORD-NEW' }, order: null, auditId: 'a1' } });
    const prisma = {
      approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'AP1', status: 'approved', payload: { processDraft: draft } }) },
    } as any;
    await executeTool(prisma, { toolId: 'development.convert_to_order', input: {}, approvalId: 'AP1' } as any);
    expect(convertDevCaseToOrder).toHaveBeenCalledTimes(1);
  });
});

describe('task dev-convert-flow: executeAgentTool draft→approval', () => {
  it('首次调用 → approval_required + payload 含 processDraft', async () => {
    let createdApproval: any = null;
    const prisma = {
      approvalRequest: { create: vi.fn().mockImplementation(async ({ data }: any) => { createdApproval = data; return data; }) },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      // DR-007 routing 查询面：requester 无部门 → FALLBACK_ADMIN 命中 ua_admin
      department: { findUnique: vi.fn().mockResolvedValue(null) },
      userRole: { findMany: vi.fn().mockResolvedValue([{ userId: 'ua_admin' }]) },
    } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation', 'development'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'development.convert_to_order',
      toolInput: { caseId: 'DC__1', mode: 'autoCreate', quantity: 1000 },
      sessionId: 's1',
    });
    expect(result.status).toBe('approval_required');
    expect(result.processDraft).toBeTruthy();
    expect((result.processDraft.subOperations[0].after as any).caseId).toBe('DC__1');
    expect((result.processDraft.subOperations[0].after as any).mode).toBe('autoCreate');
    expect(createdApproval.payload.processDraft).toBeTruthy();
  });

  it('首次调用缺 caseId → preconditions_failed', async () => {
    const prisma = { agentToolRun: { create: vi.fn().mockResolvedValue({}) } } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation', 'development'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'development.convert_to_order',
      toolInput: { mode: 'autoCreate' },
      sessionId: 's1',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(result.message).toContain('DEV_CONVERT_PRECONDITIONS_FAILED');
  });

  it('link 模式首次调用 → approval_required + draft 含 orderId', async () => {
    const prisma = {
      approvalRequest: { create: vi.fn().mockResolvedValue({}) },
      agentToolRun: { create: vi.fn().mockResolvedValue({}) },
      userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
      // DR-007 routing 查询面：requester 无部门 → FALLBACK_ADMIN 命中 ua_admin
      department: { findUnique: vi.fn().mockResolvedValue(null) },
      userRole: { findMany: vi.fn().mockResolvedValue([{ userId: 'ua_admin' }]) },
    } as any;
    const actor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['finance', 'orders', 'shipping', 'relations', 'automation', 'development'], knowledgeScopes: ['company'], departmentIds: [] } as any;
    const result: any = await executeAgentTool({
      prisma, actor, toolId: 'development.convert_to_order',
      toolInput: { caseId: 'DC__1', mode: 'link', orderId: 'ORD-1' },
      sessionId: 's1',
    });
    expect(result.status).toBe('approval_required');
    expect((result.processDraft.subOperations[0].after as any).mode).toBe('link');
    expect((result.processDraft.subOperations[0].after as any).orderId).toBe('ORD-1');
  });
});
