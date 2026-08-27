/**
 * reconciliationService.ts — W-B 波次 P2-6 客户四单对账引擎（订单 ↔ 出运 ↔ 开票 ↔ 收款）
 *
 * 开工前已拍板的 3 个跨域契约断层（docs/README.md W-0 节，2026-08-27）：
 *   ① InvoiceOrderAllocation.batchId 无任何写入入口（分批开票未启用）：
 *      本引擎按**整单口径**聚合开票金额——IOA.allocatedAmount 现恒为 null → 取 invoice.amount 全额。
 *      ⚠️ 待分批开票启用后必须补 batchId 维度（按批次拆分 invoiced/paid，与本引擎的订单级口径并存）。
 *   ② 币种双源（Order.currency vs salesCurrency ?? purchaseCurrency）：
 *      订单侧真源统一为 Order.currency；发票侧真源为 Invoice.currency。
 *      两者不一致时记 currency_mismatch 差异，**不静默取其一**。
 *   ③ Order.actualPaymentAmount 是手工 PATCH 字段，财务核销不回写：
 *      收款真源 = Σ InvoiceAllocation.appliedAmount；actualPaymentAmount 仅作参考字段，
 *      与真源不一致时记 manual_payment_field_drift 差异（info），建议后续废弃该手工字段。
 *
 * 口径说明：
 *   - 订单金额：Order.totalNet ?? quoteAmount（与 orderShipmentBatchService.orderAmountOf 同口径）
 *   - 订单数量：Σ OrderLine.quantity；无行时回退 Order.quantity
 *   - 出运数量：优先 Σ ShipmentOrderAllocation.actualQty（DR-016，限已发运+运单）；
 *     无分配行时回退 Σ ShipmentLine.quantity（经 orderLineId ∈ 订单行 关联，限已发运+运单）。
 *     已发运+ = Shipped | Arrived | Cleared | Delivered；Cancelled 运单恒排除。
 *   - 开票金额：Σ (IOA.allocatedAmount ?? Invoice.amount)，type=Receivable 且未作废；
 *     关联路径 = InvoiceOrderAllocation(orderId) ∪ Invoice.orderId 直挂（按发票 id 去重，IOA 分摊额优先）。
 *   - 收款金额：Σ InvoiceAllocation.appliedAmount（硬删除模型，无软删过滤）。
 *
 * 纯只读：不写库、不触发任何状态重算；所有金额用 Prisma.Decimal 累加避免 IEEE 754 漂移。
 *
 * P2-7 多币种扩展（fxReconciliationService 为汇率链唯一计算真源）：
 *   - 单订单结果补 fxDiscrepancies + fx（三段汇率链对照 / 锁汇 / 已实现损益）
 *   - 客户汇总补 fxGainLossTotal（按币种分组：应收/锁汇覆盖/已实现损益）
 *   - 全量差异清单拍平 fx 差异（type=fx_*，支持 type=fx 聚合筛选）
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  reconcileOrderFx,
  type FxDiscrepancy,
  type OrderFxReconciliation,
} from './fxReconciliationService';

export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export interface ReconciliationDiscrepancy {
  type:
    | 'quantity_mismatch'        // 出运量 ≠ 订单量（超发 critical；已交付未足量 warning）
    | 'invoice_amount_mismatch'  // 开票 ≠ 订单额（超开 critical；未开票余额 info/warning）
    | 'payment_mismatch'         // 收款 ≠ 开票（超收 critical；未收款余额 info/warning）
    | 'status_inconsistency'     // 状态链断裂（已交付无票/已付未交付等）
    | 'currency_mismatch'        // 订单/发票币种两两不同
    | 'manual_payment_field_drift' // actualPaymentAmount 手工字段与核销真源漂移
    | 'fx_order_to_invoice'      // P2-7 汇率链 A 段：开票汇率 vs 期望（锁定/市场）
    | 'fx_invoice_to_payment'    // P2-7 汇率链 B 段：收付汇率 vs 开票汇率（已实现损益）
    | 'fx_payment_to_settlement'; // P2-7 汇率链 C 段：结汇汇率 vs 收付汇率（已实现损益）
  field: string;
  expected: string;
  actual: string;
  severity: DiscrepancySeverity;
  message: string;
}

export interface ReconcileOrderResult {
  orderId: string;
  orderCode: string | null;
  poNumber: string | null;
  customerName: string | null;
  customerRelationId: string | null;
  currency: string | null;          // 订单侧币种真源（Order.currency）
  orderAmount: number;              // totalNet ?? quoteAmount
  orderStatus: string;
  orderedQty: number;
  shippedQty: number;
  delivered: boolean;               // 是否存在 Delivered 运单
  invoicedAmount: number;
  invoiceCount: number;
  paidAmount: number;               // Σ InvoiceAllocation.appliedAmount（收款真源）
  referenceActualPaymentAmount: number | null; // 手工字段快照（仅参考，见拍板③）
  discrepancies: ReconciliationDiscrepancy[];
  fxDiscrepancies: FxDiscrepancy[];       // P2-7 汇率链显著差异（锁汇优先）
  fx: OrderFxReconciliation;              // P2-7 三段对照 + 锁汇 + 已实现损益（纯 CNY 订单 segments 为空）
}

/** P2-7 客户维度多币种汇总行（按币种分组） */
export interface CustomerFxCurrencySummary {
  currency: string;
  invoicedAmount: number;      // 外币应收总额（发票）
  lockedAmount: number;        // 其中锁汇覆盖金额（FxRateLock active 的订单）
  coveragePct: number;         // lockedAmount / invoicedAmount（0-1）
  realizedGainLossCny: number; // 已实现汇兑损益（B+C 段合计，CNY）
}

