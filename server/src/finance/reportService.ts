/**
 * Phase B2 — 财务报表服务（账龄分析 / 客户对账单 / 汇率损益）
 *
 * 设计决策：
 *   - 只读报表，不写库；金额计算基于 Invoice + InvoiceAllocation + PaymentVoucher 真源
 *   - 未核销余额 = 发票金额 - Σ allocation.appliedAmount（与 recalcInvoiceStatus 同一口径）
 *   - 账龄以 dueDate 为基准（无 dueDate 回退 issueDate），分 current/1-30/31-60/61-90/90+ 五桶
 *   - 多币种不折算汇总 —— 按 (客户, 币种) 分行，避免汇率假设污染报表
 *   - 汇率损益口径：Receivable 收益 = 核销额 × (收款汇率 - 开票汇率)；Payable 反向
 */

import { PrismaClient } from '@prisma/client';
import { isInternalTransferEffective } from '../internalTrade/internalTransferService';

// ────────────────────────────────────────────────────────────────
// 1. 账龄分析（AR/AP Aging）
// ────────────────────────────────────────────────────────────────

export interface AgingBuckets {
  current: number; // 未到期
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

export interface AgingRow {
  customerRelationId: string | null;
  customerName: string;
  currency: string;
  invoiceCount: number;
  buckets: AgingBuckets;
}

export interface AgingReport {
  type: 'Receivable' | 'Payable';
  asOf: string;
  rows: AgingRow[];
  totals: Array<{ currency: string } & AgingBuckets>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function emptyBuckets(): AgingBuckets {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
}

function bucketOf(daysOverdue: number): keyof Omit<AgingBuckets, 'total'> {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90plus';
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function getAgingReport(
  prisma: PrismaClient,
  params: { type: 'Receivable' | 'Payable'; asOf?: string },
): Promise<AgingReport> {
  const asOf = params.asOf ?? new Date().toISOString().slice(0, 10);
  const asOfMs = new Date(asOf + 'T00:00:00Z').getTime();

  const invoices = await prisma.invoice.findMany({
    where: {
      type: params.type,
      status: { in: ['Issued', 'PartiallyPaid'] },
      deletedAt: null,
    },
    select: {
      id: true, invoiceNumber: true, amount: true, currency: true,
      issueDate: true, dueDate: true, customerRelationId: true, customerName: true,
    },
  });

  const ids = invoices.map(i => i.id);
  const allocSums = ids.length > 0
    ? await prisma.invoiceAllocation.groupBy({
        by: ['invoiceId'],
        where: { invoiceId: { in: ids } },
        _sum: { appliedAmount: true },
      })
    : [];
  const allocMap = new Map(allocSums.map(a => [a.invoiceId, a._sum.appliedAmount != null ? Number(a._sum.appliedAmount) : 0]));

  const rowMap = new Map<string, AgingRow>();
  for (const inv of invoices) {
    const open = Number(inv.amount) - (allocMap.get(inv.id) ?? 0);
    if (open <= 0) continue;

    const baseDate = inv.dueDate ?? inv.issueDate;
    const baseMs = new Date(baseDate + 'T00:00:00Z').getTime();
    const daysOverdue = Math.floor((asOfMs - baseMs) / MS_PER_DAY);
    const bucket = bucketOf(daysOverdue);

    const key = `${inv.customerRelationId ?? inv.customerName ?? 'UNKNOWN'}::${inv.currency}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        customerRelationId: inv.customerRelationId,
        customerName: inv.customerName ?? '未知客户',
        currency: inv.currency,
        invoiceCount: 0,
        buckets: emptyBuckets(),
      };
      rowMap.set(key, row);
    }
    row.buckets[bucket] = round4(row.buckets[bucket] + open);
    row.buckets.total = round4(row.buckets.total + open);
    row.invoiceCount += 1;
  }

  const rows = [...rowMap.values()].sort((a, b) => b.buckets.total - a.buckets.total);

  const totalMap = new Map<string, AgingBuckets>();
  for (const row of rows) {
    let t = totalMap.get(row.currency);
    if (!t) { t = emptyBuckets(); totalMap.set(row.currency, t); }
    t.current = round4(t.current + row.buckets.current);
    t.d1_30 = round4(t.d1_30 + row.buckets.d1_30);
    t.d31_60 = round4(t.d31_60 + row.buckets.d31_60);
    t.d61_90 = round4(t.d61_90 + row.buckets.d61_90);
    t.d90plus = round4(t.d90plus + row.buckets.d90plus);
    t.total = round4(t.total + row.buckets.total);
  }

  return {
    type: params.type,
    asOf,
    rows,
    totals: [...totalMap.entries()].map(([currency, b]) => ({ currency, ...b })),
  };
}

// ────────────────────────────────────────────────────────────────
// 2. 客户对账单（Customer Statement）
// ────────────────────────────────────────────────────────────────

export interface StatementTransaction {
  date: string;
  kind: 'invoice' | 'receipt' | 'payment';
  number: string;
  debit: number;  // 发票增加应收/应付
  credit: number; // 收款减少应收；付款减少应付
  balance: number; //  running balance
}

export interface StatementSection {
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
}

export interface CustomerStatement {
  customerRelationId: string;
  customerName: string | null;
  from: string | null;
  to: string | null;
  sections: StatementSection[];
}

export async function getCustomerStatement(
  prisma: PrismaClient,
  params: { customerRelationId: string; from?: string; to?: string },
): Promise<CustomerStatement> {
  const { customerRelationId, from, to } = params;

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerRelationId,
        type: 'Receivable',
        status: { not: 'Cancelled' },
        deletedAt: null,
      },
      select: { invoiceNumber: true, amount: true, currency: true, issueDate: true, customerName: true },
    }),
    prisma.paymentVoucher.findMany({
      where: { customerRelationId, type: 'Receipt', deletedAt: null },
      select: { voucherNumber: true, amount: true, currency: true, paymentDate: true, customerName: true },
    }),
  ]);

  const customerName = invoices[0]?.customerName ?? vouchers[0]?.customerName ?? null;

  // 按币种分组构建 section
  const currencies = [...new Set([...invoices.map(i => i.currency), ...vouchers.map(v => v.currency)])].sort();
  const sections: StatementSection[] = [];

  for (const currency of currencies) {
    const curInvoices = invoices.filter(i => i.currency === currency);
    const curVouchers = vouchers.filter(v => v.currency === currency);

    // 期初余额：from 之前的开票 - 收款
    let opening = 0;
    if (from) {
      for (const inv of curInvoices) if (inv.issueDate < from) opening += Number(inv.amount);
      for (const voc of curVouchers) if (voc.paymentDate < from) opening -= Number(voc.amount);
    }

    type Raw = { date: string; kind: 'invoice' | 'receipt'; number: string; debit: number; credit: number };
    const raws: Raw[] = [];
    for (const inv of curInvoices) {
      if (from && inv.issueDate < from) continue;
      if (to && inv.issueDate > to) continue;
      raws.push({ date: inv.issueDate, kind: 'invoice', number: inv.invoiceNumber, debit: Number(inv.amount), credit: 0 });
    }
    for (const voc of curVouchers) {
      if (from && voc.paymentDate < from) continue;
      if (to && voc.paymentDate > to) continue;
      raws.push({ date: voc.paymentDate, kind: 'receipt', number: voc.voucherNumber, debit: 0, credit: Number(voc.amount) });
    }
    raws.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

    let balance = round4(opening);
    const transactions: StatementTransaction[] = raws.map(r => {
      balance = round4(balance + r.debit - r.credit);
      return { ...r, debit: round4(r.debit), credit: round4(r.credit), balance };
    });

    sections.push({
      currency,
      openingBalance: round4(opening),
      closingBalance: balance,
      transactions,
    });
  }

  return { customerRelationId, customerName, from: from ?? null, to: to ?? null, sections };
}

// ────────────────────────────────────────────────────────────────
// 2b. 供应商对账单（Supplier Statement）— 客户对账的应付侧镜像
// ────────────────────────────────────────────────────────────────
// 语义：Invoice.customerRelationId 承载交易对象（billTo linkKind），应付发票的
// 交易对象即供应商。借方 = 供应商开票（应付增加），贷方 = 付款凭证（应付减少）。

export interface SupplierStatement {
  supplierRelationId: string;
  supplierName: string | null;
  from: string | null;
  to: string | null;
  sections: StatementSection[];
}

export async function getSupplierStatement(
  prisma: PrismaClient,
  params: { supplierRelationId: string; from?: string; to?: string },
): Promise<SupplierStatement> {
  const { supplierRelationId, from, to } = params;

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerRelationId: supplierRelationId,
        type: 'Payable',
        status: { not: 'Cancelled' },
        deletedAt: null,
      },
      select: { invoiceNumber: true, amount: true, currency: true, issueDate: true, customerName: true },
    }),
    prisma.paymentVoucher.findMany({
      where: { customerRelationId: supplierRelationId, type: 'Disbursement', deletedAt: null },
      select: { voucherNumber: true, amount: true, currency: true, paymentDate: true, customerName: true },
    }),
  ]);

  const supplierName = invoices[0]?.customerName ?? vouchers[0]?.customerName ?? null;

  // 按币种分组构建 section（与客户对账同一算法）
  const currencies = [...new Set([...invoices.map(i => i.currency), ...vouchers.map(v => v.currency)])].sort();
  const sections: StatementSection[] = [];

  for (const currency of currencies) {
    const curInvoices = invoices.filter(i => i.currency === currency);
    const curVouchers = vouchers.filter(v => v.currency === currency);

    // 期初余额：from 之前的收票 - 付款
    let opening = 0;
    if (from) {
      for (const inv of curInvoices) if (inv.issueDate < from) opening += Number(inv.amount);
      for (const voc of curVouchers) if (voc.paymentDate < from) opening -= Number(voc.amount);
    }

    type Raw = { date: string; kind: 'invoice' | 'payment'; number: string; debit: number; credit: number };
    const raws: Raw[] = [];
    for (const inv of curInvoices) {
      if (from && inv.issueDate < from) continue;
      if (to && inv.issueDate > to) continue;
      raws.push({ date: inv.issueDate, kind: 'invoice', number: inv.invoiceNumber, debit: Number(inv.amount), credit: 0 });
    }
    for (const voc of curVouchers) {
      if (from && voc.paymentDate < from) continue;
      if (to && voc.paymentDate > to) continue;
      raws.push({ date: voc.paymentDate, kind: 'payment', number: voc.voucherNumber, debit: 0, credit: Number(voc.amount) });
    }
    raws.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

    let balance = round4(opening);
    const transactions: StatementTransaction[] = raws.map(r => {
      balance = round4(balance + r.debit - r.credit);
      return { ...r, debit: round4(r.debit), credit: round4(r.credit), balance };
    });

    sections.push({
      currency,
      openingBalance: round4(opening),
      closingBalance: balance,
      transactions,
    });
  }

  return { supplierRelationId, supplierName, from: from ?? null, to: to ?? null, sections };
}

// ────────────────────────────────────────────────────────────────
// 3. 汇率损益（FX Gain/Loss）
// ────────────────────────────────────────────────────────────────

export interface FxGainLossRow {
  allocationId: string;
  appliedDate: string;
  invoiceNumber: string;
  voucherNumber: string;
  invoiceType: string;
  currency: string;
  appliedAmount: number;
  invoiceRate: number;
  voucherRate: number;
  gainLoss: number; // 正=收益，负=损失（本位币）
}

export interface FxGainLossReport {
  from: string | null;
  to: string | null;
  baseCurrency: string;
  rows: FxGainLossRow[];
  totalGainLoss: number;
}

export async function getFxGainLoss(
  prisma: PrismaClient,
  params: { from?: string; to?: string } = {},
): Promise<FxGainLossReport> {
  const { from, to } = params;

  const allocations = await prisma.invoiceAllocation.findMany({
    where: {
      ...(from ? { appliedDate: { gte: from } } : {}),
      ...(to ? { appliedDate: { lte: to } } : {}),
    },
    select: { id: true, invoiceId: true, voucherId: true, appliedAmount: true, appliedDate: true },
  });

  const invoiceIds = [...new Set(allocations.map(a => a.invoiceId))];
  const voucherIds = [...new Set(allocations.map(a => a.voucherId))];

  const [invoices, vouchers] = await Promise.all([
    invoiceIds.length > 0
      ? prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, invoiceNumber: true, type: true, currency: true, exchangeRate: true, baseCurrency: true },
        })
      : [],
    voucherIds.length > 0
      ? prisma.paymentVoucher.findMany({
          where: { id: { in: voucherIds } },
          select: { id: true, voucherNumber: true, exchangeRate: true },
        })
      : [],
  ]);
  const invMap = new Map(invoices.map(i => [i.id, i]));
  const vocMap = new Map(vouchers.map(v => [v.id, v]));

  const rows: FxGainLossRow[] = [];
  let total = 0;
  let baseCurrency = 'CNY';

  for (const alloc of allocations) {
    const inv = invMap.get(alloc.invoiceId);
    const voc = vocMap.get(alloc.voucherId);
    if (!inv || !voc) continue;
    if (inv.exchangeRate == null || voc.exchangeRate == null) continue;
    if (inv.currency === inv.baseCurrency) continue; // 本币发票无汇兑

    baseCurrency = inv.baseCurrency;
    const applied = Number(alloc.appliedAmount);
    const invRate = Number(inv.exchangeRate);
    const vocRate = Number(voc.exchangeRate);
    // Receivable：收款汇率高于开票汇率 = 收益；Payable：付款汇率低于开票汇率 = 收益
    const diff = inv.type === 'Payable' ? invRate - vocRate : vocRate - invRate;
    const gainLoss = round4(applied * diff);
    if (gainLoss === 0) continue;

    rows.push({
      allocationId: alloc.id,
      appliedDate: alloc.appliedDate,
      invoiceNumber: inv.invoiceNumber,
      voucherNumber: voc.voucherNumber,
      invoiceType: inv.type,
      currency: inv.currency,
      appliedAmount: applied,
      invoiceRate: invRate,
      voucherRate: vocRate,
      gainLoss,
    });
    total = round4(total + gainLoss);
  }

  rows.sort((a, b) => a.appliedDate.localeCompare(b.appliedDate));
  return { from: from ?? null, to: to ?? null, baseCurrency, rows, totalGainLoss: total };
}

// ────────────────────────────────────────────────────────────────
// 4. 公司合并利润视图（DR-005 抵销内部面料采购/销售）
// ────────────────────────────────────────────────────────────────
//
// 设计真源：
//   - 2026-08-16-设计评审决策记录.md DR-005 / DR-043（利润口径：内部交易不重复计入收入或成本）
//   - 订单利润表生成.md §2.3.2（合并抵销口径）
//   - 实体关系总览.md §6.4（L-18/L-19）
//
// 口径（基于 OrderProfitSheet 聚合投影 + OrderInternalTransfer 生效记录，只读不写库）：
//   合并收入 = Σ 外部订单 salesRevenue（内部面料订单 isInternalFabricTrade=true 整体剔除，不进对外营收）
//   合并成本 = Σ 外部订单 (purchaseCost − 内部采购价)        ← 剔除内部采购加价
//            + Σ 内部面料订单 purchaseCost                    ← 真实面料成本
//            + Σ 全部订单 freightCost + miscCost
//   合并利润 = 合并收入 − 合并成本
//   抵销额   = Σ 生效 incoming transferAmount（内部采购价 = 内部销售收入，仅取单边，禁止双边重复）
//
// 部门利润（DR-043 双视角）：
//   服装部（外部服装订单）：收入含外部客户收入，成本含内部面料采购价 → 服装部利润已扣内部采购
//   面料部（内部面料订单 + 外部面料订单）：收入含内部面料销售，成本为真实面料成本 → 保留内部面料利润
//   恒等式：Σ 部门利润 = 合并利润（内部采购=内部销售抵销后利润不变；discrepancy 透明披露不等情形）

export interface ConsolidatedProfitDepartment {
  revenue: number;
  cost: number;
  profit: number;
}

export interface ConsolidatedProfitReport {
  /** 报表范围元数据：订单日期（Order.poDate）过滤区间，未传为 null（与 FxGainLossReport 同模式） */
  from: string | null;
  to: string | null;
  baseCurrency: string;
  consolidatedRevenue: number;
  consolidatedCost: number;
  consolidatedProfit: number;
  costBreakdown: {
    /** 外部订单采购成本（已剔除内部采购加价） */
    externalPurchaseNetOfInternal: number;
    /** 真实面料成本（内部面料订单自身采购成本） */
    realFabricCost: number;
    freightCost: number;
    miscCost: number;
  };
  elimination: {
    /** 服装部内部面料采购成本合计（生效 incoming） */
    internalPurchase: number;
    /** 面料部内部面料销售收入合计（生效 outgoing） */
    internalSales: number;
    /** 抵销额 = internalPurchase（单边口径） */
    amount: number;
    /** internalSales − internalPurchase（应≈0；非 0 透明披露，提示双边口径不一致） */
    discrepancy: number;
  };
  departments: {
    garment: ConsolidatedProfitDepartment;
    fabric: ConsolidatedProfitDepartment;
  };
  orders: { externalCount: number; internalCount: number };
  /** 非 CNY 生效内部交易：不折算不假设汇率，透明披露并排除在抵额外 */
  unconverted: Array<{ transferId: string; orderId: string; direction: string; amount: number; currency: string; reason: string }>;
}

export async function getConsolidatedProfitReport(
  prisma: PrismaClient,
  params: { from?: string; to?: string } = {},
): Promise<ConsolidatedProfitReport> {
  const { from, to } = params;
  const scoped = Boolean(from || to);
  const db = prisma as any;

  const sheets: any[] = await db.orderProfitSheet.findMany({});
  const orderIds: string[] = [...new Set(sheets.map((s) => s.orderId as string))];
  // 日期过滤：按订单日期（Order.poDate，String?）区间筛选。
  // poDate 为 null 的订单不满足 gte/lte 比较（Prisma null 语义），过滤模式下自然排除——
  // 无法证明落在区间内，不计入报表范围。
  const orders: any[] = orderIds.length > 0
    ? await db.order.findMany({
        where: {
          id: { in: orderIds },
          deletedAt: null,
          ...(scoped ? { poDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  // 生效内部交易（Effective/Delivering/Closed，或历史已认账）；单边聚合（incoming=采购 / outgoing=销售）
  const transfers: any[] = db.orderInternalTransfer
    ? await db.orderInternalTransfer.findMany({ where: { deletedAt: null } })
    : [];
  const internalPurchaseByOrder = new Map<string, number>();
  const internalSalesByOrder = new Map<string, number>();
  const unconverted: ConsolidatedProfitReport['unconverted'] = [];
  for (const t of transfers) {
    if (!isInternalTransferEffective(t)) continue;
    const amount = Number(t.transferAmount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if ((t.transferCurrency ?? 'CNY') !== 'CNY') {
      unconverted.push({
        transferId: t.id, orderId: t.orderId, direction: t.transferDirection,
        amount, currency: t.transferCurrency, reason: '非本位币内部交易，报表不做汇率假设，透明披露',
      });
      continue;
    }
    if (t.transferDirection === 'incoming') {
      internalPurchaseByOrder.set(t.orderId, round4((internalPurchaseByOrder.get(t.orderId) ?? 0) + amount));
    } else if (t.transferDirection === 'outgoing') {
      internalSalesByOrder.set(t.orderId, round4((internalSalesByOrder.get(t.orderId) ?? 0) + amount));
    }
  }

  const garment: ConsolidatedProfitDepartment = { revenue: 0, cost: 0, profit: 0 };
  const fabric: ConsolidatedProfitDepartment = { revenue: 0, cost: 0, profit: 0 };
  let consolidatedRevenue = 0;
  let externalPurchaseNetOfInternal = 0;
  let realFabricCost = 0;
  let freightCostTotal = 0;
  let miscCostTotal = 0;
  let externalCount = 0;
  let internalCount = 0;
  // 纳入报表范围的订单集合：过滤模式下抵销额/unconverted 只汇总该集合，
  // 保证"订单被日期过滤 ⇔ 其内部交易同口径收窄"，避免范围不一致。
  const includedOrderIds = new Set<string>();

  for (const sheet of sheets) {
    const order = orderMap.get(sheet.orderId);
    // 过滤模式：order 不在范围内（日期区间外 / poDate 为空）→ 整张 sheet 排除。
    // 无过滤模式保持既有语义（含软删订单 sheet 按外部订单计入的历史行为）。
    if (scoped && !order) continue;
    includedOrderIds.add(sheet.orderId);
    const isInternal = order?.isInternalFabricTrade === true;
    const sR = Number(sheet.salesRevenue) || 0;
    const pC = Number(sheet.purchaseCost) || 0;
    const fC = Number(sheet.freightCost) || 0;
    const mC = Number(sheet.miscCost) || 0;
    freightCostTotal = round4(freightCostTotal + fC);
    miscCostTotal = round4(miscCostTotal + mC);

    // 部门归属：内部面料订单 / businessLine=fabric → 面料部；其余（garment/capsule/other 外部订单）→ 服装部
    const dept = isInternal || order?.businessLine === 'fabric' ? fabric : garment;
    dept.revenue = round4(dept.revenue + sR);
    dept.cost = round4(dept.cost + pC + fC + mC);
    dept.profit = round4(dept.revenue - dept.cost);

    if (isInternal) {
      internalCount += 1;
      realFabricCost = round4(realFabricCost + pC); // 真实面料成本
    } else {
      externalCount += 1;
      consolidatedRevenue = round4(consolidatedRevenue + sR); // 仅外部客户收入
      const internalPurchase = internalPurchaseByOrder.get(sheet.orderId) ?? 0;
      externalPurchaseNetOfInternal = round4(externalPurchaseNetOfInternal + Math.max(0, round4(pC - internalPurchase)));
    }
  }

  // 抵销合计：过滤模式只汇总范围内订单的内部交易；无过滤保持既有全量口径
  const sumScoped = (map: Map<string, number>) => {
    let total = 0;
    for (const [orderId, amount] of map) {
      if (!scoped || includedOrderIds.has(orderId)) total = round4(total + amount);
    }
    return total;
  };
  const internalPurchaseTotal = sumScoped(internalPurchaseByOrder);
  const internalSalesTotal = sumScoped(internalSalesByOrder);
  const consolidatedCost = round4(externalPurchaseNetOfInternal + realFabricCost + freightCostTotal + miscCostTotal);
  const scopedUnconverted = scoped ? unconverted.filter((u) => includedOrderIds.has(u.orderId)) : unconverted;

  return {
    from: from ?? null,
    to: to ?? null,
    baseCurrency: 'CNY',
    consolidatedRevenue,
    consolidatedCost,
    consolidatedProfit: round4(consolidatedRevenue - consolidatedCost),
    costBreakdown: {
      externalPurchaseNetOfInternal,
      realFabricCost,
      freightCost: freightCostTotal,
      miscCost: miscCostTotal,
    },
    elimination: {
      internalPurchase: internalPurchaseTotal,
      internalSales: internalSalesTotal,
      amount: internalPurchaseTotal,
      discrepancy: round4(internalSalesTotal - internalPurchaseTotal),
    },
    departments: { garment, fabric },
    orders: { externalCount, internalCount },
    unconverted: scopedUnconverted,
  };
}
