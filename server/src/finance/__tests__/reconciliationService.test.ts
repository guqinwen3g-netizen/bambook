/**
 * W-B 波次 · P2-6 客户四单对账引擎 — 回归测试
 *
 * 场景真源：跨域契约表 3 断层拍板（docs/README.md W-0 节）
 *   ① IOA.batchId 无写入入口 → 整单口径（allocatedAmount null → invoice.amount）
 *   ② 币种双源 → Order.currency 订单侧真源 / Invoice.currency 发票侧真源，不一致记差异
 *   ③ actualPaymentAmount 手工字段 → 收款真源 = Σ InvoiceAllocation.appliedAmount，漂移记 info
 *
 * 覆盖：
 *   1. 四单全一致 → 零差异
 *   2. 部分开票 → 未开票余额 info
 *   3. 部分收款 → 未收款余额 info（已交付升级 warning）
 *   4. 币种不一致 → currency_mismatch warning
 *   5. 状态不一致 → 已交付无发票 warning / 已付未交付 warning
 *   6. 数量差异 → 超发 critical / 已交付未足量 warning
 *   7. 手工实收字段漂移 → manual_payment_field_drift info
 */
import { describe, expect, it } from 'vitest';
import { reconcileOrder, reconcileCustomer, listAllDiscrepancies } from '../reconciliationService';

/** 内存 prisma：仅实现对账引擎消费的查询面 */
function makePrisma(seed: {
  orders?: any[];
  orderLines?: any[];
  shipments?: any[];
  shipmentLines?: any[];
  shipmentAllocations?: any[]; // ShipmentOrderAllocation
  ioas?: any[];                // InvoiceOrderAllocation
  invoices?: any[];
  invoiceAllocations?: any[];  // InvoiceAllocation（核销）
} = {}) {
  const state = {
    orders: seed.orders ?? [],
    orderLines: seed.orderLines ?? [],
    shipments: seed.shipments ?? [],
    shipmentLines: seed.shipmentLines ?? [],
    shipmentAllocations: seed.shipmentAllocations ?? [],
    ioas: seed.ioas ?? [],
    invoices: seed.invoices ?? [],
    invoiceAllocations: seed.invoiceAllocations ?? [],
  };
  const matchIdIn = (row: any, where: any, key = 'id') => {
    if (where?.[key]?.in) return where[key].in.includes(row[key]);
    if (where?.[key]) return row[key] === where[key];
    return true;
  };
  const prisma: any = {
    order: {
      findFirst: async ({ where }: any) =>
        state.orders.find(o => o.deletedAt == null && matchIdIn(o, where) && (!where?.customerRelationId || o.customerRelationId === where.customerRelationId)) ?? null,
      findMany: async ({ where, select }: any) => {
        let rows = state.orders.filter(o => o.deletedAt == null && matchIdIn(o, where));
        if (where?.customerRelationId) rows = rows.filter(o => o.customerRelationId === where.customerRelationId);
        if (select?.id) return rows.map(o => ({ id: o.id }));
        return rows;
      },
    },
    orderLine: {
      findMany: async ({ where }: any) => state.orderLines.filter(l => !where?.orderId || l.orderId === where.orderId),
    },
    shipment: {
      findMany: async ({ where }: any) => state.shipments.filter(s => s.deletedAt == null && matchIdIn(s, where) && (!where?.orderId || s.orderId === where.orderId)),
    },
    shipmentLine: {
      findMany: async ({ where }: any) => state.shipmentLines.filter(l => !where?.shipmentId?.in || where.shipmentId.in.includes(l.shipmentId)),
    },
    shipmentOrderAllocation: {
      findMany: async ({ where }: any) => state.shipmentAllocations.filter(a => !where?.orderId || a.orderId === where.orderId),
    },
    invoiceOrderAllocation: {
      findMany: async ({ where }: any) => state.ioas.filter(a => a.deletedAt == null && (!where?.orderId || a.orderId === where.orderId)),
    },
    invoice: {
      findMany: async ({ where }: any) => state.invoices.filter(i =>
        i.deletedAt == null
        && matchIdIn(i, where)
        && (!where?.orderId || i.orderId === where.orderId)
        && (!where?.type || i.type === where.type)),
    },
    invoiceAllocation: {
      findMany: async ({ where }: any) => state.invoiceAllocations.filter(a => !where?.invoiceId?.in || where.invoiceId.in.includes(a.invoiceId)),
    },
  };
  return prisma;
}

const baseOrder = {
  id: 'ORD1',
  code: 'SO-2026-001',
  poNumber: 'PO-001',
  customer: 'ACME',
  customerRelationId: 'REL1',
  status: 'Delivered',
  quoteAmount: '10000',
  totalNet: '10000',
  quantity: 100,
  currency: 'USD',
  deletedAt: null,
};

const shippedShipment = {
  id: 'SHP1',
  shipmentNumber: 'SHP-001',
  orderId: 'ORD1',
  status: 'Delivered',
  deletedAt: null,
};

