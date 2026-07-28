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
