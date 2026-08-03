import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { executeAgentTool } from '../toolRuntime';
import { getMcpManifest } from '../mcp/manifest';

// ============================================================================
// Agent-P1-open-ended-business-scenario-eval
// 多工具自然语言场景评估：验证 toolRuntime fail closed、RBAC 拒绝、credential-safe、service reuse。
// 覆盖 Finance/Orders/Shipping/Email/Knowledge/Relations 六类能力。
// ============================================================================

const MANIFEST_SRC = fs.readFileSync(path.resolve(__dirname, '../mcp/manifest.ts'), 'utf-8');
const REGISTRY_SRC = fs.readFileSync(path.resolve(__dirname, '../toolRegistry.ts'), 'utf-8');
const RUNTIME_SRC = fs.readFileSync(path.resolve(__dirname, '../toolRuntime.ts'), 'utf-8');

function makeApprovalPrisma() {
  let createdApproval: any = null;
  return {
    approvalRequest: {
      create: vi.fn().mockImplementation(async ({ data }: any) => { createdApproval = data; return data; }),
    },
    agentToolRun: { create: vi.fn().mockResolvedValue({}) },
    userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    actorAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    order: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    invoice: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    relation: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    developmentCase: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    garmentOrder: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
  } as any;
}

const fullScopeActor = { userId: 'u1', role: 'admin', id: 'u1', roles: ['admin'], toolScopes: ['products', 'orders', 'relations', 'knowledge', 'finance', 'email', 'entities', 'development', 'automation', 'shipping'], knowledgeScopes: ['company'], departmentIds: [] } as any;
const viewerActor = { userId: 'v1', role: 'viewer', id: 'v1', roles: ['viewer'], toolScopes: ['read', 'products'], knowledgeScopes: ['company'], departmentIds: [] } as any;

// ============================================================================
// [source-level] 工具注册事实（诚实标注 manifest vs toolRegistry）
// ============================================================================
describe('[source-level] 工具注册事实（诚实分层）', () => {
  const MANIFEST_ONLY_TOOLS = ['finance.list_invoices', 'orders.get', 'knowledge.search', 'relations.query'];
  const TOOL_REGISTRY_FLOW_TOOLS = ['invoice.create', 'order.confirm', 'order.ship', 'email.sync', 'knowledge.ingest', 'relation.onboard'];

  it('只读查询工具在 manifest 注册', () => {
    for (const id of MANIFEST_ONLY_TOOLS) {
      expect(MANIFEST_SRC).toContain(`id: '${id}'`);
    }
  });

  it('Flow API 写工具在 toolRegistry 注册', () => {
    for (const id of TOOL_REGISTRY_FLOW_TOOLS) {
      expect(REGISTRY_SRC).toContain(`id: '${id}'`);
    }
  });

  it('order.confirm 在 toolRegistry 注册（诚实：不在 manifest 的查询工具中）', () => {
    expect(REGISTRY_SRC).toContain("id: 'order.confirm'");
  });

  it('email.sync / knowledge.ingest 在 manifest 和 toolRegistry 双重注册', () => {
    for (const id of ['email.sync', 'knowledge.ingest']) {
      expect(MANIFEST_SRC).toContain(`id: '${id}'`);
      expect(REGISTRY_SRC).toContain(`id: '${id}'`);
    }
  });
});

// ============================================================================
// [execution] approval-required fail closed（精确断言）
// ============================================================================
describe('[execution] email.sync/knowledge.ingest → approval_required（精确）', () => {
  it('email.sync → approval_required', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'email.sync',
      toolInput: { credentials: { user: 'a@b.com', pass: 'secret' } },
      sessionId: 'sess_eval',
    });
    expect(result.status).toBe('approval_required');
    expect(result.processDraft).toBeTruthy();
    expect(prisma.approvalRequest.create).toHaveBeenCalledTimes(1);
  });

  it('knowledge.ingest → approval_required', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'knowledge.ingest',
      toolInput: { title: '产品规格', text: '内容' },
      sessionId: 'sess_eval',
    });
    expect(result.status).toBe('approval_required');
    expect(result.processDraft).toBeTruthy();
    expect(prisma.approvalRequest.create).toHaveBeenCalledTimes(1);
  });
});