const fullInvoice = {
  id: 'INV1',
  invoiceNumber: 'INV-2026-001',
  type: 'Receivable',
  status: 'Paid',
  amount: '10000',
  currency: 'USD',
  orderId: 'ORD1',
  deletedAt: null,
};

describe('reconcileOrder — P2-6 四单对账', () => {
  it('四单全一致（足量出运+全额开票+全额收款）→ 零差异', async () => {
    const prisma = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [fullInvoice],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    expect(r).not.toBeNull();
    expect(r!.orderAmount).toBe(10000);
    expect(r!.shippedQty).toBe(100);
    expect(r!.invoicedAmount).toBe(10000); // IOA.allocatedAmount null → 整单口径取 invoice.amount
    expect(r!.paidAmount).toBe(10000);
    expect(r!.delivered).toBe(true);
    expect(r!.discrepancies).toEqual([]);
  });

  it('部分开票 → 未开票余额 info（整单口径：IOA 分摊额为 null 时取发票全额）', async () => {
    const prisma = makePrisma({
      orders: [{ ...baseOrder, status: 'Shipping' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, status: 'Issued', amount: '4000' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    expect(r!.invoicedAmount).toBe(4000);
    const d = r!.discrepancies.find(x => x.type === 'invoice_amount_mismatch');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('info'); // 未交付允许部分开票
    expect(d!.expected).toBe('10000');
    expect(d!.actual).toBe('4000');
    // 已交付订单部分开票 → 升级 warning
    const prisma2 = makePrisma({
      orders: [baseOrder], // Delivered
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, status: 'Issued', amount: '4000' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
    });
    const r2 = await reconcileOrder(prisma2, 'ORD1');
    expect(r2!.discrepancies.find(x => x.type === 'invoice_amount_mismatch')!.severity).toBe('warning');
  });

  it('部分收款 → 未收款余额 info；已交付订单升级 warning', async () => {
    const prisma = makePrisma({
      orders: [{ ...baseOrder, status: 'Shipping' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, status: 'PartiallyPaid' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '6000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    expect(r!.paidAmount).toBe(6000);
    const d = r!.discrepancies.find(x => x.type === 'payment_mismatch');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('info');

    const prisma2 = makePrisma({
      orders: [baseOrder], // Delivered
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, status: 'PartiallyPaid' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '6000' }],
    });
    const r2 = await reconcileOrder(prisma2, 'ORD1');
    expect(r2!.discrepancies.find(x => x.type === 'payment_mismatch')!.severity).toBe('warning');
  });

  it('币种不一致（订单 USD / 发票 EUR）→ currency_mismatch warning，不静默取其一', async () => {
    const prisma = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, currency: 'EUR' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    const d = r!.discrepancies.find(x => x.type === 'currency_mismatch');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.expected).toBe('USD');
    expect(d!.actual).toBe('EUR');
    expect(r!.currency).toBe('USD'); // 订单侧真源 = Order.currency
  });

  it('状态不一致：订单 Delivered 无发票 → warning；发票 Paid 但订单未交付 → warning', async () => {
    // Delivered 无发票
    const prisma = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [],
      ioas: [],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    const statusDs = r!.discrepancies.filter(x => x.type === 'status_inconsistency');
    expect(statusDs.some(d => d.message.includes('无应收发票'))).toBe(true);
    expect(statusDs.every(d => d.severity === 'warning')).toBe(true);

    // Paid 未交付
    const prisma2 = makePrisma({
      orders: [{ ...baseOrder, status: 'Shipping' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [{ ...shippedShipment, status: 'Shipped' }],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [fullInvoice], // Paid
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r2 = await reconcileOrder(prisma2, 'ORD1');
    const d2 = r2!.discrepancies.find(x => x.type === 'status_inconsistency');
    expect(d2).toBeDefined();
    expect(d2!.severity).toBe('warning');
    expect(d2!.actual).toBe('Shipping');
  });

  it('数量差异：超发 critical；已交付未足量 warning；分批出运未交付不记差异', async () => {
    // 超发
    const prisma = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '120' }],
      invoices: [fullInvoice],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    const over = r!.discrepancies.find(x => x.type === 'quantity_mismatch');
    expect(over).toBeDefined();
    expect(over!.severity).toBe('critical');
    expect(over!.actual).toBe('120');

    // 已交付未足量
    const prisma2 = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '60' }],
      invoices: [fullInvoice],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r2 = await reconcileOrder(prisma2, 'ORD1');
    expect(r2!.discrepancies.find(x => x.type === 'quantity_mismatch')!.severity).toBe('warning');

    // 分批出运（未交付且 <）允许 → 不记数量差异
    const prisma3 = makePrisma({
      orders: [{ ...baseOrder, status: 'Shipping' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [{ ...shippedShipment, status: 'Shipped' }],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '60' }],
      invoices: [{ ...fullInvoice, status: 'Issued' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r3 = await reconcileOrder(prisma3, 'ORD1');
    expect(r3!.discrepancies.find(x => x.type === 'quantity_mismatch')).toBeUndefined();
  });

  it('出运量回退口径：无分配行时经 ShipmentLine.orderLineId 关联聚合', async () => {
    const prisma = makePrisma({
      orders: [baseOrder],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentLines: [
        { id: 'SL1', shipmentId: 'SHP1', orderLineId: 'OL1', quantity: '70' },
        { id: 'SL2', shipmentId: 'SHP1', orderLineId: 'OL1', quantity: '30' },
        { id: 'SL3', shipmentId: 'SHP1', orderLineId: 'OL_OTHER', quantity: '999' }, // 非本订单行，不计
      ],
      invoices: [fullInvoice],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    expect(r!.shippedQty).toBe(100);
    expect(r!.discrepancies).toEqual([]);
  });

  it('手工 actualPaymentAmount 与核销真源漂移 → manual_payment_field_drift info', async () => {
    const prisma = makePrisma({
      orders: [{ ...baseOrder, actualPaymentAmount: '8888' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [shippedShipment],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [fullInvoice],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    const d = r!.discrepancies.find(x => x.type === 'manual_payment_field_drift');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('info');
    expect(d!.expected).toBe('10000');
    expect(d!.actual).toBe('8888');
    expect(r!.referenceActualPaymentAmount).toBe(8888);
    expect(r!.paidAmount).toBe(10000); // 收款真源不受手工字段影响
  });

  it('Cancelled 发票与 Cancelled 运单不参与勾稽', async () => {
    const prisma = makePrisma({
      orders: [{ ...baseOrder, status: 'Shipping' }],
      orderLines: [{ id: 'OL1', orderId: 'ORD1', quantity: '100' }],
      shipments: [{ ...shippedShipment, status: 'Cancelled' }],
      shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
      invoices: [{ ...fullInvoice, status: 'Cancelled' }],
      ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
      invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
    });
    const r = await reconcileOrder(prisma, 'ORD1');
    expect(r!.shippedQty).toBe(0);
    expect(r!.invoicedAmount).toBe(0);
    expect(r!.invoiceCount).toBe(0);
    // 发票 Cancelled → 其核销不应计入（invoiceId 不在有效发票集合内）
    expect(r!.paidAmount).toBe(0);
  });

  it('订单不存在返回 null', async () => {
    const prisma = makePrisma({});
    expect(await reconcileOrder(prisma, 'NOPE')).toBeNull();
  });
});

describe('reconcileCustomer / listAllDiscrepancies — 客户维度与全量清单', () => {
  const seedTwoOrders = () => makePrisma({
    orders: [
      baseOrder, // 全一致
      { ...baseOrder, id: 'ORD2', code: 'SO-2026-002', status: 'Shipping' }, // 无票无运 → 有差异
    ],
    orderLines: [
      { id: 'OL1', orderId: 'ORD1', quantity: '100' },
      { id: 'OL2', orderId: 'ORD2', quantity: '50' },
    ],
    shipments: [shippedShipment],
    shipmentAllocations: [{ id: 'SHPA1', shipmentId: 'SHP1', orderId: 'ORD1', actualQty: '100' }],
    invoices: [fullInvoice],
    ioas: [{ id: 'IOA1', invoiceId: 'INV1', orderId: 'ORD1', allocatedAmount: null, deletedAt: null }],
    invoiceAllocations: [{ id: 'AL1', invoiceId: 'INV1', voucherId: 'PAY1', appliedAmount: '10000' }],
  });

  it('客户维度批量对账：逐单结果 + 汇总计数', async () => {
    const prisma = seedTwoOrders();
    const { summary, orders } = await reconcileCustomer(prisma, 'REL1');
    expect(orders).toHaveLength(2);
    expect(summary.totalOrders).toBe(2);
    expect(summary.discrepancyOrders).toBe(1); // ORD2 全无 → 未开票余额 info
    expect(summary.totalOrderAmount).toBe(20000);
    expect(summary.totalInvoicedAmount).toBe(10000);
    expect(summary.totalPaidAmount).toBe(10000);
    expect(summary.infoCount).toBeGreaterThan(0);
  });

  it('全量差异清单：severity 排序 + 分页 + 筛选', async () => {
    const prisma = seedTwoOrders();
    const all = await listAllDiscrepancies(prisma, {});
    expect(all.total).toBeGreaterThan(0);
    // 排序：critical 在前
    const ranks = all.items.map(i => ({ critical: 0, warning: 1, info: 2 })[i.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // 筛选
    const onlyInfo = await listAllDiscrepancies(prisma, { severity: 'info' });
    expect(onlyInfo.items.every(i => i.severity === 'info')).toBe(true);
    const byType = await listAllDiscrepancies(prisma, { type: 'invoice_amount_mismatch' });
    expect(byType.items.every(i => i.type === 'invoice_amount_mismatch')).toBe(true);
    // 分页
    const paged = await listAllDiscrepancies(prisma, { page: 2, pageSize: 1 });
    expect(paged.page).toBe(2);
    expect(paged.items.length).toBeLessThanOrEqual(1);
    // customerRelationId 过滤
    const byCustomer = await listAllDiscrepancies(prisma, { customerRelationId: 'REL_NOBODY' });
    expect(byCustomer.total).toBe(0);
  });
});
