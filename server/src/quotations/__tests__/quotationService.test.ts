import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createQuotationService, CreateQuotationInput } from '../quotationService';
import { businessEventBus } from '../../events/businessEventBus';

/**
 * task ERP-P2-quotation-service-foundation:
 * 覆盖 quotationService 的 CRUD + 状态转换 + 审计 + 事件发布 + fail-closed 契约。
 *
 * 设计：
 *   - 用 $transaction: (fn) => fn(tx) 透明穿透模式，验证 audit reject → 事务回滚
 *   - 所有 mutation 都在事务内写 auditLog，audit reject 必须回滚业务操作
 *   - sendQuotation / acceptQuotation 必须在事务提交后 publish 业务事件（fire-and-forget，永不阻断业务）
 *   - 状态转换严格校验：非法转换抛错（fail-closed）
 */

// ── Mock businessEventBus.publish（fire-and-forget，但需验证调用契约） ──
const publishSpy = vi.spyOn(businessEventBus, 'publish').mockResolvedValue(undefined);

// ── 工厂：构造 mock prisma + tx ──
function makePrisma(opts: {
  existing?: any;
  auditFail?: boolean;
  createFail?: boolean;
  updateFail?: boolean;
  quotationFindUniqueImpl?: any;
} = {}) {
  const existing = opts.existing ?? null;

  const quotationCreate = opts.createFail
    ? vi.fn().mockRejectedValue(new Error('DB_BOOM'))
    : vi.fn().mockImplementation(async ({ data }: any) => {
        const { createdAt, updatedAt, lines, ...rest } = data;
        return {
          ...rest,
          createdAt,
          updatedAt,
          lines: lines?.create?.map((l: any, i: number) => ({
            ...l,
            lineNumber: i + 1,
            amount: Math.round(l.quantity * l.unitPrice * 10000) / 10000,
          })) ?? [],
        };
      });

  const quotationUpdate = opts.updateFail
    ? vi.fn().mockRejectedValue(new Error('UPDATE_BOOM'))
    : vi.fn().mockImplementation(async ({ where, data, include }: any) => {
        const { updatedAt, deletedAt, ...rest } = data;
        return {
          ...existing,
          ...rest,
          id: where.id,
          updatedAt,
          lines: existing?.lines ?? [],
        };
      });

  const quotationFindUnique = opts.quotationFindUniqueImpl
    ? opts.quotationFindUniqueImpl
    : vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.id === existing?.id || where.quotationNumber === existing?.quotationNumber) return existing;
        return null;
      });

  const quotationLineDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const quotationLineCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });

  const tx: any = {
    quotation: { create: quotationCreate, update: quotationUpdate },
    quotationLine: { deleteMany: quotationLineDeleteMany, createMany: quotationLineCreateMany },
    // REQ2-19：Draft 改价自动版本快照（tx 内 append QuotationVersion）
    quotationVersion: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: auditCreate },
    // DR-007：价格审批单不在 tx 内直写（tx 无 approvalRequest；误写会 TypeError 暴露）
    // EntityLink 图谱（D1.1a）：sync/deactivate 走 tx 内 upsert/findMany/update
    entityReference: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    entityLink: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const prisma: any = {
    quotation: {
      findUnique: quotationFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: quotationUpdate, // expireQuotation 不用事务，直接调 prisma.quotation.update
    },
    // 双轨偏差：requester 解析（默认命中 owner）+ 发送门禁查询审批状态
    // DR-007 审批单创建通道（approvalCreateService）：事务外 outer prisma 直写，reviewerId 由路由解析
    userAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'usr_owner_default' }) },
    approvalRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // DR-007 路由解析依赖（默认：requester 无部门 → FALLBACK_ADMIN 兜底命中 usr_admin）
    department: { findUnique: vi.fn().mockResolvedValue(null) },
    userRole: { findMany: vi.fn().mockResolvedValue([{ userId: 'usr_admin' }]) },
    // §9.2 价格规则 ①②④ 评估依赖（默认空 → 无命中，保持历史用例断言不变）
    relation: { findUnique: vi.fn().mockResolvedValue(null) },
    order: { count: vi.fn().mockResolvedValue(0) },
    fabricPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
    productAsset: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return { prisma, tx, quotationCreate, quotationUpdate, quotationFindUnique, quotationLineDeleteMany, quotationLineCreateMany, auditCreate };
}

const baseInput: CreateQuotationInput = {
  quotationNumber: 'QT-20260806-001',
  currency: 'USD',
  issueDate: '2026-08-06',
  customerName: 'ACME Corp',
  // §9.2-② 新客首单规则：绑定 Relation 且默认 mock 返回 stage=null（非新客 stage）→ 不命中，保持历史断言口径
  customerRelationId: 'rel_acme',
  lines: [
    { description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5 },
    { description: 'Fabric B', quantity: 50, unit: 'M', unitPrice: 12 },
  ],
};

