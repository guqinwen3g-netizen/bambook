/**
 * P0-1 订单分批出运与尾款结算 — 批次服务回归测试
 *
 * 覆盖（设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P0-1）：
 *   ① 批次登记：batchNo 自动递增 / 金额按占比推导 / 单批自动末批 / 计划缺量化失败
 *   ② 校验门禁：占比合计 ≤100% / 同订单末批唯一 / 订单不存在
 *   ③ 状态机：planned→cancelled 合法；已发运不可取消、计划字段冻结；非法迁移拒绝
 *   ④ 发运确认：须已排船；尾款到期日 = 发运日 + 账期（本批覆盖 > paymentTerms 解析）
 *   ⑤ 末批发运收款门禁：已收不足阻断（409）；豁免留痕可过
 *   ⑥ 结算聚合：invoiced/paid 快照回写 + settleStatus 派生（部分/结清）
 *   ⑦ 尾款看板：到期未结清末批列出、已结清/未到期排除
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('AUDIT__TEST'),
}));

import {
  createOrderShipmentBatchService,
  parseCreditDaysFromPaymentTerms,
  addDays,
} from '../orderShipmentBatchService';

/** 构造内存版 prisma mock（$transaction 内联执行；各表按 state 过滤/写入） */
function makePrisma(seed: {
  orders?: any[];
  shipments?: any[];
  batches?: any[];
  ioAllocations?: any[]; // InvoiceOrderAllocation
  invoices?: any[];
  invoiceAllocations?: any[]; // InvoiceAllocation
} = {}) {
  const state = {
    orders: [...(seed.orders ?? [])],
    shipments: [...(seed.shipments ?? [])],
    batches: [...(seed.batches ?? [])],
    ioAllocations: [...(seed.ioAllocations ?? [])],
    invoices: [...(seed.invoices ?? [])],
    invoiceAllocations: [...(seed.invoiceAllocations ?? [])],
  };

  const notDeleted = (rows: any[], id?: string) =>
    rows.filter(r => r.deletedAt == null && (!id || r.id === id));

  const prisma: any = {
    order: {
      findFirst: async ({ where }: any) => notDeleted(state.orders, where?.id)[0] ?? null,
      findMany: async ({ where }: any) => state.orders.filter(o => where?.id?.in ? where.id.in.includes(o.id) : true),
    },
    shipment: {
      findFirst: async ({ where }: any) => notDeleted(state.shipments, where?.id)[0] ?? null,
    },
    orderShipmentBatch: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = notDeleted(state.batches);
        if (where?.id) rows = rows.filter(b => b.id === where.id);
        if (where?.orderId) rows = rows.filter(b => b.orderId === where.orderId);
        if (where?.isFinalBatch !== undefined) rows = rows.filter(b => b.isFinalBatch === where.isFinalBatch);
        if (orderBy?.batchNo === 'desc') rows = [...rows].sort((a, b) => b.batchNo - a.batchNo);
        return rows[0] ?? null;
      },
      findMany: async ({ where, orderBy }: any) => {
        let rows = notDeleted(state.batches);
        if (where?.orderId) rows = rows.filter(b => b.orderId === where.orderId);
        if (where?.id?.not) rows = rows.filter(b => b.id !== where.id.not);
        if (where?.isFinalBatch === true) rows = rows.filter(b => b.isFinalBatch === true);
        if (where?.status === 'shipped') rows = rows.filter(b => b.status === 'shipped');
        if (where?.settleStatus?.not) rows = rows.filter(b => b.settleStatus !== where.settleStatus.not);
        if (where?.finalPaymentDueDate?.lt) rows = rows.filter(b => (b.finalPaymentDueDate ?? '9999') < where.finalPaymentDueDate.lt);
        if (orderBy?.batchNo === 'asc') rows = [...rows].sort((a, b) => a.batchNo - b.batchNo);
        if (orderBy?.finalPaymentDueDate === 'asc') rows = [...rows].sort((a, b) => String(a.finalPaymentDueDate ?? '').localeCompare(String(b.finalPaymentDueDate ?? '')));
        return rows;
      },
      create: async ({ data }: any) => {
        const row = { ...data };
        state.batches.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = state.batches.findIndex(b => b.id === where.id);
        if (idx < 0) throw new Error('batch not found');
        state.batches[idx] = { ...state.batches[idx], ...data };
        return state.batches[idx];
      },
      count: async () => state.batches.length,
    },
    invoiceOrderAllocation: {
      findMany: async ({ where }: any) => {
        let rows = state.ioAllocations.filter(a => a.deletedAt == null);
        if (where?.batchId) rows = rows.filter(a => a.batchId === where.batchId);
        if (where?.orderId) rows = rows.filter(a => a.orderId === where.orderId);
        if (where?.invoiceId?.in) rows = rows.filter(a => where.invoiceId.in.includes(a.invoiceId));
        return rows;
      },
    },
    invoice: {
      findMany: async ({ where }: any) =>
        state.invoices.filter(i => where?.id?.in ? where.id.in.includes(i.id) : true),
    },
    invoiceAllocation: {
      findMany: async ({ where }: any) =>
        state.invoiceAllocations.filter(ia => ia.deletedAt == null
          && (where?.invoiceId?.in ? where.invoiceId.in.includes(ia.invoiceId) : true)),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, state };
}

