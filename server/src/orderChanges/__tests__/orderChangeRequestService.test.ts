import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createOrderChangeRequestService,
  ORDER_CHANGE_ERRORS,
  APPROVED_ORDER_STATUSES,
} from '../orderChangeRequestService';

/**
 * DR-010 订单变更申请服务测试：
 *   create 校验（未批准订单拒绝 / 缺 before-after 拒绝 / 暂停必填 / 交期锁死）
 *   apply 幂等 / 客户变更额度联动 / 产品变更 PreCutChecklist 重置
 *   取消两阶段（无承诺直接结案 / 有承诺 Closing → completeClosing → Cancelled）
 *   暂停生效 + 到期提醒标记
 *   撤回（仅申请人 + 仅 Pending + 状态恢复）
 */

const VALID_REASON = '客户延迟确认产前样，需要调整订单内容';
const VALID_IMPACT = 'BOM 成本变化，回款延迟风险需评估';

function makePrisma(opts: {
  order?: any;
  changeRequest?: any;
  committedPoCount?: number;
  startedStageCount?: number;
  invoiceCount?: number;
  voucherCount?: number;
  creditLimits?: Record<string, any>;
  pauseTransitions?: any[];
} = {}) {
  const order = opts.order === undefined
    ? {
        id: 'ORD__1', status: 'Confirmed', deletedAt: null, quantity: 200,
        quoteAmount: 10000, totalNet: 10000, dueDate: '2026-10-05',
        customer: 'ABC 贸易', customerRelationId: 'REL_A', customerCode: 'ABC',
        product: 'Garment-X', poNumber: 'PO-2026-001',
        salesContractNumber: null, finalContractNumber: null,
        createdAt: BigInt(0), updatedAt: BigInt(0),
      }
    : opts.order;

  const creditLimits = opts.creditLimits ?? {};
  const calls = {
    orderUpdate: vi.fn(async ({ where, data }: any) => ({ ...order, ...data, id: where.id })),
    crCreate: vi.fn(async ({ data }: any) => ({ ...data, createdAt: new Date(), updatedAt: new Date() })),
    crUpdate: vi.fn(async ({ where, data }: any) => ({ ...(opts.changeRequest ?? {}), ...data, id: where.id })),
    transitionCreate: vi.fn(async () => ({})),
    auditCreate: vi.fn(async () => ({ id: 'AL-1' })),
    creditHistoryCreate: vi.fn(async ({ data }: any) => data),
    creditLimitUpdate: vi.fn(async ({ where, data }: any) => ({ ...Object.values(creditLimits)[0], ...data, id: where.id })),
    preCutUpdateMany: vi.fn(async () => ({ count: 1 })),
    approvalUpdateMany: vi.fn(async () => ({ count: 1 })),
  };

  const prisma: any = {
    order: {
      findUnique: vi.fn(async ({ where }: any) => (order && order.id === where.id ? order : null)),
      update: calls.orderUpdate,
      findMany: vi.fn(async ({ where }: any) =>
        where?.status === 'Paused' && order?.status === 'Paused' ? [order] : []),
    },
    orderChangeRequest: {
      count: vi.fn(async () => 0),
      create: calls.crCreate,
      findUnique: vi.fn(async ({ where }: any) =>
        opts.changeRequest && opts.changeRequest.id === where.id ? opts.changeRequest : null),
      update: calls.crUpdate,
      findMany: vi.fn(async () => (opts.changeRequest ? [opts.changeRequest] : [])),
    },
    orderStatusTransition: {
      create: calls.transitionCreate,
      findFirst: vi.fn(async () => (opts.pauseTransitions?.[0] ?? null)),
    },
    approvalRequest: { updateMany: calls.approvalUpdateMany },
    auditLog: { create: calls.auditCreate },
    purchaseOrder: { count: vi.fn(async ({ where }: any) =>
      where?.status ? (opts.committedPoCount ?? 0) : (opts.committedPoCount ?? 0)) },
    developmentCase: { findMany: vi.fn(async () => []) },
    sampleNode: { count: vi.fn(async () => 0) },
    productionStage: { count: vi.fn(async () => opts.startedStageCount ?? 0) },
    invoice: { count: vi.fn(async () => opts.invoiceCount ?? 0) },
    paymentVoucher: { count: vi.fn(async () => opts.voucherCount ?? 0) },
    creditLimit: {
      findFirst: vi.fn(async ({ where }: any) => creditLimits[where.relationId] ?? null),
      update: calls.creditLimitUpdate,
    },
    creditLimitHistory: { create: calls.creditHistoryCreate },
    preCutChecklist: { updateMany: calls.preCutUpdateMany },
    entityReference: { upsert: vi.fn(async () => ({})) },
    entityLink: { upsert: vi.fn(async () => ({})), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  return { prisma, calls, order };
}

function makeService(prisma: any) {
  const createBusinessApproval = vi.fn(async (input: any) => ({
    id: 'ar_1',
    reviewerId: 'u_supervisor',
    status: 'pending',
    ...input,
  }));
  const service = createOrderChangeRequestService({
    prisma,
    approvalCreateService: { createBusinessApproval } as any,
  });
  return { service, createBusinessApproval };
}

const baseCreateInput = {
  orderId: 'ORD__1',
  changeType: 'quantity' as const,
  beforeSnapshot: { quantity: 200 },
  afterDelta: { quantity: 180 },
  changeReason: VALID_REASON,
  impactSummary: VALID_IMPACT,
  requesterId: 'u_sales',
};

beforeEach(() => vi.clearAllMocks());

describe('createChangeRequest 校验（fail-closed）', () => {
  it('已批准状态集合 = Confirmed/Production/Shipping/Delivered', () => {
    expect(APPROVED_ORDER_STATUSES).toEqual(['Confirmed', 'Production', 'Shipping', 'Delivered']);
  });

  it('未批准订单（Pending 草稿）→ ORDER_NOT_APPROVED 400（OSM-010-C5：草稿不走本链）', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'Pending', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest(baseCreateInput);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_NOT_APPROVED);
      expect(res.error.statusCode).toBe(400);
    }
  });

  it('Alert 状态订单 → ORDER_NOT_APPROVED（非已批准承诺态）', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'Alert', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest(baseCreateInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_NOT_APPROVED);
  });

  it('订单不存在 → ORDER_NOT_FOUND 404', async () => {
    const { prisma } = makePrisma({ order: null });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest(baseCreateInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_NOT_FOUND);
  });

  it('订单处于取消申请中（DR-010 守卫态）→ ORDER_LIFECYCLE_GUARDED 409（禁止并发申请）', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'CancelRequested', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest(baseCreateInput);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_LIFECYCLE_GUARDED);
      expect(res.error.statusCode).toBe(409);
    }
  });

  it('缺 beforeSnapshot/afterDelta → MISSING_BEFORE_AFTER 400', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, afterDelta: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.MISSING_BEFORE_AFTER);
  });

  it('变更理由 <15 字 → REASON_TOO_SHORT 400', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, changeReason: '客户要改' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.REASON_TOO_SHORT);
  });

  it('影响说明 <10 字 → IMPACT_TOO_SHORT 400（DR-010 必须记录影响）', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, impactSummary: '没影响' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.IMPACT_TOO_SHORT);
  });

  it('非法变更类型 → INVALID_CHANGE_TYPE 400', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, changeType: 'bogus' as any });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.INVALID_CHANGE_TYPE);
  });

  it('Shipping 状态改交期 → ORDER_SHIPPING_LOCKED 409（L1 硬防篡改，需先回退 Confirmed）', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'Shipping', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({
      ...baseCreateInput,
      changeType: 'delivery',
      beforeSnapshot: { dueDate: '2026-09-15' },
      afterDelta: { dueDate: '2026-09-25' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_SHIPPING_LOCKED);
      expect(res.error.statusCode).toBe(409);
    }
  });

  it('Delivered 状态改交期 → ORDER_SHIPPING_LOCKED（终态同锁）', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'Delivered', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, changeType: 'delivery' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_SHIPPING_LOCKED);
  });

  it('暂停缺责任人/预计恢复日期 → PAUSE_FIELDS_REQUIRED 400（OSM-010-C4 三字段必填）', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, changeType: 'pause' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.PAUSE_FIELDS_REQUIRED);
  });

  it('暂停预计恢复日期早于今天 → PAUSE_RESUME_DATE_INVALID 400（禁止无限期挂起）', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.createChangeRequest({
      ...baseCreateInput,
      changeType: 'pause',
      pauseOwnerId: 'u_customer_pm',
      expectedResumeDate: '2020-01-01',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.PAUSE_RESUME_DATE_INVALID);
  });

  it('成功创建（quantity）：经 approvalCreateService 创建审批单 + 订单状态不变 + 审计写入', async () => {
    const { prisma, calls } = makePrisma();
    const { service, createBusinessApproval } = makeService(prisma);
    const res = await service.createChangeRequest(baseCreateInput);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.approvalRequestId).toBe('ar_1');
      expect(res.data.changeRequest.status).toBe('Pending');
      expect(res.data.changeRequest.reviewerId).toBe('u_supervisor'); // DR-007 服务端解析
      expect(res.data.changeRequest.changeTypes).toEqual(['quantity']);
    }
    // 审批单创建走 approvalCreateService（禁止手写 reviewerId）
    expect(createBusinessApproval).toHaveBeenCalledTimes(1);
    expect(createBusinessApproval.mock.calls[0][0].actionType).toBe('order:change');
    expect(createBusinessApproval.mock.calls[0][0].payload.hitChangeTypes).toEqual(['quantity']);
    // 非 cancel/pause：订单状态不变
    expect(calls.orderUpdate).not.toHaveBeenCalled();
    expect(calls.auditCreate).toHaveBeenCalled();
  });

  it('成功创建（cancel）：订单进入 CancelRequested + 影响汇总写入 + transition 留痕（OSM-010-C3 步骤1）', async () => {
    const { prisma, calls } = makePrisma({ committedPoCount: 1 });
    const { service, createBusinessApproval } = makeService(prisma);
    const res = await service.createChangeRequest({ ...baseCreateInput, changeType: 'cancel' });
    expect(res.ok).toBe(true);
    expect(createBusinessApproval.mock.calls[0][0].actionType).toBe('order:cancel');
    expect(createBusinessApproval.mock.calls[0][0].payload.cancelImpact.hasIrreversibleCommitments).toBe(true);
    expect(calls.orderUpdate).toHaveBeenCalledTimes(1);
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('CancelRequested');
    expect(calls.transitionCreate).toHaveBeenCalledTimes(1);
    expect(calls.transitionCreate.mock.calls[0][0].data.toStatus).toBe('CancelRequested');
  });

  it('成功创建（pause）：订单进入 PauseRequested + attachments.pause 三字段齐备', async () => {
    const { prisma, calls } = makePrisma({ order: { id: 'ORD__1', status: 'Production', deletedAt: null } });
    const { service, createBusinessApproval } = makeService(prisma);
    const res = await service.createChangeRequest({
      ...baseCreateInput,
      changeType: 'pause',
      pauseReason: '客户要求暂停生产等待新的颜色打样',
      pauseOwnerId: 'u_customer_pm',
      expectedResumeDate: '2026-09-15',
    });
    expect(res.ok).toBe(true);
    expect(createBusinessApproval.mock.calls[0][0].actionType).toBe('order:pause');
    if (res.ok) {
      const pause = (res.data.changeRequest.attachments as any).pause;
      expect(pause.pauseOwnerId).toBe('u_customer_pm');
      expect(pause.expectedResumeDate).toBe('2026-09-15');
      expect(pause.resumeReminderFlagged).toBe(false);
    }
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('PauseRequested');
  });
});

