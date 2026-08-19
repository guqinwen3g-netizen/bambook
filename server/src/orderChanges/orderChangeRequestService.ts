/**
 * orderChangeRequestService.ts — DR-010 已批准订单变更/取消/暂停控制服务（Track B 唯一入口）
 *
 * 设计真源：
 *   - docs/design/03-业务规则/订单变更规则.md §2A（取消/暂停流程）/§6 触发矩阵 #10/#11/#12
 *   - docs/design/04-模块设计/03-订单与生产/Orders-订单管理/订单状态机.md §14.3（OSM-010-C1~C5）
 *   - docs/design/10-评审与决策/2026-08-16-设计评审决策记录.md DR-010
 *   - docs/design/03-业务规则/交期与生产规则.md L1 交期锁死（ORDER_SHIPPING_LOCKED）
 *
 * 铁律（fail-closed）：
 *   1. 仅已批准订单（status ∈ APPROVED_ORDER_STATUSES）可发起变更申请；
 *      草稿/待审批订单由业务员直接撤回/取消/暂停，不走本链（ORDER_NOT_APPROVED）
 *   2. 任何比例/任何件数改动均需审批，无阈值分级（DR-007 去阈值化）；
 *      before/after 值、变更原因（≥15字）、影响说明（≥10字）必填
 *   3. 审批单必须经 approvalCreateService.createBusinessApproval 创建（reviewerId 服务端 DR-007 解析，绝不手写）
 *   4. apply 仅允许 status=Approved；重复 apply 幂等返回 ALREADY_APPLIED，不产生二次写入
 *   5. 交期变更：Shipping/Delivered 状态直接拒绝 ORDER_SHIPPING_LOCKED（硬防篡改，
 *      无 EXC 直跳；需先走订单状态回退 Confirmed 审批链，见订单变更规则.md §13 OCG-EXC-3）
 *   6. 取消：批准后无不可逆承诺直接结案关闭；有承诺进 Closing（结案处理中），
 *      处置完成（completeClosing）才关闭——EXC 也不得跳过结案处理闭环
 *   7. 暂停：原因/责任人/预计恢复日期 3 字段必填；到期未恢复置 resumeReminderFlagged=true
 *      （checkPauseResumeDue 为 scheduler 接入点，由调度层定期调用）
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { publishBusinessEvent } from '../events/businessEventBus';
import { syncOrderEntityReferences } from '../entities/sync';
import {
  DR010_GUARDED_STATUSES,
  ORDER_LIFECYCLE_EXTENSION_ERRORS,
} from '../orders/orderLifecycleService';
import type { ApprovalCreateService } from '../approvals/approvalCreateService';
import { createCreditService } from '../credit/creditService';

// ───────────────────────────────────────────────────────────────────
// 错误码（全部 fail-closed）
// ───────────────────────────────────────────────────────────────────
export const ORDER_CHANGE_ERRORS = {
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_NOT_APPROVED: 'ORDER_NOT_APPROVED',
  ORDER_LIFECYCLE_GUARDED: ORDER_LIFECYCLE_EXTENSION_ERRORS.ORDER_LIFECYCLE_GUARDED,
  MISSING_BEFORE_AFTER: 'MISSING_BEFORE_AFTER',
  INVALID_CHANGE_TYPE: 'INVALID_CHANGE_TYPE',
  REASON_TOO_SHORT: 'REASON_TOO_SHORT',
  IMPACT_TOO_SHORT: 'IMPACT_TOO_SHORT',
  PAUSE_FIELDS_REQUIRED: 'PAUSE_FIELDS_REQUIRED',
  PAUSE_RESUME_DATE_INVALID: 'PAUSE_RESUME_DATE_INVALID',
  CHANGE_REQUEST_NOT_FOUND: 'CHANGE_REQUEST_NOT_FOUND',
  CHANGE_REQUEST_NOT_PENDING: 'CHANGE_REQUEST_NOT_PENDING',
  CHANGE_REQUEST_NOT_APPROVED: 'CHANGE_REQUEST_NOT_APPROVED',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  ORDER_SHIPPING_LOCKED: 'ORDER_SHIPPING_LOCKED',
  WITHDRAW_NOT_BY_REQUESTER: 'WITHDRAW_NOT_BY_REQUESTER',
  ORDER_STATUS_CONFLICT: 'ORDER_STATUS_CONFLICT',
  CLOSING_NOT_REQUIRED: 'CLOSING_NOT_REQUIRED',
} as const;

export type OrderChangeErrorCode = (typeof ORDER_CHANGE_ERRORS)[keyof typeof ORDER_CHANGE_ERRORS];

export type OrderChangeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: OrderChangeErrorCode; message: string; statusCode: number } };

// ───────────────────────────────────────────────────────────────────
// 变更类型（任务契约 7 类）↔ schema changeTypes 枚举映射
//   price → unitPrice | quantity → quantity | delivery → deliveryDate
//   customer → customer | product → product_spec | cancel → other | pause → other
// ───────────────────────────────────────────────────────────────────
export const ORDER_CHANGE_TYPES = ['price', 'quantity', 'delivery', 'customer', 'product', 'cancel', 'pause'] as const;
export type OrderChangeType = (typeof ORDER_CHANGE_TYPES)[number];

const CHANGE_TYPE_TO_SCHEMA: Record<OrderChangeType, string> = {
  price: 'unitPrice',
  quantity: 'quantity',
  delivery: 'deliveryDate',
  customer: 'customer',
  product: 'product_spec',
  cancel: 'other',
  pause: 'other',
};

/** 已批准（正式承诺）状态集合：仅这些状态允许发起变更申请 */
export const APPROVED_ORDER_STATUSES = ['Confirmed', 'Production', 'Shipping', 'Delivered'] as const;