describe('[execution] invoice.create/order.confirm 缺前置数据 → preconditions_failed（精确）', () => {
  it('invoice.create 缺订单数据 → preconditions_failed', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'invoice.create',
      toolInput: { orderId: 'PO-001', invoiceNumber: 'INV-001', currency: 'USD', lines: [] },
      sessionId: 'sess_eval',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('order.confirm 缺订单数据 → preconditions_failed', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'order.confirm',
      toolInput: { poNumber: 'PO-001' },
      sessionId: 'sess_eval',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });
});

// ============================================================================
// [execution] credential-safe
// ============================================================================
describe('[execution] credential-safe', () => {
  it('email.sync approval payload 不含明文 password', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'email.sync',
      toolInput: { credentials: { user: 'a@b.com', pass: 'supersecret123' } },
      sessionId: 'sess_cred',
    });
    expect(result.status).toBe('approval_required');
    const createdData = prisma.approvalRequest.create.mock.calls[0][0].data;
    const payloadStr = JSON.stringify(createdData, (_, v) => typeof v === 'bigint' ? String(v) : v);
    expect(payloadStr).not.toContain('supersecret123');
    expect(createdData.payload.input.credentials.pass).toBe('');
    expect(createdData.payload.input.credentials.credentialRef).toMatch(/^ecred_/);
  });
});

// ============================================================================
// [execution] RBAC scope gating: viewer 被拒
// ============================================================================
describe('[execution] RBAC: viewer scope 被拒', () => {
  it('viewer 访问 invoice.create → TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: viewerActor, toolId: 'invoice.create', toolInput: { orderId: 'PO-1' }, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
  });

  it('viewer 访问 email.sync → TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: viewerActor, toolId: 'email.sync', toolInput: { credentials: { user: 'a@b.com', pass: 'x' } }, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
  });

  it('viewer 访问 knowledge.ingest → TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: viewerActor, toolId: 'knowledge.ingest', toolInput: { title: 't', text: 'c' }, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
  });
});

// ============================================================================
// [source-level] service reuse no-bypass
// ============================================================================
describe('[source-level] service reuse no-bypass', () => {
  it('email.sync commit → commitEmailSync（复用 syncEmailsFromImap）', () => {
    expect(RUNTIME_SRC).toContain('commitEmailSync');
  });
  it('knowledge.ingest flow → ingestKnowledgeDocument', () => {
    const flowSrc = fs.readFileSync(path.resolve(__dirname, '../knowledgeIngestFlow.ts'), 'utf-8');
    expect(flowSrc).toContain('ingestKnowledgeDocument');
  });
  it('order.confirm commit → commitOrderConfirm', () => {
    expect(RUNTIME_SRC).toContain('commitOrderConfirm');
  });
});

