/**
 * Phase C1 — 经营驾驶舱聚合服务（Business Cockpit）
 *
 * 口径定义：
 *   - 销售额 = contractAmount ?? quoteAmount（订单承揽口径）
 *   - 回款额 = actualPaymentAmount（订单回填口径）
 *   - 毛利口径：收入 = shipmentAmount ?? contractAmount ?? quoteAmount；
 *     成本 = supplierInvoiceAmount ?? (purchasePrice × quantity)
 *   - 销售币种 = salesCurrency ?? currency；采购币种 = purchaseCurrency ?? 销售币种
 *   - 跨币种订单不计算毛利（margin=null），避免汇率假设污染报表（与 B2 口径一致）
 *   - 日期区间按 dueDate 字典序过滤（与 B3 准交率口径一致）
 *
 * 设计决策：
 *   - 只读聚合，不写库；应收应付预警/汇率损益直接复用 B2 reportService
 *   - 多币种不折算汇总 —— 按币种分行/分合计
 */

import { PrismaClient } from '@prisma/client';
import { getAgingReport, getFxGainLoss, type AgingRow } from '../finance/reportService';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface SalesLeaderboardRow {
  salesPerson: string; // 未填归 '未分配'
  currency: string;
  orderCount: number;
  salesAmount: number;
  collectedAmount: number;
}

export interface CustomerContributionRow {
  customer: string;
  customerRelationId: string | null;
  currency: string;
  orderCount: number;
  salesAmount: number;
  share: number; // 同币种内占比 0-1（round4）
}

export interface OrderMarginRow {
  orderId: string;
  poNumber: string | null;
  customer: string;
  product: string;
  salesPerson: string | null;
  dueDate: string;
  status: string;
  currency: string; // 收入币种
  revenue: number;
  cost: number | null; // 无成本数据时为 null
  crossCurrency: boolean; // 采销币种不一致 → 不算毛利
  margin: number | null;
  marginRate: number | null; // margin / revenue（round4）
}

export interface OrderMarginTotal {
  currency: string;
  revenue: number;
  cost: number;
  margin: number;
  marginRate: number | null;
  orderCount: number; // 计入合计的订单数（排除跨币种/缺成本）
}

export interface ArApAlertBucket {
  currency: string;
  overdue: number; // d1_30 + d31_60 + d61_90 + d90plus
  total: number;
}

export interface BusinessCockpit {
  from: string | null;
  to: string | null;
  generatedAt: string; // ISO
  salesLeaderboard: SalesLeaderboardRow[];
  customerContribution: CustomerContributionRow[];
  orderMargins: { rows: OrderMarginRow[]; totals: OrderMarginTotal[]; excludedCount: number };
  arApAlerts: {
    receivable: { rows: AgingRow[]; totals: ArApAlertBucket[] };
    payable: { rows: AgingRow[]; totals: ArApAlertBucket[] };
  };
  fxSummary: { baseCurrency: string; totalGainLoss: number; rowCount: number };
}

// ────────────────────────────────────────────────────────────────
// 实现
// ────────────────────────────────────────────────────────────────

const UNASSIGNED = '未分配';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function overdueOf(row: AgingRow): number {
  return round4(row.buckets.d1_30 + row.buckets.d31_60 + row.buckets.d61_90 + row.buckets.d90plus);
}

function alertTotals(rows: AgingRow[]): ArApAlertBucket[] {
  const map = new Map<string, ArApAlertBucket>();
  for (const row of rows) {
    let t = map.get(row.currency);
    if (!t) { t = { currency: row.currency, overdue: 0, total: 0 }; map.set(row.currency, t); }
    t.overdue = round4(t.overdue + overdueOf(row));
    t.total = round4(t.total + row.buckets.total);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue);
}

