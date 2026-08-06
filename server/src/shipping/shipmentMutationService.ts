/**
 * task ERP-P1-shipping-mutation-shared-service-foundation:
 * Shipment mutation service — route + Agent orderShipFlow 共用契约。
 * 每个 mutation 内部（或复用外部 tx）走 $transaction，业务写入 + syncShipmentReferences +
 * linkOrderStatusFromShipment（有 orderId 时）+ writeRouteAuditLog 在同一事务闭环，
 * 任一失败 fail closed。
 */

import { PrismaClient } from '@prisma/client';
import { syncShipmentReferences, deactivateEntityLinks } from '../entities/sync';
import { linkOrderStatusFromShipment } from './orderLinkService';
import { validateStatusTransition } from '../statusTransition';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';

export type ShipmentMutationErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'INVALID_INITIAL_STATUS'
  | 'INVALID_TRANSITION'
  | 'INVALID_CURRENT_STATUS'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_TERMINAL'
  | 'INVALID_CURRENT_ORDER_STATUS'
  | 'INVALID_SHIPMENT_STATUS'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED'
  | 'COMMIT_TRANSACTION_FAILED';

export interface ShipmentMutationError {
  code: ShipmentMutationErrorCode;
  message: string;
}

export interface ShipmentMutationResult<T = any> {
  ok: boolean;
  data?: T;
  error?: ShipmentMutationError;
}

// task_mqxxxu3k: Shipment status 合法枚举（fail closed）
export const VALID_SHIPMENT_STATUSES = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled'];
export function isValidShipmentStatus(s: string): boolean {
  return VALID_SHIPMENT_STATUSES.includes(s);
}

// ─── 事务封装 helper：若传入 tx 则复用，否则自开 $transaction ─────
async function withTx<T>(prisma: PrismaClient, tx: any | undefined, fn: (t: any) => Promise<T>): Promise<T> {
  return tx ? await fn(tx) : await (prisma as any).$transaction(fn);
}

function toMutationError(e: any, fallback: ShipmentMutationErrorCode): ShipmentMutationError {
  const passThroughCodes: ShipmentMutationErrorCode[] = [
    'NOT_FOUND', 'INVALID_STATUS', 'INVALID_INITIAL_STATUS', 'INVALID_TRANSITION', 'INVALID_CURRENT_STATUS',
    'ORDER_NOT_FOUND', 'ORDER_TERMINAL', 'INVALID_CURRENT_ORDER_STATUS', 'INVALID_SHIPMENT_STATUS',
  ];
  if (e?.code && passThroughCodes.includes(e.code)) {
    return { code: e.code, message: String(e.message ?? e) };
  }
  return { code: fallback, message: String(e?.message ?? e) };
}

// ─── CREATE ────────────────────────────────────────────────────────

export interface CreateShipmentParams {
  prisma: PrismaClient;
  input: any;
  actorId: string;
  ip?: string | null;
  /** 外部事务：route/agent flow 在自己 $transaction 里调 service 时传入，共用同一事务 */
  tx?: any;
  /** audit source 默认 'route:shipping:create'；agent flow 传 'agent:order.ship:commit' */
  auditSource?: string;
  /** audit operation 默认 'create_shipment'；agent 传 'order_ship_committed' */
  auditOperation?: string;
  /** sync source 默认 'route:create'；agent 传 'agent:order.ship' */
  syncSource?: string;
  /** 上游未提供 id 时是否兜底生成（agent flow 需要 true；route 保持 false） */
  generateIdIfMissing?: boolean;
  /** 自定义 audit.after payload 生成器（agent flow 用） */
  auditAfterBuilder?: (sh: any, extras: { orderStatus: string | null; transactionId?: string }) => Record<string, unknown>;
  /** 传给 audit.after 的 transactionId（agent flow 用） */
  transactionId?: string;
}

export interface CreateShipmentData {
  shipment: any;
  orderStatus: string | null;
  auditId: string;
}