// MOQ 门禁适配：合法 writeOnce 快照（阈值 50，现有用例数量 100/50/10 中 ≥50 的行合规；
// 数量 <50 的行仍不合规 → 用于门禁阻断/豁免审批路径验证）
const VALID_MOQ_SNAPSHOT = {
  fabricDefaultMoq: 50,
  garmentDefaultMoq: 50,
  capsuleMoq: 10,
  snapshotAt: '2026-08-01T00:00:00.000Z',
  configId: 'MOQCFG__test',
  source: 'moq_config',
};

describe('quotationService: createQuotation', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('成功创建 → 事务内 quotation + lines + audit，totalAmount = 行金额合计', async () => {
    const { prisma, tx, quotationCreate, auditCreate } = makePrisma();
    const service = createQuotationService(prisma);

    const result = await service.createQuotation(baseInput, 'u_test');

    expect(tx.quotation.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(quotationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        quotationNumber: 'QT-20260806-001',
        status: 'Draft',
        currency: 'USD',
        totalAmount: 100 * 5.5 + 50 * 12, // 550 + 600 = 1150
      }),
    }));
    // 行明细 lineNumber 自动递增
    const createCall = quotationCreate.mock.calls[0][0];
    expect(createCall.data.lines.create).toHaveLength(2);
    expect(createCall.data.lines.create[0].lineNumber).toBe(1);
    expect(createCall.data.lines.create[1].lineNumber).toBe(2);
    // 行金额自动计算
    expect(createCall.data.lines.create[0].amount).toBe(550);
    expect(createCall.data.lines.create[1].amount).toBe(600);

    // audit 动作标记
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'create_quotation',
        targetType: 'Quotation',
        actorId: 'u_test',
        operationType: 'create',
      }),
    }));

    // createQuotation 不发布业务事件（仅状态转换才发布）
    expect(publishSpy).not.toHaveBeenCalled();

    expect(result.quotationNumber).toBe('QT-20260806-001');
    expect(result.status).toBe('Draft');
  });

  it('audit reject → 事务回滚（fail-closed，不伪成功）', async () => {
    const { prisma, quotationCreate } = makePrisma({ auditFail: true });
    const service = createQuotationService(prisma);

    await expect(service.createQuotation(baseInput, 'u_test')).rejects.toThrow('AUDIT_REJECT');

    // quotation.create 被调用（在 tx 内），但事务整体回滚
    expect(quotationCreate).toHaveBeenCalledTimes(1);
    // 不发布事件
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('sync reject（quotation.create 抛错）→ 事务回滚，不 audit 不 publish', async () => {
    const { prisma, tx, auditCreate } = makePrisma({ createFail: true });
    const service = createQuotationService(prisma);

    await expect(service.createQuotation(baseInput, 'u_test')).rejects.toThrow('DB_BOOM');

    expect(tx.quotation.create).toHaveBeenCalledTimes(1);
    // audit 不应被调用（tx.quotation.create 已抛错，事务中止）
    expect(auditCreate).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('actorId 为空时使用 system 作为 actor', async () => {
    const { prisma, auditCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation(baseInput, '');

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'system' }),
    }));
  });
});

describe('quotationService: updateQuotation', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('Draft 状态 → 成功更新（含行明细替换）', async () => {
    const existing = { id: 'QT_1', quotationNumber: 'QT-001', status: 'Draft', deletedAt: null, totalAmount: 100, lines: [] };
    const { prisma, tx, quotationLineDeleteMany, quotationLineCreateMany } = makePrisma({ existing });

    const service = createQuotationService(prisma);
    const result = await service.updateQuotation('QT_1', {
      quotationNumber: 'QT-001-UPDATED',
      lines: [{ description: 'New Fabric', quantity: 10, unit: 'YD', unitPrice: 20 }],
    }, 'u_test');

    expect(tx.quotationLine.deleteMany).toHaveBeenCalledWith({ where: { quotationId: 'QT_1' } });
    expect(tx.quotationLine.createMany).toHaveBeenCalledTimes(1);
    expect(tx.quotation.update).toHaveBeenCalledTimes(1);
    expect(result.quotationNumber).toBe('QT-001-UPDATED');
  });

  it('非 Draft 状态 → 抛错（仅 Draft 可编辑）', async () => {
    const existing = { id: 'QT_1', status: 'Sent', deletedAt: null, lines: [] };
    const { prisma, tx } = makePrisma({ existing });

    const service = createQuotationService(prisma);
    await expect(service.updateQuotation('QT_1', { notes: 'new' }, 'u_test')).rejects.toThrow('仅 Draft 状态可编辑');

    expect(tx.quotation.update).not.toHaveBeenCalled();
  });

  it('报价单不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);
    await expect(service.updateQuotation('NOT_EXIST', { notes: 'x' }, 'u_test')).rejects.toThrow('不存在');
  });

  it('已软删除 → 抛错', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: 12345, lines: [] };
    const { prisma } = makePrimaWithExisting(existing);
    const service = createQuotationService(prisma);
    await expect(service.updateQuotation('QT_1', { notes: 'x' }, 'u_test')).rejects.toThrow('不存在');
  });
});

