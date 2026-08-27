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
import { logger } from '../lib/logger';
import { createCreditService } from '../credit/creditService';
import { createMoqConfigService } from '../moq/moqConfigService';
import { createMoqResolutionService } from '../moq/moqResolutionService';
import { createMoqValidationService } from '../moq/moqValidationService';
import { createApprovalRoutingService } from '../approvals/approvalRoutingService';
import { createApprovalCreateService } from '../approvals/approvalCreateService';
import { createCreditExceptionService, resolveCreditException, consumeCreditException } from '../credit/creditExceptionGate';
import type { ActiveExceptionSummary, ExceptionScopeMatch } from '../exceptions/exceptionGate';
import type { ExceptionService } from '../exceptions/exceptionService';

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
  | 'TRANSITION_FAILED'
  // ── 确认门禁错误码（W-A 走查 DE-1/DE-6 修复；fail-closed） ──
  // MOQ_VIOLATION：Confirmed 门禁命中（低于 MOQ 且无 approved 豁免审批单），HTTP 409
  // CREDIT_FROZEN_60_DAYS / CREDIT_REVOKED / OVERDUE_60_DAYS：信用门禁阻断，HTTP 403
  // CREDIT_CHECK_FAILED：信用门禁自身故障（fail-closed 阻断），HTTP 500
  | 'MOQ_VIOLATION'
  | 'CREDIT_FROZEN_60_DAYS'
  | 'CREDIT_REVOKED'
  | 'OVERDUE_60_DAYS'
  | 'CREDIT_CHECK_FAILED';

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
  /** MOQ_VIOLATION 时透传自动发起的豁免审批单 id（DR-007），供前端跳转审批 */
  approvalRequestId?: string;
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

  // ── 确认门禁（fail-closed，W-A 走查 DE-1/DE-2/DE-6 修复）──
  // 进入 Confirmed 的所有路径（V1 route / V2 route / batch-status / Agent flow）统一经本服务，
  // 门禁只在此处实现一次：
  //   ① 信用门禁（信用控制规则 §6 #6）：Frozen/Revoked/Net61+ 逾期客户禁止确认执行
  //   ② MOQ Confirmed 门禁（MOQ最小起订量.md §4.3）：低于 MOQ 且无 approved 豁免审批单 → 阻断，
  //      阻断同时自动发起 MOQ 豁免审批单（DR-007 单人单次，approvalCreateService 幂等防重）
  // DE-5：信用例外放行上下文（生效例外命中时记录，确认事务提交成功后核销）
  let creditExceptionPass: { service: ExceptionService; exception: ActiveExceptionSummary; scope: ExceptionScopeMatch } | null = null;
  if (toStatus === 'Confirmed') {
    const gateOrder = await (prisma as any).order.findUnique({
      where: { id: orderId },
      select: {
        id: true, status: true, deletedAt: true, type: true, businessLine: true,
        quantity: true, capsuleExemption: true, moqSnapshot: true, customerRelationId: true, quoteAmount: true,
      },
    });
    if (!gateOrder || gateOrder.deletedAt) {
      return { ok: false, error: { code: 'ORDER_NOT_FOUND', message: `Order ${orderId} not found` } };
    }
    if (gateOrder.status !== 'Confirmed') {
      // ① 信用门禁（DE-1：checkCreditAvailable 此前生产零调用方，Frozen 客户可正常建单/确认）
      if (gateOrder.customerRelationId) {
        try {
          const creditSvc = createCreditService({ prisma });
          const credit = await creditSvc.checkCreditAvailable({
            relationId: gateOrder.customerRelationId,
            amount: Number(gateOrder.quoteAmount ?? 0) || undefined,
          });
          if (!credit.ok) {
            logger.error('[OrderLifecycle] 信用门禁校验失败（fail-closed 阻断 Confirmed）', { orderId, error: credit.error.message });
            return { ok: false, error: { code: 'CREDIT_CHECK_FAILED', message: `信用门禁校验失败：${credit.error.message}` } };
          }
          const creditData = credit.data as { blocked: boolean; blockCode: string | null; blockReason: string | null };
          if (creditData.blocked) {
            logger.warn('[OrderLifecycle] 信用门禁阻断订单确认', { orderId, relationId: gateOrder.customerRelationId, blockCode: creditData.blockCode });
            // DE-5：DR-013 信用例外闭环 — 生效例外放行；无例外自动发起 credit_exemption 申请
            // （审批单 id 透传 DE-6 契约）；审批中不重复发起；发起失败保持阻断并提示手工入口
            const exceptionSvc = createCreditExceptionService(prisma);
            const scope: ExceptionScopeMatch = { targetType: 'Order', targetId: orderId, action: 'order:confirm' };
            const exemption = await resolveCreditException({
              exceptionService: exceptionSvc,
              scope,
              actorId: actorId || operator || 'api',
              blockReason: creditData.blockReason ?? '客户信用门禁阻断',
            });
            if (exemption.passed) {
              creditExceptionPass = { service: exceptionSvc, exception: exemption.exception, scope };
            } else {
              return {
                ok: false,
                error: {
                  code: (creditData.blockCode ?? 'CREDIT_FROZEN_60_DAYS') as OrderLifecycleErrorCode,
                  message: `${creditData.blockReason ?? '客户信用门禁阻断，禁止确认订单'}（${exemption.hint}）`,
                  ...(exemption.approvalRequestId ? { approvalRequestId: exemption.approvalRequestId } : {}),
                },
              };
            }
          }
        } catch (e: any) {
          logger.error('[OrderLifecycle] 信用门禁校验异常（fail-closed 阻断 Confirmed）', { orderId, error: e?.message });
          return { ok: false, error: { code: 'CREDIT_CHECK_FAILED', message: `信用门禁校验失败，请重试或联系管理员：${e?.message}` } };
        }
      }
      // ② MOQ Confirmed 门禁（DE-2/DE-4：V1 此前无 MOQ 门禁，V2 有门禁但不发事件——统一收敛到本服务）
      try {
        const moqConfigSvc = createMoqConfigService({ prisma });
        const moqValidationSvc = createMoqValidationService({
          prisma,
          configService: moqConfigSvc,
          resolutionService: createMoqResolutionService({ prisma, configService: moqConfigSvc }),
          approvalCreateService: createApprovalCreateService({
            prisma,
            routingService: createApprovalRoutingService({ prisma }),
          }),
        });
        const moqCheck = await moqValidationSvc.validateCreate({
          type: gateOrder.type,
          businessLine: gateOrder.businessLine,
          capsuleExemption: gateOrder.capsuleExemption === true,
          customerRelationId: gateOrder.customerRelationId ?? null,
          snapshot: gateOrder.moqSnapshot ?? null,
          lines: [{ quantity: Number(gateOrder.quantity) }],
        }, {
          actor: { userId: actorId || operator || 'api' },
          autoCreateApproval: true, targetType: 'Order', targetId: orderId,
        });
        if (!moqCheck.ok) {
          const approved = await (prisma as any).approvalRequest?.findFirst?.({
            where: {
              targetType: 'Order', targetId: orderId,
              actionType: 'order:moq-exemption', status: 'approved',
            },
            select: { id: true },
          });
          if (!approved) {
            const worst = moqCheck.lines[0];
            const approvalHint = moqCheck.approvalRequestId
              ? `（豁免审批单 ${moqCheck.approvalRequestId} 已自动发起，审批通过后重试）`
              : '（豁免审批单发起失败，请联系管理员）';
            return {
              ok: false,
              error: {
                code: 'MOQ_VIOLATION',
                message: `订单数量 ${Number(gateOrder.quantity)} 低于 MOQ ${worst?.effectiveMoq}（缺口 ${worst?.gapPct}%，快照口径），须先完成 MOQ 豁免审批（DR-007 单人单次）${approvalHint}`,
                approvalRequestId: moqCheck.approvalRequestId,
              },
            };
          }
        }
      } catch (e: any) {
        // fail-closed：门禁校验异常 → 阻断 Confirmed 推进
        logger.error('[OrderLifecycle] Confirmed 门禁 MOQ 校验异常（fail-closed 阻断）', { orderId, error: e?.message });
        return { ok: false, error: { code: 'MOQ_VIOLATION', message: `MOQ 校验失败，请重试或联系管理员：${e?.message}` } };
      }
    }
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

    // DE-5：信用例外放行的确认已提交 → 核销一次性例外（best-effort，失败不回滚确认事实）
    if (creditExceptionPass) {
      await consumeCreditException({
        exceptionService: creditExceptionPass.service,
        exceptionId: creditExceptionPass.exception.id,
        scope: creditExceptionPass.scope,
        actorId: actorId || operator || 'api',
        note: `订单 ${orderId} 确认（Confirmed）经信用例外 ${creditExceptionPass.exception.exceptionNumber} 放行`,
      });
    }
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'TRANSITION_FAILED', message: `Status transition transaction failed: ${String(e?.message ?? e)}` } };
  }
}
