/**
 * company-sim/quotations.ts — 报价→赢单转订单 + 未赢单报价（联动③）
 *
 * 剧情（确定性）：
 *   - 赢单 12 张：SIM-ORD-{1,6,11,…,56}（idx % 5 === 0，覆盖全部命运分布），
 *     status=Accepted，issueDate = 订单创建前 10 天，QuotationVersion v1 快照，
 *     回写 Quotation.convertedOrderId + Order.source='quotation-convert' + Order.quoteAmount=报价总额；
 *   - 未赢单 7 张：Sent 3 / Rejected 2 / Expired 2，散布 W3-W12，带 sentAt 与版本快照。
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { at, isoDate, round2, createManyLogged, SALES_NAME } from './common';
import { CUSTOMERS, type MasterDataCtx } from './master-data';
import type { OrderPlan } from './orders';

const DAY = 24 * 3600 * 1000;

/** 赢单报价覆盖的订单 idx（12 单） */
function isWonIdx(idx: number): boolean {
  return idx % 5 === 0;
}

/** 未赢单报价剧情：Sent 3 / Rejected 2 / Expired 2（散布各周） */
const LOST_DEFS: Array<{ week: number; status: 'Sent' | 'Rejected' | 'Expired'; note: string }> = [
  { week: 3, status: 'Expired', note: '报价有效期届满未获回复，自动过期。' },
  { week: 4, status: 'Expired', note: '客户项目推迟，报价过期未跟进。' },
  { week: 6, status: 'Rejected', note: '客户选择低价供应商，未成交。' },
  { week: 7, status: 'Rejected', note: '价格分歧未弥合，客户放弃本次采购。' },
  { week: 9, status: 'Sent', note: '报价已发送，等待客户回复。' },
  { week: 10, status: 'Sent', note: '已发送修订报价（含运费调整），跟进中。' },
  { week: 12, status: 'Sent', note: '新季报价已发送，预计下周复函。' },
];