// B4：建单/改单返回值附带 moqCheck 行级校验结果（前端表单行级提醒契约；
// mock 环境无 MoqThresholdConfig → buildSnapshot 走兜底常量 800/200/20）
describe('quotationService: MOQ 校验结果随建单/改单返回（B4 表单提醒契约）', () => {
  it('createQuotation：含低于 MOQ 的行 → moqCheck.ok=false + 行级 quantity/effectiveMoq/compliant', async () => {
    const { prisma } = makePrisma();
    const service = createQuotationService(prisma);

    const result = await service.createQuotation(baseInput, 'u_test');

    const moqCheck = (result as any).moqCheck;
    expect(moqCheck).toBeTruthy();
    expect(moqCheck.ok).toBe(false); // 100/50 < 兜底 800（YD/M 归 fabric 族）
    expect(moqCheck.blockedLineIndexes).toEqual([0, 1]);
    expect(moqCheck.lines).toHaveLength(2);
    expect(moqCheck.lines[0]).toEqual(expect.objectContaining({
      lineIndex: 0,
      quantity: 100,
      unit: 'YD',
      effectiveMoq: 800,
      compliant: false,
    }));
    expect(moqCheck.lines[1]).toEqual(expect.objectContaining({
      lineIndex: 1,
      quantity: 50,
      unit: 'M',
      effectiveMoq: 800,
      compliant: false,
    }));
    // advisory：不阻断创建，报价单仍落库为 Draft
    expect(result.status).toBe('Draft');
  });

  it('createQuotation：全部行达标 → moqCheck.ok=true、无阻断行', async () => {
    const { prisma } = makePrisma();
    const service = createQuotationService(prisma);

    const result = await service.createQuotation({
      ...baseInput,
      lines: [{ description: 'Fabric A', quantity: 1000, unit: 'YD', unitPrice: 5.5 }],
    }, 'u_test');

    const moqCheck = (result as any).moqCheck;
    expect(moqCheck).toBeTruthy();
    expect(moqCheck.ok).toBe(true);
    expect(moqCheck.blockedLineIndexes).toEqual([]);
    expect(moqCheck.lines[0]).toEqual(expect.objectContaining({ compliant: true, effectiveMoq: 800 }));
  });

  it('updateQuotation：行变更后低于 MOQ → moqCheck.ok=false + 行级结果随返回值带出', async () => {
    const existing = { id: 'QT_1', quotationNumber: 'QT-001', status: 'Draft', deletedAt: null, totalAmount: 100, lines: [] };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.updateQuotation('QT_1', {
      lines: [{ description: 'New Fabric', quantity: 10, unit: 'YD', unitPrice: 20 }],
    }, 'u_test');

    const moqCheck = (result as any).moqCheck;
    expect(moqCheck).toBeTruthy();
    expect(moqCheck.ok).toBe(false);
    expect(moqCheck.blockedLineIndexes).toEqual([0]);
    expect(moqCheck.lines[0]).toEqual(expect.objectContaining({
      lineIndex: 0,
      quantity: 10,
      effectiveMoq: 800,
      compliant: false,
    }));
  });
});

describe('quotationService: deleteQuotation (soft delete)', () => {
  it('Draft 状态 → 软删除（设置 deletedAt）', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: null, quotationNumber: 'QT-001' };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    await service.deleteQuotation('QT_1', 'u_test');

    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'QT_1' },
      data: expect.objectContaining({ deletedAt: expect.any(Number) }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'delete_quotation' }),
    }));
  });

  it('非 Draft 状态 → 抛错', async () => {
    const existing = { id: 'QT_1', status: 'Sent', deletedAt: null, quotationNumber: 'QT-001' };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.deleteQuotation('QT_1', 'u_test')).rejects.toThrow('仅 Draft 状态可删除');
    expect(tx.quotation.update).not.toHaveBeenCalled();
  });

  it('不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);
    await expect(service.deleteQuotation('NOPE', 'u_test')).rejects.toThrow('不存在');
  });
});

