/**
 * toleranceService.ts — REQ2-03 溢短装条款校验（单一真源）
 *
 * 设计真源：需求池 REQ2-03 ·「发货/开票数量按条款校验超限预警」
 *
 * 口径（面料合同溢短装惯例）：
 *   - 对称条款 ±N%（OrderLine.tolerancePercent，默认 5）：发货量允许在
 *     合同量 [qty×(1−N%), qty×(1+N%)] 区间内按实际量结算
 *   - 超限（>N% 溢装 / 短装）→ 预警（WARN 不阻断——溢短装是条款不是硬门禁），
 *     并给出条款上限口径的建议结算量/额（协商基准）
 *   - tolerancePercent = 0 → 不允许溢短装（足量交付，任何偏差即预警）
 *
 * 结算金额：
 *   - 限额内：settlementAmount = unitPrice × actualQty（按实际发货量结算）
 *   - 超限时：同时给出 actualQty 结算额 + 条款上限结算额（maxLimitAmount/
 *     minLimitAmount——按上限/下限量计的金额，供协商参考）
 */
import { PrismaClient } from '@prisma/client';
import { round4 } from '../lib/unitConversion';

export type ToleranceVerdict = 'ok' | 'over_limit' | 'under_limit';

export interface ToleranceCheckInput {
  contractQty: number;      // 合同数量
  actualQty: number;        // 实际发货/开票数量
  tolerancePercent: number; // ±N%（0 = 足量交付）
  unitPrice?: number | null;
}

export interface ToleranceCheckResult {
  verdict: ToleranceVerdict;
  deviationPct: number;        // 偏差百分比（正=溢装，负=短装）
  allowedMin: number;          // 条款下限 qty×(1−N%)
  allowedMax: number;          // 条款上限 qty×(1+N%)
  settlementQty: number;       // 实际量（结算依据）
  settlementAmount: number | null;   // unitPrice × actualQty
  maxLimitAmount: number | null;     // 按上限量的金额（超限协商参考）
  minLimitAmount: number | null;     // 按下限量的金额（超限协商参考）
  warning: string | null;     // 超限预警文案（null = 限额内）
}

/** 纯函数：单行容差校验（验收锚点：±5% 条款发货 5.2% → over_limit 预警） */
export function checkTolerance(input: ToleranceCheckInput): ToleranceCheckResult {
  const { contractQty, actualQty } = input;
  const tolPct = Math.max(0, Number(input.tolerancePercent) || 0);
  const price = input.unitPrice != null ? Number(input.unitPrice) : null;

  if (!Number.isFinite(contractQty) || contractQty <= 0) {
    throw Object.assign(new Error('合同数量必须为正数'), { code: 'INVALID_QTY' });
  }
  if (!Number.isFinite(actualQty) || actualQty < 0) {
    throw Object.assign(new Error('实际数量必须为非负数'), { code: 'INVALID_QTY' });
  }

  const allowedMin = round4(contractQty * (1 - tolPct / 100));
  const allowedMax = round4(contractQty * (1 + tolPct / 100));
  const deviationPct = round4(((actualQty - contractQty) / contractQty) * 100);

  let verdict: ToleranceVerdict = 'ok';
  let warning: string | null = null;
  if (actualQty > allowedMax) {
    verdict = 'over_limit';
    warning = `溢装超限：实际 ${actualQty}（+${deviationPct}%）超出条款上限 ${allowedMax}（+${tolPct}%），结算量需与客户协商`;
  } else if (actualQty < allowedMin) {
    verdict = 'under_limit';
    warning = `短装超限：实际 ${actualQty}（${deviationPct}%）低于条款下限 ${allowedMin}（−${tolPct}%），结算量需与客户协商`;
  }

  return {
    verdict,
    deviationPct,
    allowedMin,
    allowedMax,
    settlementQty: actualQty,
    settlementAmount: price != null ? round4(price * actualQty) : null,
    maxLimitAmount: price != null ? round4(price * allowedMax) : null,
    minLimitAmount: price != null ? round4(price * allowedMin) : null,
    warning,
  };
}

export interface OrderLineToleranceStatus {
  orderLineId: string;
  itemNo: string | null;
  description: string | null;
  unit: string | null;
  contractQty: number;
  shippedQty: number;          // 已发货量（shipmentQuantity 快照；未发=0）
  tolerancePercent: number;
  unitPrice: number | null;
  check: ToleranceCheckResult;
}

export interface OrderToleranceStatus {
  orderId: string;
  poNumber: string | null;
  lines: OrderLineToleranceStatus[];
  summary: { total: number; ok: number; overLimit: number; underLimit: number; unshipped: number };
}

/** 订单维度：全部行已发量 vs 合同量的溢短装状态（订单详情视图数据源） */
export async function getOrderToleranceStatus(prisma: PrismaClient, orderId: string): Promise<OrderToleranceStatus | null> {
  const db = prisma as any;
  const order = await db.order.findFirst({ where: { id: orderId, deletedAt: null }, select: { id: true, poNumber: true } });
  if (!order) return null;

  const lines = await db.orderLine.findMany({
    where: { orderId },
    orderBy: { lineNumber: 'asc' },
    select: { id: true, itemNo: true, description: true, unit: true, quantity: true, unitPrice: true, shipmentQuantity: true, tolerancePercent: true },
  });

  const statuses: OrderLineToleranceStatus[] = lines.map((l: any) => {
    const contractQty = Number(l.quantity);
    const shippedQty = l.shipmentQuantity != null ? Number(l.shipmentQuantity) : 0;
    const tolerancePercent = l.tolerancePercent != null ? Number(l.tolerancePercent) : 5;
    // 未发货（shippedQty=0）不做容差判定（发货启动后才触发条款）
    const check = shippedQty > 0
      ? checkTolerance({ contractQty, actualQty: shippedQty, tolerancePercent, unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null })
      : {
          verdict: 'ok' as ToleranceVerdict, deviationPct: 0, allowedMin: round4(contractQty * (1 - tolerancePercent / 100)),
          allowedMax: round4(contractQty * (1 + tolerancePercent / 100)), settlementQty: 0,
          settlementAmount: null, maxLimitAmount: null, minLimitAmount: null, warning: null,
        };
    return {
      orderLineId: l.id,
      itemNo: l.itemNo ?? null,
      description: l.description ?? null,
      unit: l.unit ?? null,
      contractQty,
      shippedQty,
      tolerancePercent,
      unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
      check,
    };
  });

  return {
    orderId: order.id,
    poNumber: order.poNumber ?? null,
    lines: statuses,
    summary: {
      total: statuses.length,
      ok: statuses.filter(s => s.shippedQty > 0 && s.check.verdict === 'ok').length,
      overLimit: statuses.filter(s => s.check.verdict === 'over_limit').length,
      underLimit: statuses.filter(s => s.check.verdict === 'under_limit').length,
      unshipped: statuses.filter(s => s.shippedQty <= 0).length,
    },
  };
}