export async function createShipment(params: CreateShipmentParams): Promise<ShipmentMutationResult<CreateShipmentData>> {
  const {
    prisma, input, actorId, ip, tx,
    auditSource = 'route:shipping:create',
    auditOperation = 'create_shipment',
    syncSource = 'route:create',
    generateIdIfMissing = false,
    auditAfterBuilder,
    transactionId,
  } = params;

  // status 合法枚举（fail closed，事务前）
  if (input?.status != null && !isValidShipmentStatus(String(input.status))) {
    return { ok: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID_SHIPMENT_STATUSES.join(', ')}` } };
  }
  // 创建时禁止直接创建终态运单（Delivered/Cancelled），允许 Draft/Booked/Loading/Shipped/Arrived/Cleared
  // 业务场景：运单可能在发货后才补录（Shipped），但不应直接创建已交付/已取消的终态记录
  const TERMINAL_CREATE_STATUSES = new Set(['Delivered', 'Cancelled']);
  if (input?.status && TERMINAL_CREATE_STATUSES.has(String(input.status))) {
    return { ok: false, error: { code: 'INVALID_INITIAL_STATUS', message: `create shipment initial status cannot be terminal (Delivered/Cancelled), got: ${input.status}` } };
  }

  try {
    const result = await withTx(prisma, tx, async (t: any) => {
      const now = BigInt(Date.now());
      const shipmentStatus = input.status ?? 'Booked';
      const shipmentId = input?.id
        || (generateIdIfMissing ? `SHP__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : undefined);
      const data: any = { ...input, status: shipmentStatus, createdAt: now, updatedAt: now };
      if (shipmentId) data.id = shipmentId;
      const sh = await t.shipment.create({ data });

      // sync EntityReference / EntityLink
      await syncShipmentReferences(prisma, sh, { source: syncSource }, t);

      // order 状态联动（有 orderId 时）
      let orderStatus: string | null = null;
      if (sh.orderId) {
        const linkResult = await linkOrderStatusFromShipment(t, sh.orderId, sh.status, { operator: actorId });
        if (linkResult.ok && !linkResult.skipped) {
          orderStatus = linkResult.toStatus || null;
        }
      }

      // AuditLog 同事务闭环
      const auditAfter = auditAfterBuilder
        ? auditAfterBuilder(sh, { orderStatus, transactionId })
        : { id: sh.id, shipmentNumber: sh.shipmentNumber, type: sh.type, status: sh.status };
      const auditId = await writeRouteAuditLog({
        prisma: t, actorId, source: auditSource,
        operation: auditOperation, targetType: 'Shipment', targetId: sh.id,
        after: auditAfter,
        ip: ip || null,
      });

      return { shipment: sh, orderStatus, auditId };
    });

    // Phase 0 Sprint 1: 发货单创建事件（事务提交后发布）
    // - ShipmentCreated：所有创建都发布
    // - ShipmentCompleted：状态直接为 Delivered 时发布（罕见但合法的补录场景）
    publishBusinessEvent({
      type: 'ShipmentCreated',
      sourceEntityType: 'Shipment',
      sourceEntityId: result.shipment.id,
      orderId: result.shipment.orderId,
      payload: {
        shipmentId: result.shipment.id,
        shipmentNumber: result.shipment.shipmentNumber,
        status: result.shipment.status,
        orderId: result.shipment.orderId,
      },
      actorId,
      transactionId: result.auditId,
    }).catch(() => { /* event publish failure must not fail business */ });

    if (result.shipment.status === 'Delivered') {
      publishBusinessEvent({
        type: 'ShipmentCompleted',
        sourceEntityType: 'Shipment',
        sourceEntityId: result.shipment.id,
        orderId: result.shipment.orderId,
        payload: {
          shipmentId: result.shipment.id,
          shipmentNumber: result.shipment.shipmentNumber,
          orderId: result.shipment.orderId,
        },
        actorId,
        transactionId: result.auditId,
      }).catch(() => { /* event publish failure must not fail business */ });
    }
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: toMutationError(e, tx ? 'COMMIT_TRANSACTION_FAILED' : 'CREATE_FAILED') };
  }
}

// ─── UPDATE ────────────────────────────────────────────────────────

export interface UpdateShipmentParams {
  prisma: PrismaClient;
  shipmentId: string;
  patch: any;
  hasStatus: boolean; // route 用 hasOwnProperty 判定
  actorId: string;
  ip?: string | null;
  tx?: any;
  auditSource?: string;
  syncSource?: string;
}

