/**
 * shipmentEligibilityGate.ts — 出运放行资格门禁（shipping 域统一消费点）
 *
 * 设计真源：
 *   - DR-012：面料船样（S/S）客户确认是标准发货门禁（未确认正常路径一律阻断）
 *   - DR-014：面料大货 QC ∥ S/S 客户确认 ∥ RC 客户确认 三条件并行（缺任一即不具备资格）
 *   - REL-14-A4：服装链出运门禁 = 大货终期 Final QC（与样品 QC 严格独立）
 *   - DR-016：合票（ShipmentOrderAllocation）——一票多订单，逐订单校验
 *   - DR-013：受控例外（targetType='Order' + action='shipment:release'，例外不改变原门禁状态）
 *
 * 消费模式（与 samples 域 assertFabricShipmentGate 同一 SDK 范式）：
 *   1. 逐订单做原始资格判定（qcService，不感知例外）；
 *   2. 全部具备资格 → passedVia='gate' 放行（不触碰例外，一次性例外不被无意核销）；
 *   3. 任一不具备资格 → 对该订单查「Order + shipment:release」生效例外：
 *      - 例外精确命中 → 该订单 via='exception' 放行（携带例外摘要，供徽标展示/审计）；
 *      - 无生效例外 → 聚合抛出 GATE_BLOCKED（409，blockingReasons 带订单维度 + exceptionEntryHint）。
 *
 * 边界语义：
 *   - 无订单锚点的运单（散货，orderIds 为空）→ 无门禁语义，直接放行；
 *   - 订单不存在/已删除 → 视同不具备资格（fail-closed，NOT_FOUND 维度阻断）；
 *   - 非面料非服装订单（Other）→ 无出运门禁定义，放行；
 *   - 例外核销（consumeException）不在本层：一次性例外在 maxUses/validUntil 内对同订单分批出运保持有效，
 *     核销时机待总控裁决（登记遗留项，与 samples 域现状一致）。
 */

import { createQcService } from '../qc/qcService';
import { isFabricChainOrder, isGarmentChainOrder } from '../qc/qcChainService';
import {
  assertGateOrThrow,
  bindExceptionChecker,
  GateBlockedError,
  GATE_BLOCKED,
  EXCEPTION_ENTRY_HINT,
  type ActiveExceptionSummary,
  type ExceptionChecker,
  type ExceptionInactiveReason,
} from '../exceptions/exceptionGate';

export const SHIPMENT_RELEASE_GATE = 'shipment_release' as const;
/** DR-013 例外 scope 动作标识（EXC 创建时 scope.action 必须与此精确一致） */
export const SHIPMENT_RELEASE_ACTION = 'shipment:release' as const;

export type ShipmentGateChain = 'fabric' | 'garment' | 'other' | 'not_found';

export interface OrderShipmentGateOutcome {
  orderId: string;
  /** 链分派结果；not_found = 订单不存在/已删除（fail-closed 视同不具备资格） */
  chain: ShipmentGateChain;
  /** 原始门禁是否具备资格（不感知例外） */
  eligible: boolean;
  /** 原始阻断原因码（面料三条件 / 服装 Final QC / ORDER_NOT_FOUND） */
  blockingReasons: string[];
  /** 最终放行通道（仅聚合通过时有值）：gate=正常资格，exception=DR-013 例外放行 */
  via?: 'gate' | 'exception';
  /** via='exception' 时的生效例外摘要（供「DR-013 例外放行」徽标与审计） */
  exception?: ActiveExceptionSummary;
}

export interface ShipmentReleaseGateBlockedError {
  code: typeof GATE_BLOCKED;
  message: string;
  /** 聚合阻断原因（`{orderId}:{reason}` 维度，合票场景可区分订单） */
  blockingReasons: string[];
  /** 逐订单判定明细（含例外查询结论） */
  orders: OrderShipmentGateOutcome[];
  /** 首个无例外订单的例外查询结论（无申请/未批准/已过期/已核销） */
  exceptionReason?: ExceptionInactiveReason;
  exceptionEntryHint: typeof EXCEPTION_ENTRY_HINT;
}

/** 订单存在性是先决条件（404 语义），不聚合进门禁阻断 */
export interface ShipmentReleaseGateOrderNotFoundError {
  code: 'ORDER_NOT_FOUND';
  message: string;
  orderIds: string[];
}

export type ShipmentReleaseGateError = ShipmentReleaseGateBlockedError | ShipmentReleaseGateOrderNotFoundError;

export type ShipmentReleaseGateResult =
  | { ok: true; data: { orders: OrderShipmentGateOutcome[] } }
  | { ok: false; error: ShipmentReleaseGateError };

/**
 * 出运放行资格判定（目标状态 = Shipped 时由 mutationService 调用）。
 * @param prisma 可为事务 client（与调用方同事务读，fail-closed）
 * @param orderIds 主订单 + 合票分配订单（函数内去重、过滤空值）
 * @param exceptionChecker DR-013 例外查询器（exceptionService.hasActiveException）；
 *                         缺省/null → 无例外放行能力（fail-closed，隐藏旁路禁止）
 */