describe('quotationService: sendQuotation (Draft → Sent)', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('Draft → Sent 成功，发布 QuotationIssued 事件', async () => {
    const existing = {
      id: 'QT_1',
      quotationNumber: 'QT-001',
      status: 'Draft',
      deletedAt: null,
      customerName: 'ACME',
      customerRelationId: 'REL_1',
      totalAmount: 1150,
      currency: 'USD',
      moqSnapshot: VALID_MOQ_SNAPSHOT, // MOQ 门禁：100/50 ≥ 50 → 合规放行
      lines: [{ id: 'L1', fabricCode: null, description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5 }],
    };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.sendQuotation('QT_1', 'u_test');

    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Sent' }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'send_quotation',
        beforeValue: 'Draft',
        afterValue: 'Sent',
      }),
    }));

    // 事件在事务后发布
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('QuotationIssued');
    expect(event.sourceEntityType).toBe('Quotation');
    expect(event.sourceEntityId).toBe('QT_1');
    expect(event.payload).toEqual(expect.objectContaining({
      quotationNumber: 'QT-001',
      customerName: 'ACME',
      totalAmount: 1150,
      currency: 'USD',
      lineCount: 1,
    }));

    expect(result.status).toBe('Sent');
  });

  it('Sent 状态 → 非法转换抛错（Sent 不能再 send）', async () => {
    const existing = { id: 'QT_1', status: 'Sent', deletedAt: null, lines: [] };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.sendQuotation('QT_1', 'u_test')).rejects.toThrow('非法状态转换');
    expect(tx.quotation.update).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('Accepted 终态 → 非法转换抛错', async () => {
    const existing = { id: 'QT_1', status: 'Accepted', deletedAt: null, lines: [] };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.sendQuotation('QT_1', 'u_test')).rejects.toThrow('非法状态转换');
  });

  it('不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);
    await expect(service.sendQuotation('NOPE', 'u_test')).rejects.toThrow('不存在');
  });

  it('事件发布失败不阻断业务（fire-and-forget）', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: null, lines: [], quotationNumber: 'QT-001', totalAmount: 100, currency: 'USD' };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    // 让 publish 抛错
    publishSpy.mockRejectedValueOnce(new Error('EVENT_PERSIST_FAIL'));

    // 业务操作仍然成功
    const result = await service.sendQuotation('QT_1', 'u_test');
    expect(result.status).toBe('Sent');
  });
});

describe('quotationService: acceptQuotation (Sent → Accepted)', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('Sent → Accepted 成功，发布 QuotationAccepted 事件（含行明细 payload）', async () => {
    const existing = {
      id: 'QT_1',
      quotationNumber: 'QT-001',
      status: 'Sent',
      deletedAt: null,
      customerName: 'ACME',
      totalAmount: 1150,
      currency: 'USD',
      lines: [
        { id: 'L1', fabricCode: 'FAB-A', description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5 },
      ],
    };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.acceptQuotation('QT_1', 'u_test', '客户已确认');

    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Accepted' }),
    }));

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('QuotationAccepted');
    expect(event.payload).toEqual(expect.objectContaining({
      quotationNumber: 'QT-001',
      lines: expect.arrayContaining([
        expect.objectContaining({ fabricCode: 'FAB-A', description: 'Fabric A', quantity: 100, unitPrice: 5.5 }),
      ]),
    }));

    expect(result.status).toBe('Accepted');
  });

  it('Draft 状态 → 非法转换抛错（Draft 不能直接 accept）', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: null, lines: [] };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.acceptQuotation('QT_1', 'u_test')).rejects.toThrow('非法状态转换');
    expect(tx.quotation.update).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('Accepted 终态 → 非法转换抛错', async () => {
    const existing = { id: 'QT_1', status: 'Accepted', deletedAt: null, lines: [] };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.acceptQuotation('QT_1', 'u_test')).rejects.toThrow('非法状态转换');
  });
});

describe('quotationService: rejectQuotation (Sent → Rejected)', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('Sent → Rejected 成功', async () => {
    const existing = { id: 'QT_1', quotationNumber: 'QT-001', status: 'Sent', deletedAt: null };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.rejectQuotation('QT_1', 'u_test', '价格过高');

    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Rejected' }),
    }));
    // reject 不发布业务事件
    expect(publishSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('Rejected');
  });

  it('Draft 状态 → 非法转换抛错', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: null };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.rejectQuotation('QT_1', 'u_test')).rejects.toThrow('非法状态转换');
  });
});

describe('quotationService: expireQuotation', () => {
  it('Draft → Expired 成功', async () => {
    const existing = { id: 'QT_1', status: 'Draft', deletedAt: null };
    const { prisma, quotationUpdate } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.expireQuotation('QT_1', 'u_test');

    // expireQuotation 不用事务，直接调 prisma.quotation.update
    expect(quotationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Expired' }),
    }));
    expect(result.status).toBe('Expired');
  });

  it('Sent → Expired 成功', async () => {
    const existing = { id: 'QT_1', status: 'Sent', deletedAt: null };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    const result = await service.expireQuotation('QT_1', 'u_test');
    expect(result.status).toBe('Expired');
  });

  it('Accepted 终态 → 抛错（不可标记过期）', async () => {
    const existing = { id: 'QT_1', status: 'Accepted', deletedAt: null };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.expireQuotation('QT_1', 'u_test')).rejects.toThrow('不可标记过期');
  });

  it('Rejected 终态 → 抛错', async () => {
    const existing = { id: 'QT_1', status: 'Rejected', deletedAt: null };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);
    await expect(service.expireQuotation('QT_1', 'u_test')).rejects.toThrow('不可标记过期');
  });

  it('不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);
    await expect(service.expireQuotation('NOPE', 'u_test')).rejects.toThrow('不存在');
  });
});