export async function getBusinessCockpit(
  prisma: PrismaClient,
  params: { from?: string; to?: string; marginRowLimit?: number } = {},
): Promise<BusinessCockpit> {
  const { from, to } = params;
  const marginRowLimit = Math.min(Math.max(params.marginRowLimit ?? 100, 1), 500);

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      ...(from || to
        ? { dueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    select: {
      id: true, poNumber: true, customer: true, product: true, salesPerson: true,
      dueDate: true, status: true, quantity: true,
      currency: true, salesCurrency: true, purchaseCurrency: true,
      quoteAmount: true, contractAmount: true, shipmentAmount: true,
      actualPaymentAmount: true, purchasePrice: true, supplierInvoiceAmount: true,
      customerRelationId: true,
    },
  });

  // ── 1. 销售业绩排行（按 salesPerson × currency） ──
  const salesMap = new Map<string, SalesLeaderboardRow>();
  // ── 2. 客户贡献度（按 customer × currency） ──
  const custMap = new Map<string, CustomerContributionRow>();
  const custCurrencyTotals = new Map<string, number>();
  // ── 3. 订单毛利表 ──
  const marginRows: OrderMarginRow[] = [];

  for (const o of orders) {
    const salesAmount = num(o.contractAmount) ?? num(o.quoteAmount) ?? 0;
    const salesCurrency = o.salesCurrency ?? o.currency ?? 'USD';
    const salesPerson = o.salesPerson?.trim() || UNASSIGNED;

    const sKey = `${salesPerson}::${salesCurrency}`;
    let sRow = salesMap.get(sKey);
    if (!sRow) {
      sRow = { salesPerson, currency: salesCurrency, orderCount: 0, salesAmount: 0, collectedAmount: 0 };
      salesMap.set(sKey, sRow);
    }
    sRow.orderCount += 1;
    sRow.salesAmount = round4(sRow.salesAmount + salesAmount);
    sRow.collectedAmount = round4(sRow.collectedAmount + (num(o.actualPaymentAmount) ?? 0));

    const cKey = `${o.customerRelationId ?? o.customer}::${salesCurrency}`;
    let cRow = custMap.get(cKey);
    if (!cRow) {
      cRow = {
        customer: o.customer, customerRelationId: o.customerRelationId,
        currency: salesCurrency, orderCount: 0, salesAmount: 0, share: 0,
      };
      custMap.set(cKey, cRow);
    }
    cRow.orderCount += 1;
    cRow.salesAmount = round4(cRow.salesAmount + salesAmount);
    custCurrencyTotals.set(salesCurrency, round4((custCurrencyTotals.get(salesCurrency) ?? 0) + salesAmount));

    // 毛利
    const revenue = num(o.shipmentAmount) ?? num(o.contractAmount) ?? num(o.quoteAmount) ?? 0;
    const purchaseCurrency = o.purchaseCurrency ?? salesCurrency;
    const cost = num(o.supplierInvoiceAmount)
      ?? (num(o.purchasePrice) != null ? round4(num(o.purchasePrice)! * o.quantity) : null);
    const crossCurrency = cost != null && purchaseCurrency !== salesCurrency;
    const margin = cost != null && !crossCurrency ? round4(revenue - cost) : null;
    const marginRate = margin != null && revenue > 0 ? round4(margin / revenue) : null;
    marginRows.push({
      orderId: o.id, poNumber: o.poNumber, customer: o.customer, product: o.product,
      salesPerson: o.salesPerson, dueDate: o.dueDate, status: o.status,
      currency: salesCurrency, revenue: round4(revenue),
      cost: cost != null ? round4(cost) : null,
      crossCurrency, margin, marginRate,
    });
  }

  // 贡献度占比（同币种内）
  for (const row of custMap.values()) {
    const total = custCurrencyTotals.get(row.currency) ?? 0;
    row.share = total > 0 ? round4(row.salesAmount / total) : 0;
  }

  const salesLeaderboard = [...salesMap.values()]
    .sort((a, b) => b.salesAmount - a.salesAmount);
  const customerContribution = [...custMap.values()]
    .sort((a, b) => b.salesAmount - a.salesAmount);

  // 毛利合计（仅同币种且成本齐备的订单计入）
  const marginTotalMap = new Map<string, OrderMarginTotal>();
  let excluded = 0;
  for (const row of marginRows) {
    if (row.margin == null || row.cost == null || row.crossCurrency) { excluded++; continue; }
    let t = marginTotalMap.get(row.currency);
    if (!t) {
      t = { currency: row.currency, revenue: 0, cost: 0, margin: 0, marginRate: null, orderCount: 0 };
      marginTotalMap.set(row.currency, t);
    }
    t.revenue = round4(t.revenue + row.revenue);
    t.cost = round4(t.cost + row.cost);
    t.margin = round4(t.margin + row.margin);
    t.orderCount += 1;
  }
  for (const t of marginTotalMap.values()) {
    t.marginRate = t.revenue > 0 ? round4(t.margin / t.revenue) : null;
  }

  // 毛利行排序：亏损订单靠前暴露问题（margin 升序），无毛利数据的排最后按收入降序
  marginRows.sort((a, b) => {
    if (a.margin == null && b.margin == null) return b.revenue - a.revenue;
    if (a.margin == null) return 1;
    if (b.margin == null) return -1;
    return a.margin - b.margin;
  });
  const trimmedMarginRows = marginRows.slice(0, marginRowLimit);

  // ── 4. 应收应付预警（复用 B2 账龄，取逾期行 Top5） ──
  const [arAging, apAging] = await Promise.all([
    getAgingReport(prisma, { type: 'Receivable' }),
    getAgingReport(prisma, { type: 'Payable' }),
  ]);
  const arAlertRows = arAging.rows.filter(r => overdueOf(r) > 0)
    .sort((a, b) => overdueOf(b) - overdueOf(a)).slice(0, 5);
  const apAlertRows = apAging.rows.filter(r => overdueOf(r) > 0)
    .sort((a, b) => overdueOf(b) - overdueOf(a)).slice(0, 5);

  // ── 5. 汇率损益汇总（复用 B2） ──
  const fx = await getFxGainLoss(prisma, { from, to });

  return {
    from: from ?? null,
    to: to ?? null,
    generatedAt: new Date().toISOString(),
    salesLeaderboard,
    customerContribution,
    orderMargins: { rows: trimmedMarginRows, totals: [...marginTotalMap.values()], excludedCount: excluded },
    arApAlerts: {
      receivable: { rows: arAlertRows, totals: alertTotals(arAging.rows) },
      payable: { rows: apAlertRows, totals: alertTotals(apAging.rows) },
    },
    fxSummary: { baseCurrency: fx.baseCurrency, totalGainLoss: fx.totalGainLoss, rowCount: fx.rows.length },
  };
}