/** L1 交期锁死状态集合 */
const SHIPPING_LOCKED_STATUSES = new Set(['Shipping', 'Delivered']);

const CHANGE_REASON_MIN = 15; // 变更理由 ≥15 字（schema 注释 fail-closed 约定）
const IMPACT_SUMMARY_MIN = 10; // 影响说明 ≥10 字（DR-010「记录前后值、原因与影响」服务端强制下限）

// afterDelta.field → Order 列映射（apply 时一次性写入）
const ORDER_FIELD_MAP: Record<string, string> = {
  quantity: 'quantity',
  unitPrice: 'quoteAmount',
  deliveryDate: 'dueDate',
  dueDate: 'dueDate',
  clientDate: 'clientDate',
  customer: 'customer',
  customerRelationId: 'customerRelationId',
  customerCode: 'customerCode',
  product: 'product',
  type: 'type',
  businessLine: 'businessLine',
};

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const epochNow = () => BigInt(Date.now());

function fail<T>(code: OrderChangeErrorCode, message: string, statusCode: number): OrderChangeResult<T> {
  return { ok: false, error: { code, message, statusCode } };
}

// ───────────────────────────────────────────────────────────────────
// 服务工厂
// ───────────────────────────────────────────────────────────────────
export interface OrderChangeRequestServiceOptions {
  prisma: PrismaClient;
  approvalCreateService: ApprovalCreateService;
}

export interface CreateChangeRequestInput {
  orderId: string;
  changeType: OrderChangeType;
  /** 变更前快照（writeOnce），如 { quantity: 200 } */
  beforeSnapshot: Record<string, unknown>;
  /** 变更后增量，如 { quantity: 180 } */
  afterDelta: Record<string, unknown>;
  /** 变更理由（≥15字必填） */
  changeReason: string;
  /** 影响说明（≥10字必填，写入 notes） */
  impactSummary: string;
  requesterId: string;
  /** 暂停必填：原因（缺省回落 changeReason）/责任人/预计恢复日期 YYYY-MM-DD */
  pauseReason?: string;
  pauseOwnerId?: string;
  expectedResumeDate?: string;
  attachments?: unknown;
}

