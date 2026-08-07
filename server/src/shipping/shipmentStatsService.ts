/**
 * Phase B3 — 出运统计服务（准交率）
 *
 * 口径定义：
 *   - 运单准点率：已发运运单（ata 已回填）中 ata ≤ eta 的占比
 *   - 订单准交率：交期（dueDate）在统计区间内的订单中，
 *     最后一票运单 ata ≤ dueDate 的占比；ata 未回填的订单计入 pending（不分母子单）
 *
 * 设计决策：
 *   - 只读统计，不写库；日期为 String YYYY-MM-DD 字典序比较（与全项目口径一致）
 *   - 多票 partial shipment 场景：以该订单所有运单的最大 ata 作为"完成出运日"
 */

import { PrismaClient } from '@prisma/client';

export interface OnTimeBucket {
  total: number;
  onTime: number;
  late: number;
  pending: number;
  rate: number | null; // onTime / (total - pending)；无可判定样本时为 null
}

export interface OnTimeStats {
  from: string | null;
  to: string | null;
  shipment: OnTimeBucket;
  order: OnTimeBucket;
}

function buildBucket(total: number, onTime: number, late: number, pending: number): OnTimeBucket {
  const judged = total - pending;
  return {
    total,
    onTime,
    late,
    pending,
    rate: judged > 0 ? Math.round((onTime / judged) * 10000) / 10000 : null,
  };
}

export async function getOnTimeStats(
  prisma: PrismaClient,
  params: { from?: string; to?: string } = {},
): Promise<OnTimeStats> {
  const { from, to } = params;

  // ── 运单准点率（按 ata 落在区间内过滤） ──
  const shipments = await prisma.shipment.findMany({
    where: {
      deletedAt: null,
      status: { in: ['Shipped', 'Arrived', 'Cleared', 'Delivered'] },
      eta: { not: null },
      // 注意：对象展开同名键后者覆盖前者，ata 条件必须单次合并构造
      ata: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
    },
    select: { id: true, eta: true, ata: true },
  });
  let shipOnTime = 0;
  for (const s of shipments) {
    if (s.ata! <= s.eta!) shipOnTime++;
  }
  const shipBucket = buildBucket(shipments.length, shipOnTime, shipments.length - shipOnTime, 0);

  // ── 订单准交率（dueDate 在区间内的订单） ──
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      dueDate: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    },
    select: { id: true, dueDate: true },
  });
  const orderIds = orders.map(o => o.id);
  const orderShipments = orderIds.length > 0
    ? await prisma.shipment.findMany({
        where: { orderId: { in: orderIds }, deletedAt: null, status: { not: 'Cancelled' } },
        select: { orderId: true, ata: true },
      })
    : [];

  const ataByOrder = new Map<string, string[]>();
  for (const s of orderShipments) {
    if (!s.orderId || !s.ata) continue;
    const list = ataByOrder.get(s.orderId) ?? [];
    list.push(s.ata);
    ataByOrder.set(s.orderId, list);
  }

  let orderOnTime = 0;
  let orderLate = 0;
  let orderPending = 0;
  for (const o of orders) {
    const atas = ataByOrder.get(o.id);
    if (!atas || atas.length === 0) {
      orderPending++; // 尚无实际出运记录
      continue;
    }
    const lastAta = atas.reduce((max, d) => (d > max ? d : max));
    if (lastAta <= o.dueDate) orderOnTime++;
    else orderLate++;
  }
  const orderBucket = buildBucket(orders.length, orderOnTime, orderLate, orderPending);

  return { from: from ?? null, to: to ?? null, shipment: shipBucket, order: orderBucket };
}
