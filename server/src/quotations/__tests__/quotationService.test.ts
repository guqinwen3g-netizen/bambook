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
    auditLog: { create: auditCreate },
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
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return { prisma, tx, quotationCreate, quotationUpdate, quotationFindUnique, quotationLineDeleteMany, quotationLineCreateMany, auditCreate };
}

const baseInput: CreateQuotationInput = {
  quotationNumber: 'QT-20260806-001',
  currency: 'USD',
  issueDate: '2026-08-06',
  customerName: 'ACME Corp',
  lines: [
    { description: 'Fabric A', quantity: 100, unit: 'YD', unitPrice: 5.5 },
    { description: 'Fabric B', quantity: 50, unit: 'M', unitPrice: 12 },
  ],
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