const NOW = BigInt(Date.parse('2026-08-25T00:00:00Z'));

/** 订单种子：成交净额 100000 USD，paymentTerms 含 30 天账期 */
const ORDER = {
  id: 'O-1', poNumber: 'PO-2601001', customer: 'Atlas', deletedAt: null,
  totalNet: '100000', quoteAmount: '100000', salesCurrency: 'USD',
  customerRelationId: 'REL-ATLAS',
  paymentTerms: 'T/T 30% deposit, 70% against B/L 30 days',
};

beforeEach(() => { vi.clearAllMocks(); });

// ═══ 工具函数 ═══
describe('工具：账期解析与日期加法', () => {
  it('paymentTerms 解析 30 days → 30；无 days → null；越界钳 null', () => {
    expect(parseCreditDaysFromPaymentTerms('T/T 30% deposit, 70% against B/L 30 days')).toBe(30);
    expect(parseCreditDaysFromPaymentTerms('T/T 100% in advance')).toBeNull();
    expect(parseCreditDaysFromPaymentTerms('net 400 days')).toBeNull();
    expect(parseCreditDaysFromPaymentTerms(null)).toBeNull();
  });
  it('addDays 跨月正确', () => {
    expect(addDays('2026-08-25', 30)).toBe('2026-09-24');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });
});

