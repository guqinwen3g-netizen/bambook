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
import { mapOrderLinesToShipmentLineInputs, replaceShipmentLinesTx } from './shipmentPackingService';
import { evaluateShipmentReleaseGate, type ShipmentReleaseGateBlockedError } from './shipmentEligibilityGate';
import { createOrderShipmentBatchService } from './orderShipmentBatchService';
import type { ExceptionChecker } from '../exceptions/exceptionGate';

export type ShipmentMutationErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'INVALID_INITIAL_STATUS'
  | 'INVALID_TRANSITION'
  | 'INVALID_CURRENT_STATUS'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_TERMINAL'
  | 'INVALID_CURRENT_ORDER_STATUS'
  | 'INVALID_SHIPMENT_STATUS'
  | 'GATE_BLOCKED'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED'
  | 'COMMIT_TRANSACTION_FAILED';

export interface ShipmentMutationError {
  code: ShipmentMutationErrorCode;
  message: string;
  /** GATE_BLOCKED 时的门禁明细（blockingReasons 带订单维度 + 逐订单判定结果 + DR-013 申请入口） */
  gateDetails?: Pick<ShipmentReleaseGateBlockedError, 'blockingReasons' | 'orders' | 'exceptionReason' | 'exceptionEntryHint'>;
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

// ─── F3：物流节点事件 ─────────────────────────────────────────────
// 节点业务日期取值口径：优先对应业务日期字段，兜底当日（YYYY-MM-DD）
function nodeBusinessDate(toNode: string, sh: any): string {
  const today = new Date().toISOString().slice(0, 10);
  switch (toNode) {
    case 'Booked': return sh?.bookingDate || today;
    case 'Shipped': return sh?.atd || sh?.etd || today;
    case 'Arrived': return sh?.ata || sh?.eta || today;
    case 'Cleared': return sh?.customsClearanceDate || today;
    default: return today;
  }
}

/**
 * 事务内追加物流节点事件（append-only）。
 * route / agent 两条写路径共用此 helper，保证时间轴完整性单一来源。
 */
export async function appendShipmentEvent(
  t: any,
  params: { shipmentId: string; fromNode: string | null; toNode: string; shipment?: any; note?: string | null; actorId?: string | null },
): Promise<void> {
  await t.shipmentEvent.create({
    data: {
      id: `SHPE__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      shipmentId: params.shipmentId,
      fromNode: params.fromNode,
      toNode: params.toNode,
      eventDate: nodeBusinessDate(params.toNode, params.shipment),
      note: params.note ?? null,
      actorId: params.actorId ?? null,
      createdAt: BigInt(Date.now()),
    },
  });
}

function toMutationError(e: any, fallback: ShipmentMutationErrorCode): ShipmentMutationError {
  const passThroughCodes: ShipmentMutationErrorCode[] = [
    'NOT_FOUND', 'INVALID_STATUS', 'INVALID_INITIAL_STATUS', 'INVALID_TRANSITION', 'INVALID_CURRENT_STATUS',
    'ORDER_NOT_FOUND', 'ORDER_TERMINAL', 'INVALID_CURRENT_ORDER_STATUS', 'INVALID_SHIPMENT_STATUS',
    'GATE_BLOCKED',
  ];
  if (e?.code && passThroughCodes.includes(e.code)) {
    return {
      code: e.code,
      message: String(e.message ?? e),
      ...(e.gateDetails ? { gateDetails: e.gateDetails } : {}),
    };
  }
  return { code: fallback, message: String(e?.message ?? e) };
}

/**
 * DR-012/014 + REL-14-A4 出运放行门禁（目标状态 = Shipped 的统一前置校验）。
 * 门禁失败抛 code=GATE_BLOCKED（statusCode=409）错误，由 toMutationError 透传；
 * 例外查询器缺失时 fail-closed（无例外放行能力，隐藏旁路禁止）。
 */
async function assertShipmentReleaseGateOrThrow(params: {
  tx: any;
  orderIds: Array<string | null | undefined>;
  exceptionChecker?: ExceptionChecker | null;
}): Promise<void> {
  const gate = await evaluateShipmentReleaseGate({
    prisma: params.tx,
    orderIds: params.orderIds,
    exceptionChecker: params.exceptionChecker ?? null,
  });
  if (!gate.ok) {
    // 订单存在性失败（404 语义）与门禁阻断（409 语义）分流
    if (gate.error.code === 'ORDER_NOT_FOUND') {
      throw Object.assign(new Error(gate.error.message), { code: 'ORDER_NOT_FOUND' as const, statusCode: 404 });
    }
    throw Object.assign(new Error(gate.error.message), {
      code: 'GATE_BLOCKED' as const,
      statusCode: 409,
      gateDetails: {
        blockingReasons: gate.error.blockingReasons,
        orders: gate.error.orders,
        exceptionReason: gate.error.exceptionReason,
        exceptionEntryHint: gate.error.exceptionEntryHint,
      },
    });
  }
}

// ─── CREATE ────────────────────────────────────────────────────────

import { nextBusinessNumber } from '../shared/businessNumberService';

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
  /** DR-013 例外查询器（出运放行门禁用）；缺省 → 无例外放行能力（fail-closed） */
  exceptionChecker?: ExceptionChecker | null;
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
    exceptionChecker,
  } = params;

  // status 合法枚举（fail closed，事务前）
  if (input?.status != null && !isValidShipmentStatus(String(input.status))) {
    return { ok: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID_SHIPMENT_STATUSES.join(', ')}` } };
  }
  // DTO 前置校验（S3 走查 ε 车道）：空体/缺必填字段坠入事务撞 Prisma P2012 → 500（空体 POST 实锤），
  // 提前为 VALIDATION_ERROR（route 400）。校验集合 = 全部现存调用方共同契约的交集：
  // route（create 白名单含 shippingMethod）/ L2 事件联动（显式传 shippingMethod）/
  // agent orderShipFlow（toolRuntime 前置强制 shipment.shippingMethod）三方均保证 shippingMethod。
  // type 同为 schema 必填，但 agent draft 契约（OrderShipDraftInput.type 可选 + order.ship
  // inputSchema 未要求）不保证该字段——在服务层强制会收紧跨域契约，超出本车道租约；
  // 待 agent 域前置补齐 type 后，本校验集合可同标准扩入 type。
  const REQUIRED_CREATE_FIELDS = ['shippingMethod'] as const;
  const missingFields = REQUIRED_CREATE_FIELDS.filter((f) => input?.[f] === undefined || input?.[f] === null || input?.[f] === '');
  if (missingFields.length > 0) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: `missing required fields: ${missingFields.join(', ')}` } };
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
      // Shipment.id 无数据库默认值，必须显式生成（route/agent 统一走此生成逻辑）
      const shipmentId = input?.id
        || `SHP__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      // PRD 5.6：服务端自动生成运单号（SH-YYYY-NNNN），传入时优先使用传入值
      // REQ2-20 期间实测发现的第四例序列落后占位（与 REQ2-12 第三例同类根因）：
      // BusinessSequence 缺 SEQ_SH_{year} 行而 Shipment 表已有 SH-YYYY-NNNN 直写行（迁移导入/序列重建）时
      // 生成号即撞唯一键（P2002 事务回滚）→ occupied 回调查目标表（含软删）自动追平到首个未占用号
      const shipmentNumber = input.shipmentNumber || await nextBusinessNumber(t, 'SH', undefined, {
        occupied: async (num) => {
          const dup = await t.shipment.findFirst({ where: { shipmentNumber: num }, select: { id: true } });
          return dup != null;
        },
      });
      const data: any = { ...input, shipmentNumber, status: shipmentStatus, createdAt: now, updatedAt: now };
      if (shipmentId) data.id = shipmentId;

      // DR-012/014 出运放行门禁：直建 Shipped（补录场景）视同出运放行，须过资格判定
      // （create 时合票分配尚未建立，仅校验主订单；合票订单在 update → Shipped 时校验）
      if (shipmentStatus === 'Shipped') {
        await assertShipmentReleaseGateOrThrow({ tx: t, orderIds: [input.orderId], exceptionChecker });
      }

      const sh = await t.shipment.create({ data });

      // F3：首节点事件（创建即入时间轴，fromNode=null）
      await appendShipmentEvent(t, { shipmentId: sh.id, fromNode: null, toNode: sh.status, shipment: sh, actorId });

      // sync EntityReference / EntityLink
      await syncShipmentReferences(prisma, sh, { source: syncSource }, t);

      // order 状态联动（有 orderId 时）
      let orderStatus: string | null = null;
      if (sh.orderId) {
        const linkResult = await linkOrderStatusFromShipment(t, sh.orderId, sh.status, { operator: actorId });
        if (linkResult.ok && !linkResult.skipped) {
          orderStatus = linkResult.toStatus || null;
        }

        // C4：建单首装——关联订单且订单有明细行时自动带出装运行
        // （同事务，映射口径与 pull-from-order 端点共用 mapOrderLinesToShipmentLineInputs）
        // 注意：createShipment 直建 Shipped 状态时，运单尚未持久化完成，需跳过状态检查
        const orderLines = await t.orderLine.findMany({ where: { orderId: sh.orderId }, orderBy: { lineNumber: 'asc' } });
        if (orderLines.length > 0) {
          await replaceShipmentLinesTx(t, sh.id, mapOrderLinesToShipmentLineInputs(orderLines), actorId, ip, { skipStatusCheck: true });
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
    // W-B 断层④：直建 Shipped（补录场景）→ 自动推进挂接批次 planned→shipped（best-effort，不阻断创建结果）
    if (result.shipment.status === 'Shipped') {
      await createOrderShipmentBatchService(prisma).autoAdvanceOnShipmentShipped(result.shipment.id, actorId);
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
  /** DR-013 例外查询器（出运放行门禁用）；缺省 → 无例外放行能力（fail-closed） */
  exceptionChecker?: ExceptionChecker | null;
}

export async function updateShipment(params: UpdateShipmentParams): Promise<ShipmentMutationResult<{ shipment: any; orderStatus: string | null; auditId: string }>> {
  const { prisma, shipmentId, patch, hasStatus, actorId, ip, tx, auditSource = 'route:shipping:update', syncSource = 'route:update', exceptionChecker } = params;
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
        // DR-012/014 出运放行门禁：流转至 Shipped（出运放行语义）时校验全部关联订单
        // （DR-016 合票：主订单 + ShipmentOrderAllocation 分配订单逐单校验；同状态幂等 patch 不重复校验）
        if (newStatus === 'Shipped' && existing.status !== 'Shipped') {
          const allocations = await t.shipmentOrderAllocation.findMany({ where: { shipmentId }, select: { orderId: true } });
          await assertShipmentReleaseGateOrThrow({
            tx: t,
            orderIds: [existing.orderId, ...allocations.map((a: any) => a.orderId)],
            exceptionChecker,
          });
        }
      }
      const now = BigInt(Date.now());
      const upd = await t.shipment.update({ where: { id: shipmentId }, data: { ...patch, updatedAt: now } });
      // F3：状态实际变更时落节点事件（同事务；同状态幂等 patch 不落事件）
      if (hasStatus && existing.status !== upd.status) {
        await appendShipmentEvent(t, { shipmentId: upd.id, fromNode: existing.status, toNode: upd.status, shipment: upd, note: upd.notes ?? null, actorId });
      }
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
    // W-B 断层④：流转至 Shipped → 自动推进挂接批次 planned→shipped（同状态幂等 patch 不重复触发；best-effort 不阻断更新结果）
    if (hasStatus && result.shipment.status === 'Shipped' && result.fromStatus !== 'Shipped') {
      await createOrderShipmentBatchService(prisma).autoAdvanceOnShipmentShipped(result.shipment.id, actorId);
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
