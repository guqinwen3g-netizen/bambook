import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerTool, registerCommitTool, dispatchFromRegistry, getRegisteredToolIds, getRegisteredToolCount } from '../toolDispatchRegistry';
import { PrismaClient } from '@prisma/client';

const mockPrisma = {
  approvalRequest: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient;

describe('toolDispatchRegistry: simple tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('register + dispatch roundtrip', async () => {
    registerTool('test.simple.add', async (_prisma, input) => {
      return { ok: true, sum: (input.a as number) + (input.b as number) };
    });

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.simple.add',
      input: { a: 3, b: 4 },
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(true);
      expect(result.result.sum).toBe(7);
    }
  });

  it('unregistered tool → hit=false', async () => {
    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'nonexistent.tool',
      input: {},
    });
    expect(result.hit).toBe(false);
  });
});

describe('toolDispatchRegistry: commit tools (approval boilerplate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('missing approvalId → APPROVAL_ID_MISSING', async () => {
    registerCommitTool('test.commit.noapproval', async () => ({ ok: true }));

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.commit.noapproval',
      input: {},
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(false);
      expect((result.result as any).errorFeedback.code).toBe('APPROVAL_ID_MISSING');
    }
  });

  it('approval not found → APPROVAL_NOT_FOUND', async () => {
    (mockPrisma.approvalRequest.findUnique as any).mockResolvedValue(null);
    registerCommitTool('test.commit.notfound', async () => ({ ok: true }));

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.commit.notfound',
      input: {},
      approvalId: 'appr_missing',
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(false);
      expect((result.result as any).errorFeedback.code).toBe('APPROVAL_NOT_FOUND');
    }
  });

  it('approval pending → APPROVAL_PENDING', async () => {
    (mockPrisma.approvalRequest.findUnique as any).mockResolvedValue({
      id: 'appr_1',
      status: 'pending',
      payload: {},
    });
    registerCommitTool('test.commit.pending', async () => ({ ok: true }));

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.commit.pending',
      input: {},
      approvalId: 'appr_1',
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(false);
      expect((result.result as any).errorFeedback.code).toBe('APPROVAL_PENDING');
    }
  });

  it('approval modified → APPROVAL_MODIFIED_UNSUPPORTED', async () => {
    (mockPrisma.approvalRequest.findUnique as any).mockResolvedValue({
      id: 'appr_2',
      status: 'modified',
      payload: {},
    });
    registerCommitTool('test.commit.modified', async () => ({ ok: true }));

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.commit.modified',
      input: {},
      approvalId: 'appr_2',
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(false);
      expect((result.result as any).errorFeedback.code).toBe('APPROVAL_MODIFIED_UNSUPPORTED');
    }
  });

  it('approval approved → commit function called with correct context', async () => {
    const mockPayload = { input: { poNumber: 'PO-001' }, draft: { totalAmount: 1000 } };
    (mockPrisma.approvalRequest.findUnique as any).mockResolvedValue({
      id: 'appr_ok',
      status: 'approved',
      payload: mockPayload,
    });

    let capturedCtx: any = null;
    registerCommitTool('test.commit.success', async (ctx) => {
      capturedCtx = ctx;
      return { ok: true, committed: true, orderId: 'O-123' };
    });

    const result = await dispatchFromRegistry(mockPrisma, {
      toolId: 'test.commit.success',
      input: { poNumber: 'PO-001' },
      approvalId: 'appr_ok',
    });

    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.result.ok).toBe(true);
      expect((result.result as any).committed).toBe(true);
      expect((result.result as any).orderId).toBe('O-123');
    }

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.approvalId).toBe('appr_ok');
    expect(capturedCtx.approvalPayload).toEqual(mockPayload);
    expect(capturedCtx.prisma).toBe(mockPrisma);
  });
});

describe('toolDispatchRegistry: introspection', () => {
  it('getRegisteredToolIds returns sorted array', () => {
    registerTool('test.zebra', async () => ({ ok: true }));
    registerTool('test.alpha', async () => ({ ok: true }));
    const ids = getRegisteredToolIds();
    const zebraIdx = ids.indexOf('test.zebra');
    const alphaIdx = ids.indexOf('test.alpha');
    expect(alphaIdx).toBeLessThan(zebraIdx); // sorted
  });

  it('getRegisteredToolCount increases after registration', () => {
    const before = getRegisteredToolCount();
    registerTool('test.count_check', async () => ({ ok: true }));
    const after = getRegisteredToolCount();
    expect(after).toBe(before + 1);
  });
});