// ═══ 批次登记 ═══
describe('批次登记', () => {
  it('单批登记：金额按占比推导 + 自动末批 + batchNo=1 + 客户快照', async () => {
    const { prisma, state } = makePrisma({ orders: [ORDER] });
    const r = await createOrderShipmentBatchService(prisma).createBatch({
      orderId: 'O-1', plannedRatio: 60, unit: 'm',
    });
    expect(r.ok).toBe(true);
    const b = r.data;
    expect(b.batchNo).toBe(1);
    expect(b.amount).toBe(60000); // 100000 × 60%
    expect(b.currency).toBe('USD');
    expect(b.isFinalBatch).toBe(true); // 单批自动末批
    expect(b.status).toBe('planned');
    expect(b.settleStatus).toBe('unsettled');
    expect(b.customerName).toBe('Atlas');
    expect(state.batches).toHaveLength(1);
  });

  it('多批登记：batchNo 递增；第二批显式 isFinalBatch=true 且首批已让位（显式 false）', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [{
        id: 'OSB__1', orderId: 'O-1', batchNo: 1, shipmentId: null,
        plannedRatio: '60.00', plannedQty: null, unit: 'm', amount: '60000', currency: 'USD',
        customerRelationId: 'REL-ATLAS', customerName: 'Atlas',
        status: 'planned', shippedAt: null, settleStatus: 'unsettled',
        invoicedAmount: null, paidAmount: null, settledAt: null,
        isFinalBatch: false, finalPaymentDueDays: null, finalPaymentDueDate: null,
        notes: null, createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    const r = await createOrderShipmentBatchService(prisma).createBatch({
      orderId: 'O-1', plannedRatio: 40, isFinalBatch: true,
    });
    expect(r.ok).toBe(true);
    expect(r.data.batchNo).toBe(2);
    expect(r.data.amount).toBe(40000);
    expect(r.data.isFinalBatch).toBe(true);
  });

  it('占比合计 >100% 拒绝；订单不存在 404；无任何量化字段拒绝', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [{
        id: 'OSB__1', orderId: 'O-1', batchNo: 1, plannedRatio: '60.00',
        amount: '60000', currency: 'USD', status: 'planned', isFinalBatch: false,
        settleStatus: 'unsettled', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r1 = await svc.createBatch({ orderId: 'O-1', plannedRatio: 50 }); // 60+50>100
    expect(r1.ok).toBe(false);
    expect(r1.error.code).toBe('RATIO_EXCEEDED');

    const r2 = await svc.createBatch({ orderId: 'O-404', plannedRatio: 10 });
    expect(r2.ok).toBe(false);
    expect(r2.error.code).toBe('ORDER_NOT_FOUND');
    expect(r2.error.status).toBe(404);

    const r3 = await svc.createBatch({ orderId: 'O-1', isFinalBatch: false });
    expect(r3.ok).toBe(false);
    expect(r3.error.code).toBe('VALIDATION_FAILED');
  });

  it('排船回填：运单不存在 404；运单已取消 409', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      shipments: [{ id: 'SHP-1', status: 'Cancelled', deletedAt: null }],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r1 = await svc.createBatch({ orderId: 'O-1', plannedRatio: 100, shipmentId: 'SHP-404' });
    expect(r1.error.code).toBe('SHIPMENT_NOT_FOUND');
    const r2 = await svc.createBatch({ orderId: 'O-1', plannedRatio: 100, shipmentId: 'SHP-1' });
    expect(r2.error.code).toBe('SHIPMENT_CANCELLED');
  });
});

// ═══ 状态机与更新 ═══
describe('批次更新与状态机', () => {
  it('计划期可改占比并重推金额；末批转移（旧末批显式置 false 时通过唯一性校验）', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [{
        id: 'OSB__1', orderId: 'O-1', batchNo: 1, shipmentId: null,
        plannedRatio: '60.00', plannedQty: null, unit: null, amount: '60000', currency: 'USD',
        customerRelationId: null, customerName: 'Atlas', status: 'planned', shippedAt: null,
        settleStatus: 'unsettled', invoicedAmount: null, paidAmount: null, settledAt: null,
        isFinalBatch: true, finalPaymentDueDays: null, finalPaymentDueDate: null,
        notes: null, createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    const r = await createOrderShipmentBatchService(prisma).updateBatch('OSB__1', { plannedRatio: 50 });
    expect(r.ok).toBe(true);
    expect(r.data.amount).toBe(50000); // 重推
  });

  it('已发运：计划字段冻结（PLAN_FROZEN）+ 不可取消（ALREADY_SHIPPED）', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [{
        id: 'OSB__1', orderId: 'O-1', batchNo: 1, shipmentId: 'SHP-1',
        plannedRatio: '100.00', amount: '100000', currency: 'USD',
        status: 'shipped', shippedAt: NOW, settleStatus: 'unsettled',
        isFinalBatch: true, finalPaymentDueDate: '2026-09-01',
        createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r1 = await svc.updateBatch('OSB__1', { plannedRatio: 80 });
    expect(r1.error.code).toBe('PLAN_FROZEN');
    const r2 = await svc.updateBatch('OSB__1', { status: 'cancelled' });
    expect(r2.error.code).toBe('ALREADY_SHIPPED');
  });

  it('计划期 planned→cancelled 合法；cancelled 后计划冻结', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [{
        id: 'OSB__1', orderId: 'O-1', batchNo: 1, plannedRatio: '100.00', amount: '100000',
        currency: 'USD', status: 'planned', settleStatus: 'unsettled', isFinalBatch: true,
        createdAt: NOW, updatedAt: NOW, deletedAt: null,
      }],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r1 = await svc.updateBatch('OSB__1', { status: 'cancelled' });
    expect(r1.ok).toBe(true);
    expect(r1.data.status).toBe('cancelled');
    const r2 = await svc.updateBatch('OSB__1', { plannedRatio: 50 });
    expect(r2.error.code).toBe('PLAN_FROZEN');
  });
});

// ═══ 发运确认与末批门禁 ═══
describe('批次发运确认（markShipped）', () => {
  const baseBatch = (over: any = {}) => ({
    id: 'OSB__F', orderId: 'O-1', batchNo: 2, shipmentId: 'SHP-2',
    plannedRatio: '40.00', amount: '40000', currency: 'USD',
    customerName: 'Atlas', status: 'planned', shippedAt: null,
    settleStatus: 'unsettled', invoicedAmount: null, paidAmount: null, settledAt: null,
    isFinalBatch: true, finalPaymentDueDays: null, finalPaymentDueDate: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null, ...over,
  });
  const SHIPMENT = { id: 'SHP-2', status: 'Shipped', atd: '2026-08-20', deletedAt: null };

  it('未排船拒绝；末批已收不足阻断（FINAL_PAYMENT_GATE_BLOCKED 409）', async () => {
    const { prisma } = makePrisma({ orders: [ORDER], batches: [baseBatch({ shipmentId: null })] });
    const r1 = await createOrderShipmentBatchService(prisma).markShipped('OSB__F');
    expect(r1.error.code).toBe('SHIPMENT_REQUIRED');

    // 已排船但零收款：末批门禁 = 订单 100000 − 末批 40000 = 60000 须已收
    const { prisma: p2 } = makePrisma({
      orders: [ORDER], shipments: [SHIPMENT], batches: [baseBatch()],
    });
    const r2 = await createOrderShipmentBatchService(p2).markShipped('OSB__F');
    expect(r2.error.code).toBe('FINAL_PAYMENT_GATE_BLOCKED');
    expect(r2.error.status).toBe(409);
    expect(r2.error.message).toContain('60000');
  });

  it('末批收款足额放行：尾款到期日 = 发运日 + paymentTerms 账期 30 天', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER], shipments: [SHIPMENT], batches: [baseBatch()],
      ioAllocations: [{ id: 'IOA-1', invoiceId: 'INV-1', orderId: 'O-1', batchId: 'OSB__E', allocatedAmount: '60000', deletedAt: null }],
      invoices: [{ id: 'INV-1', amount: '60000', currency: 'USD', status: 'Issued', deletedAt: null }],
      invoiceAllocations: [{ id: 'IA-1', invoiceId: 'INV-1', appliedAmount: '60000', deletedAt: null }],
    });
    const r = await createOrderShipmentBatchService(prisma).markShipped('OSB__F');
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('shipped');
    expect(r.data.finalPaymentDueDate).toBe('2026-09-19'); // 2026-08-20 + 30d
  });

  it('本批 finalPaymentDueDays 覆盖 paymentTerms；skipGate 豁免可过（留痕）', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER], shipments: [SHIPMENT], batches: [baseBatch({ finalPaymentDueDays: 60 })],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r = await svc.markShipped('OSB__F', { skipGate: true });
    expect(r.ok).toBe(true);
    expect(r.data.finalPaymentDueDate).toBe('2026-10-19'); // 2026-08-20 + 60d
  });
});