describe('applyChangeRequest（审批通过后生效）', () => {
  const approvedCr = (over: any = {}) => ({
    id: 'OCR_1',
    orderId: 'ORD__1',
    requestNumber: 'OCR-20260816-001',
    status: 'Approved',
    changeTypes: ['quantity'],
    beforeSnapshot: { quantity: 200 },
    afterDelta: { quantity: 180 },
    approvalRequestId: 'ar_1',
    requesterId: 'u_sales',
    deletedAt: null,
    attachments: null,
    ...over,
  });

  it('重复 apply → ALREADY_APPLIED 409（幂等，不产生二次写入）', async () => {
    const { prisma, calls } = makePrisma({ changeRequest: approvedCr({ status: 'Applied', appliedAt: new Date() }) });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ALREADY_APPLIED);
    expect(calls.orderUpdate).not.toHaveBeenCalled();
  });

  it('非 Approved（Pending）→ CHANGE_REQUEST_NOT_APPROVED 409', async () => {
    const { prisma } = makePrisma({ changeRequest: approvedCr({ status: 'Pending' }) });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_APPROVED);
  });

  it('申请不存在 → CHANGE_REQUEST_NOT_FOUND 404', async () => {
    const { prisma } = makePrisma({ changeRequest: null });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_X', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_FOUND);
  });

  it('数量变更生效：Order.quantity 写入 + 字段级 AuditLog（before/after + transactionId=approvalRequestId）+ CR→Applied', async () => {
    const { prisma, calls } = makePrisma({ changeRequest: approvedCr() });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    expect(calls.orderUpdate).toHaveBeenCalledTimes(1);
    expect(calls.orderUpdate.mock.calls[0][0].data.quantity).toBe(180);
    // §4.1 字段级审计：order_change_approved + fieldPath=quantity + transactionId 串联审批单
    const fieldAudit = calls.auditCreate.mock.calls.find((c: any) => c[0].data.action === 'order_change_approved');
    expect(fieldAudit).toBeTruthy();
    expect(fieldAudit[0].data.fieldPath).toBe('quantity');
    expect(fieldAudit[0].data.beforeValue).toBe(200);
    expect(fieldAudit[0].data.afterValue).toBe(180);
    expect(fieldAudit[0].data.transactionId).toBe('ar_1');
    expect(calls.crUpdate.mock.calls.at(-1)![0].data.status).toBe('Applied');
  });

  it('客户变更生效：旧客户额度释放 + 新客户额度占用（CreditLimitHistory 双向留痕）', async () => {
    const creditLimits = {
      REL_A: { id: 'CL_A', relationId: 'REL_A', usedAmount: 120000, status: 'Active', deletedAt: null, createdAt: BigInt(1) },
      REL_B: { id: 'CL_B', relationId: 'REL_B', usedAmount: 50000, status: 'Active', deletedAt: null, createdAt: BigInt(1) },
    };
    const { prisma, calls } = makePrisma({
      creditLimits,
      changeRequest: approvedCr({
        changeTypes: ['customer'],
        beforeSnapshot: { customerRelationId: 'REL_A' },
        afterDelta: { customerRelationId: 'REL_B', customer: 'XYZ 时尚' },
      }),
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    // 订单金额 10000（totalNet）：REL_A 释放 -10000，REL_B 占用 +10000
    const deltas = calls.creditHistoryCreate.mock.calls.map((c: any) => ({
      relationId: c[0].data.relationId, delta: c[0].data.delta, triggerType: c[0].data.triggerType,
    }));
    expect(deltas).toContainEqual({ relationId: 'REL_A', delta: -10000, triggerType: 'order_change_customer' });
    expect(deltas).toContainEqual({ relationId: 'REL_B', delta: 10000, triggerType: 'order_change_customer' });
    expect(calls.creditLimitUpdate).toHaveBeenCalledTimes(2);
    // 订单客户字段更新
    expect(calls.orderUpdate.mock.calls[0][0].data.customerRelationId).toBe('REL_B');
  });

  it('产品变更生效：PreCutChecklist 4 项全部重置（§9.3 质量门禁联动）', async () => {
    const { prisma, calls } = makePrisma({
      changeRequest: approvedCr({
        changeTypes: ['product_spec'],
        beforeSnapshot: { product: 'Garment-X' },
        afterDelta: { product: 'Garment-Y' },
      }),
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    expect(calls.preCutUpdateMany).toHaveBeenCalledTimes(1);
    const reset = calls.preCutUpdateMany.mock.calls[0][0].data;
    expect(reset.gradingConfirmed).toBe(false);
    expect(reset.consumptionConfirmed).toBe(false);
    expect(reset.patternConfirmed).toBe(false);
    expect(reset.preProductionMeeting).toBe(false);
  });

  it('审批期间订单推进到 Shipping → 交期变更 apply 仍被 ORDER_SHIPPING_LOCKED 拦截（硬锁二次校验）', async () => {
    const { prisma } = makePrisma({
      order: { id: 'ORD__1', status: 'Shipping', deletedAt: null },
      changeRequest: approvedCr({
        changeTypes: ['deliveryDate'],
        beforeSnapshot: { dueDate: '2026-09-15' },
        afterDelta: { dueDate: '2026-09-25' },
      }),
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_SHIPPING_LOCKED);
  });

  it('取消生效（无不可逆承诺）→ 订单直接 Cancelled 结案关闭（§2A.2 步骤 3a）', async () => {
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'CancelRequested', deletedAt: null },
      changeRequest: approvedCr({ changeTypes: ['other'], attachments: null }),
      committedPoCount: 0, startedStageCount: 0, invoiceCount: 0, voucherCount: 0,
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.applied).toBe('cancel_closed_direct');
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('Cancelled');
    expect(calls.transitionCreate.mock.calls[0][0].data.toStatus).toBe('Cancelled');
  });

  it('取消生效（有采购承诺）→ 订单进 Closing 结案处理中，不直接关闭（§2A.2 步骤 3b）', async () => {
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'CancelRequested', deletedAt: null },
      changeRequest: approvedCr({ changeTypes: ['other'], attachments: null }),
      committedPoCount: 2,
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.applied).toBe('cancel_to_closing');
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('Closing');
  });

  it('取消生效时订单不在 CancelRequested → ORDER_STATUS_CONFLICT 409', async () => {
    const { prisma } = makePrisma({
      order: { id: 'ORD__1', status: 'Confirmed', deletedAt: null },
      changeRequest: approvedCr({ changeTypes: ['other'], attachments: null }),
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.ORDER_STATUS_CONFLICT);
  });

  it('暂停生效：订单 → Paused + attachments.pause 记录 pausedAt（§2A.3 步骤 3）', async () => {
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'PauseRequested', deletedAt: null },
      changeRequest: approvedCr({
        changeTypes: ['other'],
        attachments: { pause: { pauseReason: '客户要求暂停', pauseOwnerId: 'u_pm', expectedResumeDate: '2026-09-15', resumeReminderFlagged: false } },
      }),
    });
    const { service } = makeService(prisma);
    const res = await service.applyChangeRequest({ changeRequestId: 'OCR_1', appliedBy: 'u_supervisor' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.applied).toBe('pause_activated');
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('Paused');
  });
});

