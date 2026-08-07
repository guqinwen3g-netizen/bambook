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
  kind: 'invoice' | 'receipt';
  number: string;
  debit: number;  // 发票增加应收
  credit: number; // 收款减少应收
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