describe('quotationService: listQuotations', () => {
  it('返回列表 + total（默认 deletedAt: null 过滤）', async () => {
    const items = [{ id: 'QT_1' }, { id: 'QT_2' }];
    const { prisma } = makePrimaWithListResult(items, 2);
    const service = createQuotationService(prisma);

    const result = await service.listQuotations({});

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('status 过滤 → where.status 传入', async () => {
    const { prisma, quotationFindManySpy } = makePrimaWithListResult([], 0);
    const service = createQuotationService(prisma);

    await service.listQuotations({ status: 'Sent' });

    expect(quotationFindManySpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'Sent', deletedAt: null }),
    }));
  });

  it('search 过滤 → where.OR 包含 quotationNumber/customerName/inquiryRef', async () => {
    const { prisma, quotationFindManySpy } = makePrimaWithListResult([], 0);
    const service = createQuotationService(prisma);

    await service.listQuotations({ search: 'ACME' });

    expect(quotationFindManySpy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { quotationNumber: { contains: 'ACME' } },
          { customerName: { contains: 'ACME' } },
          { inquiryRef: { contains: 'ACME' } },
        ]),
      }),
    }));
  });

  it('limit 上限 200', async () => {
    const { prisma, quotationFindManySpy } = makePrimaWithListResult([], 0);
    const service = createQuotationService(prisma);

    await service.listQuotations({ limit: 500 });

    expect(quotationFindManySpy).toHaveBeenCalledWith(expect.objectContaining({
      take: 200,
    }));
  });
});

describe('quotationService: getQuotation', () => {
  it('返回含行明细的报价单', async () => {
    const existing = { id: 'QT_1', deletedAt: null, lines: [{ id: 'L1' }] };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.getQuotation('QT_1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('QT_1');
  });

  it('已软删除 → 返回 null', async () => {
    const existing = { id: 'QT_1', deletedAt: 12345 };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.getQuotation('QT_1');
    expect(result).toBeNull();
  });

  it('不存在 → 返回 null', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);

    const result = await service.getQuotation('NOPE');
    expect(result).toBeNull();
  });
});

