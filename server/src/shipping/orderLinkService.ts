/**
 * task ERP-P1-order-shipment-status-link-foundation
 *
 * Shipment 创建/状态变更 → Order 状态联动（同事务闭环）。
 *
 * 映射规则（单一来源）：
 *   Shipment Booked/Loading/Shipped/Arrived/Cleared → Order Shipping
 *   Shipment Delivered → Order Delivered
 *   Shipment Draft/Cancelled → 不联动（Draft 未启动；Cancelled 不自动回退 order，留人工）
 *
 * 终态 Order（Delivered）不再被联动覆盖；Alert/非法当前 status fail closed；缺失 order/shipment fail closed。
 */

export type TxLike = any;

// Order 合法状态（与 orders/route.ts VALID_ORDER_STATUSES 对齐）
export const VALID_ORDER_STATUSES = ['Pending', 'Confirmed', 'Production', 'Shipping', 'Delivered', 'Alert'];

// Order 终态（不可被联动覆盖）
const ORDER_TERMINAL_STATUSES = new Set(['Delivered', 'Alert']);

const VALID_ORDER_STATUS_SET = new Set(VALID_ORDER_STATUSES);

/**
 * 从 Shipment status 推导应联动的 Order status。
 * 返回 null 表示不联动（维持 Order 原状）。
 */
export function deriveOrderStatusFromShipment(shipmentStatus: string): string | null {
  switch (shipmentStatus) {
    case 'Booked':
    case 'Loading':
    case 'Shipped':
    case 'Arrived':
    case 'Cleared':
      return 'Shipping';
    case 'Delivered':
      return 'Delivered';
    default: return null; // Draft/Cancelled 不联动
  }
}

export interface LinkResult {
  ok: boolean;
  skipped?: boolean; // 无需联动（shipment status 不映射）
  orderId?: string;
  fromStatus?: string;
  toStatus?: string;
  error?: string;
  message?: string;
}

/**
 * 事务内联动：根据 shipment status 更新 order status + 写 OrderStatusTransition。
 * fail closed：order 不存在/已删/终态 → 抛错（事务回滚）。
 *
 * @returns LinkResult skipped=true 表示无需联动（正常路径，非错误）
 */
export async function linkOrderStatusFromShipment(
  tx: TxLike,
  orderId: string,
  shipmentStatus: string,
  options: { operator?: string; now?: () => number } = {},
): Promise<LinkResult> {
  if (!orderId) return { ok: false, error: 'MISSING_ORDER', message: 'orderId is required for status link' };

  const targetOrderStatus = deriveOrderStatusFromShipment(shipmentStatus);
  if (targetOrderStatus == null) return { ok: true, skipped: true }; // 不联动

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!order || order.deletedAt) {
    throw Object.assign(new Error(`order ${orderId} not found or deleted`), { statusCode: 404, code: 'ORDER_NOT_FOUND' });
  }

  // task review fix: 非法当前 status（脏数据）→ fail closed
  if (!VALID_ORDER_STATUS_SET.has(order.status)) {
    throw Object.assign(
      new Error(`order ${orderId} has unrecognized current status '${order.status}'. Valid: ${VALID_ORDER_STATUSES.join(', ')}`),
      { statusCode: 400, code: 'INVALID_CURRENT_ORDER_STATUS' },
    );
  }

  // 终态保护：Delivered/Alert 不被联动覆盖
  if (ORDER_TERMINAL_STATUSES.has(order.status) && order.status !== targetOrderStatus) {
    throw Object.assign(
      new Error(`order ${orderId} is in terminal status '${order.status}', cannot be changed by shipment link`),
      { statusCode: 400, code: 'ORDER_TERMINAL' },
    );
  }

  // 幂等：order 已在目标 status，跳过
  if (order.status === targetOrderStatus) {
    return { ok: true, skipped: true, orderId, fromStatus: order.status, toStatus: targetOrderStatus };
  }

  const ts = options.now?.() ?? Date.now();
  const transitionId = `ST-SHIP-${orderId}-${ts}`;

  // 写 OrderStatusTransition 审计
  await tx.orderStatusTransition.create({
    data: {
      id: transitionId,
      orderId,
      fromStatus: order.status,
      toStatus: targetOrderStatus,
      note: `auto-linked from shipment status '${shipmentStatus}'`,
      operator: options.operator || 'shipping-sync',
      createdAt: BigInt(ts),
    },
  });

  // 更新 Order status
  await tx.order.update({
    where: { id: orderId },
    data: { status: targetOrderStatus, updatedAt: BigInt(ts) },
  });

  return { ok: true, orderId, fromStatus: order.status, toStatus: targetOrderStatus };
}
