/**
 * REQ2-08 催款函套件回归测试（设计文档 §7 验收场景）
 *
 * 覆盖：
 *   1. 中英函生成（账龄明细注入：逾期天数/五桶分段/多发票汇总；净额口径扣 InvoiceAllocation）
 *   2. 无逾期 → 409 NO_OVERDUE；缺币种/客户 → 400
 *   3. 登记校验（channel/result 枚举/金额非负/customerName 必填）
 *   4. 历史（客户维度过滤 + 倒序）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createDunningService } from '../dunningService';

/** 构造发票（dueDate 早于 asOf → 逾期） */
function makeInvoice(over: any = {}) {
  return {
    id: 'INV-1',
    invoiceNumber: 'INV-2026-001',
    amount: 10000,
    currency: 'USD',
    issueDate: '2026-03-01',
    dueDate: '2026-04-01',
    customerName: 'Peerless',
    ...over,
  };
}

function makePrisma(overrides: { invoices?: any[]; allocations?: any[]; records?: any[] } = {}) {
  const invoices = overrides.invoices ?? [];
  const allocations = overrides.allocations ?? [];
  const records = overrides.records ?? [];
  return {
    invoice: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) =>
        invoices.filter(i =>
          i.currency === where?.currency
          && (where?.customerRelationId === undefined || i.customerRelationId === where.customerRelationId)
          && (where?.customerName === undefined || i.customerName === where.customerName))),
    },
    invoiceAllocation: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) =>
        allocations.filter(a => (where?.invoiceId?.in ?? []).includes(a.invoiceId))),
    },
    dunningRecord: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
      findMany: vi.fn().mockImplementation(async ({ where }: any, _opts?: any) =>
        records.filter(r =>
          (where?.customerRelationId === undefined || r.customerRelationId === where.customerRelationId)
          && (where?.customerName === undefined || r.customerName === where.customerName))),
    },
  } as any;
}

// asOf=2026-06-30：dueDate 2026-04-01 → 89 天（d61_90）；2026-03-01 → 120 天（d90plus）
const AS_OF = '2026-06-30';

beforeEach(() => { vi.clearAllMocks(); });

describe('buildLetter 中英函生成（账龄明细注入锚点）', () => {
  it('多发票：中英双份 + 逐发票逾期天数 + 五桶汇总 + 总额（验收锚点）', async () => {
    const prisma = makePrisma({
      invoices: [
        makeInvoice({ id: 'INV-1', invoiceNumber: 'INV-2026-001', amount: 10000, dueDate: '2026-04-01' }),
        makeInvoice({ id: 'INV-2', invoiceNumber: 'INV-2026-002', amount: 8000, dueDate: '2026-03-01' }),
        makeInvoice({ id: 'INV-3', invoiceNumber: 'INV-2026-003', amount: 5000, dueDate: '2026-03-15' }),
      ],
      allocations: [
        { invoiceId: 'INV-1', appliedAmount: 3000 }, // 净额 7000（DR-044 口径）
      ],
    });
    const svc = createDunningService(prisma);
    const r = await svc.buildLetter({ customerName: 'Peerless', currency: 'USD', asOf: AS_OF });
    expect(r.ok).toBe(true);
    const { zh, en, summary } = (r as any).data;

    // 汇总：净额 7000 + 8000 + 5000 = 20000，3 张
    expect(summary.invoiceCount).toBe(3);
    expect(summary.totalOverdue).toBe(20000);
    // 五桶：INV-1 89 天 d61_90=7000；INV-2 120 天 d90plus=8000；INV-3 106 天 d90plus=5000
    expect(summary.buckets.d61_90).toBe(7000);
    expect(summary.buckets.d90plus).toBe(13000);
    // 逐发票明细（逾期天数注入：Apr1→Jun30=90 天 d61_90；Mar1→Jun30=121 天 d90plus）
    expect(summary.items.find((x: any) => x.invoiceNumber === 'INV-2026-001').daysOverdue).toBe(90);
    expect(summary.items.find((x: any) => x.invoiceNumber === 'INV-2026-002').daysOverdue).toBe(121);
    // 中函：标题含客户+总额；正文含明细行与分段
    expect(zh.subject).toContain('Peerless');
    expect(zh.subject).toContain('$20,000.00');
    expect(zh.body).toContain('INV-2026-001 | $7,000.00 | 到期 2026-04-01 | 逾期 90 天（61-90 天）');
    expect(zh.body).toContain('90 天以上：$13,000.00');
    // 英函：同结构
    expect(en.subject).toContain('Payment Reminder');
    expect(en.body).toContain('INV-2026-002 | $8,000.00 | Due 2026-03-01 | 121 days overdue (90+ Days)');
    expect(en.body).toContain('90+ Days: $13,000.00');
  });

  it('未到期/已结清过滤；全结清 → 409 NO_OVERDUE', async () => {
    const prisma = makePrisma({
      invoices: [
        makeInvoice({ id: 'INV-F', invoiceNumber: 'INV-FUTURE', dueDate: '2026-12-01' }), // 未到期
      ],
    });
    const svc = createDunningService(prisma);
    const r = await svc.buildLetter({ customerName: 'Peerless', currency: 'USD', asOf: AS_OF });
    expect((r as any).error.code).toBe('NO_OVERDUE');
    expect((r as any).error.status).toBe(409);

    // 全额核销 → 也 409
    const prisma2 = makePrisma({
      invoices: [makeInvoice({ dueDate: '2026-04-01' })],
      allocations: [{ invoiceId: 'INV-1', appliedAmount: 10000 }],
    });
    const svc2 = createDunningService(prisma2);
    expect(((await svc2.buildLetter({ customerName: 'Peerless', currency: 'USD', asOf: AS_OF })) as any).error.code).toBe('NO_OVERDUE');
  });

  it('缺币种/缺客户 → 400', async () => {
    const svc = createDunningService(makePrisma());
    expect(((await svc.buildLetter({ customerName: 'X', currency: '' })) as any).error.code).toBe('CURRENCY_REQUIRED');
    expect(((await svc.buildLetter({ currency: 'USD' })) as any).error.code).toBe('CUSTOMER_REQUIRED');
  });
});