describe('quotationService: convertToOrder (Accepted → Order)', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  it('Accepted 报价单 → 成功转为订单（含订单行 + convertedOrderId + 双审计日志）', async () => {
    const existing = {
      id: 'QT_1',
      quotationNumber: 'QT-001',
      status: 'Accepted',
      deletedAt: null,
      convertedOrderId: null,
      customerName: 'ACME Corp',
      customerCode: 'C001',
      customerRelationId: 'REL_1',
      currency: 'USD',
      baseCurrency: 'CNY',
      totalAmount: 1150,
      validUntil: '2026-09-30',
      deliveryTerms: 'FOB Shanghai',
      paymentTerms: 'T/T 30%',
      moqSnapshot: VALID_MOQ_SNAPSHOT, // MOQ 转换门禁：100/50 ≥ 50 → 合规放行
      lines: [
        { id: 'L1', fabricCode: 'FAB-A', description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5, amount: 550 },
        { id: 'L2', fabricCode: 'FAB-B', description: 'Fabric B', quantity: 50, unit: 'M', unitPrice: 12, amount: 600 },
      ],
    };
    const { prisma, tx } = makePrismaWithConvertSupport({ existing });
    const service = createQuotationService(prisma);

    const result = await service.convertToOrder('QT_1', 'u_test');

    // 订单创建
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    const orderCreateCall = tx.order.create.mock.calls[0][0];
    expect(orderCreateCall.data.customer).toBe('ACME Corp');
    expect(orderCreateCall.data.poNumber).toBe('QT-001'); // 默认用报价号
    expect(orderCreateCall.data.status).toBe('Pending');
    expect(orderCreateCall.data.source).toBe('quotation-convert');
    expect(orderCreateCall.data.quoteAmount).toBe(1150);
    expect(orderCreateCall.data.salesCurrency).toBe('USD');
    expect(orderCreateCall.data.purchaseCurrency).toBe('CNY');
    // 订单行从报价行映射
    expect(orderCreateCall.data.lines.create).toHaveLength(2);
    expect(orderCreateCall.data.lines.create[0]).toEqual(expect.objectContaining({
      materialCode: 'FAB-A',
      description: 'Fabric A',
      quantity: 100,
      unit: 'YD',
      unitPrice: 5.5,
      netValue: 550,
      status: 'Pending',
    }));

    // 报价单标记 convertedOrderId
    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'QT_1' },
      data: expect.objectContaining({ convertedOrderId: expect.stringMatching(/^ORD-QT-/) }),
    }));

    // 双审计日志
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    const auditActions = tx.auditLog.create.mock.calls.map((c: any) => c[0].data.action);
    expect(auditActions).toContain('convert_quotation_to_order');
    expect(auditActions).toContain('create_order_from_quotation');

    expect(result.orderId).toMatch(/^ORD-QT-/);
    expect(result.quotation.convertedOrderId).toBe(result.orderId);
  });

  it('支持 overrides（poNumber / millName / type / dueDate）', async () => {
    const existing = {
      id: 'QT_1',
      quotationNumber: 'QT-001',
      status: 'Accepted',
      deletedAt: null,
      convertedOrderId: null,
      customerName: 'ACME',
      currency: 'USD',
      baseCurrency: 'CNY',
      totalAmount: 500,
      validUntil: '2026-09-30',
      moqSnapshot: { ...VALID_MOQ_SNAPSHOT, fabricDefaultMoq: 10 }, // MOQ 门禁：10 ≥ 10 → 合规放行
      lines: [{ id: 'L1', fabricCode: null, description: 'x', quantity: 10, unit: 'YD', unitPrice: 50, amount: 500 }],
    };
    const { prisma, tx } = makePrismaWithConvertSupport({ existing });
    const service = createQuotationService(prisma);

    await service.convertToOrder('QT_1', 'u_test', {
      poNumber: 'PO-CUSTOM-001',
      millName: 'Mill A',
      type: 'Garment',
      dueDate: '2026-10-15',
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.poNumber).toBe('PO-CUSTOM-001');
    expect(orderData.millName).toBe('Mill A');
    expect(orderData.type).toBe('Garment');
    expect(orderData.dueDate).toBe('2026-10-15');
  });

  it('非 Accepted 状态 → 抛错（仅 Accepted 可转）', async () => {
    const existing = { id: 'QT_1', status: 'Sent', deletedAt: null, convertedOrderId: null, lines: [] };
    const { prisma, tx } = makePrismaWithConvertSupport({ existing });
    const service = createQuotationService(prisma);
    await expect(service.convertToOrder('QT_1', 'u_test')).rejects.toThrow('仅 Accepted');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('已转换过 → 抛错（不可重复转换）', async () => {
    const existing = { id: 'QT_1', status: 'Accepted', deletedAt: null, convertedOrderId: 'ORD-QT-EXISTING', lines: [] };
    const { prisma, tx } = makePrismaWithConvertSupport({ existing });
    const service = createQuotationService(prisma);
    await expect(service.convertToOrder('QT_1', 'u_test')).rejects.toThrow('已转为订单');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existing: null });
    const service = createQuotationService(prisma);
    await expect(service.convertToOrder('NOPE', 'u_test')).rejects.toThrow('不存在');
  });

  it('audit reject → 事务回滚（订单和报价单标记都不生效）', async () => {
    const existing = {
      id: 'QT_1',
      status: 'Accepted',
      deletedAt: null,
      convertedOrderId: null,
      customerName: 'ACME',
      currency: 'USD',
      totalAmount: 100,
      moqSnapshot: { ...VALID_MOQ_SNAPSHOT, fabricDefaultMoq: 10 }, // MOQ 门禁：10 ≥ 10 → 合规放行，让 audit reject 发生在事务内
      lines: [{ id: 'L1', description: 'x', quantity: 10, unit: 'YD', unitPrice: 10, amount: 100 }],
    };
    const { prisma, tx } = makePrismaWithConvertSupport({ existing, auditFail: true });
    const service = createQuotationService(prisma);

    await expect(service.convertToOrder('QT_1', 'u_test')).rejects.toThrow('AUDIT_REJECT');
    // tx 内的操作都执行了，但事务回滚（实际上由 prisma.$transaction 保证）
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });
});

// ── 辅助工厂（变体） ──
function makePrimaWithExisting(existing: any) {
  return makePrisma({ existing });
}

function makePrimaWithListResult(items: any[], total: number) {
  const quotationFindManySpy = vi.fn().mockResolvedValue(items);
  const quotationCountSpy = vi.fn().mockResolvedValue(total);
  const quotationFindUnique = vi.fn().mockResolvedValue(null);

  const prisma: any = {
    quotation: {
      findUnique: quotationFindUnique,
      findMany: quotationFindManySpy,
      count: quotationCountSpy,
    },
    $transaction: vi.fn(async (fn: any) => fn({})),
  };
  return { prisma, quotationFindManySpy, quotationCountSpy };
}

// ── convertToOrder 需要额外的 order/auditLog mock ──
function makePrismaWithConvertSupport(opts: { existing?: any; auditFail?: boolean } = {}) {
  const base = makePrisma({ existing: opts.existing });
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });
  const orderCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: data.id,
    ...data,
    lines: data.lines?.create ?? [],
  }));
  const quotationUpdate = vi.fn().mockImplementation(async ({ where, data, include }: any) => ({
    ...opts.existing,
    ...data,
    id: where.id,
    lines: opts.existing?.lines ?? [],
  }));

  base.tx.order = { create: orderCreate };
  base.tx.quotation.update = quotationUpdate;
  base.tx.auditLog.create = auditCreate;

  base.prisma.$transaction = vi.fn(async (fn: any) => fn(base.tx));

  return { ...base, orderCreate, quotationUpdate };
}