export async function evaluateShipmentReleaseGate(params: {
  prisma: any;
  orderIds: Array<string | null | undefined>;
  at?: Date;
  exceptionChecker?: ExceptionChecker | null;
}): Promise<ShipmentReleaseGateResult> {
  const { prisma, at, exceptionChecker } = params;
  const orderIds = [...new Set(params.orderIds.filter((id): id is string => !!id?.trim()))];

  // 无订单锚点（散货运单）→ 无门禁语义
  if (orderIds.length === 0) {
    return { ok: true, data: { orders: [] } };
  }

  const qc = createQcService(prisma);
  const checkOrderRelease = exceptionChecker
    ? bindExceptionChecker(exceptionChecker, { targetType: 'Order', action: SHIPMENT_RELEASE_ACTION })
    : null;

  // ── 1. 逐订单原始资格判定（不感知例外） ──
  const outcomes: OrderShipmentGateOutcome[] = [];
  const notFoundIds: string[] = [];
  for (const orderId of orderIds) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt !== null) {
      // 订单存在性是先决条件（404 语义），不参与门禁聚合
      notFoundIds.push(orderId);
      outcomes.push({
        orderId,
        chain: 'not_found',
        eligible: false,
        blockingReasons: ['ORDER_NOT_FOUND'],
      });
      continue;
    }

    if (isFabricChainOrder(order)) {
      // DR-012/014：面料三条件并行（bulkQc ∥ S/S ∥ RC）
      const eligibility = await qc.checkShipmentEligibility(orderId);
      outcomes.push({
        orderId,
        chain: 'fabric',
        eligible: eligibility.eligible,
        blockingReasons: eligibility.missingGates,
      });
      continue;
    }

    if (isGarmentChainOrder(order)) {
      // REL-14-A4：服装大货终期 Final QC 单条件
      const eligibility = await qc.checkGarmentShipmentEligibility(orderId);
      outcomes.push({
        orderId,
        chain: 'garment',
        eligible: eligibility.eligible,
        blockingReasons: eligibility.missingGates,
      });
      continue;
    }

    // Other 类型订单无出运门禁定义 → 放行
    outcomes.push({ orderId, chain: 'other', eligible: true, blockingReasons: [] });
  }

  // ── 2. 订单不存在 → 404 先决条件失败（不走门禁聚合，不查例外） ──
  if (notFoundIds.length > 0) {
    return {
      ok: false,
      error: {
        code: 'ORDER_NOT_FOUND',
        message: `订单 ${notFoundIds.join(', ')} 不存在或已删除，无法判定出运放行资格`,
        orderIds: notFoundIds,
      },
    };
  }

  // ── 3. 全部具备资格 → 正常放行（不触碰例外） ──
  const blocked = outcomes.filter((o) => !o.eligible);
  if (blocked.length === 0) {
    for (const o of outcomes) o.via = 'gate';
    return { ok: true, data: { orders: outcomes } };
  }

  // ── 4. 不具备资格订单逐单查 DR-013 例外 ──
  const failures: Array<{ outcome: OrderShipmentGateOutcome; error: GateBlockedError }> = [];
  for (const outcome of blocked) {
    try {
      const pass = await assertGateOrThrow(
        {
          eligible: false,
          gate: SHIPMENT_RELEASE_GATE,
          blockingReasons: outcome.blockingReasons,
          message: `订单 ${outcome.orderId} 出运放行门禁未通过（${outcome.blockingReasons.join(', ')}）`,
        },
        checkOrderRelease
          ? () => checkOrderRelease(outcome.orderId, at)
          : { active: false, reason: 'NO_ACTIVE_EXCEPTION' },
      );
      if (pass.passedVia === 'exception') {
        outcome.via = 'exception';
        outcome.exception = pass.exception;
      }
    } catch (e) {
      if (e instanceof GateBlockedError) {
        failures.push({ outcome, error: e });
      } else {
        throw e;
      }
    }
  }

  if (failures.length > 0) {
    const first = failures[0].error;
    return {
      ok: false,
      error: {
        code: GATE_BLOCKED,
        message:
          `出运放行门禁未通过：${failures.map((f) => f.error.message.split('。')[0]).join('；')}` +
          `。${EXCEPTION_ENTRY_HINT}`,
        blockingReasons: failures.flatMap((f) =>
          f.outcome.blockingReasons.map((r) => `${f.outcome.orderId}:${r}`)),
        orders: outcomes,
        exceptionReason: first.exceptionReason,
        exceptionEntryHint: EXCEPTION_ENTRY_HINT,
      },
    };
  }

  // 全部不具备资格订单均经例外放行（正常资格订单 via='gate' 保持未标记 → 统一补标）
  for (const o of outcomes) if (!o.via) o.via = 'gate';
  return { ok: true, data: { orders: outcomes } };
}
