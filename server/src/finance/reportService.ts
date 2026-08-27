/**
 * Phase B2 — 财务报表服务（账龄分析 / 客户对账单 / 汇率损益）
 *
 * 设计决策：
 *   - 只读报表，不写库；金额计算基于 Invoice + InvoiceAllocation + PaymentVoucher 真源
 *   - 未核销余额 = 发票金额 - Σ allocation.appliedAmount（与 recalcInvoiceStatus 同一口径）
 *   - 账龄以 dueDate 为基准（无 dueDate 回退 issueDate），分 current/1-30/31-60/61-90/90+ 五桶
 *   - 多币种不折算汇总 —— 按 (客户, 币种) 分行，避免汇率假设污染报表
 *   - 汇率损益口径（P2-7 统一走 fxReconciliationService 汇率链）：
 *     B 段 核销额 × (收付汇率 - 开票汇率)；C 段 结汇额 × (结汇汇率 - 收付汇率)；Payable 反向
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
//
// P2-7 口径统一：损益计算不再自算，统一走 fxReconciliationService 的汇率链——
//   B 段（开票日→收付日）：核销维度，computeFxGainLoss(invoice.exchangeRate → voucher.exchangeRate)
//   C 段（收付日→结汇日）：水单维度，computeFxGainLoss(voucher.exchangeRate → settlement.fxRate)
// 符号真源 = computeFxGainLoss（Receivable 下游高=收益 / Payable 下游低=收益）。
// 锁汇覆盖：行级 lockProtected 标记（该单据所属订单存在同币种 active FxRateLock），
// 报表级 lockCoverage 汇总（期间内核销涉及的外币发票中，被锁汇保护的金额占比）。

import { computeFxGainLoss } from './fxReconciliationService';

export type FxGainLossSegment = 'invoice_to_payment' | 'payment_to_settlement';

export interface FxGainLossRow {
  allocationId: string;          // B 段 = InvoiceAllocation.id；C 段 = FxSettlement.id
  appliedDate: string;           // B 段 = 核销日；C 段 = 结汇日
  invoiceNumber: string;         // B 段 = 发票号；C 段 = 上游凭证号（结汇无直接发票）
  voucherNumber: string;         // B 段 = 凭证号；C 段 = 结汇水单号
  invoiceType: string;
  currency: string;
  appliedAmount: number;
  invoiceRate: number;           // 上游汇率（B 段开票日 / C 段收付日）
  voucherRate: number;           // 下游汇率（B 段收付日 / C 段结汇日）
  gainLoss: number; // 正=收益，负=损失（本位币）
  segment: FxGainLossSegment;    // P2-7 汇率链分段
  lockProtected: boolean;        // P2-7 是否被 FxRateLock 保护
}

export interface FxLockCoverageRow {
  currency: string;
  totalAmount: number;   // 期间内核销涉及的外币发票总额
  lockedAmount: number;  // 其中锁汇覆盖金额
  coveragePct: number;   // lockedAmount / totalAmount（0-1）
}

export interface FxGainLossReport {
  from: string | null;
  to: string | null;
  baseCurrency: string;
  rows: FxGainLossRow[];
  totalGainLoss: number;
  lockCoverage: FxLockCoverageRow[]; // P2-7 锁汇覆盖汇总
}

export async function getFxGainLoss(
  prisma: PrismaClient,
  params: { from?: string; to?: string } = {},
): Promise<FxGainLossReport> {
  const { from, to } = params;
  const db = prisma as any;

  const allocations = await prisma.invoiceAllocation.findMany({
    where: {
      ...(from ? { appliedDate: { gte: from } } : {}),
      ...(to ? { appliedDate: { lte: to } } : {}),
    },
    select: { id: true, invoiceId: true, voucherId: true, appliedAmount: true, appliedDate: true },
  });

  // C 段：期间内结汇水单（FxSettlement 仅挂 Receipt 外币凭证，恒 Receivable 侧）
  const settlements: any[] = await db.fxSettlement.findMany({
    where: {
      deletedAt: null,
      ...(from ? { settleDate: { gte: from } } : {}),
      ...(to ? { settleDate: { lte: to } } : {}),
    },
  });

  const invoiceIds = [...new Set(allocations.map(a => a.invoiceId))];
  const voucherIds = [...new Set([
    ...allocations.map(a => a.voucherId),
    ...settlements.map((s: any) => s.voucherId as string),
  ])];

  const [invoices, vouchers] = await Promise.all([
    invoiceIds.length > 0
      ? prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, invoiceNumber: true, type: true, amount: true, currency: true, exchangeRate: true, baseCurrency: true, orderId: true },
        })
      : [],
    voucherIds.length > 0
      ? prisma.paymentVoucher.findMany({
          where: { id: { in: voucherIds } },
          select: { id: true, voucherNumber: true, exchangeRate: true },
        })
      : [],
  ]);
  const invMap = new Map<string, any>(invoices.map(i => [i.id, i] as [string, any]));
  const vocMap = new Map<string, any>(vouchers.map(v => [v.id, v] as [string, any]));

  // 锁汇索引：(orderId, currency) active 锁
  const lockOrderIds = [...new Set([
    ...invoices.map(i => i.orderId).filter((x): x is string => x != null),
    ...settlements.map((s: any) => s.orderId).filter((x: any): x is string => x != null),
  ])];
  const lockRows: any[] = lockOrderIds.length > 0
    ? await db.fxRateLock.findMany({ where: { orderId: { in: lockOrderIds }, deletedAt: null } })
    : [];
  const lockSet = new Set<string>(lockRows.map((l: any) => `${l.orderId}::${l.currency}`));

  const rows: FxGainLossRow[] = [];
  let total = 0;
  let baseCurrency = 'CNY';

  // ── B 段：开票 → 收付（核销维度） ──
  const coverageMap = new Map<string, { total: number; locked: number }>();
  const coveredInvoiceIds = new Set<string>();
  for (const alloc of allocations) {
    const inv = invMap.get(alloc.invoiceId);
    const voc = vocMap.get(alloc.voucherId);
    if (!inv || !voc) continue;
    if (inv.exchangeRate == null || voc.exchangeRate == null) continue;
    if (inv.currency === inv.baseCurrency) continue; // 本币发票无汇兑

    baseCurrency = inv.baseCurrency;
    const lockProtected = inv.orderId != null && lockSet.has(`${inv.orderId}::${inv.currency}`);

    // 锁汇覆盖汇总（按发票去重；期间内核销涉及的外币发票）
    if (!coveredInvoiceIds.has(inv.id)) {
      coveredInvoiceIds.add(inv.id);
      const invAmount = Number(inv.amount);
      if (Number.isFinite(invAmount)) {
        const b = coverageMap.get(inv.currency) ?? { total: 0, locked: 0 };
        b.total = round4(b.total + invAmount);
        if (lockProtected) b.locked = round4(b.locked + invAmount);
        coverageMap.set(inv.currency, b);
      }
    }

    const applied = Number(alloc.appliedAmount);
    const invRate = Number(inv.exchangeRate);
    const vocRate = Number(voc.exchangeRate);
    // 符号口径统一走 computeFxGainLoss（Receivable 收高=收益 / Payable 付低=收益）
    const gainLoss = computeFxGainLoss({ side: inv.type, foreignAmount: applied, fromRate: invRate, toRate: vocRate });
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
      segment: 'invoice_to_payment',
      lockProtected,
    });
    total = round4(total + gainLoss);
  }

  // ── C 段：收付 → 结汇（水单维度；上游=收款凭证汇率快照） ──
  for (const st of settlements) {
    const voc = vocMap.get(st.voucherId);
    if (!voc || voc.exchangeRate == null) continue;
    if (!st.currency || st.currency === 'CNY') continue; // CNY 凭证无结汇语义（创建侧 fail closed），防御性排除
    const foreign = Number(st.foreignAmount);
    const fromRate = Number(voc.exchangeRate);
    const toRate = Number(st.fxRate);
    // 结汇恒为收款侧：结汇汇率高于收付汇率 = 收益
    const gainLoss = computeFxGainLoss({ side: 'Receivable', foreignAmount: foreign, fromRate, toRate });
    if (gainLoss === 0) continue;

    rows.push({
      allocationId: st.id,
      appliedDate: st.settleDate,
      invoiceNumber: voc.voucherNumber, // 结汇无直接发票，上游单据 = 收款凭证
      voucherNumber: st.settlementNumber,
      invoiceType: 'Receivable',
      currency: st.currency,
      appliedAmount: foreign,
      invoiceRate: fromRate,
      voucherRate: toRate,
      gainLoss,
      segment: 'payment_to_settlement',
      lockProtected: st.orderId != null && lockSet.has(`${st.orderId}::${st.currency}`),
    });
    total = round4(total + gainLoss);
  }

  const lockCoverage: FxLockCoverageRow[] = [...coverageMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, b]) => ({
      currency,
      totalAmount: b.total,
      lockedAmount: b.locked,
      coveragePct: b.total > 0 ? round4(b.locked / b.total) : 0,
    }));

  rows.sort((a, b) => a.appliedDate.localeCompare(b.appliedDate));
  return { from: from ?? null, to: to ?? null, baseCurrency, rows, totalGainLoss: total, lockCoverage };
}

// ────────────────────────────────────────────────────────────────
// 3b. 资金日历与 30 天现金流预测（REQ2-02，剧本 C）
// ────────────────────────────────────────────────────────────────
//
// 设计真源：需求池 REQ2-02 · DR-044 净额口径（与账龄/对账单/KPI 同一公式）
//
// 口径：
//   - 现金流事件 = 未结清发票（open = amount − Σ InvoiceAllocation，净额）
//     Receivable → inflow（应收到期收款）/ Payable → outflow（应付到期付款）
//   - 今日动作清单：dueDate ≤ asOf（逾期 + 今日到期），daysOverdue = asOf − dueDate
//   - 30 天预测：asOf < dueDate ≤ asOf+days，按币种分组不折算（多币种纪律同账龄）
//   - 外汇敞口（E4）：非本位币（CNY）净应收/净应付合计（全部未结清，不限窗口）
//   - 预收款/保证金泳道：未核销凭证余额（amount − Σ allocation）按 voucherCategory 分组
//   - 日期基准与账龄一致：dueDate 缺失回退 issueDate
//

export interface CashCalendarAction {
  invoiceId: string;
  invoiceNumber: string;
  type: 'Receivable' | 'Payable';
  counterparty: string | null;
  currency: string;
  openAmount: number;
  dueDate: string;
  daysOverdue: number; // 0 = 今日到期；>0 = 逾期天数
}

export interface CashCalendarForecastRow {
  currency: string;
  overdueInflow: number;   // 已逾期未收
  overdueOutflow: number;  // 已逾期未付
  windowInflow: number;    // 未来 days 天应收到期
  windowOutflow: number;   // 未来 days 天应付到期
  netWindow: number;       // windowInflow − windowOutflow
  itemCount: number;
}

export interface FxExposureRow {
  currency: string;
  netReceivable: number; // 非本位币全部未结清应收
  netPayable: number;    // 非本位币全部未结清应付
}

export interface UnappliedVoucherRow {
  voucherCategory: string; // normal | advance | deposit | ...
  currency: string;
  unapplied: number;       // amount − Σ allocation（未核销余额）
  count: number;
}

export interface CashCalendarReport {
  asOf: string;
  days: number;
  windowEnd: string;
  todayActions: CashCalendarAction[];
  upcoming: CashCalendarAction[];
  forecast: CashCalendarForecastRow[];
  fxExposure: FxExposureRow[];
  unappliedVouchers: UnappliedVoucherRow[];
}

function addDaysYmd(ymd: string, days: number): string {
  return new Date(new Date(ymd + 'T00:00:00Z').getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export async function getCashCalendar(
  prisma: PrismaClient,
  params: { asOf?: string; days?: number } = {},
): Promise<CashCalendarReport> {
  const asOf = params.asOf ?? new Date().toISOString().slice(0, 10);
  const days = Math.min(Math.max(params.days ?? 30, 1), 90);
  const windowEnd = addDaysYmd(asOf, days);

  // 未结清发票（与 getAgingReport 同一过滤与净额公式）
  const invoices = await prisma.invoice.findMany({
    where: {
      type: { in: ['Receivable', 'Payable'] },
      status: { in: ['Issued', 'PartiallyPaid'] },
      deletedAt: null,
    },
    select: {
      id: true, invoiceNumber: true, type: true, amount: true, currency: true,
      issueDate: true, dueDate: true, customerName: true, baseCurrency: true,
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

  const todayActions: CashCalendarAction[] = [];
  const upcoming: CashCalendarAction[] = [];
  const forecastMap = new Map<string, CashCalendarForecastRow>();
  const fxMap = new Map<string, FxExposureRow>();

  for (const inv of invoices) {
    const open = round4(Number(inv.amount) - (allocMap.get(inv.id) ?? 0));
    if (open <= 0) continue;
    const dueDate = inv.dueDate ?? inv.issueDate;
    const daysOverdue = Math.floor((new Date(asOf + 'T00:00:00Z').getTime() - new Date(dueDate + 'T00:00:00Z').getTime()) / MS_PER_DAY);
    const action: CashCalendarAction = {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      type: inv.type as 'Receivable' | 'Payable',
      counterparty: inv.customerName ?? null,
      currency: inv.currency,
      openAmount: open,
      dueDate,
      daysOverdue: Math.max(0, daysOverdue),
    };

    if (dueDate <= asOf) todayActions.push(action);
    else if (dueDate <= windowEnd) upcoming.push(action);

    // 预测（按币种）
    let f = forecastMap.get(inv.currency);
    if (!f) {
      f = { currency: inv.currency, overdueInflow: 0, overdueOutflow: 0, windowInflow: 0, windowOutflow: 0, netWindow: 0, itemCount: 0 };
      forecastMap.set(inv.currency, f);
    }
    f.itemCount += 1;
    if (dueDate <= asOf) {
      if (inv.type === 'Receivable') f.overdueInflow = round4(f.overdueInflow + open);
      else f.overdueOutflow = round4(f.overdueOutflow + open);
    } else if (dueDate <= windowEnd) {
      if (inv.type === 'Receivable') f.windowInflow = round4(f.windowInflow + open);
      else f.windowOutflow = round4(f.windowOutflow + open);
    }

    // 外汇敞口：非本位币（本位币 CNY；与 fx-gain-loss 的 baseCurrency 判定一致）
    if (inv.currency !== 'CNY') {
      let fx = fxMap.get(inv.currency);
      if (!fx) { fx = { currency: inv.currency, netReceivable: 0, netPayable: 0 }; fxMap.set(inv.currency, fx); }
      if (inv.type === 'Receivable') fx.netReceivable = round4(fx.netReceivable + open);
      else fx.netPayable = round4(fx.netPayable + open);
    }
  }

  for (const f of forecastMap.values()) f.netWindow = round4(f.windowInflow - f.windowOutflow);
  todayActions.sort((a, b) => b.daysOverdue - a.daysOverdue || b.openAmount - a.openAmount);
  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.openAmount - a.openAmount);

  // 预收款/保证金泳道：未核销凭证余额（DR-045 真源 = InvoiceAllocation 汇总）
  const vouchers = await prisma.paymentVoucher.findMany({
    where: { deletedAt: null },
    select: { id: true, amount: true, currency: true, voucherCategory: true },
  });
  const voucherIds = vouchers.map(v => v.id);
  const voucherAllocSums = voucherIds.length > 0
    ? await prisma.invoiceAllocation.groupBy({
        by: ['voucherId'],
        where: { voucherId: { in: voucherIds } },
        _sum: { appliedAmount: true },
      })
    : [];
  const voucherAllocMap = new Map(voucherAllocSums.map(a => [a.voucherId, a._sum.appliedAmount != null ? Number(a._sum.appliedAmount) : 0]));
  const unappliedMap = new Map<string, UnappliedVoucherRow>();
  for (const v of vouchers) {
    const unapplied = round4(Number(v.amount) - (voucherAllocMap.get(v.id) ?? 0));
    if (unapplied <= 0) continue;
    const key = `${v.voucherCategory}::${v.currency}`;
    let row = unappliedMap.get(key);
    if (!row) {
      row = { voucherCategory: v.voucherCategory, currency: v.currency, unapplied: 0, count: 0 };
      unappliedMap.set(key, row);
    }
    row.unapplied = round4(row.unapplied + unapplied);
    row.count += 1;
  }

  return {
    asOf,
    days,
    windowEnd,
    todayActions,
    upcoming,
    forecast: [...forecastMap.values()].sort((a, b) => b.netWindow - a.netWindow),
    fxExposure: [...fxMap.values()].sort((a, b) => (b.netReceivable + b.netPayable) - (a.netReceivable + a.netPayable)),
    unappliedVouchers: [...unappliedMap.values()].sort((a, b) => b.unapplied - a.unapplied),
  };
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