export async function seedQuotations(
  prisma: PrismaClient,
  plans: OrderPlan[],
  md: MasterDataCtx,
): Promise<void> {
  console.log('── 报价单（赢单 12 转订单 + 未赢单 7） ──');

  const garmentIdxById = new Map(md.garmentAssets.map((g, i) => [g.id, i] as const));
  const fabricSkuOfGarment = (garmentId: string): string => {
    const gIdx = garmentIdxById.get(garmentId);
    if (gIdx === undefined) throw new Error(`garmentId ${garmentId} 不在 md.garmentAssets`);
    return md.fabricAssets[gIdx % 24].sku;
  };
  const fxOf = (currency: string): number => (currency === 'EUR' ? 7.82 : 7.16);

  const quotationRows: Prisma.QuotationUncheckedCreateInput[] = [];
  const lineRows: Prisma.QuotationLineUncheckedCreateInput[] = [];
  const versionRows: Prisma.QuotationVersionUncheckedCreateInput[] = [];
  const wonUpdates: Array<{ orderId: string; totalAmount: Prisma.Decimal; confirmedMs: number }> = [];

  let seq = 0;
  const buildQuotation = (args: {
    status: string;
    currency: string;
    customerRelId: string;
    customerName: string;
    issueMs: number;
    validUntil: string | null;
    salesName: string;
    salesId: string;
    sentAtMs: number | null;
    totalAmount: number;
    convertedOrderId: string | null;
    notes: string;
    confirmedMs: number;
    lines: Array<{ fabricCode: string; description: string; quantity: number; unit: string; unitPrice: number }>;
  }): void => {
    seq += 1;
    const qId = `SIM-QT-${String(seq).padStart(3, '0')}`;
    const quotationNumber = `SIM-QT-2026-${String(seq).padStart(3, '0')}`;
    quotationRows.push({
      id: qId, quotationNumber, status: args.status,
      currency: args.currency, totalAmount: new Prisma.Decimal(round2(args.totalAmount)), version: 1,
      exchangeRate: new Prisma.Decimal(fxOf(args.currency)), baseCurrency: 'CNY',
      customerRelationId: args.customerRelId, customerName: args.customerName, customerCode: args.customerRelId,
      issueDate: isoDate(args.issueMs), validUntil: args.validUntil,
      deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% against B/L copy',
      salesperson: args.salesName, convertedOrderId: args.convertedOrderId,
      notes: args.notes, sentAt: args.sentAtMs === null ? null : BigInt(args.sentAtMs),
      ownerId: args.salesId, departmentId: null,
      createdAt: BigInt(args.issueMs), updatedAt: BigInt(args.confirmedMs), deletedAt: null,
    });
    let amountSum = 0;
    args.lines.forEach((l, li) => {
      const amount = round2(l.quantity * l.unitPrice);
      amountSum = round2(amountSum + amount);
      lineRows.push({
        id: `${qId}-L${li + 1}`, quotationId: qId, lineNumber: li + 1,
        fabricCode: l.fabricCode, description: l.description,
        quantity: new Prisma.Decimal(l.quantity), unit: l.unit,
        unitPrice: new Prisma.Decimal(l.unitPrice), amount: new Prisma.Decimal(amount),
        notes: null, createdAt: BigInt(args.issueMs),
      });
    });
    if (Math.abs(amountSum - round2(args.totalAmount)) > 0.01) {
      throw new Error(`报价行金额合计不一致：${quotationNumber}（行合计 ${amountSum} ≠ 头 ${args.totalAmount}）`);
    }
    versionRows.push({
      id: `${qId}-V1`, quotationId: qId, version: 1,
      totalAmount: new Prisma.Decimal(round2(args.totalAmount)), currency: args.currency,
      headerSnapshot: {
        quotationNumber, status: args.status, currency: args.currency,
        customerName: args.customerName, issueDate: isoDate(args.issueMs), validUntil: args.validUntil,
        deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T 30% deposit, 70% against B/L copy',
        salesperson: args.salesName,
      },
      linesSnapshot: args.lines.map((l, li) => ({
        lineNumber: li + 1, fabricCode: l.fabricCode, description: l.description,
        quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: round2(l.quantity * l.unitPrice),
      })),
      changeReason: null, changedBy: args.salesName, createdAt: BigInt(args.issueMs),
    });
    if (args.convertedOrderId) {
      wonUpdates.push({ orderId: args.convertedOrderId, totalAmount: new Prisma.Decimal(round2(args.totalAmount)), confirmedMs: args.confirmedMs });
    }
  };

  // 1. 赢单 12 张（idx % 5 === 0）
  for (const p of plans.filter((x) => isWonIdx(x.idx))) {
    buildQuotation({
      status: 'Accepted', currency: p.currency,
      customerRelId: p.customerId, customerName: p.customerName,
      issueMs: p.createdAtMs - 10 * DAY,
      validUntil: isoDate(p.createdAtMs - 10 * DAY + 30 * DAY),
      salesName: p.salesName, salesId: p.salesId,
      sentAtMs: p.createdAtMs - 9 * DAY,
      totalAmount: p.amount,
      convertedOrderId: p.id,
      notes: '客户确认报价后转订单（SIM 模拟赢单链路）。',
      confirmedMs: p.confirmMs ?? p.createdAtMs + 2 * DAY,
      lines: p.linePlans.map((l) => ({
        fabricCode: fabricSkuOfGarment(l.garmentId),
        description: `Ladies' ${l.category} — style ${l.styleNo}（${l.color}）`,
        quantity: l.qty, unit: 'PC', unitPrice: l.price,
      })),
    });
  }

  // 2. 未赢单 7 张
  LOST_DEFS.forEach((def, di) => {
    const cust = CUSTOMERS[(di + 3) % 8];
    const garment = md.garmentAssets[(di * 5 + 2) % 12];
    const qty = 1200 + di * 350;
    const price = round2(7.5 + (di % 5) * 0.9);
    const issueMs = at(def.week, 3, 10);
    const sentAtMs = issueMs + DAY;
    buildQuotation({
      status: def.status, currency: cust.currency,
      customerRelId: cust.id, customerName: cust.name,
      issueMs,
      validUntil: isoDate(issueMs + (def.status === 'Expired' ? 21 : 30) * DAY),
      salesName: SALES_NAME[cust.ownerId ?? ''] ?? 'Vivian Chen',
      salesId: cust.ownerId ?? '',
      sentAtMs,
      totalAmount: round2(qty * price),
      convertedOrderId: null,
      notes: def.note,
      confirmedMs: sentAtMs + 5 * DAY,
      lines: [{
        fabricCode: fabricSkuOfGarment(garment.id),
        description: `${garment.name}（询价样品款）`,
        quantity: qty, unit: 'PC', unitPrice: price,
      }],
    });
  });

  await createManyLogged(prisma, 'quotation', 'Quotation', quotationRows);
  await createManyLogged(prisma, 'quotationLine', 'QuotationLine', lineRows);
  await createManyLogged(prisma, 'quotationVersion', 'QuotationVersion', versionRows);

  // 3. 回写订单：source='quotation-convert' + quoteAmount=报价总额
  for (const w of wonUpdates) {
    await prisma.order.update({
      where: { id: w.orderId },
      data: { source: 'quotation-convert', quoteAmount: w.totalAmount, updatedAt: BigInt(w.confirmedMs) },
    });
  }
  console.log(`  Order 回写（quotation-convert）: ${wonUpdates.length} 单`);
}