export function createOrderChangeRequestService(opts: OrderChangeRequestServiceOptions) {
  const { prisma, approvalCreateService } = opts;

  // ── 内部：写入 OrderStatusTransition（不经过 6 态矩阵的扩展迁移，见 orderLifecycleService 注释） ──
  async function writeExtensionTransition(
    tx: any,
    orderId: string,
    fromStatus: string,
    toStatus: string,
    operator: string,
    note: string | null,
  ) {
    await tx.orderStatusTransition.create({
      data: {
        id: genId('OST'),
        orderId,
        fromStatus,
        toStatus,
        note,
        operator,
        lineId: null,
        createdAt: epochNow(),
      },
    });
  }

  // ── 内部：客户变更信用额度联动 ──
  // 已接线 Track F 统一信用服务（creditService.reserveCredit / releaseCredit）：
  // usedAmount 写操作 + CreditLimitHistory append-only 由信用域收口，
  // 保持既有语义：客户变更 → 旧客户释放（-amount）+ 新客户占用（+amount），
  // triggerType='order_change_customer'，triggerId=变更申请 ID，triggerBy='system_change_apply'。
  const creditService = createCreditService({ prisma });
  async function applyCustomerCreditLinkage(
    tx: any,
    changeRequestId: string,
    order: any,
    newCustomerRelationId: string,
  ) {
    const amountRaw = order.totalNet ?? order.quoteAmount ?? 0;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      logger.warn('[OrderChange] 客户变更额度联动跳过：订单金额不可用', { orderId: order.id, amountRaw });
      return { released: false, occupied: false, amount: 0 };
    }
    const oldRelationId: string | null = order.customerRelationId ?? null;
    const remark = `DR-010 客户变更额度联动（订单 ${order.id}）`;
    const shiftBase = {
      amount,
      triggerType: 'order_change_customer',
      triggerId: changeRequestId,
      triggerBy: 'system_change_apply',
      remark,
      tx,
    };

    // 语义与原 shift() 一致：无 Active 额度 → false（跳过不报错）
    let released = false;
    if (oldRelationId && oldRelationId !== newCustomerRelationId) {
      const res = await creditService.releaseCredit({ ...shiftBase, relationId: oldRelationId });
      released = res.ok && res.data.adjusted;
      if (!res.ok) {
        logger.warn('[OrderChange] 旧客户额度释放失败', { changeRequestId, oldRelationId, error: res.error });
      }
    }
    const occ = await creditService.reserveCredit({ ...shiftBase, relationId: newCustomerRelationId });
    const occupied = occ.ok && occ.data.adjusted;
    if (!occ.ok) {
      logger.warn('[OrderChange] 新客户额度占用失败', { changeRequestId, newCustomerRelationId, error: occ.error });
    }
    logger.info('[OrderChange] 客户变更额度联动完成', {
      changeRequestId, orderId: order.id, oldRelationId, newCustomerRelationId, released, occupied, amount,
    });
    return { released, occupied, amount };
  }

  // ── 内部：取消影响汇总（合同/面料采购/样品/生产/付款/库存 6 方面，§2A.2 步骤 1） ──
  // 设计真源：订单变更规则.md §6 触发矩阵 #10。影响汇总失败 → impactSummaryFailed: true（fail-closed 标记，需人工介入）。
  async function summarizeCancelImpact(orderId: string, order: any) {
    const emptyLines: any[] = [];
    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e: any) {
        logger.warn('[OrderChange] 取消影响汇总子项失败', { orderId, error: e?.message });
        return -1;
      }
    };

    const contract = {
      customerPoNumber: order.poNumber ?? null,
      salesContractNumber: order.salesContractNumber ?? null,
      finalContractNumber: order.finalContractNumber ?? null,
      hasSignedContract: Boolean(order.salesContractNumber || order.finalContractNumber || order.poNumber),
    };
    const procurement = {
      purchaseOrderCount: await safeCount(() => prisma.purchaseOrder.count({ where: { orderId, deletedAt: null } })),
      committedCount: await safeCount(() => prisma.purchaseOrder.count({
        where: { orderId, deletedAt: null, status: { in: ['Sent', 'Confirmed', 'PartiallyReceived', 'Received'] } },
      })),
    };
    // 样品维度：DevelopmentCase.linkedOrderId → SampleNode（schema 无 SealedSample 模型，
    // 封样链路经由开发案样品节点反映；approved 的 pp 样视为样品侧承诺）
    const developmentCaseIds: string[] = await prisma.developmentCase
      .findMany({ where: { linkedOrderId: orderId, deletedAt: null }, select: { id: true } })
      .then((rows: any[]) => rows.map((r) => r.id))
      .catch(() => []);
    const samples = {
      developmentCaseCount: developmentCaseIds.length,
      sampleNodeCount: developmentCaseIds.length > 0
        ? await safeCount(() => prisma.sampleNode.count({ where: { developmentCaseId: { in: developmentCaseIds }, deletedAt: null } }))
        : 0,
    };
    const production = {
      startedStageCount: await safeCount(() => prisma.productionStage.count({
        where: { orderId, status: { in: ['done', 'in_progress'] }, stageSeq: { gt: 1 } },
      })),
    };
    const finance = {
      invoiceCount: await safeCount(() => prisma.invoice.count({ where: { orderId, deletedAt: null } })),
      paymentVoucherCount: await safeCount(() => prisma.paymentVoucher.count({ where: { orderId, deletedAt: null } })),
    };
    const inventory = { note: '无订单级库存锁模型；库存占用经采购/到货链路反映（见 procurement.committedCount）' };

    const impactSummaryFailed = [procurement.purchaseOrderCount, procurement.committedCount,
      samples.sampleNodeCount, production.startedStageCount, finance.invoiceCount, finance.paymentVoucherCount]
      .some((n) => n < 0);

    // 不可逆承诺：已盖章/确认采购合同、已启动生产（seq>1 已有完成/进行中）、已开票、已收款
    const hasIrreversibleCommitments =
      procurement.committedCount > 0 || production.startedStageCount > 0 ||
      finance.invoiceCount > 0 || finance.paymentVoucherCount > 0;

    return {
      contract, procurement, samples, production, finance, inventory,
      impactSummaryFailed,
      hasIrreversibleCommitments,
    };
  }

  // ── 内部：生成业务单号 OCR-YYYYMMDD-xxx ──
  async function nextRequestNumber(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `OCR-${day}-`;
    const count = await prisma.orderChangeRequest.count({
      where: { requestNumber: { startsWith: prefix } },
    }).catch(() => 0);
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  // ══════════════════════════════════════════════════════════════════
  // createChangeRequest — 仅已批准订单可发起（scope 由 route 层守卫）
  // ══════════════════════════════════════════════════════════════════
  async function createChangeRequest(input: CreateChangeRequestInput): Promise<OrderChangeResult<{ changeRequest: any; approvalRequestId: string }>> {
    const {
      orderId, changeType, beforeSnapshot, afterDelta, changeReason, impactSummary,
      requesterId, pauseReason, pauseOwnerId, expectedResumeDate, attachments,
    } = input;

    // 1. 变更类型校验
    if (!ORDER_CHANGE_TYPES.includes(changeType)) {
      return fail(ORDER_CHANGE_ERRORS.INVALID_CHANGE_TYPE, `非法变更类型: ${changeType}。允许: ${ORDER_CHANGE_TYPES.join(', ')}`, 400);
    }
    // 2. before/after 必填
    if (!beforeSnapshot || typeof beforeSnapshot !== 'object' || Object.keys(beforeSnapshot).length === 0 ||
        !afterDelta || typeof afterDelta !== 'object' || Object.keys(afterDelta).length === 0) {
      return fail(ORDER_CHANGE_ERRORS.MISSING_BEFORE_AFTER, 'beforeSnapshot 与 afterDelta 均必填且非空（DR-010 前后值留痕）', 400);
    }
    // 3. 原因 / 影响必填
    const reason = (changeReason ?? '').trim();
    if (reason.length < CHANGE_REASON_MIN) {
      return fail(ORDER_CHANGE_ERRORS.REASON_TOO_SHORT, `变更理由至少 ${CHANGE_REASON_MIN} 字（审计强制）`, 400);
    }
    const impact = (impactSummary ?? '').trim();
    if (impact.length < IMPACT_SUMMARY_MIN) {
      return fail(ORDER_CHANGE_ERRORS.IMPACT_TOO_SHORT, `影响说明至少 ${IMPACT_SUMMARY_MIN} 字（DR-010 记录原因与影响）`, 400);
    }
    // 4. 暂停 3 字段必填（原因/责任人/预计恢复日期）+ 日期格式与未来性校验
    if (changeType === 'pause') {
      const pr = (pauseReason ?? reason).trim();
      if (!pr || !(pauseOwnerId ?? '').trim() || !(expectedResumeDate ?? '').trim()) {
        return fail(ORDER_CHANGE_ERRORS.PAUSE_FIELDS_REQUIRED, '暂停申请必须记录原因、责任人和预计恢复日期（DR-010 §2A.3）', 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedResumeDate!) || expectedResumeDate! < new Date().toISOString().slice(0, 10)) {
        return fail(ORDER_CHANGE_ERRORS.PAUSE_RESUME_DATE_INVALID, '预计恢复日期必须为 YYYY-MM-DD 且不早于今天（禁止无限期挂起）', 400);
      }
    }

    // 5. 订单校验：存在 / 未软删 / 已批准 / 非生命周期守卫中
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_NOT_FOUND, `订单 ${orderId} 不存在或已删除`, 404);
    }
    if (DR010_GUARDED_STATUSES.has(order.status)) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_LIFECYCLE_GUARDED, `订单处于「${order.status}」，存在进行中的变更/取消/暂停申请，禁止并发发起`, 409);
    }
    if (!(APPROVED_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_NOT_APPROVED, `仅已批准订单（${APPROVED_ORDER_STATUSES.join('/')}）可发起变更申请；草稿/待审批订单由业务员直接撤回/取消/暂停`, 400);
    }
    // 交期锁死属硬防篡改：Shipping/Delivered 直接拒绝（无 EXC 直跳，需先走状态回退 Confirmed 审批链）
    if (changeType === 'delivery' && SHIPPING_LOCKED_STATUSES.has(order.status)) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_SHIPPING_LOCKED, `订单已 ${order.status}，交期锁死禁止篡改（L1）。请先走「订单状态回退 Confirmed」审批，回退成功后再提交交期变更申请`, 409);
    }

    // 6. 取消：进入「取消申请中」前汇总 6 方面影响（§2A.2 步骤 1）
    let cancelImpact: Record<string, unknown> | null = null;
    if (changeType === 'cancel') {
      cancelImpact = (await summarizeCancelImpact(orderId, order)) as unknown as Record<string, unknown>;
    }

    // 7. 审批单创建（DR-007 组织归属路由；NO_REVIEWER_RESOLVED 原样上抛）
    const requestNumber = await nextRequestNumber();
    const actionType = changeType === 'cancel' ? 'order:cancel' : changeType === 'pause' ? 'order:pause' : 'order:change';
    let approval;
    try {
      approval = await approvalCreateService.createBusinessApproval({
        requesterId,
        actionType,
        targetType: 'OrderChangeRequest',
        targetId: orderId,
        payload: {
          changeType,
          hitChangeTypes: [CHANGE_TYPE_TO_SCHEMA[changeType]],
          beforeSnapshot,
          afterDelta,
          changeReason: reason,
          impactSummary: impact,
          requestNumber,
          ...(changeType === 'cancel' ? { cancelImpact } : {}),
          ...(changeType === 'pause' ? { pauseReason: (pauseReason ?? reason).trim(), pauseOwnerId, expectedResumeDate } : {}),
        },
        risk: changeType === 'customer' || changeType === 'product' || changeType === 'cancel' ? 'high' : 'medium',
      });
    } catch (e: any) {
      // NO_REVIEWER_RESOLVED 透传为 409（fail-closed 不允许 reviewerId=null 落库）
      return fail(e?.code ?? ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, e?.message ?? '审批单创建失败', e?.code === 'NO_REVIEWER_RESOLVED' ? 409 : 500);
    }

    // 8. 事务：OrderChangeRequest 落库 + 订单状态迁移 + 时间线 + 审计
    const crId = genId('OCR');
    const lifecycleStatus = changeType === 'cancel' ? 'CancelRequested' : changeType === 'pause' ? 'PauseRequested' : null;
    const impactLevel = changeType === 'customer' || changeType === 'product' || changeType === 'cancel' ? 'high' : 'medium';
    const pauseMeta = changeType === 'pause'
      ? { pauseReason: (pauseReason ?? reason).trim(), pauseOwnerId: pauseOwnerId!.trim(), expectedResumeDate, resumeReminderFlagged: false }
      : null;

    try {
      const changeRequest = await prisma.$transaction(async (tx: any) => {
        const cr = await tx.orderChangeRequest.create({
          data: {
            id: crId,
            orderId,
            requestNumber,
            beforeSnapshot: beforeSnapshot as any,
            afterDelta: afterDelta as any,
            changeTypes: [CHANGE_TYPE_TO_SCHEMA[changeType]],
            impactLevel,
            changeReason: reason,
            requesterId,
            reviewerId: approval.reviewerId as string,
            approvalRequestId: approval.id,
            status: 'Pending',
            notes: impact,
            attachments: (attachments ?? (cancelImpact || pauseMeta ? { cancelImpact, pause: pauseMeta } : undefined)) as any,
          },
        });

        if (lifecycleStatus) {
          const now = epochNow();
          await tx.order.update({ where: { id: orderId }, data: { status: lifecycleStatus, updatedAt: now } });
          await writeExtensionTransition(tx, orderId, order.status, lifecycleStatus, requesterId, `${requestNumber} 申请提交`);
        }

        await writeRouteAuditLog({
          prisma: tx, actorId: requesterId, source: 'service:order-change:create',
          operation: 'order_change_request', targetType: 'OrderChangeRequest', targetId: crId,
          before: { orderStatus: order.status },
          after: { changeType, requestNumber, approvalRequestId: approval.id, ...(lifecycleStatus ? { orderStatus: lifecycleStatus } : {}) },
        });
        return cr;
      });

      logger.info('[OrderChange] 变更申请已创建', { id: crId, requestNumber, changeType, orderId, approvalRequestId: approval.id });
      return { ok: true, data: { changeRequest, approvalRequestId: approval.id } };
    } catch (e: any) {
      logger.error('[OrderChange] 变更申请落库失败', { orderId, changeType, error: e?.message });
      return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, `变更申请创建事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // applyChangeRequest — 审批通过后生效（幂等；scope 由 route 层守卫）
  // ══════════════════════════════════════════════════════════════════
  async function applyChangeRequest(params: { changeRequestId: string; appliedBy: string }): Promise<OrderChangeResult<{ changeRequest: any; applied: string }>> {
    const { changeRequestId, appliedBy } = params;

    const cr = await prisma.orderChangeRequest.findUnique({ where: { id: changeRequestId } });
    if (!cr || cr.deletedAt) {
      return fail(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_FOUND, `变更申请 ${changeRequestId} 不存在`, 404);
    }
    // 幂等：已 Applied 直接返回，不产生二次写入
    if (cr.status === 'Applied') {
      return fail(ORDER_CHANGE_ERRORS.ALREADY_APPLIED, `变更申请 ${cr.requestNumber} 已生效（appliedAt=${cr.appliedAt?.toISOString?.() ?? cr.appliedAt}），防重复 apply`, 409);
    }
    if (cr.status !== 'Approved') {
      return fail(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_APPROVED, `变更申请当前状态 ${cr.status}，仅 Approved 可生效`, 409);
    }

    const order = await prisma.order.findUnique({ where: { id: cr.orderId } });
    if (!order || order.deletedAt) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_NOT_FOUND, `订单 ${cr.orderId} 不存在或已删除`, 404);
    }

    const schemaType: string = cr.changeTypes?.[0] ?? 'other';
    // schema 枚举反推业务类型：非 'other' 直接反查；'other' 由 attachments.pause 区分 pause/cancel
    const businessType: OrderChangeType = schemaType !== 'other'
      ? ((Object.keys(CHANGE_TYPE_TO_SCHEMA) as OrderChangeType[])
          .find((k) => CHANGE_TYPE_TO_SCHEMA[k] === schemaType) ?? 'cancel')
      : ((cr as any).attachments?.pause ? 'pause' : 'cancel');
    const afterDelta = (cr.afterDelta ?? {}) as Record<string, unknown>;

    // 交期锁死二次校验（审批期间订单可能已推进到 Shipping/Delivered）
    if (businessType === 'delivery' && SHIPPING_LOCKED_STATUSES.has(order.status)) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_SHIPPING_LOCKED, `订单已 ${order.status}，交期锁死禁止篡改（L1）。请先走「订单状态回退 Confirmed」审批`, 409);
    }

    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const now = epochNow();
        let appliedTag: string = businessType;
        let orderUpdateData: Record<string, unknown> | null = null;
        let statusTo: string | null = null;

        if (businessType === 'cancel') {
          // §2A.2 步骤 3a/3b：无不可逆承诺 → 直接结案关闭；有承诺 → 结案处理中
          if (order.status !== 'CancelRequested') {
            throw Object.assign(new Error(`订单当前状态 ${order.status}，取消生效要求 CancelRequested`), { code: ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT });
          }
          const impact = await summarizeCancelImpact(cr.orderId, order);
          statusTo = impact.hasIrreversibleCommitments ? 'Closing' : 'Cancelled';
          orderUpdateData = { status: statusTo, updatedAt: now };
          appliedTag = statusTo === 'Closing' ? 'cancel_to_closing' : 'cancel_closed_direct';
        } else if (businessType === 'pause') {
          if (order.status !== 'PauseRequested') {
            throw Object.assign(new Error(`订单当前状态 ${order.status}，暂停生效要求 PauseRequested`), { code: ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT });
          }
          const pauseMeta = (cr as any).attachments?.pause ?? {};
          statusTo = 'Paused';
          orderUpdateData = { status: 'Paused', updatedAt: now };
          await tx.orderChangeRequest.update({
            where: { id: cr.id },
            data: {
              attachments: {
                ...(((cr as any).attachments) ?? {}),
                pause: { ...pauseMeta, pausedAt: new Date().toISOString(), resumeReminderFlagged: false },
              } as any,
            },
          });
          appliedTag = 'pause_activated';
        } else {
          // 业务字段变更：写入 Order 字段（before 不被覆盖，审批通过才 commit）
          const data: Record<string, unknown> = { updatedAt: now };
          for (const [field, value] of Object.entries(afterDelta)) {
            const column = ORDER_FIELD_MAP[field];
            if (column) data[column] = value;
          }
          orderUpdateData = data;

          // 客户变更 → 额度联动（EXC 也不跳过联动，OCG-EXC-2）
          if (businessType === 'customer') {
            const newRelationId = String(afterDelta.customerRelationId ?? afterDelta.customer ?? '');
            if (newRelationId && newRelationId !== order.customerRelationId) {
              await applyCustomerCreditLinkage(tx, cr.id, order, newRelationId);
            } else if (!newRelationId) {
              logger.warn('[OrderChange] 客户变更缺少 customerRelationId after 值，额度联动跳过', { changeRequestId: cr.id });
            }
          }

          // 产品变更 → PreCutChecklist 重置（4 项全部→false，重新走裁剪前确认，§9.3 质量门禁联动）
          if (businessType === 'product') {
            await tx.preCutChecklist.updateMany({
              where: { orderId: cr.orderId },
              data: {
                gradingConfirmed: false, consumptionConfirmed: false,
                patternConfirmed: false, preProductionMeeting: false,
                confirmedBy: null, confirmedAt: null, updatedAt: now,
              },
            });
          }
          // 数量变更 → MOQ 重算接入点：校验服务属其他 Track，此处发布 OrderChanged 事件
          // 由下游 MOQ/豁免校验订阅重算（见下方 publishBusinessEvent），留 TODO 接口点。
        }

        // 订单写回 + 状态迁移（cancel/pause 有状态机动作）
        let updatedOrder = order;
        if (orderUpdateData) {
          updatedOrder = await tx.order.update({ where: { id: cr.orderId }, data: orderUpdateData });
          if (statusTo) {
            await writeExtensionTransition(tx, cr.orderId, order.status, statusTo, appliedBy, `${cr.requestNumber} 审批通过生效`);
          }
          // 业务字段变更后同步 EntityLink（customer 等关联快照）
          if (!statusTo && (businessType === 'customer' || businessType === 'product')) {
            await syncOrderEntityReferences(prisma, updatedOrder, { source: 'service:order-change:apply' }, tx);
          }
        }

        // 变更申请状态 → Applied（仅非 cancel/pause 在 updateMany 前已写过 attachments，统一覆盖）
        const applied = await tx.orderChangeRequest.update({
          where: { id: cr.id },
          data: { status: 'Applied', appliedAt: new Date(), appliedBy },
        });

        // 字段级 AuditLog：每个 afterDelta 字段一条（§4.1），transactionId=approvalRequestId ?? cr.id
        const transactionId = cr.approvalRequestId ?? cr.id;
        const beforeSnapshot = (cr.beforeSnapshot ?? {}) as Record<string, unknown>;
        for (const [field, value] of Object.entries(afterDelta)) {
          await tx.auditLog.create({
            data: {
              id: genId('alog'),
              actorId: appliedBy,
              action: 'order_change_approved',
              targetType: 'Order',
              targetId: cr.orderId,
              detail: { source: 'service:order-change:apply', changeRequestId: cr.id, changeType: businessType } as any,
              ip: null,
              operationType: 'update',
              fieldPath: field,
              beforeValue: beforeSnapshot[field] as any,
              afterValue: value as any,
              transactionId,
            },
          });
        }

        return { changeRequest: applied, applied: appliedTag };
      });

      // 事务提交后 fire-and-forget 事件（复用既有 OrderStatusChanged 类型，payload 带 changeType/applied 语义；
      // 数量变更 → MOQ 重算 / 出运聚合重算由订阅方处理）
      publishBusinessEvent({
        type: 'OrderStatusChanged',
        sourceEntityType: 'OrderChangeRequest',
        sourceEntityId: changeRequestId,
        orderId: cr.orderId,
        payload: {
          orderChangeApplied: true,
          changeType: businessType,
          requestNumber: cr.requestNumber,
          applied: result.applied,
          // TODO(cross-domain)：quantity 变更后由 MOQ 校验服务订阅本事件重算豁免缺口；
          // 已有部分出运分配时由出运域订阅重算聚合（OSM-010-C2 联动，当前无既有订阅方）
        },
        actorId: appliedBy,
        transactionId: cr.approvalRequestId ?? cr.id,
      }).catch(() => { /* event publish failure must not fail business */ });

      logger.info('[OrderChange] 变更已生效', { changeRequestId, applied: result.applied, appliedBy });
      return { ok: true, data: result };
    } catch (e: any) {
      if (e?.code === ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT) {
        return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, e.message, 409);
      }
      logger.error('[OrderChange] 变更生效事务失败', { changeRequestId, error: e?.message });
      return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, `变更生效事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // syncFromApprovalDecision — 审批决策同步（P0-003 修复）
  //   审批单 approved/rejected 后同步变更申请状态：
  //   - approved → OrderChangeRequest.status: Pending → Approved（业务员随后 apply 生效，两段式语义保留）
  //   - rejected → Pending → Rejected + 订单从 CancelRequested/PauseRequested 恢复申请前状态（时间线回查，同撤回路径）
  //   幂等：仅 Pending 状态处理；找不到关联变更申请（非 OrderChangeRequest 类审批）静默返回。
  // ══════════════════════════════════════════════════════════════════
  async function syncFromApprovalDecision(params: {
    approvalRequestId: string;
    decision: 'approved' | 'rejected';
    decisionNote?: string;
    actorId: string;
  }): Promise<OrderChangeResult<{ changeRequest: any; orderRestoredTo?: string | null }>> {
    const { approvalRequestId, decision, decisionNote, actorId } = params;

    const cr = await prisma.orderChangeRequest.findFirst({
      where: { approvalRequestId, deletedAt: null },
    });
    if (!cr || cr.status !== 'Pending') {
      // 非 OrderChangeRequest 类审批 / 已同步（幂等）→ 静默跳过
      return { ok: true, data: { changeRequest: cr } };
    }

    const order = await prisma.order.findUnique({ where: { id: cr.orderId } });
    const schemaType: string = cr.changeTypes?.[0] ?? 'other';
    const isPause = schemaType === 'other' && Boolean((cr as any).attachments?.pause);
    const isCancel = schemaType === 'other' && !isPause;

    // 驳回取消/暂停：恢复申请前状态（时间线回查 fromStatus，与撤回同源逻辑）
    let restoreStatus: string | null = null;
    if (
      decision === 'rejected' && (isCancel || isPause) && order &&
      (order.status === 'CancelRequested' || order.status === 'PauseRequested')
    ) {
      const lastTransition = await prisma.orderStatusTransition.findFirst({
        where: { orderId: order.id, toStatus: order.status },
        orderBy: { createdAt: 'desc' },
      });
      const candidate = lastTransition?.fromStatus ?? null;
      restoreStatus = candidate && !DR010_GUARDED_STATUSES.has(candidate) && candidate !== 'Cancelled' ? candidate : 'Confirmed';
    }

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const now = epochNow();
        const next = await tx.orderChangeRequest.update({
          where: { id: cr.id },
          data: { status: decision === 'approved' ? 'Approved' : 'Rejected' },
        });
        // 驳回 → 订单恢复申请前状态（仅 cancel/pause 有状态迁移）
        if (restoreStatus && order) {
          await tx.order.update({ where: { id: order.id }, data: { status: restoreStatus, updatedAt: now } });
          await writeExtensionTransition(tx, order.id, order.status, restoreStatus, actorId, `${cr.requestNumber} 审批驳回${decisionNote ? `：${decisionNote}` : ''}`);
        }
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:order-change:approval-sync',
          operation: 'order_change_approval_synced', targetType: 'OrderChangeRequest', targetId: cr.id,
          before: { status: 'Pending' },
          after: { status: decision === 'approved' ? 'Approved' : 'Rejected', orderRestoredTo: restoreStatus, decisionNote: decisionNote ?? null },
        });
        return next;
      });
      logger.info('[OrderChange] 审批决策已同步变更申请', { approvalRequestId, decision, changeRequestId: cr.id, orderRestoredTo: restoreStatus });
      return { ok: true, data: { changeRequest: updated, orderRestoredTo: restoreStatus } };
    } catch (e: any) {
      logger.error('[OrderChange] 审批决策同步失败', { approvalRequestId, decision, error: e?.message });
      return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, `审批决策同步失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // withdrawChangeRequest — 申请人撤回（仅 Pending，仅本人）
  // ══════════════════════════════════════════════════════════════════
  async function withdrawChangeRequest(params: { changeRequestId: string; actorId: string }): Promise<OrderChangeResult<{ changeRequest: any }>> {
    const { changeRequestId, actorId } = params;

    const cr = await prisma.orderChangeRequest.findUnique({ where: { id: changeRequestId } });
    if (!cr || cr.deletedAt) {
      return fail(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_FOUND, `变更申请 ${changeRequestId} 不存在`, 404);
    }
    if (cr.status !== 'Pending') {
      return fail(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_PENDING, `变更申请当前状态 ${cr.status}，仅 Pending 可撤回`, 409);
    }
    if (cr.requesterId !== actorId) {
      return fail(ORDER_CHANGE_ERRORS.WITHDRAW_NOT_BY_REQUESTER, '仅申请人本人可撤回变更申请（§6 #9）', 403);
    }

    const order = await prisma.order.findUnique({ where: { id: cr.orderId } });
    const schemaType: string = cr.changeTypes?.[0] ?? 'other';
    const isPause = schemaType === 'other' && Boolean((cr as any).attachments?.pause);
    const isCancel = schemaType === 'other' && !isPause;

    // 恢复申请前状态：从 OrderStatusTransition 时间线回查最近一次进入 取消/暂停申请中 的 fromStatus（审计真源，不污染 beforeSnapshot）
    let restoreStatus: string | null = null;
    if ((isCancel || isPause) && order && (order.status === 'CancelRequested' || order.status === 'PauseRequested')) {
      const lastTransition = await prisma.orderStatusTransition.findFirst({
        where: { orderId: order.id, toStatus: order.status },
        orderBy: { createdAt: 'desc' },
      });
      const candidate = lastTransition?.fromStatus ?? null;
      restoreStatus = candidate && !DR010_GUARDED_STATUSES.has(candidate) && candidate !== 'Cancelled' ? candidate : 'Confirmed';
    }

    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const now = epochNow();
        const next = await tx.orderChangeRequest.update({
          where: { id: cr.id },
          data: { status: 'Cancelled' },
        });
        // 撤回关联审批单（防止审批人继续处理已撤回的申请）
        if (cr.approvalRequestId) {
          await tx.approvalRequest.updateMany({
            where: { id: cr.approvalRequestId, status: 'pending' },
            data: { status: 'cancelled', decidedAt: new Date(), decisionNote: `变更申请 ${cr.requestNumber} 已被申请人撤回` },
          });
        }
        // 订单从 取消申请中/暂停申请中 恢复申请前状态
        if (order && restoreStatus && (order.status === 'CancelRequested' || order.status === 'PauseRequested')) {
          await tx.order.update({ where: { id: order.id }, data: { status: restoreStatus, updatedAt: now } });
          await writeExtensionTransition(tx, order.id, order.status, restoreStatus, actorId, `${cr.requestNumber} 申请人撤回`);
        }
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:order-change:withdraw',
          operation: 'order_change_withdraw', targetType: 'OrderChangeRequest', targetId: cr.id,
          before: { status: 'Pending' },
          after: { status: 'Cancelled' },
        });
        return next;
      });
      logger.info('[OrderChange] 变更申请已撤回', { changeRequestId, actorId });
      return { ok: true, data: { changeRequest: updated } };
    } catch (e: any) {
      logger.error('[OrderChange] 撤回失败', { changeRequestId, error: e?.message });
      return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, `撤回事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // completeClosing — 结案处理完成（Closing → Cancelled）
  //   §2A.2 步骤 3b：完成供应商、物料、客户责任和财务损益处置后才可关闭
  // ══════════════════════════════════════════════════════════════════
  async function completeClosing(params: { orderId: string; actorId: string; note?: string }): Promise<OrderChangeResult<{ order: any }>> {
    const { orderId, actorId, note } = params;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_NOT_FOUND, `订单 ${orderId} 不存在或已删除`, 404);
    }
    if (order.status !== 'Closing') {
      return fail(ORDER_CHANGE_ERRORS.CLOSING_NOT_REQUIRED, `订单当前状态 ${order.status}，仅「结案处理中」可执行结案完成`, 409);
    }
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const now = epochNow();
        const next = await tx.order.update({ where: { id: orderId }, data: { status: 'Cancelled', updatedAt: now } });
        await writeExtensionTransition(tx, orderId, 'Closing', 'Cancelled', actorId, note ?? '结案处置完成（供应商/物料/客户责任/财务损益），订单关闭');
        await writeRouteAuditLog({
          prisma: tx, actorId, source: 'service:order-change:complete-closing',
          operation: 'order_closing_completed', targetType: 'Order', targetId: orderId,
          before: { status: 'Closing' },
          after: { status: 'Cancelled', note: note ?? null },
        });
        return next;
      });
      return { ok: true, data: { order: updated } };
    } catch (e: any) {
      return fail(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT, `结案完成事务失败: ${String(e?.message ?? e)}`, 500);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // checkPauseResumeDue — 暂停到期提醒接入点（scheduler 定期调用）
  //   §2A.3 步骤 3：到期未恢复自动提醒，禁止无限期挂起
  //   返回本次新标记的申请数；提醒投递（通知中心/邮件）由调度层按 resumeReminderFlagged=true 驱动
  // ══════════════════════════════════════════════════════════════════
  async function checkPauseResumeDue(params?: { today?: string }): Promise<{ flagged: number; orderIds: string[] }> {
    const today = params?.today ?? new Date().toISOString().slice(0, 10);
    // Paused 订单 + 暂停申请已 Applied + expectedResumeDate ≤ today + 未标记
    const pausedOrders = await prisma.order.findMany({ where: { status: 'Paused', deletedAt: null }, select: { id: true } });
    if (pausedOrders.length === 0) return { flagged: 0, orderIds: [] };
    const orderIds = pausedOrders.map((o: any) => o.id);

    const dueRequests = await prisma.orderChangeRequest.findMany({
      where: { orderId: { in: orderIds }, status: 'Applied', deletedAt: null },
      orderBy: { appliedAt: 'desc' },
    });
    const flaggedOrderIds: string[] = [];
    for (const cr of dueRequests) {
      const pause = (cr as any).attachments?.pause;
      if (!pause?.expectedResumeDate || pause.resumeReminderFlagged) continue;
      if (pause.expectedResumeDate <= today) {
        await prisma.orderChangeRequest.update({
          where: { id: cr.id },
          data: {
            attachments: {
              ...((cr as any).attachments ?? {}),
              pause: { ...pause, resumeReminderFlagged: true, resumeReminderFlaggedAt: new Date().toISOString() },
            } as any,
          },
        });
        flaggedOrderIds.push(cr.orderId);
      }
    }
    if (flaggedOrderIds.length > 0) {
      // 提醒投递（通知中心/邮件/升级 T+7 总领导）由调度层消费本函数返回值驱动；
      // BusinessEventType 联合类型属事件总线跨域所有权，本域不新增事件类型
      logger.warn('[OrderChange] 暂停到期未恢复，已标记提醒', { orderIds: flaggedOrderIds });
    }
    return { flagged: flaggedOrderIds.length, orderIds: flaggedOrderIds };
  }

  // ══════════════════════════════════════════════════════════════════
  // listChangeRequests / getChangeRequest — 只读查询（与 orderChangeRoute GET 同一合约真源）
  //   Agent 只读工具与路由共用本入口；纯查询，不触发审批链、不写库
  // ══════════════════════════════════════════════════════════════════
  async function listChangeRequests(filter: {
    orderId?: string;
    status?: string;
    requesterId?: string;
    limit?: number;
  }): Promise<{ items: any[] }> {
    const where: any = { deletedAt: null };
    if (filter.orderId) where.orderId = filter.orderId;
    if (filter.status) where.status = filter.status;
    if (filter.requesterId) where.requesterId = filter.requesterId;
    const items = await prisma.orderChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
    return { items };
  }

  async function getChangeRequest(id: string): Promise<{ item: any | null }> {
    const item = await prisma.orderChangeRequest.findUnique({ where: { id } });
    if (!item || item.deletedAt) return { item: null };
    // 关联数据单独查询（OrderChangeRequest 模型无 @relation，禁用 include）
    const [order, approvalRequest] = await Promise.all([
      prisma.order.findUnique({
        where: { id: item.orderId },
        select: { id: true, status: true, poNumber: true, customer: true },
      }).catch(() => null),
      item.approvalRequestId
        ? prisma.approvalRequest.findUnique({
            where: { id: item.approvalRequestId },
            select: { id: true, status: true, reviewerId: true, decidedAt: true, decisionNote: true },
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { item: { ...item, order, approvalRequest } };
  }

  return {
    createChangeRequest,
    applyChangeRequest,
    syncFromApprovalDecision,
    withdrawChangeRequest,
    completeClosing,
    checkPauseResumeDue,
    listChangeRequests,
    getChangeRequest,
  };
}

export type OrderChangeRequestService = ReturnType<typeof createOrderChangeRequestService>;
