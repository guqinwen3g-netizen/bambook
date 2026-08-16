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
import { publishBusinessEvent } from '../events/businessEventBus';

export const VALID_ORDER_STATUSES = ['Pending', 'Confirmed', 'Production', 'Shipping', 'Delivered', 'Alert'] as const;
const VALID_STATUS_SET = new Set<string>(VALID_ORDER_STATUSES);

// Order 合法状态转换矩阵（from -> Set<to>）
export const ORDER_TRANSITIONS: Record<string, Set<string>> = {
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
  | 'INVALID_TRANSITION'
  | 'NO_CHANGE'
  | 'DELETE_FAILED'
  | 'TRANSITION_FAILED';

// 注：DR-010 守卫运行时使用 'ORDER_LIFECYCLE_GUARDED' / 'ORDER_ALREADY_CLOSED' 错误码
// （见 ORDER_LIFECYCLE_EXTENSION_ERRORS 常量与 transitionOrderStatus 守卫 throw）。
// 二者不进本联合类型——OrderLifecycleErrorCode 被 agent/orderLifecycleFlow.ts 的
// Record<OrderLifecycleFlowErrorCode, string> 穷举消费，扩展需跨域协调（属 Track A 所有权）。

// ────────────────────────────────────────────────────────────────
// DR-010 扩展状态（不进 6 态枚举/矩阵；由 orderChanges 域服务直写）
//   CancelRequested 取消申请中 / PauseRequested 暂停申请中 / Closing 结案处理中：
//     守卫态——订单存在进行中的取消/暂停/结案处置，禁止常规 6 态推进
//   Paused 暂停中：暂停审批通过后的生效态，禁止常规推进（恢复走 Alert 通道或撤回）
//   Cancelled 已关闭：取消结案终态（等效软删）
// 设计真源：订单变更规则.md §2A / 订单状态机.md §14.3
// ────────────────────────────────────────────────────────────────
export const DR010_EXTENSION_STATUSES = ['CancelRequested', 'PauseRequested', 'Closing', 'Paused', 'Cancelled'] as const;
export type DR010ExtensionStatus = (typeof DR010_EXTENSION_STATUSES)[number];

/** 守卫态集合：处于这些状态的订单禁止 transitionOrderStatus 常规推进（fail-closed） */
export const DR010_GUARDED_STATUSES: ReadonlySet<string> = new Set([
  'CancelRequested',
  'PauseRequested',
  'Closing',
  'Paused',
]);

export const ORDER_LIFECYCLE_EXTENSION_ERRORS = {
  ORDER_LIFECYCLE_GUARDED: 'ORDER_LIFECYCLE_GUARDED',
  ORDER_ALREADY_CLOSED: 'ORDER_ALREADY_CLOSED',
} as const;

/** 订单是否处于 DR-010 守卫态（取消/暂停申请中、结案处理中、暂停中） */
export function isOrderLifecycleGuarded(status: string | null | undefined): boolean {
  return !!status && DR010_GUARDED_STATUSES.has(status);
}

/** 订单是否已关闭（取消结案终态） */
export function isOrderClosed(status: string | null | undefined): boolean {
  return status === 'Cancelled';
}

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
      // DR-010 守卫：取消/暂停申请中、结案处理中、暂停中、已关闭订单禁止常规 6 态推进
      if (DR010_GUARDED_STATUSES.has(fromStatus)) {
        throw Object.assign(new Error(`订单处于「${fromStatus}」（DR-010 守卫态），需先完成或撤回对应的变更/取消/暂停申请，禁止状态推进`), { code: 'ORDER_LIFECYCLE_GUARDED', statusCode: 409 });
      }
      if (fromStatus === 'Cancelled') {
        throw Object.assign(new Error(`订单 ${orderId} 已关闭（Cancelled 终态），禁止状态推进`), { code: 'ORDER_ALREADY_CLOSED', statusCode: 409 });
      }
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

    // Phase 0 Sprint 1: 事务提交后发布业务事件（fire-and-forget，永不阻断业务操作）
    // - OrderStatusChanged：所有状态变更都发布
    // - OrderConfirmed：仅 Pending→Confirmed 转换发布（用于触发生产单创建联动 Phase 1 Sprint 3）
    publishBusinessEvent({
      type: 'OrderStatusChanged',
      sourceEntityType: 'Order',
      sourceEntityId: orderId,
      orderId,
      payload: { poNumber: result.order.poNumber, fromStatus: result.fromStatus, toStatus: result.toStatus, transitionId: result.transitionId },
      actorId: actorId || operator || 'api',
      transactionId: result.transitionId,
    }).catch(() => { /* event publish failure must not fail business */ });

    if (result.toStatus === 'Confirmed' && result.fromStatus !== 'Confirmed') {
      publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: orderId,
        orderId,
        payload: { poNumber: result.order.poNumber, fromStatus: result.fromStatus, customer: result.order.customer, transitionId: result.transitionId },
        actorId: actorId || operator || 'api',
        transactionId: result.transitionId,
      }).catch(() => { /* event publish failure must not fail business */ });
    }
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'TRANSITION_FAILED', message: `Status transition transaction failed: ${String(e?.message ?? e)}` } };
  }
}