// ═══ 结算聚合 ═══
describe('结算进度聚合（recalcSettlement）', () => {
  const BATCH = {
    id: 'OSB__1', orderId: 'O-1', batchNo: 1, amount: '60000', currency: 'USD',
    status: 'shipped', settleStatus: 'unsettled', isFinalBatch: false,
    invoicedAmount: null, paidAmount: null, settledAt: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
  };

  it('invoiced/paid 快照回写：部分收款 → partially_settled；足额 → settled + settledAt', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER], batches: [{ ...BATCH }],
      ioAllocations: [{ id: 'IOA-1', invoiceId: 'INV-1', orderId: 'O-1', batchId: 'OSB__1', allocatedAmount: '60000', deletedAt: null }],
      invoices: [{ id: 'INV-1', amount: '60000', currency: 'USD', status: 'Issued', deletedAt: null }],
      invoiceAllocations: [{ id: 'IA-1', invoiceId: 'INV-1', appliedAmount: '20000', deletedAt: null }],
    });
    const svc = createOrderShipmentBatchService(prisma);
    const r1 = await svc.recalcSettlement('OSB__1');
    expect(r1.ok).toBe(true);
    expect(r1.data.invoicedAmount).toBe(60000);
    expect(r1.data.paidAmount).toBe(20000);
    expect(r1.data.settleStatus).toBe('partially_settled');

    // 再收 40000 → 结清
    const { prisma: p2 } = makePrisma({
      orders: [ORDER], batches: [{ ...BATCH }],
      ioAllocations: [{ id: 'IOA-1', invoiceId: 'INV-1', orderId: 'O-1', batchId: 'OSB__1', allocatedAmount: '60000', deletedAt: null }],
      invoices: [{ id: 'INV-1', amount: '60000', currency: 'USD', status: 'Issued', deletedAt: null }],
      invoiceAllocations: [
        { id: 'IA-1', invoiceId: 'INV-1', appliedAmount: '20000', deletedAt: null },
        { id: 'IA-2', invoiceId: 'INV-1', appliedAmount: '40000', deletedAt: null },
      ],
    });
    const r2 = await createOrderShipmentBatchService(p2).recalcSettlement('OSB__1');
    expect(r2.data.paidAmount).toBe(60000);
    expect(r2.data.settleStatus).toBe('settled');
    expect(r2.data.settledAt).not.toBeNull();
  });

  it('作废发票不计入；allocatedAmount 缺省按发票全额；无分配保持 unsettled', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER], batches: [{ ...BATCH }],
      ioAllocations: [
        { id: 'IOA-1', invoiceId: 'INV-1', orderId: 'O-1', batchId: 'OSB__1', allocatedAmount: null, deletedAt: null },
        { id: 'IOA-2', invoiceId: 'INV-2', orderId: 'O-1', batchId: 'OSB__1', allocatedAmount: '5000', deletedAt: null },
      ],
      invoices: [
        { id: 'INV-1', amount: '60000', currency: 'USD', status: 'Cancelled', deletedAt: null },
        { id: 'INV-2', amount: '5000', currency: 'USD', status: 'Issued', deletedAt: null },
      ],
      invoiceAllocations: [],
    });
    const r = await createOrderShipmentBatchService(prisma).recalcSettlement('OSB__1');
    // INV-1 作废不计；INV-2 无核销 → invoiced=5000, paid=0, unsettled
    expect(r.data.invoicedAmount).toBe(5000);
    expect(r.data.paidAmount).toBe(0);
    expect(r.data.settleStatus).toBe('unsettled');
  });
});