// ============================================================================
// [execution] preconditions failed（精确断言）
// ============================================================================
describe('[execution] preconditions failed（精确）', () => {
  it('email.sync 缺 credentials.user → preconditions_failed，不创建 approval', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'email.sync',
      toolInput: { credentials: {} },
      sessionId: 's',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('knowledge.ingest 缺 text → preconditions_failed，不创建 approval', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'knowledge.ingest',
      toolInput: { title: 't' },
      sessionId: 's',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Phase 2 · 2.3: 多场景评估补强——幻觉工具 fail-closed / 跨 scope RBAC / 拒绝可审计
// 评估原则：跨工具路径、边界情况、失败状态、权限上下文，不以单个成功示例评判
// ============================================================================

describe('[execution] LLM 幻觉 toolId fail-closed（TOOL_NOT_REGISTERED）', () => {
  it('未注册 toolId → throw TOOL_NOT_REGISTERED，不创建 approval、不写 tool run', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({
        prisma, actor: fullScopeActor,
        toolId: 'finance.delete_all_invoices', // LLM 幻觉出的危险工具——必须 fail closed
        toolInput: {},
        sessionId: 'sess_halluc',
      })
    ).rejects.toThrow(/TOOL_NOT_REGISTERED/);
    // 幻觉工具不得产生任何副作用
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
    expect(prisma.agentToolRun.create).not.toHaveBeenCalled();
  });

  it('空 toolId / 畸形 toolId → TOOL_NOT_REGISTERED（不 fallback 到任何 handler）', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: fullScopeActor, toolId: '', toolInput: {}, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_REGISTERED/);
    await expect(
      executeAgentTool({ prisma, actor: fullScopeActor, toolId: 'orders.query; DROP TABLE orders;--', toolInput: {}, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_REGISTERED/);
  });
});

describe('[execution] 跨 scope RBAC 矩阵（非 viewer 的细粒度权限上下文）', () => {
  const financeActor = { userId: 'f1', role: 'operator', id: 'f1', roles: ['operator'], toolScopes: ['finance'], knowledgeScopes: ['company'], departmentIds: [] } as any;
  const ordersActor = { userId: 'o1', role: 'operator', id: 'o1', roles: ['operator'], toolScopes: ['orders'], knowledgeScopes: ['company'], departmentIds: [] } as any;
  const knowledgeActor = { userId: 'k1', role: 'operator', id: 'k1', roles: ['operator'], toolScopes: ['knowledge'], knowledgeScopes: ['company'], departmentIds: [] } as any;

  it('finance scope actor 调 order.confirm（scope=orders）→ TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: financeActor, toolId: 'order.confirm', toolInput: { poNumber: 'PO-1' }, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('orders scope actor 调 invoice.create（scope=finance）→ TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: ordersActor, toolId: 'invoice.create', toolInput: { orderId: 'PO-1' }, sessionId: 's' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
  });

  it('knowledge scope actor 调 payment.receive_and_reconcile（scope=finance 高危）→ TOOL_NOT_ALLOWED', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({
        prisma, actor: knowledgeActor,
        toolId: 'payment.receive_and_reconcile',
        toolInput: { voucherId: 'V1', voucherAmount: 100, currency: 'USD', allocations: [{ invoiceId: 'I1', appliedAmount: 100 }] },
        sessionId: 's',
      })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });
});

describe('[execution] RBAC 拒绝可审计（权限链留痕）', () => {
  it('policy 拒绝时写 agentToolRun(status=failed, error=TOOL_NOT_ALLOWED)', async () => {
    const prisma = makeApprovalPrisma();
    await expect(
      executeAgentTool({ prisma, actor: viewerActor, toolId: 'invoice.create', toolInput: { orderId: 'PO-1' }, sessionId: 'sess_audit' })
    ).rejects.toThrow(/TOOL_NOT_ALLOWED|ROLE_NOT_ALLOWED/);
    // 拒绝必须留痕：权限链可审计（谁、何时、哪个工具、为何被拒）
    expect(prisma.agentToolRun.create).toHaveBeenCalledTimes(1);
    const runData = prisma.agentToolRun.create.mock.calls[0][0].data;
    expect(runData.status).toBe('failed');
    expect(String(runData.error)).toMatch(/TOOL_NOT_ALLOWED|role_not_allowed/i);
  });

  it('policy 放行但 preconditions 失败 → 不产生 approval（权限正确≠业务可执行）', async () => {
    const prisma = makeApprovalPrisma();
    const result: any = await executeAgentTool({
      prisma, actor: fullScopeActor,
      toolId: 'order.confirm',
      toolInput: { poNumber: 'PO-NONEXISTENT' },
      sessionId: 'sess_pre',
    });
    expect(result.status).toBe('preconditions_failed');
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });
});