describe('withdrawChangeRequest（申请人撤回）', () => {
  const pendingCr = (over: any = {}) => ({
    id: 'OCR_1', orderId: 'ORD__1', requestNumber: 'OCR-20260816-001',
    status: 'Pending', changeTypes: ['other'], approvalRequestId: 'ar_1',
    requesterId: 'u_sales', deletedAt: null, attachments: null, ...over,
  });

  it('非申请人撤回 → WITHDRAW_NOT_BY_REQUESTER 403', async () => {
    const { prisma } = makePrisma({ changeRequest: pendingCr() });
    const { service } = makeService(prisma);
    const res = await service.withdrawChangeRequest({ changeRequestId: 'OCR_1', actorId: 'u_other' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.WITHDRAW_NOT_BY_REQUESTER);
  });

  it('非 Pending（已 Approved）→ CHANGE_REQUEST_NOT_PENDING 409（审批人已批准不可撤回）', async () => {
    const { prisma } = makePrisma({ changeRequest: pendingCr({ status: 'Approved' }) });
    const { service } = makeService(prisma);
    const res = await service.withdrawChangeRequest({ changeRequestId: 'OCR_1', actorId: 'u_sales' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.CHANGE_REQUEST_NOT_PENDING);
  });

  it('成功撤回（取消申请）：CR→Cancelled + 关联审批单取消 + 订单恢复申请前状态（时间线 fromStatus 回查）', async () => {
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'CancelRequested', deletedAt: null },
      changeRequest: pendingCr(),
      pauseTransitions: [{ fromStatus: 'Confirmed', toStatus: 'CancelRequested' }],
    });
    const { service } = makeService(prisma);
    const res = await service.withdrawChangeRequest({ changeRequestId: 'OCR_1', actorId: 'u_sales' });
    expect(res.ok).toBe(true);
    expect(calls.crUpdate.mock.calls[0][0].data.status).toBe('Cancelled');
    expect(calls.approvalUpdateMany).toHaveBeenCalledTimes(1);
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('Confirmed');
  });
});