// ────────────────────────────────────────────────────────────────
// 双轨偏差审批联动（PRD 8.6）：创建快照 + warn/block 自动审批 + 发送红标门禁
// ────────────────────────────────────────────────────────────────
describe('quotationService: 双轨偏差快照与审批联动（PRD 8.6）', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  const dualTrackBase: CreateQuotationInput = {
    ...baseInput,
    trackAMedianUsd: 1.0,
    trackAUnit: 'M',
    trackBFinalUsd: 1.1, // +10% → ok
  };

  it('ok 偏差（≤15%）→ 快照落库，不生成审批', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation(dualTrackBase, 'u_test');

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.trackAMedianUsd).toBe(1.0);
    expect(data.trackAUnit).toBe('M');
    expect(data.trackBFinalUsd).toBe(1.1);
    expect(data.priceDeviationPercent).toBeCloseTo(10, 4);
    expect(data.priceDeviationLevel).toBe('ok');
    expect(data.priceApprovalId).toBeNull();
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('warn 偏差（>15%）→ 快照落库 + 事务外生成 medium 风险审批（DR-007 路由）', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    const created = await service.createQuotation({ ...dualTrackBase, trackBFinalUsd: 1.2 }, 'u_test'); // +20%

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.priceDeviationPercent).toBeCloseTo(20, 4);
    expect(data.priceDeviationLevel).toBe('warn');
    expect(data.priceApprovalId).toBeNull(); // tx 内不直写审批，先置空后回填

    expect(prisma.approvalRequest.create).toHaveBeenCalledTimes(1);
    const approvalData = prisma.approvalRequest.create.mock.calls[0][0].data;
    expect(approvalData.id).toMatch(/^ar_/);
    expect(approvalData.actionType).toBe('quotation:price-deviation');
    expect(approvalData.targetType).toBe('Quotation');
    expect(approvalData.targetId).toBe(data.id);
    expect(approvalData.status).toBe('pending');
    expect(approvalData.risk).toBe('medium');
    expect(approvalData.requesterId).toBe('usr_owner_default');
    // DR-007：reviewerId 非空且经 routingService 解析（默认 mock → FALLBACK_ADMIN）
    expect(approvalData.reviewerId).toBe('usr_admin');
    expect(approvalData.reviewerResolverRoute).toBe('FALLBACK_ADMIN');
    expect(approvalData.departmentSnapshotId).toBe('DEPT_NONE');
    expect(approvalData.payload).toEqual(expect.objectContaining({
      policyKey: 'price_approval',
      hitConditions: ['dual_track_deviation'],
      trackAMedianUsd: 1.0,
      trackBFinalUsd: 1.2,
      level: 'warn',
      source: 'quotation-dual-track',
    }));
    // 报价单 ↔ 审批单互链回填（返回对象读最终态）
    expect((created as any).priceApprovalId).toBe(approvalData.id);
    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: data.id },
      data: { priceApprovalId: approvalData.id },
    });
  });

  it('block 偏差（>30%）→ 快照落库 + high 风险审批', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation({ ...dualTrackBase, trackBFinalUsd: 1.35 }, 'u_test'); // +35%

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.priceDeviationPercent).toBeCloseTo(35, 4);
    expect(data.priceDeviationLevel).toBe('block');
    expect(prisma.approvalRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.approvalRequest.create.mock.calls[0][0].data.risk).toBe('high');
  });

  it('价格审批单 reviewerId 非空且经 DR-007 解析（DEPT_HEAD 路径）', async () => {
    const { prisma, quotationCreate } = makePrisma();
    // requester=usr_owner_default（owner 兜底），部门 dept_sales 主管 usr_mgr → DEPT_HEAD
    prisma.userAccount.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'usr_mgr' ? { id: 'usr_mgr' } : { id: 'usr_owner_default', primaryDeptId: 'dept_sales' });
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_sales', status: 'active', headId: 'usr_mgr', parentId: null });
    const service = createQuotationService(prisma);

    const created = await service.createQuotation({ ...dualTrackBase, trackBFinalUsd: 1.35 }, 'u_test'); // +35% block

    expect(prisma.approvalRequest.create).toHaveBeenCalledTimes(1);
    const approvalData = prisma.approvalRequest.create.mock.calls[0][0].data;
    expect(approvalData.reviewerId).toBe('usr_mgr'); // 非空且经 DR-007 路由解析，非 requester 本人
    expect(approvalData.reviewerResolverRoute).toBe('DEPT_HEAD');
    expect(approvalData.departmentSnapshotId).toBe('dept_sales');
    expect(approvalData.payload.policyKey).toBe('price_approval');
    expect(approvalData.payload.hitConditions).toContain('dual_track_deviation');
    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.priceApprovalId).toBeNull(); // tx 内置空
    expect((created as any).priceApprovalId).toBe(approvalData.id); // 事务外回填
  });

  it('负向偏差绝对值同样分级（-35% → block）', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation({ ...dualTrackBase, trackBFinalUsd: 0.65 }, 'u_test'); // -35%

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.priceDeviationPercent).toBeCloseTo(-35, 4);
    expect(data.priceDeviationLevel).toBe('block');
  });

  it('无双轨输入 → 快照字段为 null，不生成审批（向后兼容）', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation(baseInput, 'u_test');

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.trackAMedianUsd).toBeNull();
    expect(data.trackBFinalUsd).toBeNull();
    expect(data.priceDeviationPercent).toBeNull();
    expect(data.priceDeviationLevel).toBeNull();
    expect(data.priceApprovalId).toBeNull();
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('仅单轨输入（缺轨道 B）→ 不计算偏差，不生成审批', async () => {
    const { prisma, quotationCreate } = makePrisma();
    const service = createQuotationService(prisma);

    await service.createQuotation({ ...baseInput, trackAMedianUsd: 1.0, trackAUnit: 'M' }, 'u_test');

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.trackAMedianUsd).toBe(1.0);
    expect(data.priceDeviationLevel).toBeNull();
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('requester 无法解析（无 owner）→ 快照照常落库但不生成审批（不阻断创建）', async () => {
    const { prisma, quotationCreate } = makePrisma();
    prisma.userAccount.findFirst.mockResolvedValue(null); // actor 解析失败 + owner 缺失
    const service = createQuotationService(prisma);

    await service.createQuotation({ ...dualTrackBase, trackBFinalUsd: 1.35 }, 'u_test');

    const data = quotationCreate.mock.calls[0][0].data;
    expect(data.priceDeviationLevel).toBe('block');
    expect(data.priceApprovalId).toBeNull();
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });
});