describe('recordDunning 登记 + listDunning 历史', () => {
  it('登记成功（快照字段全落库）；枚举非法 → 400', async () => {
    const prisma = makePrisma();
    const svc = createDunningService(prisma);
    const r = await svc.recordDunning({
      customerRelationId: 'REL-1', customerName: 'Peerless', currency: 'USD',
      totalOverdue: 20000, invoiceCount: 3,
      agingBuckets: { d90plus: 13000, d61_90: 7000 },
      channel: 'email', result: 'promised', note: '客户承诺 7 月 10 日前付清', operator: '赵美玲',
    });
    expect(r.ok).toBe(true);
    const data = prisma.dunningRecord.create.mock.calls[0][0].data;
    expect(data.channel).toBe('email');
    expect(data.result).toBe('promised');
    expect(data.agingBuckets).toEqual({ d90plus: 13000, d61_90: 7000 });

    const badChannel = await svc.recordDunning({ customerName: 'X', currency: 'USD', totalOverdue: 1, channel: 'fax', result: 'sent' });
    expect((badChannel as any).error.code).toBe('INVALID_CHANNEL');
    const badResult = await svc.recordDunning({ customerName: 'X', currency: 'USD', totalOverdue: 1, channel: 'email', result: 'maybe' });
    expect((badResult as any).error.code).toBe('INVALID_RESULT');
    const noName = await svc.recordDunning({ currency: 'USD', totalOverdue: 1, channel: 'email', result: 'sent' });
    expect((noName as any).error.code).toBe('CUSTOMER_NAME_REQUIRED');
    const badAmount = await svc.recordDunning({ customerName: 'X', currency: 'USD', totalOverdue: -1, channel: 'email', result: 'sent' });
    expect((badAmount as any).error.code).toBe('INVALID_AMOUNT');
  });

  it('历史：customerRelationId 过滤', async () => {
    const prisma = makePrisma({
      records: [
        { id: 'DUN__1', customerRelationId: 'REL-1', customerName: 'Peerless' },
        { id: 'DUN__2', customerRelationId: 'REL-2', customerName: 'Norden' },
      ],
    });
    const svc = createDunningService(prisma);
    const r = await svc.listDunning({ customerRelationId: 'REL-1' });
    expect((r as any).data.items.length).toBe(1);
    expect((r as any).data.items[0].customerName).toBe('Peerless');
  });
});
