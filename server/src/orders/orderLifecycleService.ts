/**
 * ERP-P1-order-lifecycle-route-foundation
 *
 * Order 软删 + 状态流转 service（route + Agent flow 共用契约）。
 * 业务写入 + Order EntityLink inactive + AuditLog 同事务闭环，失败 fail closed。
 * status-transition 只允许 6 状态枚举（Pending/Confirmed/Production/Shipping/Delivered/Alert），不新增 Cancelled。
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { syncOrderEntityReferences, deactivateEntityLinks } from '../entities/sync';

export const VALID_ORDER_STATUSES = ['Pending', 'Confirmed', 'Production', 'Shipping', 'Delivered', 'Alert'] as const;
const VALID_STATUS_SET = new Set<string>(VALID_ORDER_STATUSES);

// Order 合法状态转换矩阵（from -> Set<to>）
const ORDER_TRANSITIONS: Record<string, Set<string>> = {
  Pending: new Set(['Confirmed', 'Alert']),
  Confirmed: new Set(['Production', 'Alert']),
  Production: new Set(['Shipping', 'Alert']),
  Shipping: new Set(['Delivered', 'Alert']),
  Delivered: new Set(), // 终态
  Alert: new Set(['Pending', 'Confirmed', 'Production', 'Shipping']), // 恢复到非终态
};

export type OrderLifecycleErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_DELETED'
  | 'INVALID_STATUS'
  | 'NO_CHANGE'
  | 'DELETE_FAILED'
  | 'TRANSITION_FAILED';

export interface OrderLifecycleError {
  code: OrderLifecycleErrorCode;
  message: string;
}

// ────────────────────────────────────────────────────────────────
// Order 软删
// ────────────────────────────────────────────────────────────────

export interface DeleteOrderParams {
  prisma: PrismaClient;
  orderId: string;
  actorId?: string;
}

export interface DeleteOrderResult {
  ok: boolean;
  error?: OrderLifecycleError;
  data?: { order: any; auditId: string };
}

export async function deleteOrder(params: DeleteOrderParams): Promise<DeleteOrderResult> {
  const { prisma, orderId, actorId } = params;
  const now = BigInt(Date.now());

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      if (!existing) {
        throw Object.assign(new Error(`Order ${orderId} not found`), { code: 'ORDER_NOT_FOUND', statusCode: 404 });
      }
      if (existing.deletedAt) {
        throw Object.assign(new Error(`Order ${orderId} already deleted`), { code: 'ORDER_ALREADY_DELETED', statusCode: 409 });
      }

      // 检查关联实体：有发票/运单/凭证的订单不可删除
      const [invoiceCount, shipmentCount, voucherCount] = await Promise.all([
        tx.invoice.count({ where: { orderId, deletedAt: null } }).catch(() => 0),
        tx.shipment.count({ where: { orderId, deletedAt: null } }).catch(() => 0),
        tx.paymentVoucher.count({ where: { orderId, deletedAt: null } }).catch(() => 0),
      ]);
      if (invoiceCount > 0 || shipmentCount > 0 || voucherCount > 0) {
        const deps: string[] = [];
        if (invoiceCount > 0) deps.push(`${invoiceCount} invoice(s)`);
        if (shipmentCount > 0) deps.push(`${shipmentCount} shipment(s)`);
        if (voucherCount > 0) deps.push(`${voucherCount} voucher(s)`);
        throw Object.assign(new Error(`Cannot delete order with dependent records: ${deps.join(', ')}`), { code: 'HAS_DEPENDENTS', statusCode: 400 });
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { deletedAt: now, updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // EntityLink inactive（deactivate order 发出的所有 active link）
      await deactivateEntityLinks(tx, 'order', orderId, now);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:order:delete',
        operation: 'delete_order', targetType: 'Order', targetId: orderId,
        before: { deletedAt: null },
        after: { deletedAt: Number(now) },
      });
      return { order: updated, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'DELETE_FAILED', message: `Delete order transaction failed: ${String(e?.message ?? e)}` } };
  }
}

// ────────────────────────────────────────────────────────────────
// Order 状态流转
// ────────────────────────────────────────────────────────────────

export interface TransitionOrderStatusParams {
  prisma: PrismaClient;
  orderId: string;
  toStatus: string;
  note?: string;
  operator?: string;
  lineId?: string;
  actorId?: string;
}

export interface TransitionOrderStatusResult {
  ok: boolean;
  error?: OrderLifecycleError;
  data?: { order: any; transitionId: string; auditId: string; fromStatus: string; toStatus: string; note: string | null; operator: string; lineId: string | null; createdAt: number };
}

export async function transitionOrderStatus(params: TransitionOrderStatusParams): Promise<TransitionOrderStatusResult> {
  const { prisma, orderId, toStatus, note, operator, lineId, actorId } = params;
  const now = BigInt(Date.now());

  // 枚举校验（6 状态，不新增 Cancelled）
  if (!VALID_STATUS_SET.has(toStatus)) {
    return { ok: false, error: { code: 'INVALID_STATUS', message: `Invalid target status: ${toStatus}. Allowed: ${VALID_ORDER_STATUSES.join(', ')}` } };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      if (!existing || existing.deletedAt) {
        throw Object.assign(new Error(`Order ${orderId} not found`), { code: 'ORDER_NOT_FOUND', statusCode: 404 });
      }
      if (existing.status === toStatus) {
        throw Object.assign(new Error(`Order ${orderId} already in status ${toStatus}`), { code: 'NO_CHANGE', statusCode: 400 });
      }

      const fromStatus = existing.status;
      // 状态转换合法性校验
      const allowedTargets = ORDER_TRANSITIONS[fromStatus];
      if (!allowedTargets || !allowedTargets.has(toStatus)) {
        throw Object.assign(new Error(`Invalid status transition: ${fromStatus} -> ${toStatus}`), { code: 'INVALID_TRANSITION', statusCode: 400 });
      }
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: toStatus, updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // OrderStatusTransition.create（审计时间线）
      const transitionId = `OST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await tx.orderStatusTransition.create({
        data: {
          id: transitionId,
          orderId,
          fromStatus,
          toStatus,
          note: note || null,
          operator: operator || actorId || 'api',
          lineId: lineId || null,
          createdAt: now,
        },
      });

      // sync Order EntityLinks（更新 orderedBy/suppliedBy 等 active link）
      await syncOrderEntityReferences(prisma, updated, { source: 'route:order:status-transition' }, tx);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:order:status-transition',
        operation: 'transition_order_status', targetType: 'Order', targetId: orderId,
        before: { status: fromStatus },
        after: { status: toStatus, transitionId },
      });

      return { order: updated, transitionId, auditId, fromStatus, toStatus, note: note || null, operator: operator || actorId || 'api', lineId: lineId || null, createdAt: Number(now) };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'TRANSITION_FAILED', message: `Status transition transaction failed: ${String(e?.message ?? e)}` } };
  }
}