export async function updateShipment(params: UpdateShipmentParams): Promise<ShipmentMutationResult<{ shipment: any; orderStatus: string | null; auditId: string }>> {
  const { prisma, shipmentId, patch, hasStatus, actorId, ip, tx, auditSource = 'route:shipping:update', syncSource = 'route:update' } = params;
  try {
    const result = await withTx(prisma, tx, async (t: any) => {
      const existing = await t.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, shipmentNumber: true, orderId: true, deletedAt: true } });
      if (!existing || existing.deletedAt) throw Object.assign(new Error('shipment not found'), { statusCode: 404, code: 'NOT_FOUND' });
      if (hasStatus) {
        const newStatus = patch.status;
        if (typeof newStatus !== 'string') {
          throw Object.assign(new Error('status must be a non-null string'), { statusCode: 400, code: 'INVALID_STATUS' });
        }
        const tCheck = validateStatusTransition('Shipment', existing.status, newStatus);
        if (!tCheck.ok) throw Object.assign(new Error(tCheck.message!), { statusCode: 400, code: tCheck.error! });
      }
      const now = BigInt(Date.now());
      const upd = await t.shipment.update({ where: { id: shipmentId }, data: { ...patch, updatedAt: now } });
      await syncShipmentReferences(prisma, upd, { source: syncSource }, t);
      let orderStatus: string | null = null;
      if (upd.orderId) {
        const linkResult = await linkOrderStatusFromShipment(t, upd.orderId, upd.status, { operator: actorId });
        if (linkResult.ok && !linkResult.skipped) orderStatus = linkResult.toStatus || null;
      }
      const auditId = await writeRouteAuditLog({
        prisma: t, actorId, source: auditSource,
        operation: 'update_shipment', targetType: 'Shipment', targetId: upd.id,
        before: { status: existing.status, shipmentNumber: existing.shipmentNumber },
        after: { status: upd.status, shipmentNumber: upd.shipmentNumber },
        ip: ip || null,
      });
      return { shipment: upd, orderStatus, auditId, fromStatus: existing.status };
    });

    // Phase 0 Sprint 1: 发货单状态变更事件（事务提交后发布）
    // - ShipmentStatusChanged：所有状态变更都发布
    // - ShipmentCompleted：状态变为 Delivered 时发布（用于 Phase 1 Sprint 3 触发开票联动）
    if (hasStatus && result.fromStatus !== result.shipment.status) {
      publishBusinessEvent({
        type: 'ShipmentStatusChanged',
        sourceEntityType: 'Shipment',
        sourceEntityId: result.shipment.id,
        orderId: result.shipment.orderId,
        payload: {
          shipmentId: result.shipment.id,
          shipmentNumber: result.shipment.shipmentNumber,
          fromStatus: result.fromStatus,
          toStatus: result.shipment.status,
          orderId: result.shipment.orderId,
        },
        actorId,
        transactionId: result.auditId,
      }).catch(() => { /* event publish failure must not fail business */ });

      if (result.shipment.status === 'Delivered' && result.fromStatus !== 'Delivered') {
        publishBusinessEvent({
          type: 'ShipmentCompleted',
          sourceEntityType: 'Shipment',
          sourceEntityId: result.shipment.id,
          orderId: result.shipment.orderId,
          payload: {
            shipmentId: result.shipment.id,
            shipmentNumber: result.shipment.shipmentNumber,
            orderId: result.shipment.orderId,
            fromStatus: result.fromStatus,
          },
          actorId,
          transactionId: result.auditId,
        }).catch(() => { /* event publish failure must not fail business */ });
      }
    }
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: toMutationError(e, tx ? 'COMMIT_TRANSACTION_FAILED' : 'UPDATE_FAILED') };
  }
}

// ─── DELETE (soft) ─────────────────────────────────────────────────

export interface DeleteShipmentParams {
  prisma: PrismaClient;
  shipmentId: string;
  actorId: string;
  ip?: string | null;
  tx?: any;
  auditSource?: string;
}

export async function deleteShipment(params: DeleteShipmentParams): Promise<ShipmentMutationResult<{ shipment: any; auditId: string }>> {
  const { prisma, shipmentId, actorId, ip, tx, auditSource = 'route:shipping:delete' } = params;
  try {
    const result = await withTx(prisma, tx, async (t: any) => {
      const existing = await t.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, shipmentNumber: true } });
      if (!existing) throw Object.assign(new Error('shipment not found'), { statusCode: 404, code: 'NOT_FOUND' });
      // 仅 Draft/Booked/Cancelled 状态可删除（Draft/Booked 未发货可直接删，Cancelled 已走取消流程）
      // Loading 及之后状态（在途/已交付）应走取消流程而非物理删除
      const DELETABLE_STATUSES = new Set(['Draft', 'Booked', 'Cancelled']);
      if (!DELETABLE_STATUSES.has(existing.status)) {
        throw Object.assign(new Error(`cannot delete shipment with status=${existing.status}; cancel it first`), { code: 'INVALID_STATUS', statusCode: 400 });
      }
      const now = BigInt(Date.now());
      const del = await t.shipment.update({ where: { id: shipmentId }, data: { deletedAt: now, updatedAt: now } });
      await deactivateEntityLinks(t, 'shipment', shipmentId, now);
      const auditId = await writeRouteAuditLog({
        prisma: t, actorId, source: auditSource,
        operation: 'delete_shipment', targetType: 'Shipment', targetId: del.id,
        before: { id: del.id, shipmentNumber: existing.shipmentNumber, status: existing.status },
        ip: ip || null,
      });
      return { shipment: del, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: toMutationError(e, tx ? 'COMMIT_TRANSACTION_FAILED' : 'DELETE_FAILED') };
  }
}
