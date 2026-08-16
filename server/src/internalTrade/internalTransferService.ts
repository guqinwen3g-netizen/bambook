/**
 * internalTransferService.ts — DR-033 内部供料单 + DR-005 内部面料交易核算服务（Track G 唯一入口）
 *
 * 设计真源：
 *   - docs/design/10-评审与决策/2026-08-16-设计评审决策记录.md DR-005 / DR-033 / DR-006 / DR-007
 *   - docs/design/02-数据模型/实体关系总览.md §6.4（L-15~L-19 跨组联动）
 *   - docs/design/04-模块设计/05-财务与结算/订单利润表生成.md §2.3（DR-005 利润口径）
 *
 * 铁律（fail-closed）：
 *   1. 由服装部基于服装订单发起；必填申请部门/供料部门/关联服装订单与面料订单/物料/数量/内部结算价/交期
 *   2. 面料订单必须 isInternalFabricTrade=true（DR-005 标记纪律），否则拒绝关联
 *   3. 内部结算价必须经 approvalCreateService.createBusinessApproval 审批链（DR-006/DR-007），
 *      审批单 status !== 'approved' 时内部供料单不得生效（SETTLEMENT_PRICE_NOT_APPROVED）
 *   4. 生效门槛：面料部确认数量+交期+已批准内部结算价 → Effective；
 *      生效后回写双方 OrderLine.internalTransferPrice（服装部成本依据 / 面料部收入依据），双向关联、各自独立核算
 *   5. 实际交付进入面料订单既有出运状态机：registerDelivery 仅关联面料订单名下非 Cancelled 运单，
 *      不另造平行出库流程；每笔出运关联内部供料分配 → 回写服装订单行面料到货数量/日期/状态；
 *      支持分批出运/分批到货/差异追溯；只产生内部交付单+装箱明细数据，不生成对外商业发票
 *   6. 状态机 Draft → PendingConfirm → Effective → Delivering → Closed（+Cancelled），守卫 fail-closed
 *
 * schema 冻结权衡（显式标记）：
 *   OrderInternalTransfer 为 Phase 0 最小模型（无 status/quantity/dueDate 等列），本任务禁止改 schema.prisma。
 *   DR-033 扩展单据内容以类型化 JSON 存于 memo 字符串列（docType='DR033_INTERNAL_FABRIC_SUPPLY' 标记），
 *   由 encode/decodeInternalTransferPayload 唯一编解码。
 *   TODO(schema)：schema 解冻后应将 payload 字段提升为正式列/独立模型（InternalSupplyOrder），
 *   届时列表的状态过滤可下推至 SQL（当前在内存过滤，见 listInternalTransfers 注释）。
 *
 * 双向记录拓扑（@@unique([orderId, transferDirection])）：
 *   - master：orderId=服装订单, direction=incoming（我方买入）——单据真源，payload 权威
 *   - mirror：orderId=面料订单, direction=outgoing（我方卖出）——镜像指针，status/金额随 master 同步
 *   合并抵销仅取单边（incoming=内部采购=outgoing=内部销售），禁止双边重复计入（见 reportService）。
 */

import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../lib/logger';
import { writeRouteAuditLog } from '../audit/routeAudit';
import type { ApprovalCreateService } from '../approvals/approvalCreateService';

// ───────────────────────────────────────────────────────────────────
// 错误码（全部 fail-closed）
// ───────────────────────────────────────────────────────────────────
export const INTERNAL_TRANSFER_ERRORS = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  GARMENT_ORDER_NOT_FOUND: 'GARMENT_ORDER_NOT_FOUND',
  FABRIC_ORDER_NOT_FOUND: 'FABRIC_ORDER_NOT_FOUND',
  FABRIC_ORDER_NOT_INTERNAL_TRADE: 'FABRIC_ORDER_NOT_INTERNAL_TRADE',
  GARMENT_ORDER_INTERNAL_CONFLICT: 'GARMENT_ORDER_INTERNAL_CONFLICT',
  SAME_ORDER_CONFLICT: 'SAME_ORDER_CONFLICT',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_SETTLEMENT_PRICE: 'INVALID_SETTLEMENT_PRICE',
  INVALID_DUE_DATE: 'INVALID_DUE_DATE',
  TRANSFER_ALREADY_EXISTS: 'TRANSFER_ALREADY_EXISTS',
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  INVALID_TRANSFER_STATE: 'INVALID_TRANSFER_STATE',
  SETTLEMENT_PRICE_NOT_APPROVED: 'SETTLEMENT_PRICE_NOT_APPROVED',
  SHIPMENT_NOT_FOUND: 'SHIPMENT_NOT_FOUND',
  SHIPMENT_NOT_OF_FABRIC_ORDER: 'SHIPMENT_NOT_OF_FABRIC_ORDER',
  INVALID_DELIVERY_QUANTITY: 'INVALID_DELIVERY_QUANTITY',
  OVER_DELIVERY: 'OVER_DELIVERY',
  NO_REVIEWER_RESOLVED: 'NO_REVIEWER_RESOLVED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type InternalTransferErrorCode =
  (typeof INTERNAL_TRANSFER_ERRORS)[keyof typeof INTERNAL_TRANSFER_ERRORS];

