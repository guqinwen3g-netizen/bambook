/**
 * 卡点 3 供应商询价比价 — 回归测试
 *
 * 覆盖（剧本 2.10 验收点 / procurementService.ts 询价家族 + procurementRoute.ts inquiries 端点）：
 *   ① 创建询价单：nextBusinessNumber(tx,'SI') 业务编号 + status=Open + 审计写入
 *   ② 状态机 Open → Compared → Closed（白名单外转移拒绝；终态 Closed 无出边）
 *   ③ 加报价：baseAmount = quoteAmount × exchangeRate 换算（含无汇率/非正汇率回退 1）
 *   ④ 比价决策 select：quoteId 不存在拒绝；存在时 Open→Compared 且中选快照落库
 *   ⑤ 软删除后不出现在列表（deletedAt 过滤）
 *   ⑥ 路由层入参过滤：POST /inquiries 白名单外字段丢弃；POST /:id/quotes 必填校验 400
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../events/businessEventBus', () => ({
  businessEventBus: { publish: vi.fn() },
  publishBusinessEvent: vi.fn(),
}));
vi.mock('../../entities/sync', () => ({
  syncPurchaseOrderReferences: vi.fn().mockResolvedValue(undefined),
  deactivateEntityLinks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/businessNumberService', () => ({
  nextBusinessNumber: vi.fn(async (_tx: unknown, prefix: string) => `${prefix}-2608-0001`),
}));
vi.mock('../../auth/middleware', () => ({
  // W-C 批三-E：路由写面挂 procurement:write scope 门（requirePermission 消费 actor.roles）——
  // mock actor 补 owner 角色（SuperAdmin 全放行）；userId 'u9' 语义不变（审计断言沿用）。
  extractActorFromRequest: vi.fn(() => ({ userId: 'u9', roles: ['owner'] })),
}));

import { createProcurementService } from '../procurementService';
import { createProcurementRouter } from '../procurementRoute';

/** 构造内存版 prisma mock（$transaction 内联执行；supplierInquiry 表按 state 读写） */
function makePrisma(seed: { inquiries?: any[] } = {}) {
  const state = {
    inquiries: [...(seed.inquiries ?? [])],
    audits: [] as any[],
  };

  const applyWhere = (rows: any[], where: any = {}) => {
    let out = rows;
    if (where.deletedAt === null) out = out.filter(r => r.deletedAt == null);
    if (where.status) out = out.filter(r => r.status === where.status);
    return out;
  };

  const inquiryTable = {
    findUnique: async ({ where }: any) =>
      state.inquiries.find(r => r.id === where.id) ?? null,
    findMany: async ({ where }: any) => applyWhere(state.inquiries, where),
    count: async ({ where }: any) => applyWhere(state.inquiries, where).length,
    create: async ({ data }: any) => {
      const row = { ...data };
      state.inquiries.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const idx = state.inquiries.findIndex(r => r.id === where.id);
      if (idx < 0) throw new Error('record not found');
      state.inquiries[idx] = { ...state.inquiries[idx], ...data };
      return state.inquiries[idx];
    },
  };

  const prisma: any = {
    supplierInquiry: inquiryTable,
    auditLog: {
      create: async ({ data }: any) => {
        state.audits.push(data);
        return data;
      },
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, state };
}

const CREATE_INPUT = {
  description: '全棉汗布 GJ-2103 询价',
  materialCode: 'GJ-2103',
  quantity: 1500,
  unit: 'kg',
  currency: 'USD',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══ 服务层 ═══
describe('供应商询价比价 service', () => {
  it('创建成功：生成 SI 业务编号 + status=Open + 写审计', async () => {
    const { prisma, state } = makePrisma();
    const svc = createProcurementService(prisma);
    const inquiry = await svc.createSupplierInquiry(CREATE_INPUT, 'u9');

    expect(inquiry.inquiryNumber).toBe('SI-2608-0001');
    expect(inquiry.status).toBe('Open');
    expect(inquiry.description).toBe(CREATE_INPUT.description);

    const audit = state.audits.find(a => a.action === 'create_supplier_inquiry');
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe('SupplierInquiry');
    expect(audit.targetId).toBe(inquiry.id);
    expect(audit.actorId).toBe('u9');
    expect(audit.operationType).toBe('create');
  });

  it('非法状态流转被拒：Closed 终态再 close/select 均拒绝；Compared 单不可重复 select', async () => {
    // Closed 终态：无出边（连 Closed→Closed 自转移都拒绝）
    const closedSeed = {
      id: 'SI_C1', inquiryNumber: 'SI-2608-0099', status: 'Closed',
      description: '已关闭询价', currency: 'USD',
      supplierQuotes: [], deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const a = makePrisma({ inquiries: [closedSeed] });
    await expect(
      createProcurementService(a.prisma).closeSupplierInquiry('SI_C1', 'u9'),
    ).rejects.toThrow(/询价单非法状态转换.*Closed/);

    const b = makePrisma({ inquiries: [closedSeed] });
    await expect(
      createProcurementService(b.prisma).selectSupplier('SI_C1', 'SQ_x', 'note', 'u9'),
    ).rejects.toThrow(/询价单非法状态转换.*Closed/);

    // Compared 状态：仅允许 →Closed，再次 select（目标仍是 Compared）为白名单外转移
    const comparedSeed = { ...closedSeed, status: 'Compared' };
    const c = makePrisma({ inquiries: [comparedSeed] });
    await expect(
      createProcurementService(c.prisma).selectSupplier('SI_C1', 'SQ_x', 'note', 'u9'),
    ).rejects.toThrow(/询价单非法状态转换.*Compared.*Closed/);
  });

  it('加报价：baseAmount=quoteAmount×exchangeRate；无汇率或非正汇率按 1 兜底；写审计', async () => {
    const seed = {
      id: 'SI_Q1', inquiryNumber: 'SI-2608-0002', status: 'Open',
      description: '比价单', currency: 'USD',
      supplierQuotes: [], deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const { prisma, state } = makePrisma({ inquiries: [seed] });
    const svc = createProcurementService(prisma);

    const r1 = await svc.addSupplierQuote('SI_Q1', {
      supplierName: '南通三厂', quoteAmount: 5000, currency: 'CNY',
      exchangeRate: 7.25, quoteDate: '2026-08-25',
    }, 'u9');
    const q1 = (r1.supplierQuotes as any[])[0];
    expect(q1.baseAmount).toBe(36250); // 5000 × 7.25
    expect(q1.isSelected).toBe(false);

    const r2 = await svc.addSupplierQuote('SI_Q1', {
      supplierName: '无锡五厂', quoteAmount: 800, currency: 'USD',
      quoteDate: '2026-08-26', exchangeRate: -1,
    }, 'u9');
    const q2 = (r2.supplierQuotes as any[])[1];
    expect(q2.baseAmount).toBe(800); // 非正汇率 → 按 1

    const audit = state.audits.find(x => x.action === 'add_supplier_quote');
    expect(audit?.targetId).toBe('SI_Q1');
    expect(audit?.fieldPath).toBe('supplierQuotes');
  });

  it('updateQuote 改金额/汇率时重算 baseAmount', async () => {
    const seed = {
      id: 'SI_U1', inquiryNumber: 'SI-2608-0003', status: 'Open',
      description: '改价单', currency: 'USD',
      supplierQuotes: [{
        id: 'SQ_A1', supplierName: '常州厂', quoteAmount: 100, currency: 'USD',
        exchangeRate: 7, baseAmount: 700, quoteDate: '2026-08-01', isSelected: false,
      }],
      deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const { prisma } = makePrisma({ inquiries: [seed] });
    const svc = createProcurementService(prisma);
    const r = await svc.updateSupplierQuote('SI_U1', 'SQ_A1', { quoteAmount: 200 }, 'u9');
    const q = (r.supplierQuotes as any[])[0];
    expect(q.quoteAmount).toBe(200);
    expect(q.exchangeRate).toBe(7);
    expect(q.baseAmount).toBe(1400); // 200 × 7
  });

  it('select：quoteId 不存在拒绝且状态不变；存在时 Open→Compared 并落中选快照', async () => {
    const seed = {
      id: 'SI_S1', inquiryNumber: 'SI-2608-0004', status: 'Open',
      description: '决策单', currency: 'USD', buyer: '小王',
      supplierQuotes: [
        { id: 'SQ_W1', supplierId: 'REL-NANTONG', supplierName: '南通厂', quoteAmount: 100, currency: 'USD', baseAmount: 100, quoteDate: '2026-08-01', isSelected: false },
        { id: 'SQ_W2', supplierName: '苏州厂', quoteAmount: 120, currency: 'USD', baseAmount: 120, quoteDate: '2026-08-02', isSelected: false },
      ],
      deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const { prisma, state } = makePrisma({ inquiries: [seed] });
    const svc = createProcurementService(prisma);

    // 不存在的报价：无法比价决策
    await expect(
      svc.selectSupplier('SI_S1', 'SQ_NOPE', '', 'u9'),
    ).rejects.toThrow(/报价 SQ_NOPE 不存在于询价单 SI_S1/);
    expect(state.inquiries[0].status).toBe('Open'); // 状态未被污染

    // 存在中选报价：状态流转 + isSelected 标记 + 快照字段落库
    const updated = await svc.selectSupplier('SI_S1', 'SQ_W1', '南通厂价优交期短', 'u9');
    expect(updated.status).toBe('Compared');
    const row = state.inquiries[0];
    expect(row.selectedSupplierId).toBe('REL-NANTONG');
    expect(row.selectedSupplierName).toBe('南通厂');
    expect(row.decisionNote).toBe('南通厂价优交期短');
    expect(row.supplierQuotes.map((q: any) => q.isSelected)).toEqual([true, false]);

    const audit = state.audits.find(x => x.action === 'select_supplier');
    expect(audit?.operationType).toBe('transition');
    expect(audit?.beforeValue).toBe('Open');
    expect(audit?.afterValue).toBe('Compared');
  });

  it('软删后不出现在列表；且 getSupplierInquiry 返回 null', async () => {
    const { prisma } = makePrisma();
    const svc = createProcurementService(prisma);
    const created = await svc.createSupplierInquiry(CREATE_INPUT, 'u9');

    await svc.deleteSupplierInquiry(created.id, 'u9');

    const listed = await svc.listSupplierInquiries({});
    expect(listed.items).toHaveLength(0);
    expect(listed.total).toBe(0);
    expect(await svc.getSupplierInquiry(created.id)).toBeNull();
  });

  it('close：Compared→Closed 合法流转并写审计', async () => {
    const comparedSeed = {
      id: 'SI_CC1', inquiryNumber: 'SI-2608-0011', status: 'Compared',
      description: '待关闭', currency: 'USD',
      supplierQuotes: [], selectedSupplierName: '南通厂',
      deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const { prisma, state } = makePrisma({ inquiries: [comparedSeed] });
    const updated = await createProcurementService(prisma).closeSupplierInquiry('SI_CC1', 'u9');
    expect(updated.status).toBe('Closed');
    const audit = state.audits.find(x => x.action === 'close_supplier_inquiry');
    expect(audit?.afterValue).toBe('Closed');
  });
});

// ═══ 路由层：入参白名单过滤 ═══
describe('供应商询价比价 route — 入参过滤', () => {
  function makeApp(prisma: any) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/procurement', createProcurementRouter({
      prisma, requireAuth: false, apiKeys: new Set<string>(),
    }));
    return app;
  }

  it('POST /inquiries 丢弃白名单外字段（防客户端写入非法字段）', async () => {
    const { prisma, state } = makePrisma();
    const res = await request(makeApp(prisma))
      .post('/api/v1/procurement/inquiries')
      .send({ ...CREATE_INPUT, hackerField: 'DROP TABLE users', status: 'Closed' });

    expect(res.status).toBe(201);
    expect(res.body.inquiry.inquiryNumber).toBe('SI-2608-0001');
    const persisted = state.inquiries[0];
    expect(persisted.hackerField).toBeUndefined();
    expect(persisted.status).toBe('Open'); // body 里伪造的 status 未透传
    expect(persisted.description).toBe(CREATE_INPUT.description);
    expect(persisted.currency).toBe(CREATE_INPUT.currency);
  });

  it('POST /inquiries/:id/quotes 缺必填字段返回 400 且不落数据', async () => {
    const seed = {
      id: 'SI_R1', inquiryNumber: 'SI-2608-0012', status: 'Open',
      description: '缺参校验', currency: 'USD',
      supplierQuotes: [], deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    const { prisma, state } = makePrisma({ inquiries: [seed] });
    const res = await request(makeApp(prisma))
      .post('/api/v1/procurement/inquiries/SI_R1/quotes')
      .send({ supplierName: '南通厂', quoteAmount: 99 }); // 缺 currency / quoteDate

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('缺少必填字段');
    expect(state.inquiries[0].supplierQuotes).toHaveLength(0); // 未写入
  });
});
