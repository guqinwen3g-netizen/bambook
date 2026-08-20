/**
 * 阶段 P1 — 订单级利润表服务（PRD 6.2 P1 / 8.3 订单利润分析）
 *
 * 职责：
 *   generateOrderProfitSheet(orderId)：聚合订单全链路资金口径，归一化至 CNY：
 *     销售收入 = Σ 应收发票（type=Receivable，非 Cancelled）amount × 汇率
 *     采购成本 = Σ 采购单（非 Cancelled）totalAmount × 汇率
 *     运费     = Σ 运单（非 Cancelled）freight+insurance+customs+otherCharges
 *     杂费     = Σ 付款凭证（type=Disbursement，orderId 匹配，未核销发票）(amount + bankFee) × 汇率
 *   汇率口径：Invoice/PurchaseOrder/PaymentVoucher 自带 exchangeRate 快照优先；
 *     快照缺失且币种非本位币时回退 ExchangeRate 最新记录（details 行标记 rateSource）；
 *     无任何可用汇率的外币行不计入合计，列入 details.unconverted 透明披露。
 *
 * 幂等：orderId @unique 为真源，重生成=覆盖更新（version+1），不产生重复行。
 */

import { PrismaClient, OrderProfitSheet } from '@prisma/client';
import { logger } from '../lib/logger';
import { isInternalTransferEffective } from '../internalTrade/internalTransferService';
import crypto from 'crypto';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export interface ProfitLineItem {
  id: string;
  label: string; // 发票号 / 采购单号 / 运单号 / 凭证号
  amount: number; // 原币金额
  currency: string;
  rate: number; // 实际采用汇率
  rateSource: 'snapshot' | 'base' | 'latest-rate';
  cnyAmount: number; // 折算后金额
  /** DR-005：true = 内部交易行（内部面料采购/销售），合并报表须抵销，不计对外营收 */
  internal?: boolean;
}

export interface UnconvertedLine {
  id: string;
  label: string;
  kind: 'sales' | 'purchase' | 'freight' | 'misc';
  amount: number;
  currency: string;
  reason: string;
}

/** DR-005 内部面料交易利润口径摘要（仅内部交易相关订单附加；schema 冻结期载体为 details JSON） */
export interface InternalTradeSummary {
  /** order.isInternalFabricTrade：内部面料订单独立归集，不进对外营收 */
  isInternalTrade: boolean;
  /** 服装部口径：内部面料采购成本（Σ 生效 incoming transferAmount，CNY） */
  internalPurchaseAmount: number;
  /** 面料部口径：内部面料销售收入（Σ 生效 outgoing transferAmount，CNY） */
  internalSalesAmount: number;
  /** 公司合并视图抵销额 = internalPurchaseAmount（内部采购价 = 内部销售收入） */
  consolidatedAdjustment: number;
  /** 部门利润 = grossProfit（部门视角，不含抵销；合并抵销仅在 reportService 公司视图执行） */
  departmentProfit: number;
}

export interface ProfitSheetDetails {
  sales: ProfitLineItem[];
  purchases: ProfitLineItem[];
  freight: ProfitLineItem[];
  misc: ProfitLineItem[];
  unconverted: UnconvertedLine[];
  internalTrade?: InternalTradeSummary;
}

