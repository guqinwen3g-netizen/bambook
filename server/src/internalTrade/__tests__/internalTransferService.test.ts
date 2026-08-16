import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createInternalTransferService,
  decodeInternalTransferPayload,
  INTERNAL_TRANSFER_ERRORS,
} from '../internalTransferService';

/**
 * DR-033 内部供料单服务测试：
 *   create 必填/越界校验 + 双订单校验 + 方向唯一 + 结算价审批链
 *   confirm 生效门槛（未批准结算价不生效）+ 生效后双方 OrderLine.internalTransferPrice 回写
 *   registerDelivery 分批出运/到货回写/差异追溯/超发拒绝/运单归属守卫
 *   cancel 状态守卫 + 状态机非法迁移 fail-closed
 *   list/get 查询（按部门/状态/面料订单）
 */

function makePrisma(opts: {
  orders?: any[];
  orderLines?: any[];
  shipments?: any[];
  approvals?: any[];
  transfers?: any[];
} = {}) {
  const transfers: any[] = opts.transfers ?? [];
  const orderLines: any[] = opts.orderLines ?? [];
  const shipments: any[] = opts.shipments ?? [];
  const approvals: any[] = opts.approvals ?? [];
  const auditLogs: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const calls = {
    transferCreate: [] as any[],
    transferUpdate: [] as any[],
    orderLineUpdateMany: [] as any[],
    approvalUpdateMany: [] as any[],
  };

  const prisma: any = {
    order: {
      findUnique: vi.fn(async ({ where }: any) =>
        (opts.orders ?? []).find((o) => o.id === where.id) ?? null),
    },
    orderInternalTransfer: {
      create: vi.fn(async ({ data }: any) => {
        // 模拟 @@unique([orderId, transferDirection])
        const dup = transfers.find(
          (t) => t.orderId === data.orderId && t.transferDirection === data.transferDirection && !t.deletedAt,
        );
        if (dup) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = { ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, recognizedBy: data.recognizedBy ?? null, recognizedAt: data.recognizedAt ?? null };
        transfers.push(row);
        calls.transferCreate.push(data);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => transfers.find((t) => t.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => transfers.find((t) => matchWhere(t, where)) ?? null),
      findMany: vi.fn(async ({ where, orderBy }: any = {}) => {
        let rows = transfers.filter((t) => matchWhere(t, where));
        if (orderBy?.createdAt === 'desc') rows = [...rows].reverse();
        return rows;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = transfers.find((t) => t.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        calls.transferUpdate.push({ where, data });
        return row;
      }),
    },
    orderLine: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const l of orderLines) {
          if (matchWhere(l, where)) { Object.assign(l, data); count += 1; }
        }
        calls.orderLineUpdateMany.push({ where, data });
        return { count };
      }),
    },
    shipment: {
      findUnique: vi.fn(async ({ where }: any) => shipments.find((s) => s.id === where.id) ?? null),
    },
    approvalRequest: {
      findUnique: vi.fn(async ({ where }: any) => approvals.find((a) => a.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const a of approvals) {
          if (matchWhere(a, where)) { Object.assign(a, data); count += 1; }
        }
        calls.approvalUpdateMany.push({ where, data });
        return { count };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => { auditLogs.push(data); return { id: `alog_${auditLogs.length}` }; }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  return { prisma, calls, transfers, orderLines, shipments, approvals, auditLogs };
}

const GARMENT_ORDER = { id: 'G1', deletedAt: null, isInternalFabricTrade: false, businessLine: 'garment' };
const FABRIC_ORDER = { id: 'F1', deletedAt: null, isInternalFabricTrade: true, businessLine: 'fabric', internalCounterpartyId: 'CP-INTERNAL' };

function baseOrders() {
  return [{ ...GARMENT_ORDER }, { ...FABRIC_ORDER }];
}

function baseLines() {
  return [
    { id: 'GL1', orderId: 'G1', materialCode: 'M100', quantity: 1000, shipmentQuantity: null, shippingDate: null, status: 'Pending', internalTransferPrice: null },
    { id: 'FL1', orderId: 'F1', materialCode: 'M100', quantity: 1000, shipmentQuantity: null, shippingDate: null, status: 'Pending', internalTransferPrice: null },
  ];
}

const VALID_INPUT = {
  requestDepartmentId: 'dept_garment',
  supplyDepartmentId: 'dept_fabric',
  garmentOrderId: 'G1',
  fabricOrderId: 'F1',
  materialCode: 'M100',
  quantity: 1000,
  unit: 'm',
  settlementPrice: 30,
  dueDate: '2026-09-01',
  requesterId: 'u_sales',
};

function makeService(prisma: any, approvalOverride?: any) {
  const createBusinessApproval = approvalOverride ?? vi.fn(async (input: any) => ({
    id: 'ar_1', reviewerId: 'u_mgr', status: 'pending', ...input,
  }));
  const service = createInternalTransferService({
    prisma,
    approvalCreateService: { createBusinessApproval } as any,
  });
  return { service, createBusinessApproval };
}

/** 快捷：创建一张 PendingConfirm 供料单并返回上下文 */
async function seedPendingTransfer(opts: { approvals?: any[] } = {}) {
  const ctx = makePrisma({ orders: baseOrders(), orderLines: baseLines(), approvals: opts.approvals ?? [] });
  const { service, createBusinessApproval } = makeService(ctx.prisma);
  const created = await service.createInternalTransfer(VALID_INPUT);
  if (!created.ok) throw new Error(`seed failed: ${created.error.code}`);
  return { ...ctx, service, createBusinessApproval, created: created.data };
}

/** 快捷：创建 + 批准 + 确认生效 */
async function seedEffectiveTransfer() {
  const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'approved' }] });
  const confirmed = await ctx.service.confirmInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_fabric' });
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.error.code}`);
  return { ...ctx, confirmed: confirmed.data };
}

describe('createInternalTransfer 发起', () => {
  it('必填缺失 → 400 MISSING_REQUIRED_FIELD（列出缺失字段）', async () => {
    const { prisma } = makePrisma({ orders: baseOrders() });
    const { service } = makeService(prisma);
    const res = await service.createInternalTransfer({ ...VALID_INPUT, supplyDepartmentId: '', materialCode: '', dueDate: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.MISSING_REQUIRED_FIELD);
      expect(res.error.message).toContain('supplyDepartmentId');
      expect(res.error.message).toContain('materialCode');
      expect(res.error.message).toContain('dueDate');
      expect(res.error.statusCode).toBe(400);
    }
  });

  it('数量/结算价非正数、交期格式非法 → 400', async () => {
    const { prisma } = makePrisma({ orders: baseOrders() });
    const { service } = makeService(prisma);
    const badQty = await service.createInternalTransfer({ ...VALID_INPUT, quantity: 0 });
    expect(!badQty.ok && badQty.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_QUANTITY);
    const badPrice = await service.createInternalTransfer({ ...VALID_INPUT, settlementPrice: -5 });
    expect(!badPrice.ok && badPrice.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_SETTLEMENT_PRICE);
    const badDate = await service.createInternalTransfer({ ...VALID_INPUT, dueDate: '2026/09/01' });
    expect(!badDate.ok && badDate.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_DUE_DATE);
  });

  it('服装订单不存在 → 404 GARMENT_ORDER_NOT_FOUND', async () => {
    const { prisma } = makePrisma({ orders: [{ ...FABRIC_ORDER }] });
    const { service } = makeService(prisma);
    const res = await service.createInternalTransfer(VALID_INPUT);
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.GARMENT_ORDER_NOT_FOUND);
    expect(!res.ok && res.error.statusCode).toBe(404);
  });

  it('面料订单未标记 isInternalFabricTrade → 400 FABRIC_ORDER_NOT_INTERNAL_TRADE（fail-closed）', async () => {
    const { prisma } = makePrisma({
      orders: [{ ...GARMENT_ORDER }, { ...FABRIC_ORDER, isInternalFabricTrade: false }],
    });
    const { service } = makeService(prisma);
    const res = await service.createInternalTransfer(VALID_INPUT);
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.FABRIC_ORDER_NOT_INTERNAL_TRADE);
  });

  it('服装订单自身为内部交易订单 → 400 GARMENT_ORDER_INTERNAL_CONFLICT', async () => {
    const { prisma } = makePrisma({
      orders: [{ ...GARMENT_ORDER, isInternalFabricTrade: true }, { ...FABRIC_ORDER }],
    });
    const { service } = makeService(prisma);
    const res = await service.createInternalTransfer(VALID_INPUT);
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.GARMENT_ORDER_INTERNAL_CONFLICT);
  });

  it('成功发起 → master(incoming/服装订单) + mirror(outgoing/面料订单) 双向关联 + 结算价审批单', async () => {
    const { prisma, calls, transfers } = makePrisma({ orders: baseOrders(), orderLines: baseLines() });
    const { service, createBusinessApproval } = makeService(prisma);
    const res = await service.createInternalTransfer(VALID_INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 双向记录
    expect(transfers).toHaveLength(2);
    const master = transfers.find((t) => t.transferDirection === 'incoming')!;
    const mirror = transfers.find((t) => t.transferDirection === 'outgoing')!;
    expect(master.orderId).toBe('G1');
    expect(master.ourDepartmentId).toBe('dept_garment');
    expect(master.counterpartyId).toBe('dept_fabric');
    expect(mirror.orderId).toBe('F1');
    expect(mirror.ourDepartmentId).toBe('dept_fabric');
    // 金额 = 结算价 × 数量
    expect(Number(master.transferAmount)).toBe(30000);
    expect(Number(mirror.transferAmount)).toBe(30000);

    // 载荷状态机：PendingConfirm（Draft → PendingConfirm 已留痕）
    const payload = decodeInternalTransferPayload(master.memo)!;
    expect(payload.status).toBe('PendingConfirm');
    expect(payload.history[0]).toMatchObject({ from: 'Draft', to: 'PendingConfirm' });
    expect(payload.mirrorId).toBe(mirror.id);

    // 审批链：actionType + targetType + payload（DR-006 内部结算价审批）
    expect(createBusinessApproval).toHaveBeenCalledTimes(1);
    const approvalInput = createBusinessApproval.mock.calls[0][0];
    expect(approvalInput.actionType).toBe('order:internal_trade_price');
    expect(approvalInput.targetType).toBe('OrderInternalTransfer');
    expect(approvalInput.payload.settlementPrice).toBe(30);
    expect(res.data.approvalRequestId).toBe('ar_1');
    expect(payload.settlementApprovalId).toBe('ar_1');
    expect(calls.transferCreate).toHaveLength(2);
  });

  it('方向唯一：同一服装订单重复发起 incoming → 409 TRANSFER_ALREADY_EXISTS', async () => {
    const ctx = await seedPendingTransfer();
    const res = await ctx.service.createInternalTransfer(VALID_INPUT);
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.TRANSFER_ALREADY_EXISTS);
    expect(!res.ok && res.error.statusCode).toBe(409);
  });

  it('审批路由解析失败（NO_REVIEWER_RESOLVED）→ 409 透传，不落库', async () => {
    const { prisma, transfers } = makePrisma({ orders: baseOrders() });
    const noReviewer = Object.assign(new Error('无法解析审批人'), { code: 'NO_REVIEWER_RESOLVED' });
    const { service } = makeService(prisma, vi.fn(async () => { throw noReviewer; }));
    const res = await service.createInternalTransfer(VALID_INPUT);
    expect(!res.ok && res.error.code).toBe('NO_REVIEWER_RESOLVED');
    expect(!res.ok && res.error.statusCode).toBe(409);
    expect(transfers).toHaveLength(0);
  });
});

describe('confirmInternalTransfer 生效门槛', () => {
  it('结算价审批 pending → 409 SETTLEMENT_PRICE_NOT_APPROVED（未批准不生效，fail-closed）', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'pending' }] });
    const res = await ctx.service.confirmInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_fabric' });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SETTLEMENT_PRICE_NOT_APPROVED);
    expect(!res.ok && res.error.statusCode).toBe(409);
    // 状态未变
    const payload = decodeInternalTransferPayload(ctx.transfers[0].memo)!;
    expect(payload.status).toBe('PendingConfirm');
  });

  it('结算价审批 rejected → 409 SETTLEMENT_PRICE_NOT_APPROVED', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'rejected' }] });
    const res = await ctx.service.confirmInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_fabric' });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SETTLEMENT_PRICE_NOT_APPROVED);
  });

  it('非 PendingConfirm 状态确认 → 409 INVALID_TRANSFER_STATE', async () => {
    const ctx = await seedEffectiveTransfer();
    const res = await ctx.service.confirmInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_fabric' });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE);
  });

  it('供料单不存在 → 404 TRANSFER_NOT_FOUND', async () => {
    const { prisma } = makePrisma({ orders: baseOrders() });
    const { service } = makeService(prisma);
    const res = await service.confirmInternalTransfer({ id: 'OIT__MISSING', actorId: 'u' });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.TRANSFER_NOT_FOUND);
    expect(!res.ok && res.error.statusCode).toBe(404);
  });

  it('审批通过 + 面料部确认 → Effective：认账落库 + 双方 OrderLine.internalTransferPrice 回写（双向关联独立核算）+ mirror 同步', async () => {
    const ctx = await seedEffectiveTransfer();
    const master = ctx.transfers.find((t) => t.transferDirection === 'incoming')!;
    const mirror = ctx.transfers.find((t) => t.transferDirection === 'outgoing')!;
    const payload = decodeInternalTransferPayload(master.memo)!;

    expect(payload.status).toBe('Effective');
    expect(payload.confirmedQuantity).toBe(1000);
    expect(payload.confirmedDueDate).toBe('2026-09-01');
    expect(payload.confirmedBy).toBe('u_fabric');
    expect(master.recognizedBy).toBe('u_fabric');
    expect(master.recognizedAt).toBeTruthy();
    // mirror 同步
    expect(decodeInternalTransferPayload(mirror.memo)!.status).toBe('Effective');

    // 双方订单行回写内部结算价：服装订单=面料成本依据，面料订单=内部收入依据
    const gl = ctx.orderLines.find((l) => l.id === 'GL1')!;
    const fl = ctx.orderLines.find((l) => l.id === 'FL1')!;
    expect(Number(gl.internalTransferPrice)).toBe(30);
    expect(Number(fl.internalTransferPrice)).toBe(30);
    expect(ctx.calls.orderLineUpdateMany).toHaveLength(2);
  });

  it('面料部确认时调整数量/交期 → transferAmount 按确认数量重算', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'approved' }] });
    const res = await ctx.service.confirmInternalTransfer({
      id: ctx.created.transfer.id, actorId: 'u_fabric', confirmedQuantity: 800, confirmedDueDate: '2026-09-15',
    });
    expect(res.ok).toBe(true);
    const master = ctx.transfers.find((t) => t.transferDirection === 'incoming')!;
    expect(Number(master.transferAmount)).toBe(24000); // 30 × 800
    const payload = decodeInternalTransferPayload(master.memo)!;
    expect(payload.confirmedQuantity).toBe(800);
    expect(payload.confirmedDueDate).toBe('2026-09-15');
  });
});

describe('registerDelivery 交付登记（面料订单既有出运状态机）', () => {
  const SHIPMENT = { id: 'SH1', shipmentNumber: 'SHP-2026-001', orderId: 'F1', status: 'Shipped', deletedAt: null };

  it('未生效（PendingConfirm）登记交付 → 409 INVALID_TRANSFER_STATE', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'approved' }] });
    const res = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH1', quantity: 100,
    });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE);
  });

  it('运单不存在/已取消 → 404 SHIPMENT_NOT_FOUND', async () => {
    const ctx = await seedEffectiveTransfer();
    const res = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH_X', quantity: 100,
    });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_FOUND);
    const cancelled = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH_C', quantity: 100,
    });
    ctx.shipments.push({ id: 'SH_C', shipmentNumber: 'X', orderId: 'F1', status: 'Cancelled', deletedAt: null });
    const res2 = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH_C', quantity: 100,
    });
    expect(!cancelled.ok && cancelled.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_FOUND);
    expect(!res2.ok && res2.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_FOUND);
  });

  it('运单不属于关联面料订单 → 409 SHIPMENT_NOT_OF_FABRIC_ORDER（禁止平行出库）', async () => {
    const ctx = await seedEffectiveTransfer();
    ctx.shipments.push({ ...SHIPMENT, id: 'SH_OTHER', orderId: 'G1' });
    const res = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH_OTHER', quantity: 100,
    });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.SHIPMENT_NOT_OF_FABRIC_ORDER);
    expect(!res.ok && res.error.statusCode).toBe(409);
  });

  it('累计交付超确认数量 → 409 OVER_DELIVERY（禁止超发）', async () => {
    const ctx = await seedEffectiveTransfer();
    ctx.shipments.push({ ...SHIPMENT });
    const res = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH1', quantity: 1001,
    });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.OVER_DELIVERY);
  });

  it('分批出运 + 分批到货 + 差异追溯 + 服装订单行到货回写（PartiallyArrived → Arrived → Closed）', async () => {
    const ctx = await seedEffectiveTransfer();
    ctx.shipments.push({ ...SHIPMENT }, { ...SHIPMENT, id: 'SH2', shipmentNumber: 'SHP-2026-002' });
    const id = ctx.created.transfer.id;

    // 第一批：出运 600，到货 580（差异 -20）
    const d1 = await ctx.service.registerDelivery({
      id, actorId: 'u_fabric', shipmentId: 'SH1', quantity: 600, deliveryDate: '2026-08-20',
      receivedQuantity: 580, receivedDate: '2026-08-22',
      packingLines: [{ cartonNo: '1-20', quantity: 600, grossWeight: 720 }],
    });
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    expect(d1.data.status).toBe('Delivering');
    expect(d1.data.cumulativeDelivered).toBe(600);
    expect(d1.data.delivery.variance).toBe(-20); // 差异追溯
    expect(d1.data.delivery.shipmentNumber).toBe('SHP-2026-001');
    expect(d1.data.delivery.packingLines).toHaveLength(1); // 装箱明细数据

    // 服装订单行回写：累计出运量 + 最近交付日期 + 分批到货状态
    const gl = ctx.orderLines.find((l) => l.id === 'GL1')!;
    expect(Number(gl.shipmentQuantity)).toBe(600);
    expect(gl.shippingDate).toBe('2026-08-20');
    expect(gl.status).toBe('PartiallyArrived');

    // 第二批：出运 400（累计 1000 = 确认数量）→ Closed
    const d2 = await ctx.service.registerDelivery({
      id, actorId: 'u_fabric', shipmentId: 'SH2', quantity: 400, deliveryDate: '2026-08-25', receivedQuantity: 400,
    });
    expect(d2.ok).toBe(true);
    if (!d2.ok) return;
    expect(d2.data.status).toBe('Closed');
    expect(d2.data.cumulativeDelivered).toBe(1000);
    expect(d2.data.payload.deliveries).toHaveLength(2);

    // 累计到货 980 ≥ 确认 1000？否（980 < 1000）→ 仍 PartiallyArrived（差异 -20 保留追溯）
    expect(gl.status).toBe('PartiallyArrived');
    expect(Number(gl.shipmentQuantity)).toBe(1000);
    expect(gl.shippingDate).toBe('2026-08-25');

    // mirror 同步关闭
    const mirror = ctx.transfers.find((t) => t.transferDirection === 'outgoing')!;
    expect(decodeInternalTransferPayload(mirror.memo)!.status).toBe('Closed');

    // Closed 后禁止追加交付
    const d3 = await ctx.service.registerDelivery({ id, actorId: 'u_fabric', shipmentId: 'SH2', quantity: 1 });
    expect(!d3.ok && d3.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE);
  });

  it('到货累计达确认数量 → 服装订单行状态 Arrived', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'approved' }] });
    await ctx.service.confirmInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_fabric', confirmedQuantity: 500 });
    ctx.shipments.push({ ...SHIPMENT });
    const res = await ctx.service.registerDelivery({
      id: ctx.created.transfer.id, actorId: 'u_fabric', shipmentId: 'SH1', quantity: 500, receivedQuantity: 500,
    });
    expect(res.ok).toBe(true);
    const gl = ctx.orderLines.find((l) => l.id === 'GL1')!;
    expect(gl.status).toBe('Arrived');
  });
});

describe('cancelInternalTransfer 取消', () => {
  it('PendingConfirm 可取消 + 待决审批单同步取消', async () => {
    const ctx = await seedPendingTransfer({ approvals: [{ id: 'ar_1', status: 'pending' }] });
    const res = await ctx.service.cancelInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_sales', reason: '客户需求取消' });
    expect(res.ok).toBe(true);
    const payload = decodeInternalTransferPayload(ctx.transfers[0].memo)!;
    expect(payload.status).toBe('Cancelled');
    expect(ctx.approvals[0].status).toBe('cancelled');
  });

  it('Effective 后禁止取消 → 409（须走订单变更/例外链）', async () => {
    const ctx = await seedEffectiveTransfer();
    const res = await ctx.service.cancelInternalTransfer({ id: ctx.created.transfer.id, actorId: 'u_sales' });
    expect(!res.ok && res.error.code).toBe(INTERNAL_TRANSFER_ERRORS.INVALID_TRANSFER_STATE);
  });
});

describe('查询：list / get（按部门/状态/订单）', () => {
  it('list 按 status 过滤（内存过滤，schema 冻结权衡）', async () => {
    const ctx = await seedPendingTransfer();
    const pending = await ctx.service.listInternalTransfers({ status: 'PendingConfirm' });
    expect(pending.total).toBe(1);
    const effective = await ctx.service.listInternalTransfers({ status: 'Effective' });
    expect(effective.total).toBe(0);
  });

  it('list 按 departmentId / garmentOrderId / fabricOrderId 过滤', async () => {
    const ctx = await seedPendingTransfer();
    const byDept = await ctx.service.listInternalTransfers({ departmentId: 'dept_garment' });
    expect(byDept.total).toBe(1);
    const byDeptMiss = await ctx.service.listInternalTransfers({ departmentId: 'dept_other' });
    expect(byDeptMiss.total).toBe(0);
    const byGarment = await ctx.service.listInternalTransfers({ garmentOrderId: 'G1' });
    expect(byGarment.total).toBe(1);
    const byFabric = await ctx.service.listInternalTransfers({ fabricOrderId: 'F1' });
    expect(byFabric.total).toBe(1);
    const byFabricMiss = await ctx.service.listInternalTransfers({ fabricOrderId: 'F_X' });
    expect(byFabricMiss.total).toBe(0);
  });

  it('getById 支持 mirror id 解析到 master', async () => {
    const ctx = await seedPendingTransfer();
    const mirrorId = ctx.created.mirror.id;
    const got = await ctx.service.getInternalTransferById(mirrorId);
    expect(got).toBeTruthy();
    expect(got!.master.id).toBe(ctx.created.transfer.id);
    expect(got!.mirror?.id).toBe(mirrorId);
    expect(got!.payload?.garmentOrderId).toBe('G1');
  });
});