describe('completeClosing（结案处理完成 → 关闭）', () => {
  it('Closing 订单 → Cancelled + 审计留痕', async () => {
    const { prisma, calls } = makePrisma({ order: { id: 'ORD__1', status: 'Closing', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.completeClosing({ orderId: 'ORD__1', actorId: 'u_supervisor', note: '供应商合同撤销完成，财务损益已确认' });
    expect(res.ok).toBe(true);
    expect(calls.orderUpdate.mock.calls[0][0].data.status).toBe('Cancelled');
    expect(calls.transitionCreate.mock.calls[0][0].data.toStatus).toBe('Cancelled');
  });

  it('非 Closing 状态 → CLOSING_NOT_REQUIRED 409', async () => {
    const { prisma } = makePrisma({ order: { id: 'ORD__1', status: 'Confirmed', deletedAt: null } });
    const { service } = makeService(prisma);
    const res = await service.completeClosing({ orderId: 'ORD__1', actorId: 'u_supervisor' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ORDER_CHANGE_ERRORS.CLOSING_NOT_REQUIRED);
  });
});

describe('checkPauseResumeDue（暂停到期提醒，scheduler 接入点）', () => {
  it('到期未恢复 → resumeReminderFlagged=true 标记 + 返回订单列表', async () => {
    const appliedPauseCr = {
      id: 'OCR_1', orderId: 'ORD__1', status: 'Applied', deletedAt: null,
      attachments: { pause: { pauseReason: '客户要求暂停', pauseOwnerId: 'u_pm', expectedResumeDate: '2026-08-01', resumeReminderFlagged: false } },
    };
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'Paused', deletedAt: null },
      changeRequest: appliedPauseCr,
    });
    const { service } = makeService(prisma);
    const res = await service.checkPauseResumeDue({ today: '2026-08-16' });
    expect(res.flagged).toBe(1);
    expect(res.orderIds).toEqual(['ORD__1']);
    const updateData = calls.crUpdate.mock.calls[0][0].data;
    expect(updateData.attachments.pause.resumeReminderFlagged).toBe(true);
  });

  it('未到期 → 不标记', async () => {
    const appliedPauseCr = {
      id: 'OCR_1', orderId: 'ORD__1', status: 'Applied', deletedAt: null,
      attachments: { pause: { pauseReason: '客户要求暂停', pauseOwnerId: 'u_pm', expectedResumeDate: '2026-09-01', resumeReminderFlagged: false } },
    };
    const { prisma, calls } = makePrisma({
      order: { id: 'ORD__1', status: 'Paused', deletedAt: null },
      changeRequest: appliedPauseCr,
    });
    const { service } = makeService(prisma);
    const res = await service.checkPauseResumeDue({ today: '2026-08-16' });
    expect(res.flagged).toBe(0);
    expect(calls.crUpdate).not.toHaveBeenCalled();
  });

  it('无暂停中订单 → flagged=0（空扫）', async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const res = await service.checkPauseResumeDue();
    expect(res.flagged).toBe(0);
  });
});