export interface CustomerReconciliationSummary {
  customerRelationId: string;
  totalOrders: number;
  discrepancyOrders: number;
  totalOrderAmount: number;
  totalInvoicedAmount: number;
  totalPaidAmount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  fxGainLossTotal: CustomerFxCurrencySummary[]; // P2-7 多币种汇总（按币种分组）
}

const SHIPPED_STATUSES = new Set(['Shipped', 'Arrived', 'Cleared', 'Delivered']);
const EPS = new Prisma.Decimal('0.0001');

function dec(v: unknown): Prisma.Decimal {
  if (v === null || v === undefined) return new Prisma.Decimal(0);
  try { return new Prisma.Decimal(v as any); } catch { return new Prisma.Decimal(0); }
}

function d2n(d: Prisma.Decimal): number {
  return Number(d.toFixed(4));
}

const SEVERITY_RANK: Record<DiscrepancySeverity, number> = { critical: 0, warning: 1, info: 2 };

export function sortDiscrepancies<T extends { severity: DiscrepancySeverity }>(list: T[]): T[] {
  return [...list].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * 单订单四单勾稽。订单不存在/已软删返回 null（由路由层转 404）。
 */
export async function reconcileOrder(prisma: PrismaClient, orderId: string): Promise<ReconcileOrderResult | null> {
  const db = prisma as any;

  // ── 订单侧 ────────────────────────────────────────────────
  const order = await db.order.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) return null;
  const orderAmount = dec(order.totalNet ?? order.quoteAmount);
  // 拍板②：订单侧币种真源 = Order.currency（不回退 salesCurrency/purchaseCurrency，避免双源静默漂移）
  const orderCurrency: string | null = order.currency ?? null;

  const orderLines: any[] = await db.orderLine.findMany({ where: { orderId } });
  const orderedQty = orderLines.length > 0
    ? orderLines.reduce((sum: Prisma.Decimal, l: any) => sum.plus(dec(l.quantity)), new Prisma.Decimal(0))
    : dec(order.quantity);
  const orderLineIds = new Set(orderLines.map((l: any) => l.id));

  // ── 出运侧 ────────────────────────────────────────────────
  // 关联路径：ShipmentOrderAllocation(orderId)（DR-016 真源）∪ Shipment.orderId 投影（兼容旧数据）
  const shipmentAllocRows: any[] = await db.shipmentOrderAllocation.findMany({ where: { orderId } });
  const allocShipmentIds = [...new Set(shipmentAllocRows.map((a: any) => a.shipmentId))] as string[];
  const projectionShipments: any[] = await db.shipment.findMany({ where: { orderId, deletedAt: null } });
  const shipmentIds = [...new Set([...allocShipmentIds, ...projectionShipments.map((s: any) => s.id)])] as string[];
  const shipments: any[] = shipmentIds.length > 0
    ? await db.shipment.findMany({ where: { id: { in: shipmentIds }, deletedAt: null } })
    : [];
  const activeShipments = shipments.filter((s: any) => s.status !== 'Cancelled');
  const shippedShipments = activeShipments.filter((s: any) => SHIPPED_STATUSES.has(s.status));
  const shippedShipmentIds = new Set(shippedShipments.map((s: any) => s.id));
  const delivered = activeShipments.some((s: any) => s.status === 'Delivered');

  let shippedQty = new Prisma.Decimal(0);
  const allocRowsOnShipped = shipmentAllocRows.filter((a: any) => shippedShipmentIds.has(a.shipmentId));
  if (allocRowsOnShipped.length > 0) {
    // DR-016 分配表口径：actualQty（发货确认回填）；actualQty 缺省回退 plannedQty
    for (const a of allocRowsOnShipped) {
      shippedQty = shippedQty.plus(dec(a.actualQty ?? a.plannedQty));
    }
  } else if (shippedShipments.length > 0) {
    // 回退口径：ShipmentLine.quantity（经 orderLineId ∈ 订单行；行无 orderLineId 时若运单投影挂本订单则计入）
    const projectionShippedIds = new Set(
      shippedShipments.filter((s: any) => s.orderId === orderId).map((s: any) => s.id),
    );
    const lines: any[] = await db.shipmentLine.findMany({
      where: { shipmentId: { in: [...shippedShipmentIds] } },
    });
    for (const line of lines) {
      const belongs = (line.orderLineId && orderLineIds.has(line.orderLineId))
        || (!line.orderLineId && projectionShippedIds.has(line.shipmentId));
      if (belongs) shippedQty = shippedQty.plus(dec(line.quantity));
    }
  }

  // ── 开票侧（应收） ─────────────────────────────────────────
  // 拍板①：整单口径——IOA.allocatedAmount 现恒 null → 取 invoice.amount；
  // ⚠️ 待分批开票启用后需补 batchId 维度（按 OrderShipmentBatch 拆分勾稽）。
  const ioaRows: any[] = await db.invoiceOrderAllocation.findMany({ where: { orderId, deletedAt: null } });
  const ioaInvoiceIds = [...new Set(ioaRows.map((a: any) => a.invoiceId))] as string[];
  const directInvoices: any[] = await db.invoice.findMany({
    where: { orderId, type: 'Receivable', deletedAt: null },
  });
  const allInvoiceIds = [...new Set([...ioaInvoiceIds, ...directInvoices.map((i: any) => i.id)])] as string[];
  const invoices: any[] = allInvoiceIds.length > 0
    ? await db.invoice.findMany({ where: { id: { in: allInvoiceIds }, deletedAt: null } })
    : [];
  const validInvoices = invoices.filter((i: any) => i.type === 'Receivable' && i.status !== 'Cancelled');
  const ioaByInvoiceId = new Map<string, any>(ioaRows.map((a: any) => [a.invoiceId, a]));

  let invoicedAmount = new Prisma.Decimal(0);
  for (const inv of validInvoices) {
    const ioa = ioaByInvoiceId.get(inv.id);
    // IOA 分摊额优先；缺省（null）= 整单口径取发票全额
    invoicedAmount = invoicedAmount.plus(ioa?.allocatedAmount != null ? dec(ioa.allocatedAmount) : dec(inv.amount));
  }

  // ── 收款侧 ────────────────────────────────────────────────
  // 拍板③：收款真源 = Σ InvoiceAllocation.appliedAmount（硬删除模型，无软删过滤）。
  // Order.actualPaymentAmount 仅作参考字段，见下方 manual_payment_field_drift 差异。
  const validInvoiceIds = validInvoices.map((i: any) => i.id);
  const paymentAllocs: any[] = validInvoiceIds.length > 0
    ? await db.invoiceAllocation.findMany({ where: { invoiceId: { in: validInvoiceIds } } })
    : [];
  let paidAmount = new Prisma.Decimal(0);
  for (const pa of paymentAllocs) paidAmount = paidAmount.plus(dec(pa.appliedAmount));

  // ── 差异判定 ───────────────────────────────────────────────
  const discrepancies: ReconciliationDiscrepancy[] = [];
  const push = (d: ReconciliationDiscrepancy) => discrepancies.push(d);
  const orderStatus: string = order.status;

  // 币种不一致（拍板②：订单/发票两两比对，不静默取其一）
  if (orderCurrency) {
    const foreignCurrencies = [...new Set(validInvoices.map((i: any) => i.currency).filter((c: any) => c && c !== orderCurrency))] as string[];
    if (foreignCurrencies.length > 0) {
      push({
        type: 'currency_mismatch',
        field: 'currency',
        expected: orderCurrency,
        actual: foreignCurrencies.join('/'),
        severity: 'warning',
        message: `订单币种 ${orderCurrency} 与发票币种 ${foreignCurrencies.join('/')} 不一致`,
      });
    }
  } else if (validInvoices.length > 0) {
    push({
      type: 'currency_mismatch',
      field: 'currency',
      expected: validInvoices[0].currency,
      actual: '(订单币种缺失)',
      severity: 'info',
      message: '订单未登记币种（Order.currency 为空），无法与发票币种勾稽',
    });
  }

  // 数量差异：超发 critical；订单已交付但未足量 warning；分批出运（未交付且 <）允许
  if (shippedQty.gt(orderedQty.plus(EPS))) {
    push({
      type: 'quantity_mismatch',
      field: 'shippedQty',
      expected: d2n(orderedQty).toString(),
      actual: d2n(shippedQty).toString(),
      severity: 'critical',
      message: `出运量 ${d2n(shippedQty)} 超过订单量 ${d2n(orderedQty)}（超发）`,
    });
  } else if (orderStatus === 'Delivered' && shippedQty.plus(EPS).lt(orderedQty)) {
    push({
      type: 'quantity_mismatch',
      field: 'shippedQty',
      expected: d2n(orderedQty).toString(),
      actual: d2n(shippedQty).toString(),
      severity: 'warning',
      message: `订单已交付但出运量 ${d2n(shippedQty)} 不足订单量 ${d2n(orderedQty)}`,
    });
  }

  // 开票差异：超开 critical；未开票余额（订单交付后 warning，否则 info 允许部分开票）
  if (invoicedAmount.gt(orderAmount.plus(EPS))) {
    push({
      type: 'invoice_amount_mismatch',
      field: 'invoicedAmount',
      expected: d2n(orderAmount).toString(),
      actual: d2n(invoicedAmount).toString(),
      severity: 'critical',
      message: `开票总额 ${d2n(invoicedAmount)} 超过订单金额 ${d2n(orderAmount)}（超开）`,
    });
  } else if (invoicedAmount.plus(EPS).lt(orderAmount)) {
    const open = orderAmount.minus(invoicedAmount);
    push({
      type: 'invoice_amount_mismatch',
      field: 'invoicedAmount',
      expected: d2n(orderAmount).toString(),
      actual: d2n(invoicedAmount).toString(),
      severity: orderStatus === 'Delivered' ? 'warning' : 'info',
      message: `未开票余额 ${d2n(open)}（开票 ${d2n(invoicedAmount)} / 订单 ${d2n(orderAmount)}）`,
    });
  }

  // 收款差异：超收 critical；未收款余额（订单交付后 warning，否则 info 允许部分收款）
  if (paidAmount.gt(invoicedAmount.plus(EPS))) {
    push({
      type: 'payment_mismatch',
      field: 'paidAmount',
      expected: d2n(invoicedAmount).toString(),
      actual: d2n(paidAmount).toString(),
      severity: 'critical',
      message: `收款总额 ${d2n(paidAmount)} 超过开票总额 ${d2n(invoicedAmount)}（超收）`,
    });
  } else if (invoicedAmount.gt(0) && paidAmount.plus(EPS).lt(invoicedAmount)) {
    const open = invoicedAmount.minus(paidAmount);
    push({
      type: 'payment_mismatch',
      field: 'paidAmount',
      expected: d2n(invoicedAmount).toString(),
      actual: d2n(paidAmount).toString(),
      severity: orderStatus === 'Delivered' ? 'warning' : 'info',
      message: `未收款余额 ${d2n(open)}（已收 ${d2n(paidAmount)} / 已开 ${d2n(invoicedAmount)}）`,
    });
  }

  // 状态链一致性
  if (orderStatus === 'Delivered') {
    if (activeShipments.length === 0) {
      push({
        type: 'status_inconsistency',
        field: 'orderStatus',
        expected: '存在运单',
        actual: '无运单',
        severity: 'warning',
        message: '订单已交付但无任何出运记录',
      });
    }
    if (validInvoices.length === 0) {
      push({
        type: 'status_inconsistency',
        field: 'orderStatus',
        expected: '已开票',
        actual: '无应收发票',
        severity: 'warning',
        message: '订单已交付但无应收发票',
      });
    }
  }
  const hasPaidInvoice = validInvoices.some((i: any) => i.status === 'Paid');
  if (hasPaidInvoice && orderStatus !== 'Delivered') {
    push({
      type: 'status_inconsistency',
      field: 'orderStatus',
      expected: 'Delivered',
      actual: orderStatus,
      severity: 'warning',
      message: `发票已结清但订单状态为 ${orderStatus}（未交付）`,
    });
  }

  // 拍板③：手工 actualPaymentAmount 与核销真源漂移（建议废弃手工字段）
  if (order.actualPaymentAmount != null) {
    const manual = dec(order.actualPaymentAmount);
    if (manual.minus(paidAmount).abs().gt(EPS)) {
      push({
        type: 'manual_payment_field_drift',
        field: 'actualPaymentAmount',
        expected: d2n(paidAmount).toString(),
        actual: d2n(manual).toString(),
        severity: 'info',
        message: `手工实收字段 ${d2n(manual)} 与核销真源 ${d2n(paidAmount)} 漂移（建议废弃 Order.actualPaymentAmount 手工 PATCH）`,
      });
    }
  }

  // ── P2-7 汇率链（fxReconciliationService 唯一真源；订单已存在，恒非 null） ──
  const fx = await reconcileOrderFx(prisma, orderId);

  return {
    orderId: order.id,
    orderCode: order.code ?? null,
    poNumber: order.poNumber ?? null,
    customerName: order.customer ?? null,
    customerRelationId: order.customerRelationId ?? null,
    currency: orderCurrency,
    orderAmount: d2n(orderAmount),
    orderStatus,
    orderedQty: d2n(orderedQty),
    shippedQty: d2n(shippedQty),
    delivered,
    invoicedAmount: d2n(invoicedAmount),
    invoiceCount: validInvoices.length,
    paidAmount: d2n(paidAmount),
    referenceActualPaymentAmount: order.actualPaymentAmount != null ? d2n(dec(order.actualPaymentAmount)) : null,
    discrepancies: sortDiscrepancies(discrepancies),
    fxDiscrepancies: fx!.fxDiscrepancies,
    fx: fx!,
  };
}