function generateId(prefix: string): string {
  return `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createProfitSheetService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  /** 最新汇率表（currency → rate），每次生成加载一次 */
  async function loadLatestRateMap(): Promise<Map<string, number>> {
    const rows = await db.exchangeRate.findMany({
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!map.has(r.currency)) map.set(r.currency, Number(r.rate));
    }
    return map;
  }

  /**
   * 单行归一化：返回 ProfitLineItem；无法折算返回 UnconvertedLine 语义对象（cnyAmount 无效）。
   * snapshotRate：单据自带汇率快照（currency → CNY）。
   */
  function normalizeLine(
    kind: UnconvertedLine['kind'],
    id: string,
    label: string,
    amount: number,
    currency: string,
    snapshotRate: number | null,
    latestRates: Map<string, number>,
  ): { line?: ProfitLineItem; unconverted?: UnconvertedLine } {
    if (currency === 'CNY') {
      return { line: { id, label, amount, currency, rate: 1, rateSource: 'base', cnyAmount: round4(amount) } };
    }
    if (snapshotRate !== null && Number.isFinite(snapshotRate) && snapshotRate > 0) {
      return { line: { id, label, amount, currency, rate: snapshotRate, rateSource: 'snapshot', cnyAmount: round4(amount * snapshotRate) } };
    }
    const latest = latestRates.get(currency);
    if (latest !== undefined && latest > 0) {
      return { line: { id, label, amount, currency, rate: latest, rateSource: 'latest-rate', cnyAmount: round4(amount * latest) } };
    }
    return { unconverted: { id, label, kind, amount, currency, reason: '无汇率快照且无最新汇率记录' } };
  }

  /**
   * 聚合订单利润口径（DR-054-①：生成与运费重估同一真源）。
   *
   * freightMultiplier 仅作用于计算层——运单四类费用金额 × multiplier 后再折 CNY
   * （模拟"如果运费涨 N 倍"），不改任何运单数据；生成落库传 1（真实口径）。
   */
  async function buildProfitOverview(orderId: string, freightMultiplier = 1) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) throw new Error('订单不存在');

    const latestRates = await loadLatestRateMap();
    const details: ProfitSheetDetails = { sales: [], purchases: [], freight: [], misc: [], unconverted: [] };

    // ─── 销售收入：应收发票 ───
    const invoices = await db.invoice.findMany({
      where: { orderId, type: 'Receivable', status: { not: 'Cancelled' }, deletedAt: null },
    });
    for (const inv of invoices) {
      const r = normalizeLine('sales', inv.id, inv.invoiceNumber, Number(inv.amount), inv.currency,
        inv.exchangeRate === null ? null : Number(inv.exchangeRate), latestRates);
      if (r.line) details.sales.push(r.line);
      if (r.unconverted) details.unconverted.push(r.unconverted);
    }

    // ─── 采购成本：采购单 ───
    const purchaseOrders = await db.purchaseOrder.findMany({
      where: { orderId, status: { not: 'Cancelled' }, deletedAt: null },
    });
    for (const po of purchaseOrders) {
      const r = normalizeLine('purchase', po.id, po.poNumber, Number(po.totalAmount), po.currency,
        po.exchangeRate === null ? null : Number(po.exchangeRate), latestRates);
      if (r.line) details.purchases.push(r.line);
      if (r.unconverted) details.unconverted.push(r.unconverted);
    }

    // ─── 运费：运单四类费用（运单无汇率快照字段，外币一律按最新汇率折算；
    //     REQ2-14 重估：金额 × freightMultiplier 模拟海运费变动，DR-054-①） ───
    const shipments = await db.shipment.findMany({
      where: { orderId, status: { not: 'Cancelled' }, deletedAt: null },
    });
    for (const sh of shipments) {
      const charges: Array<[number | null, string | null, string]> = [
        [sh.freightAmount === null ? null : Number(sh.freightAmount), sh.freightCurrency, '运费'],
        [sh.insuranceAmount === null ? null : Number(sh.insuranceAmount), sh.insuranceCurrency, '保险费'],
        [sh.customsAmount === null ? null : Number(sh.customsAmount), sh.customsCurrency, '报关费'],
        [sh.otherCharges === null ? null : Number(sh.otherCharges), sh.otherChargesCurrency, '其他费用'],
      ];
      for (const [rawAmount, currency, label] of charges) {
        if (rawAmount === null || rawAmount === 0) continue;
        const amount = rawAmount * freightMultiplier;
        const cur = currency ?? 'CNY';
        const r = normalizeLine('freight', sh.id, `${sh.shipmentNumber} ${label}`, amount, cur, null, latestRates);
        if (r.line) details.freight.push(r.line);
        if (r.unconverted) details.unconverted.push(r.unconverted);
      }
    }

    // ─── 杂费：未核销发票的订单付款凭证（amount + bankFee） ───
    const vouchers = await db.paymentVoucher.findMany({
      where: { orderId, type: 'Disbursement', invoiceId: null, deletedAt: null },
    });
    for (const pv of vouchers) {
      const total = Number(pv.amount) + Number(pv.bankFee ?? 0);
      if (total === 0) continue;
      const r = normalizeLine('misc', pv.id, pv.voucherNumber, total, pv.currency,
        pv.exchangeRate === null ? null : Number(pv.exchangeRate), latestRates);
      if (r.line) details.misc.push(r.line);
      if (r.unconverted) details.unconverted.push(r.unconverted);
    }

    // ─── DR-005 内部面料交易：部门利润口径（订单利润表生成.md §2.3.4） ───
    //   服装部（服装订单侧 incoming）：purchases 维度含内部面料采购价（生效内部供料单 transferAmount）
    //   面料部（内部面料订单侧 outgoing）：sales 维度含内部面料销售收入
    //   仅生效状态（Effective/Delivering/Closed，或历史已认账记录）计入核算；
    //   Draft/PendingConfirm/Cancelled 不计（未批准结算价不得生效，fail-closed）。
    //   兼容说明：mock/旧库无 orderInternalTransfer 表时按无内部交易处理（不影响既有四维聚合）。
    const transferRows: any[] = db.orderInternalTransfer
      ? await db.orderInternalTransfer.findMany({ where: { orderId, deletedAt: null } })
      : [];
    const effectiveTransfers = transferRows.filter((t) => isInternalTransferEffective(t));
    let internalPurchaseCny = 0;
    let internalSalesCny = 0;
    for (const t of effectiveTransfers) {
      const amount = Number(t.transferAmount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      if (t.transferDirection === 'incoming') {
        const r = normalizeLine('purchase', t.id, `内部面料采购（内部供料单 ${t.id}）`, amount, t.transferCurrency ?? 'CNY', null, latestRates);
        if (r.line) { details.purchases.push({ ...r.line, internal: true }); internalPurchaseCny = round4(internalPurchaseCny + r.line.cnyAmount); }
        if (r.unconverted) details.unconverted.push(r.unconverted);
      } else if (t.transferDirection === 'outgoing') {
        const r = normalizeLine('sales', t.id, `内部面料销售（内部供料单 ${t.id}）`, amount, t.transferCurrency ?? 'CNY', null, latestRates);
        if (r.line) { details.sales.push({ ...r.line, internal: true }); internalSalesCny = round4(internalSalesCny + r.line.cnyAmount); }
        if (r.unconverted) details.unconverted.push(r.unconverted);
      }
    }

    const sum = (rows: ProfitLineItem[]) => round4(rows.reduce((acc, r) => acc + r.cnyAmount, 0));
    const salesRevenue = sum(details.sales);
    const purchaseCost = sum(details.purchases);
    const freightCost = sum(details.freight);
    const miscCost = sum(details.misc);
    const grossProfit = round4(salesRevenue - purchaseCost - freightCost - miscCost);
    const grossMargin = salesRevenue > 0 ? round4((grossProfit / salesRevenue) * 100) : null;

    // DR-005 摘要：仅内部交易相关订单附加（departmentProfit = 部门视角 grossProfit；
    // consolidatedAdjustment 供公司合并报表抵销使用，此处不做抵销扣减）
    if (order.isInternalFabricTrade === true || effectiveTransfers.length > 0) {
      details.internalTrade = {
        isInternalTrade: order.isInternalFabricTrade === true,
        internalPurchaseAmount: internalPurchaseCny,
        internalSalesAmount: internalSalesCny,
        consolidatedAdjustment: internalPurchaseCny,
        departmentProfit: grossProfit,
      };
    }

    return {
      order: { id: order.id, poNumber: order.poNumber, customer: order.customer, status: order.status },
      salesRevenue, purchaseCost, freightCost, miscCost, grossProfit, grossMargin, details,
    };
  }

  /**
   * 生成/重生成订单利润表（幂等：orderId 唯一，覆盖更新 version+1）。
   */
  async function generateOrderProfitSheet(orderId: string, actorId: string): Promise<OrderProfitSheet> {
    if (!orderId?.trim()) throw new Error('orderId 必填');
    const overview = await buildProfitOverview(orderId, 1);
    const { salesRevenue, purchaseCost, freightCost, miscCost, grossProfit, grossMargin, details } = overview;

    const ts = now();
    const existing = await db.orderProfitSheet.findUnique({ where: { orderId } });
    let sheet: OrderProfitSheet;
    if (existing) {
      sheet = await db.orderProfitSheet.update({
        where: { orderId },
        data: {
          salesRevenue, purchaseCost, freightCost, miscCost, grossProfit, grossMargin,
          details, version: existing.version + 1, generatedAt: BigInt(ts), updatedAt: BigInt(ts),
        },
      });
    } else {
      sheet = await db.orderProfitSheet.create({
        data: {
          id: generateId('OPS'), orderId,
          salesRevenue, purchaseCost, freightCost, miscCost, grossProfit, grossMargin,
          details, version: 1, generatedAt: BigInt(ts), createdAt: BigInt(ts), updatedAt: BigInt(ts),
        },
      });
    }
    logger.info('[ProfitSheetService] sheet generated', {
      orderId, sheetId: sheet.id, version: sheet.version, grossProfit, actorId,
    });
    return sheet;
  }

  async function getProfitSheetByOrder(orderId: string): Promise<OrderProfitSheet | null> {
    const row = await db.orderProfitSheet.findUnique({ where: { orderId } });
    return row ?? null;
  }

  async function listProfitSheets(query: { limit?: number; offset?: number }) {
    const take = Math.min(query.limit || 50, 200);
    const skip = query.offset || 0;
    const [items, total] = await Promise.all([
      db.orderProfitSheet.findMany({ orderBy: { generatedAt: 'desc' }, take, skip }),
      db.orderProfitSheet.count({}),
    ]);
    return { items, total };
  }

  async function deleteProfitSheet(orderId: string, actorId: string): Promise<void> {
    const existing = await db.orderProfitSheet.findUnique({ where: { orderId } });
    if (!existing) throw new Error('利润表不存在');
    // 硬删除：利润表是聚合投影，重生成即可恢复，无历史留痕义务
    await db.orderProfitSheet.delete({ where: { orderId } });
    logger.info('[ProfitSheetService] sheet deleted', { orderId, actorId });
  }

  /**
   * REQ2-14 海运费变动批量重估（DR-054-②：只读预览不落库；X-04 一屏可见锚点）。
   *
   * 受影响 = 非终态订单且存在活跃运单运费类费用（有运费基数才谈重估）；
   * baseline 优先取已落库利润表（用户认过的口径），无则现场 ×1 计算——同真源。
   */
  async function reestimateFreightImpact(params: { multiplier?: unknown; orderId?: unknown }) {
    const multiplier = Number(params.multiplier ?? 1);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      throw Object.assign(new Error('multiplier 必须为 (0, 100] 区间数值（如 3 = 运费涨 3 倍）'), { code: 'INVALID_MULTIPLIER' });
    }

    // 受影响订单：非终态 + 有活跃运单运费类费用
    const TERMINAL_ORDER_STATUS = ['Cancelled', 'Delivered', 'Completed'];
    const where: any = { deletedAt: null, status: { notIn: TERMINAL_ORDER_STATUS } };
    if (params.orderId != null && String(params.orderId).trim() !== '') where.id = String(params.orderId).trim();
    const orders = await db.order.findMany({
      where,
      select: { id: true, poNumber: true, customer: true, status: true },
    });

    const items: any[] = [];
    for (const order of orders) {
      // 运费基数：活跃运单四类费用（>0 计数）
      const shipments = await db.shipment.findMany({
        where: { orderId: order.id, status: { not: 'Cancelled' }, deletedAt: null },
        select: { freightAmount: true, insuranceAmount: true, customsAmount: true, otherCharges: true },
      });
      const hasFreightBase = shipments.some((sh: any) =>
        [sh.freightAmount, sh.insuranceAmount, sh.customsAmount, sh.otherCharges]
          .some(v => v != null && Number(v) > 0));
      if (!hasFreightBase) continue;

      // baseline 优先取已落库利润表（用户认过的口径）；无落库表 → 现场算（×1，与生成同真源 DR-054-①）
      const baselineSheet = await db.orderProfitSheet.findUnique({ where: { orderId: order.id } });
      const base = baselineSheet
        ? {
          grossProfit: Number(baselineSheet.grossProfit),
          grossMargin: baselineSheet.grossMargin === null ? null : Number(baselineSheet.grossMargin),
          freightCost: Number(baselineSheet.freightCost),
          source: 'persisted' as const,
        }
        : await (async () => {
          const o = await buildProfitOverview(order.id, 1);
          return { grossProfit: o.grossProfit, grossMargin: o.grossMargin, freightCost: o.freightCost, source: 'computed' as const };
        })();

      const reestimated = await buildProfitOverview(order.id, multiplier);
      const deltaProfit = round4(reestimated.grossProfit - base.grossProfit);
      const deltaMargin = (base.grossMargin != null && reestimated.grossMargin != null)
        ? round4(reestimated.grossMargin - base.grossMargin) : null;

      // DR-054-② 三级建议：转负 renegotiate / margin 跌 >10pt warn / 其他 ok
      let advice: 'renegotiate' | 'warn' | 'ok' = 'ok';
      if (reestimated.grossProfit < 0) advice = 'renegotiate';
      else if (deltaMargin != null && deltaMargin < -10) advice = 'warn';

      items.push({
        orderId: order.id, poNumber: order.poNumber, customer: order.customer, status: order.status,
        baseline: { ...base },
        reestimated: {
          grossProfit: reestimated.grossProfit, grossMargin: reestimated.grossMargin,
          freightCost: reestimated.freightCost,
        },
        deltaProfit, deltaMargin, advice,
      });
    }

    // 转负优先，利润变化幅度降序
    const adviceRank: Record<string, number> = { renegotiate: 0, warn: 1, ok: 2 };
    items.sort((a, b) => (adviceRank[a.advice] - adviceRank[b.advice]) || (a.deltaProfit - b.deltaProfit));

    const summary = {
      multiplier,
      affectedOrders: items.length,
      baselineProfitTotal: round4(items.reduce((s, x) => s + x.baseline.grossProfit, 0)),
      reestimatedProfitTotal: round4(items.reduce((s, x) => s + x.reestimated.grossProfit, 0)),
      deltaProfitTotal: round4(items.reduce((s, x) => s + x.deltaProfit, 0)),
      negativeProfitOrders: items.filter(x => x.reestimated.grossProfit < 0).length,
      renegotiateOrders: items.filter(x => x.advice === 'renegotiate').length,
      warnOrders: items.filter(x => x.advice === 'warn').length,
    };
    return { items, summary };
  }

  return {
    generateOrderProfitSheet,
    getProfitSheetByOrder,
    listProfitSheets,
    deleteProfitSheet,
    reestimateFreightImpact,
  };
}

export type ProfitSheetService = ReturnType<typeof createProfitSheetService>;