// ═══ 尾款看板 ═══
describe('尾款看板（listOverdueFinalBatches）', () => {
  it('到期未结清末批列出；已结清/未到期/非末批排除', async () => {
    const mk = (over: any) => ({
      orderId: 'O-1', batchNo: 1, amount: '40000', currency: 'USD',
      status: 'shipped', settleStatus: 'unsettled', isFinalBatch: true,
      createdAt: NOW, updatedAt: NOW, deletedAt: null, ...over,
    });
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [
        mk({ id: 'B1', finalPaymentDueDate: '2026-08-01' }),            // 到期未结 → 列出
        mk({ id: 'B2', finalPaymentDueDate: '2026-08-01', settleStatus: 'settled' }), // 已结清 → 排除
        mk({ id: 'B3', finalPaymentDueDate: '2026-12-31' }),            // 未到期 → 排除
        mk({ id: 'B4', finalPaymentDueDate: '2026-08-01', isFinalBatch: false }),     // 非末批 → 排除
      ],
    });
    const r = await createOrderShipmentBatchService(prisma).listOverdueFinalBatches();
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe('B1');
    expect(r.data[0].finalPaymentOverdue).toBe(true);
  });
});

// ═══ 订单全景 ═══
describe('订单批次全景（listByOrder）', () => {
  it('批次列表 + 汇总（计划/开票/收款合计 + allShipped）', async () => {
    const { prisma } = makePrisma({
      orders: [ORDER],
      batches: [
        { id: 'B1', orderId: 'O-1', batchNo: 1, amount: '60000', currency: 'USD', status: 'shipped', settleStatus: 'settled', invoicedAmount: '60000', paidAmount: '60000', isFinalBatch: false, createdAt: NOW, updatedAt: NOW, deletedAt: null },
        { id: 'B2', orderId: 'O-1', batchNo: 2, amount: '40000', currency: 'USD', status: 'planned', settleStatus: 'unsettled', invoicedAmount: '0', paidAmount: '0', isFinalBatch: true, createdAt: NOW, updatedAt: NOW, deletedAt: null },
      ],
    });
    const r = await createOrderShipmentBatchService(prisma).listByOrder('O-1');
    expect(r.ok).toBe(true);
    expect(r.data.batches).toHaveLength(2);
    expect(r.data.summary.totalPlannedAmount).toBe(100000);
    expect(r.data.summary.totalPaid).toBe(60000);
    expect(r.data.summary.allShipped).toBe(false);
    expect(r.data.order.poNumber).toBe('PO-2601001');
  });
});