export type InternalTransferResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: InternalTransferErrorCode | string; message: string; statusCode: number } };

// ───────────────────────────────────────────────────────────────────
// 状态机（fail-closed 守卫）
// ───────────────────────────────────────────────────────────────────
export const INTERNAL_TRANSFER_STATUSES = [
  'Draft',
  'PendingConfirm',
  'Effective',
  'Delivering',
  'Closed',
  'Cancelled',
] as const;
export type InternalTransferStatus = (typeof INTERNAL_TRANSFER_STATUSES)[number];

/** 允许的状态迁移矩阵（不在矩阵内一律拒绝） */
const ALLOWED_TRANSITIONS: Record<InternalTransferStatus, readonly InternalTransferStatus[]> = {
  Draft: ['PendingConfirm', 'Cancelled'],
  PendingConfirm: ['Effective', 'Cancelled'],
  Effective: ['Delivering', 'Closed'],
  Delivering: ['Closed'],
  Closed: [],
  Cancelled: [],
};

/** 计入核算（服装部成本 / 面料部收入 / 合并抵销）的生效状态集合 */
export const INTERNAL_TRANSFER_ACCOUNTING_STATUSES: readonly InternalTransferStatus[] = [
  'Effective',
  'Delivering',
  'Closed',
];

// ───────────────────────────────────────────────────────────────────
// DR-033 扩展载荷（memo JSON，schema 冻结期载体）
// ───────────────────────────────────────────────────────────────────
export interface InternalTransferPackingLine {
  cartonNo: string;
  quantity: number;
  grossWeight?: number;
  netWeight?: number;
}

export interface InternalTransferDelivery {
  id: string;
  shipmentId: string;
  shipmentNumber: string | null;
  quantity: number;
  deliveryDate: string; // YYYY-MM-DD
  receivedQuantity: number | null;
  receivedDate: string | null;
  /** 差异 = 到货 − 出运（null = 尚未登记到货） */
  variance: number | null;
  packingLines: InternalTransferPackingLine[];
  registeredBy: string;
  registeredAt: string; // ISO
}

export interface InternalTransferHistoryEntry {
  from: InternalTransferStatus | null;
  to: InternalTransferStatus;
  actorId: string;
  at: string; // ISO
  note?: string;
}

export interface InternalTransferPayload {
  docType: 'DR033_INTERNAL_FABRIC_SUPPLY';
  /** master=服装订单侧 incoming（权威）；mirror=面料订单侧 outgoing（镜像） */
  role: 'master' | 'mirror';
  masterId: string;
  mirrorId: string | null;
  requestDepartmentId: string; // 申请部门（服装部）
  supplyDepartmentId: string; // 供料部门（面料部）
  garmentOrderId: string;
  fabricOrderId: string;
  materialCode: string;
  quantity: number;
  unit: string;
  settlementPrice: number; // 内部结算价（单价，CNY）
  settlementApprovalId: string; // DR-006 结算价审批单 ID
  dueDate: string; // 交期 YYYY-MM-DD
  status: InternalTransferStatus;
  confirmedQuantity: number | null;
  confirmedDueDate: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  deliveries: InternalTransferDelivery[];
  history: InternalTransferHistoryEntry[];
  memo?: string;
}

export function encodeInternalTransferPayload(payload: InternalTransferPayload): string {
  return JSON.stringify(payload);
}