describe('quotationService: 发送红标门禁（PRD 8.6，block 未审批禁止发送）', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  const blockedQuotation = {
    id: 'QT_1',
    quotationNumber: 'QT-001',
    status: 'Draft',
    deletedAt: null,
    customerName: 'ACME',
    totalAmount: 100,
    currency: 'USD',
    priceDeviationLevel: 'block',
    priceDeviationPercent: 35,
    priceApprovalId: 'ar_1',
    lines: [],
  };

  it('block + 审批 pending → 抛门禁错误，不更新不发布事件', async () => {
    const { prisma, tx } = makePrisma({ existing: blockedQuotation });
    prisma.approvalRequest.findUnique.mockResolvedValue({ id: 'ar_1', status: 'pending' });
    const service = createQuotationService(prisma);

    await expect(service.sendQuotation('QT_1', 'u_test')).rejects.toThrow('门禁');
    expect(tx.quotation.update).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('DE-6 审批单透传：block 门禁错误对象携带 approvalRequestId（route 回传 body 供前端跳转审批）', async () => {
    const { prisma } = makePrisma({ existing: blockedQuotation });
    prisma.approvalRequest.findUnique.mockResolvedValue({ id: 'ar_1', status: 'pending' });
    const service = createQuotationService(prisma);

    const err = await service.sendQuotation('QT_1', 'u_test').catch((e: any) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PRICE_DEVIATION_BLOCKED');
    expect(err.approvalRequestId).toBe('ar_1');
  });

  it('block + 审批 rejected → 抛门禁错误', async () => {
    const { prisma, tx } = makePrisma({ existing: blockedQuotation });
    prisma.approvalRequest.findUnique.mockResolvedValue({ id: 'ar_1', status: 'rejected' });
    const service = createQuotationService(prisma);

    await expect(service.sendQuotation('QT_1', 'u_test')).rejects.toThrow('门禁');
    expect(tx.quotation.update).not.toHaveBeenCalled();
  });

  it('block + priceApprovalId 缺失 → fail-closed 抛门禁错误', async () => {
    const { prisma, tx } = makePrisma({ existing: { ...blockedQuotation, priceApprovalId: null } });
    const service = createQuotationService(prisma);

    await expect(service.sendQuotation('QT_1', 'u_test')).rejects.toThrow('门禁');
    expect(tx.quotation.update).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findUnique).not.toHaveBeenCalled();
  });

  it('block + 审批 approved → 放行发送', async () => {
    const { prisma, tx } = makePrisma({ existing: blockedQuotation });
    prisma.approvalRequest.findUnique.mockResolvedValue({ id: 'ar_1', status: 'approved' });
    const service = createQuotationService(prisma);

    const result = await service.sendQuotation('QT_1', 'u_test');

    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Sent' }),
    }));
    expect(result.status).toBe('Sent');
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('warn 级别不设门禁 → 正常发送', async () => {
    const existing = { ...blockedQuotation, priceDeviationLevel: 'warn', priceDeviationPercent: 20 };
    const { prisma, tx } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.sendQuotation('QT_1', 'u_test');

    expect(result.status).toBe('Sent');
    expect(prisma.approvalRequest.findUnique).not.toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('无偏差快照（历史报价单）→ 正常发送', async () => {
    const existing = { ...blockedQuotation, priceDeviationLevel: null, priceDeviationPercent: null, priceApprovalId: null };
    const { prisma } = makePrisma({ existing });
    const service = createQuotationService(prisma);

    const result = await service.sendQuotation('QT_1', 'u_test');
    expect(result.status).toBe('Sent');
  });
});