/**
 * 客户维度批量对账：该客户（customerRelationId）全部未删订单逐单勾稽 + 汇总。
 */
export async function reconcileCustomer(
  prisma: PrismaClient,
  customerRelationId: string,
): Promise<{ summary: CustomerReconciliationSummary; orders: ReconcileOrderResult[] }> {
  const db = prisma as any;
  const orders: any[] = await db.order.findMany({
    where: { customerRelationId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  const results: ReconcileOrderResult[] = [];
  for (const o of orders) {
    const r = await reconcileOrder(prisma, o.id);
    if (r) results.push(r);
  }
  // P2-7 多币种汇总：按币种分组聚合应收 / 锁汇覆盖 / 已实现损益
  const fxByCurrency = new Map<string, CustomerFxCurrencySummary>();
  for (const r of results) {
    for (const g of r.fx.invoicedByCurrency) {
      let row = fxByCurrency.get(g.currency);
      if (!row) {
        row = { currency: g.currency, invoicedAmount: 0, lockedAmount: 0, coveragePct: 0, realizedGainLossCny: 0 };
        fxByCurrency.set(g.currency, row);
      }
      row.invoicedAmount = d2n(dec(row.invoicedAmount).plus(dec(g.amount)));
      row.lockedAmount = d2n(dec(row.lockedAmount).plus(dec(g.lockedAmount)));
    }
    for (const seg of r.fx.segments) {
      if (seg.gainLossCny == null) continue;
      let row = fxByCurrency.get(seg.currency);
      if (!row) {
        row = { currency: seg.currency, invoicedAmount: 0, lockedAmount: 0, coveragePct: 0, realizedGainLossCny: 0 };
        fxByCurrency.set(seg.currency, row);
      }
      row.realizedGainLossCny = d2n(dec(row.realizedGainLossCny).plus(dec(seg.gainLossCny)));
    }
  }
  for (const row of fxByCurrency.values()) {
    row.coveragePct = row.invoicedAmount > 0 ? d2n(dec(row.lockedAmount).div(dec(row.invoicedAmount))) : 0;
  }
  const summary: CustomerReconciliationSummary = {
    customerRelationId,
    totalOrders: results.length,
    discrepancyOrders: results.filter(r => r.discrepancies.length > 0).length,
    totalOrderAmount: d2n(results.reduce((s, r) => s.plus(dec(r.orderAmount)), new Prisma.Decimal(0))),
    totalInvoicedAmount: d2n(results.reduce((s, r) => s.plus(dec(r.invoicedAmount)), new Prisma.Decimal(0))),
    totalPaidAmount: d2n(results.reduce((s, r) => s.plus(dec(r.paidAmount)), new Prisma.Decimal(0))),
    criticalCount: results.reduce((s, r) => s + r.discrepancies.filter(d => d.severity === 'critical').length, 0),
    warningCount: results.reduce((s, r) => s + r.discrepancies.filter(d => d.severity === 'warning').length, 0),
    infoCount: results.reduce((s, r) => s + r.discrepancies.filter(d => d.severity === 'info').length, 0),
    fxGainLossTotal: [...fxByCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
  return { summary, orders: results };
}

export interface DiscrepancyListItem extends ReconciliationDiscrepancy {
  orderId: string;
  orderCode: string | null;
  poNumber: string | null;
  customerName: string | null;
  customerRelationId: string | null;
  currency: string | null;
  orderAmount: number;
}

/**
 * 全量差异清单：扫全部未删订单逐单勾稽，拍平差异按 severity 排序，内存分页。
 * （对账工作台口径；订单量大时后续可加快照缓存——POST /refresh 即为重算入口。）
 *
 * P2-7：fx 差异（汇率链三段）一并拍平，type=fx_order_to_invoice / fx_invoice_to_payment /
 * fx_payment_to_settlement；type 筛选支持精确匹配，或 type=fx 聚合匹配全部汇率链差异。
 */
export async function listAllDiscrepancies(
  prisma: PrismaClient,
  params: { severity?: DiscrepancySeverity; type?: string; customerRelationId?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: DiscrepancyListItem[]; total: number; page: number; pageSize: number }> {
  const db = prisma as any;
  const where: any = { deletedAt: null };
  if (params.customerRelationId) where.customerRelationId = params.customerRelationId;
  const orders: any[] = await db.order.findMany({ where, select: { id: true } });
  const matchType = (t: string) => {
    if (!params.type) return true;
    if (params.type === 'fx') return t.startsWith('fx_');
    return t === params.type;
  };
  const flat: DiscrepancyListItem[] = [];
  for (const o of orders) {
    const r = await reconcileOrder(prisma, o.id);
    if (!r) continue;
    const orderCtx = {
      orderId: r.orderId,
      orderCode: r.orderCode,
      poNumber: r.poNumber,
      customerName: r.customerName,
      customerRelationId: r.customerRelationId,
      currency: r.currency,
      orderAmount: r.orderAmount,
    };
    for (const d of r.discrepancies) {
      if (params.severity && d.severity !== params.severity) continue;
      if (!matchType(d.type)) continue;
      flat.push({ ...d, ...orderCtx });
    }
    // P2-7 汇率链差异拍平（FxDiscrepancy → 清单行；expected/actual 取期望/实际汇率）
    for (const fx of r.fxDiscrepancies) {
      if (params.severity && fx.severity !== params.severity) continue;
      const flatType = `fx_${fx.type}` as ReconciliationDiscrepancy['type'];
      if (!matchType(flatType)) continue;
      flat.push({
        type: flatType,
        field: 'exchangeRate',
        expected: fx.expectedRate != null ? String(fx.expectedRate) : '(缺上游汇率)',
        actual: fx.actualRate != null ? String(fx.actualRate) : '(缺单据汇率)',
        severity: fx.severity,
        message: fx.message,
        ...orderCtx,
      });
    }
  }
  const sorted = sortDiscrepancies(flat);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 50), 200);
  return {
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    page,
    pageSize,
  };
}