/** 解码 memo 载荷；非 DR-033 载荷/非法 JSON 返回 null（fail-safe，不抛错） */
export function decodeInternalTransferPayload(memo: string | null | undefined): InternalTransferPayload | null {
  if (!memo) return null;
  try {
    const parsed = JSON.parse(memo);
    if (parsed && parsed.docType === 'DR033_INTERNAL_FABRIC_SUPPLY') {
      return parsed as InternalTransferPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 内部交易记录是否计入核算（利润表/合并报表共用口径）：
 *   - DR-033 载荷：status ∈ Effective/Delivering/Closed（Draft/PendingConfirm/Cancelled 不计）
 *   - 无载荷的历史记录：recognizedAt 非空（已认账）才计入
 */
export function isInternalTransferEffective(record: { memo?: string | null; recognizedAt?: unknown }): boolean {
  const payload = decodeInternalTransferPayload(record.memo ?? null);
  if (payload) return INTERNAL_TRANSFER_ACCOUNTING_STATUSES.includes(payload.status);
  return record.recognizedAt != null;
}

// ───────────────────────────────────────────────────────────────────
// 工具
// ───────────────────────────────────────────────────────────────────
const genId = (prefix: string) => `${prefix}__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
const today = () => new Date().toISOString().slice(0, 10);
const isoNow = () => new Date().toISOString();

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fail<T>(code: InternalTransferErrorCode | string, message: string, statusCode: number): InternalTransferResult<T> {
  return { ok: false, error: { code, message, statusCode } };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ───────────────────────────────────────────────────────────────────
// 服务工厂
// ───────────────────────────────────────────────────────────────────
export interface InternalTransferServiceOptions {
  prisma: PrismaClient;
  approvalCreateService: ApprovalCreateService;
}

export interface CreateInternalTransferInput {
  requestDepartmentId: string; // 申请部门（服装部）
  supplyDepartmentId: string; // 供料部门（面料部）
  garmentOrderId: string; // 关联服装订单
  fabricOrderId: string; // 关联内部面料订单（isInternalFabricTrade=true）
  materialCode: string;
  quantity: number;
  unit?: string;
  settlementPrice: number; // 内部结算价（单价）——须走 DR-006 审批
  dueDate: string; // 交期 YYYY-MM-DD
  memo?: string;
  requesterId: string;
}

export interface ConfirmInternalTransferInput {
  id: string;
  actorId: string;
  confirmedQuantity?: number;
  confirmedDueDate?: string;
}

export interface RegisterDeliveryInput {
  id: string;
  actorId: string;
  shipmentId: string;
  quantity: number;
  deliveryDate?: string;
  receivedQuantity?: number;
  receivedDate?: string;
  packingLines?: InternalTransferPackingLine[];
}

export function createInternalTransferService(opts: InternalTransferServiceOptions) {
  const { prisma, approvalCreateService } = opts;

  // ── 内部：状态迁移守卫（fail-closed） ──
  function assertTransition(from: InternalTransferStatus, to: InternalTransferStatus): void {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw Object.assign(
        new Error(`内部供料单状态机非法迁移: ${from} → ${to}（允许: ${ALLOWED_TRANSITIONS[from].join(', ') || '无'}）`),
        { code: INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE },
      );
    }
  }

  // ── 内部：按 id 解析 master 记录（mirror id 自动跳转到 master） ──
  async function resolveMaster(id: string) {
    const rec = await prisma.orderInternalTransfer.findUnique({ where: { id } });
    if (!rec || rec.deletedAt) return null;
    const payload = decodeInternalTransferPayload(rec.memo);
    if (payload?.role === 'mirror' && payload.masterId !== rec.id) {
      const master = await prisma.orderInternalTransfer.findUnique({ where: { id: payload.masterId } });
      if (master && !master.deletedAt) return master;
    }
    return rec;
  }

  // ── 内部：同步镜像记录（status/金额/载荷随 master） ──
  async function syncMirror(tx: any, masterPayload: InternalTransferPayload, transferAmount: number) {
    if (!masterPayload.mirrorId) return;
    const mirrorPayload: InternalTransferPayload = { ...masterPayload, role: 'mirror' };
    await tx.orderInternalTransfer.update({
      where: { id: masterPayload.mirrorId },
      data: {
        transferAmount,
        memo: encodeInternalTransferPayload(mirrorPayload),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // createInternalTransfer — 服装部发起内部供料申请（scope 由 route 层守卫）
  //   创建即提交面料部确认（Draft → PendingConfirm），同时创建结算价审批单
  // ══════════════════════════════════════════════════════════════════
  async function createInternalTransfer(
    input: CreateInternalTransferInput,
  ): Promise<InternalTransferResult<{ transfer: any; mirror: any; approvalRequestId: string; payload: InternalTransferPayload }>> {
    const {
      requestDepartmentId, supplyDepartmentId, garmentOrderId, fabricOrderId,
      materialCode, quantity, unit, settlementPrice, dueDate, memo, requesterId,
    } = input;

    // 1. 必填校验（DR-033 核心内容：申请部门/供料部门/双方订单/物料/数量/结算价/交期）
    const missing: string[] = [];
    if (!requestDepartmentId?.trim()) missing.push('requestDepartmentId');
    if (!supplyDepartmentId?.trim()) missing.push('supplyDepartmentId');
    if (!garmentOrderId?.trim()) missing.push('garmentOrderId');
    if (!fabricOrderId?.trim()) missing.push('fabricOrderId');
    if (!materialCode?.trim()) missing.push('materialCode');
    if (!dueDate?.trim()) missing.push('dueDate');
    if (quantity === undefined || quantity === null) missing.push('quantity');
    if (settlementPrice === undefined || settlementPrice === null) missing.push('settlementPrice');
    if (missing.length > 0) {
      return fail(INTERNAL_TRANSFER_ERRORS.MISSING_REQUIRED_FIELD, `必填字段缺失: ${missing.join(', ')}（DR-033 内部供料单核心内容）`, 400);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_QUANTITY, `数量必须为正有限数: ${quantity}`, 400);
    }
    if (!Number.isFinite(settlementPrice) || settlementPrice <= 0) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_SETTLEMENT_PRICE, `内部结算价必须为正有限数: ${settlementPrice}`, 400);
    }
    if (!DATE_RE.test(dueDate.trim())) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_DUE_DATE, `交期必须为 YYYY-MM-DD: ${dueDate}`, 400);
    }
    if (garmentOrderId === fabricOrderId) {
      return fail(INTERNAL_TRANSFER_ERRORS.SAME_ORDER_CONFLICT, '服装订单与面料订单不得为同一订单', 400);
    }

    // 2. 双方订单校验
    const [garmentOrder, fabricOrder] = await Promise.all([
      prisma.order.findUnique({ where: { id: garmentOrderId } }),
      prisma.order.findUnique({ where: { id: fabricOrderId } }),
    ]);
    if (!garmentOrder || garmentOrder.deletedAt) {
      return fail(INTERNAL_TRANSFER_ERRORS.GARMENT_ORDER_NOT_FOUND, `服装订单 ${garmentOrderId} 不存在或已删除`, 404);
    }
    if (!fabricOrder || fabricOrder.deletedAt) {
      return fail(INTERNAL_TRANSFER_ERRORS.FABRIC_ORDER_NOT_FOUND, `面料订单 ${fabricOrderId} 不存在或已删除`, 404);
    }
    if (garmentOrder.isInternalFabricTrade === true) {
      return fail(INTERNAL_TRANSFER_ERRORS.GARMENT_ORDER_INTERNAL_CONFLICT, `服装订单 ${garmentOrderId} 被标记为内部面料交易订单，不得作为采购发起方`, 400);
    }
    if (fabricOrder.isInternalFabricTrade !== true) {
      return fail(INTERNAL_TRANSFER_ERRORS.FABRIC_ORDER_NOT_INTERNAL_TRADE, `面料订单 ${fabricOrderId} 未标记 isInternalFabricTrade=true，内部供料必须关联内部面料订单（DR-005 标记纪律）`, 400);
    }

    // 3. 方向唯一性预检（@@unique([orderId, transferDirection])，一单每方向仅 1 条）
    const [dupIncoming, dupOutgoing] = await Promise.all([
      prisma.orderInternalTransfer.findFirst({ where: { orderId: garmentOrderId, transferDirection: 'incoming', deletedAt: null } }),
      prisma.orderInternalTransfer.findFirst({ where: { orderId: fabricOrderId, transferDirection: 'outgoing', deletedAt: null } }),
    ]);
    if (dupIncoming) {
      return fail(INTERNAL_TRANSFER_ERRORS.TRANSFER_ALREADY_EXISTS, `服装订单 ${garmentOrderId} 已存在内部供料单 ${dupIncoming.id}（incoming 方向唯一）`, 409);
    }
    if (dupOutgoing) {
      return fail(INTERNAL_TRANSFER_ERRORS.TRANSFER_ALREADY_EXISTS, `面料订单 ${fabricOrderId} 已关联内部供料单 ${dupOutgoing.id}（outgoing 方向唯一）`, 409);
    }

    // 4. 内部结算价审批单（DR-006/DR-007：reviewerId 服务端解析；NO_REVIEWER_RESOLVED 原样上抛 409）
    const transferAmount = round4(settlementPrice * quantity);
    let approval;
    try {
      approval = await approvalCreateService.createBusinessApproval({
        requesterId,
        actionType: 'order:internal_trade_price',
        targetType: 'OrderInternalTransfer',
        targetId: garmentOrderId,
        payload: {
          docType: 'DR033_INTERNAL_FABRIC_SUPPLY',
          garmentOrderId,
          fabricOrderId,
          materialCode,
          quantity,
          unit: unit ?? 'm',
          settlementPrice,
          transferAmount,
          transferCurrency: 'CNY',
          dueDate,
          requestDepartmentId,
          supplyDepartmentId,
        },
        risk: 'medium',
      });
    } catch (e: any) {
      return fail(
        e?.code ?? INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR,
        e?.message ?? '内部结算价审批单创建失败',
        e?.code === INTERNAL_TRANSFER_ERRORS.NO_REVIEWER_RESOLVED ? 409 : 500,
      );
    }

    // 5. 事务：master（incoming/服装订单侧）+ mirror（outgoing/面料订单侧）双向落库
    const masterId = genId('OIT');
    const mirrorId = genId('OIT');
    const nowIso = isoNow();
    const payload: InternalTransferPayload = {
      docType: 'DR033_INTERNAL_FABRIC_SUPPLY',
      role: 'master',
      masterId,
      mirrorId,
      requestDepartmentId: requestDepartmentId.trim(),
      supplyDepartmentId: supplyDepartmentId.trim(),
      garmentOrderId,
      fabricOrderId,
      materialCode: materialCode.trim(),
      quantity,
      unit: unit ?? 'm',
      settlementPrice,
      settlementApprovalId: approval.id,
      dueDate: dueDate.trim(),
      status: 'PendingConfirm',
      confirmedQuantity: null,
      confirmedDueDate: null,
      confirmedBy: null,
      confirmedAt: null,
      deliveries: [],
      history: [{ from: 'Draft', to: 'PendingConfirm', actorId: requesterId, at: nowIso, note: '服装部发起内部供料申请' }],
      ...(memo?.trim() ? { memo: memo.trim() } : {}),
    };

    try {
      const { master, mirror } = await prisma.$transaction(async (tx: any) => {
        const masterRow = await tx.orderInternalTransfer.create({
          data: {
            id: masterId,
            orderId: garmentOrderId,
            transferDirection: 'incoming', // 服装部买入（我方买入）
            counterpartyId: supplyDepartmentId.trim(),
            ourDepartmentId: requestDepartmentId.trim(),
            transferAmount,
            transferCurrency: 'CNY',
            transferDate: today(),
            memo: encodeInternalTransferPayload(payload),
          },
        });
        const mirrorPayload: InternalTransferPayload = { ...payload, role: 'mirror' };
        const mirrorRow = await tx.orderInternalTransfer.create({
          data: {
            id: mirrorId,
            orderId: fabricOrderId,
            transferDirection: 'outgoing', // 面料部卖出（我方卖出）
            counterpartyId: requestDepartmentId.trim(),
            ourDepartmentId: supplyDepartmentId.trim(),
            transferAmount,
            transferCurrency: 'CNY',
            transferDate: today(),
            memo: encodeInternalTransferPayload(mirrorPayload),
          },
        });
        await writeRouteAuditLog({
          prisma: tx, actorId: requesterId, source: 'service:internal-trade:create',
          operation: 'internal_transfer_create', targetType: 'OrderInternalTransfer', targetId: masterId,
          before: null,
          after: {
            garmentOrderId, fabricOrderId, materialCode, quantity, settlementPrice,
            transferAmount, dueDate, mirrorId, settlementApprovalId: approval.id, status: 'PendingConfirm',
          },
        });
        return { master: masterRow, mirror: mirrorRow };
      });

      logger.info('[InternalTransfer] 内部供料单已创建（待面料部确认）', {
        id: masterId, mirrorId, garmentOrderId, fabricOrderId, transferAmount, settlementApprovalId: approval.id,
      });
      return { ok: true, data: { transfer: master, mirror, approvalRequestId: approval.id, payload } };
    } catch (e: any) {
      logger.error('[InternalTransfer] 创建事务失败', { garmentOrderId, fabricOrderId, error: e?.message });
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `内部供料单创建事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // confirmInternalTransfer — 面料部确认数量+交期+已批准结算价 → 生效
  //   生效后：双方 OrderLine.internalTransferPrice 回写（成本/收入依据），双向关联独立核算
  // ══════════════════════════════════════════════════════════════════
  async function confirmInternalTransfer(
    input: ConfirmInternalTransferInput,
  ): Promise<InternalTransferResult<{ transfer: any; payload: InternalTransferPayload }>> {
    const { id, actorId, confirmedQuantity, confirmedDueDate } = input;

    const master = await resolveMaster(id);
    if (!master) {
      return fail(INTERNAL_TRANSFER_ERRORS.TRANSFER_NOT_FOUND, `内部供料单 ${id} 不存在或已删除`, 404);
    }
    const payload = decodeInternalTransferPayload(master.memo);
    if (!payload) {
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `内部供料单 ${id} 载荷缺失或损坏（memo 非 DR-033 载荷）`, 500);
    }
    if (payload.status !== 'PendingConfirm') {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, `内部供料单当前状态 ${payload.status}，仅 PendingConfirm 可确认生效`, 409);
    }

    // 生效门槛①：内部结算价审批必须已通过（DR-006/DR-033，fail-closed）
    const approval = await prisma.approvalRequest.findUnique({ where: { id: payload.settlementApprovalId } });
    if (!approval || approval.status !== 'approved') {
      return fail(
        INTERNAL_TRANSFER_ERRORS.SETTLEMENT_PRICE_NOT_APPROVED,
        `内部结算价审批单 ${payload.settlementApprovalId} 当前状态 ${approval?.status ?? 'missing'}，未批准的内部结算价不得生效（DR-006/DR-033）`,
        409,
      );
    }

    // 生效门槛②：面料部确认数量+交期（缺省取申请值；显式确认值须合法）
    const effQuantity = confirmedQuantity ?? payload.quantity;
    const effDueDate = confirmedDueDate ?? payload.dueDate;
    if (!Number.isFinite(effQuantity) || effQuantity <= 0) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_QUANTITY, `确认数量必须为正有限数: ${effQuantity}`, 400);
    }
    if (!DATE_RE.test(effDueDate)) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_DUE_DATE, `确认交期必须为 YYYY-MM-DD: ${effDueDate}`, 400);
    }

    assertTransition(payload.status, 'Effective');
    const transferAmount = round4(payload.settlementPrice * effQuantity);
    const nowIso = isoNow();
    const nextPayload: InternalTransferPayload = {
      ...payload,
      status: 'Effective',
      confirmedQuantity: effQuantity,
      confirmedDueDate: effDueDate,
      confirmedBy: actorId,
      confirmedAt: nowIso,
      history: [...payload.history, { from: 'PendingConfirm', to: 'Effective', actorId, at: nowIso, note: '面料部确认数量/交期/已批准结算价，内部供料单生效' }],
    };

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const row = await tx.orderInternalTransfer.update({
          where: { id: master.id },
          data: {
            transferAmount,
            recognizedBy: actorId,
            recognizedAt: new Date(),
            memo: encodeInternalTransferPayload(nextPayload),
          },
        });
        await syncMirror(tx, nextPayload, transferAmount);
        // 生效写入：服装订单行内部结算价（面料成本依据）+ 面料订单行内部结算价（内部收入依据）
        await tx.orderLine.updateMany({
          where: { orderId: payload.garmentOrderId, materialCode: payload.materialCode },
          data: { internalTransferPrice: payload.settlementPrice },
        });
        await tx.orderLine.updateMany({
          where: { orderId: payload.fabricOrderId, materialCode: payload.materialCode },
          data: { internalTransferPrice: payload.settlementPrice },
        });
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:internal-trade:confirm',
          operation: 'internal_transfer_confirm', targetType: 'OrderInternalTransfer', targetId: master.id,
          before: { status: 'PendingConfirm', transferAmount: Number(master.transferAmount) },
          after: { status: 'Effective', confirmedQuantity: effQuantity, confirmedDueDate: effDueDate, transferAmount },
        });
        return row;
      });

      logger.info('[InternalTransfer] 内部供料单已生效', { id: master.id, confirmedQuantity: effQuantity, transferAmount, actorId });
      return { ok: true, data: { transfer: updated, payload: nextPayload } };
    } catch (e: any) {
      if (e?.code === INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE) {
        return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, e.message, 409);
      }
      logger.error('[InternalTransfer] 确认生效事务失败', { id, error: e?.message });
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `确认生效事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // registerDelivery — 交付登记（关联面料订单既有出运，不另造平行出库流程）
  //   每笔出运关联内部供料分配 → 回写服装订单行面料到货数量/日期/状态；
  //   支持分批出运/分批到货/差异追溯；仅内部交付单+装箱明细，无对外商业发票
  // ══════════════════════════════════════════════════════════════════
  async function registerDelivery(
    input: RegisterDeliveryInput,
  ): Promise<InternalTransferResult<{ transfer: any; delivery: InternalTransferDelivery; cumulativeDelivered: number; status: InternalTransferStatus; payload: InternalTransferPayload }>> {
    const { id, actorId, shipmentId, quantity, deliveryDate, receivedQuantity, receivedDate, packingLines } = input;

    const master = await resolveMaster(id);
    if (!master) {
      return fail(INTERNAL_TRANSFER_ERRORS.TRANSFER_NOT_FOUND, `内部供料单 ${id} 不存在或已删除`, 404);
    }
    const payload = decodeInternalTransferPayload(master.memo);
    if (!payload) {
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `内部供料单 ${id} 载荷缺失或损坏（memo 非 DR-033 载荷）`, 500);
    }
    if (payload.status !== 'Effective' && payload.status !== 'Delivering') {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, `内部供料单当前状态 ${payload.status}，仅 Effective/Delivering 可登记交付（未生效不得交付，已关闭/取消禁止追加）`, 409);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_DELIVERY_QUANTITY, `交付数量必须为正有限数: ${quantity}`, 400);
    }
    const effDeliveryDate = deliveryDate ?? today();
    if (!DATE_RE.test(effDeliveryDate)) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_DUE_DATE, `交付日期必须为 YYYY-MM-DD: ${effDeliveryDate}`, 400);
    }
    if (receivedQuantity !== undefined && (!Number.isFinite(receivedQuantity) || receivedQuantity < 0)) {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_DELIVERY_QUANTITY, `到货数量必须为非负有限数: ${receivedQuantity}`, 400);
    }

    // 运单校验：必须属于关联面料订单且非 Cancelled（进入面料订单既有出运状态机，fail-closed）
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment || shipment.deletedAt || shipment.status === 'Cancelled') {
      return fail(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_FOUND, `运单 ${shipmentId} 不存在、已删除或已取消`, 404);
    }
    if (shipment.orderId !== payload.fabricOrderId) {
      return fail(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_OF_FABRIC_ORDER, `运单 ${shipmentId} 属于订单 ${shipment.orderId ?? '（无）'}，非关联面料订单 ${payload.fabricOrderId} 的出运（DR-033：内部供料交付必须进入面料订单既有出运状态机）`, 409);
    }

    // 分批出运累计不得超确认数量（fail-closed；差异指出运 vs 到货，非超发）
    const confirmedQty = payload.confirmedQuantity ?? payload.quantity;
    const cumulativeBefore = round4(payload.deliveries.reduce((acc, d) => acc + d.quantity, 0));
    const cumulativeAfter = round4(cumulativeBefore + quantity);
    if (cumulativeAfter > confirmedQty) {
      return fail(INTERNAL_TRANSFER_ERRORS.OVER_DELIVERY, `累计交付 ${cumulativeAfter} 超出确认数量 ${confirmedQty}（已交付 ${cumulativeBefore}，本次 ${quantity}），禁止超发`, 409);
    }

    const nowIso = isoNow();
    const delivery: InternalTransferDelivery = {
      id: genId('ITD'),
      shipmentId,
      shipmentNumber: shipment.shipmentNumber ?? null,
      quantity,
      deliveryDate: effDeliveryDate,
      receivedQuantity: receivedQuantity ?? null,
      receivedDate: receivedQuantity !== undefined ? (receivedDate ?? effDeliveryDate) : null,
      variance: receivedQuantity !== undefined ? round4(receivedQuantity! - quantity) : null,
      packingLines: packingLines ?? [],
      registeredBy: actorId,
      registeredAt: nowIso,
    };

    const nextStatus: InternalTransferStatus = cumulativeAfter >= confirmedQty ? 'Closed' : 'Delivering';
    assertTransition(payload.status, nextStatus);
    const nextPayload: InternalTransferPayload = {
      ...payload,
      status: nextStatus,
      deliveries: [...payload.deliveries, delivery],
      history: [...payload.history, { from: payload.status, to: nextStatus, actorId, at: nowIso, note: `交付登记 ${quantity}${payload.unit}（运单 ${shipment.shipmentNumber ?? shipmentId}）` }],
    };
    const transferAmount = Number(master.transferAmount);

    // 服装订单行到货回写：累计出运量 + 最近交付日期 + 到货状态（分批/差异可追溯）
    const cumulativeReceived = round4(nextPayload.deliveries.reduce((acc, d) => acc + (d.receivedQuantity ?? 0), 0));
    const anyReceipt = nextPayload.deliveries.some((d) => d.receivedQuantity !== null);
    const garmentLineStatus = cumulativeReceived >= confirmedQty
      ? 'Arrived'
      : anyReceipt || cumulativeAfter > 0
        ? 'PartiallyArrived'
        : undefined;

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const row = await tx.orderInternalTransfer.update({
          where: { id: master.id },
          data: { memo: encodeInternalTransferPayload(nextPayload) },
        });
        await syncMirror(tx, nextPayload, transferAmount);
        await tx.orderLine.updateMany({
          where: { orderId: payload.garmentOrderId, materialCode: payload.materialCode },
          data: {
            shipmentQuantity: cumulativeAfter,
            shippingDate: effDeliveryDate,
            ...(garmentLineStatus ? { status: garmentLineStatus } : {}),
          },
        });
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:internal-trade:delivery',
          operation: 'internal_transfer_delivery', targetType: 'OrderInternalTransfer', targetId: master.id,
          before: { status: payload.status, cumulativeDelivered: cumulativeBefore },
          after: {
            status: nextStatus, deliveryId: delivery.id, shipmentId, quantity,
            cumulativeDelivered: cumulativeAfter, receivedQuantity: delivery.receivedQuantity, variance: delivery.variance,
          },
        });
        return row;
      });

      logger.info('[InternalTransfer] 交付已登记', {
        id: master.id, deliveryId: delivery.id, shipmentId, quantity, cumulativeDelivered: cumulativeAfter, status: nextStatus,
      });
      return { ok: true, data: { transfer: updated, delivery, cumulativeDelivered: cumulativeAfter, status: nextStatus, payload: nextPayload } };
    } catch (e: any) {
      if (e?.code === INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE) {
        return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, e.message, 409);
      }
      logger.error('[InternalTransfer] 交付登记事务失败', { id, shipmentId, error: e?.message });
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `交付登记事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // cancelInternalTransfer — 仅 Draft/PendingConfirm 可取消（生效后须走订单变更/例外链，不在本域）
  // ══════════════════════════════════════════════════════════════════
  async function cancelInternalTransfer(
    input: { id: string; actorId: string; reason?: string },
  ): Promise<InternalTransferResult<{ transfer: any; payload: InternalTransferPayload }>> {
    const { id, actorId, reason } = input;

    const master = await resolveMaster(id);
    if (!master) {
      return fail(INTERNAL_TRANSFER_ERRORS.TRANSFER_NOT_FOUND, `内部供料单 ${id} 不存在或已删除`, 404);
    }
    const payload = decodeInternalTransferPayload(master.memo);
    if (!payload) {
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `内部供料单 ${id} 载荷缺失或损坏（memo 非 DR-033 载荷）`, 500);
    }
    if (payload.status !== 'Draft' && payload.status !== 'PendingConfirm') {
      return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, `内部供料单当前状态 ${payload.status}，仅 Draft/PendingConfirm 可取消；已生效单据须走订单变更/DR-013 例外链`, 409);
    }

    assertTransition(payload.status, 'Cancelled');
    const nowIso = isoNow();
    const nextPayload: InternalTransferPayload = {
      ...payload,
      status: 'Cancelled',
      history: [...payload.history, { from: payload.status, to: 'Cancelled', actorId, at: nowIso, note: reason?.trim() || '取消内部供料单' }],
    };
    const transferAmount = Number(master.transferAmount);

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const row = await tx.orderInternalTransfer.update({
          where: { id: master.id },
          data: { memo: encodeInternalTransferPayload(nextPayload) },
        });
        await syncMirror(tx, nextPayload, transferAmount);
        // 关联的待决审批单同步取消（防止审批人继续处理已作废的结算价审批）
        await tx.approvalRequest.updateMany({
          where: { id: payload.settlementApprovalId, status: 'pending' },
          data: { status: 'cancelled', decidedAt: new Date(), decisionNote: `内部供料单 ${master.id} 已取消` },
        });
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:internal-trade:cancel',
          operation: 'internal_transfer_cancel', targetType: 'OrderInternalTransfer', targetId: master.id,
          before: { status: payload.status },
          after: { status: 'Cancelled', reason: reason?.trim() ?? null },
        });
        return row;
      });
      logger.info('[InternalTransfer] 内部供料单已取消', { id: master.id, actorId });
      return { ok: true, data: { transfer: updated, payload: nextPayload } };
    } catch (e: any) {
      if (e?.code === INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE) {
        return fail(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE, e.message, 409);
      }
      logger.error('[InternalTransfer] 取消事务失败', { id, error: e?.message });
      return fail(INTERNAL_TRANSFER_ERRORS.INTERNAL_ERROR, `取消事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 查询
  // ══════════════════════════════════════════════════════════════════
  async function getInternalTransferById(id: string) {
    const master = await resolveMaster(id);
    if (!master) return null;
    const payload = decodeInternalTransferPayload(master.memo);
    const mirror = payload?.mirrorId
      ? await prisma.orderInternalTransfer.findUnique({ where: { id: payload.mirrorId } }).catch(() => null)
      : null;
    return { master, mirror: mirror ?? null, payload };
  }

  /**
   * 列表（按部门/状态/订单过滤）。
   * 注意（schema 冻结权衡）：状态在 memo JSON 内，无法下推 SQL，本函数在内存过滤后分页；
   * 数据量受 limit≤500 保护，schema 解冻后应改为列查询。
   */
  async function listInternalTransfers(query: {
    departmentId?: string;
    status?: InternalTransferStatus;
    garmentOrderId?: string;
    fabricOrderId?: string;
    limit?: number;
    offset?: number;
  }) {
    const take = Math.min(query.limit || 100, 500);
    const skip = query.offset || 0;

    const where: any = { deletedAt: null, transferDirection: 'incoming' };
    if (query.garmentOrderId) where.orderId = query.garmentOrderId;
    if (query.departmentId) where.ourDepartmentId = query.departmentId;

    let rows: any[] = await prisma.orderInternalTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // 面料订单维度过滤（经 mirror 反查 master）
    if (query.fabricOrderId) {
      const mirrors: any[] = await prisma.orderInternalTransfer.findMany({
        where: { deletedAt: null, transferDirection: 'outgoing', orderId: query.fabricOrderId },
      });
      const masterIds = new Set(
        mirrors.map((m) => decodeInternalTransferPayload(m.memo)?.masterId).filter(Boolean) as string[],
      );
      rows = rows.filter((r) => masterIds.has(r.id));
    }

    let items = rows.map((record) => ({ record, payload: decodeInternalTransferPayload(record.memo) }));
    if (query.status) {
      items = items.filter((it) => it.payload?.status === query.status);
    }
    const total = items.length;
    items = items.slice(skip, skip + take);
    return { items, total };
  }

  return {
    createInternalTransfer,
    confirmInternalTransfer,
    registerDelivery,
    cancelInternalTransfer,
    getInternalTransferById,
    listInternalTransfers,
  };
}

export type InternalTransferService = ReturnType<typeof createInternalTransferService>;
