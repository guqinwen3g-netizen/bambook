/**
 * 采购管理服务 Procurement Service
 *
 * 职责：
 *   1. 采购单 CRUD（含行明细，事务内创建/更新）
 *   2. 状态流转：Draft → Sent → Confirmed → PartiallyReceived/Received → Closed
 *   3. 来料检验记录（MaterialReceipt）
 *   4. 业务事件发布（PurchaseOrderSent / PurchaseOrderConfirmed / MaterialReceived）
 *   5. 行金额自动计算 + 采购总金额汇总
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 事务内创建采购单 + 行 + 审计日志
 *   - 状态转换有严格校验（非法转换抛 409）
 *   - 事件发布失败不阻断业务（fire-and-forget）
 */

import { PrismaClient, PurchaseOrder, PurchaseLine, MaterialReceipt } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';
import { deactivateEntityLinks, syncPurchaseOrderReferences } from '../entities/sync';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export interface PurchaseLineInput {
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

import { nextBusinessNumber } from '../shared/businessNumberService';

export interface CreatePurchaseOrderInput {
  /** 采购单号（可选，服务端自动生成 PO-YYYY-NNNN；传入时优先使用传入值并校验唯一性） */
  poNumber?: string;
  currency: string;
  supplierRelationId?: string;
  supplierName?: string;
  supplierCode?: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  shipToAddress?: string;
  orderId?: string;
  quotationId?: string;
  bomId?: string;
  buyer?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  lines: PurchaseLineInput[];
}

export interface UpdatePurchaseOrderInput extends Partial<CreatePurchaseOrderInput> {
  status?: string;
}

export type PurchaseOrderStatus = 'Draft' | 'Sent' | 'Confirmed' | 'PartiallyReceived' | 'Received' | 'Closed' | 'Cancelled';

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseLine[];
  receipts?: MaterialReceipt[];
}

export interface MaterialReceiptInput {
  receiptNumber: string;
  receivedDate: string;
  receivedBy?: string;
  warehouseId?: string;
  warehouseName?: string;
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
  rejectionReason?: string;
  qualityNotes?: string;
  notes?: string;
}

// ────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────

// 状态转换矩阵：key → 允许的目标状态
const TRANSITIONS: Record<string, PurchaseOrderStatus[]> = {
  Draft: ['Sent', 'Cancelled'],
  Sent: ['Confirmed', 'Cancelled'],
  Confirmed: ['PartiallyReceived', 'Received', 'Cancelled'],
  PartiallyReceived: ['Received', 'Closed'],
  Received: ['Closed'],
  Closed: [], // 终态
  Cancelled: [], // 终态
};

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

function generatePurchaseOrderId(): string {
  return `PO_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateLineId(): string {
  return `PL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateReceiptId(): string {
  return `MR_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function calcLineAmount(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 10000) / 10000;
}

function calcTotalAmount(lines: PurchaseLineInput[]): number {
  return lines.reduce((sum, l) => sum + calcLineAmount(l.quantity, l.unitPrice), 0);
}

function validateStatusTransition(from: string, to: PurchaseOrderStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`非法状态转换：${from} → ${to}（允许的目标：${allowed?.join(', ') || '无（终态）'}）`);
  }
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createProcurementService(prisma: PrismaClient) {
  // ── 创建采购单（含行明细，事务） ──
  async function createPurchaseOrder(input: CreatePurchaseOrderInput, actorId: string): Promise<PurchaseOrderDetail> {
    // PRD 13.1：被拉黑的工厂禁止新建采购单（身份真源 Relation → FactoryProfile 1:1）
    if (input.supplierRelationId) {
      const factory = await (prisma as any).factoryProfile?.findUnique?.({ where: { relationId: input.supplierRelationId } });
      if (factory && factory.deletedAt === null && factory.blacklistedAt !== null) {
        throw new Error(`该供应商已被拉黑（原因：${factory.blacklistReason || '未填写'}），禁止新建采购单`);
      }
    }
    const totalAmount = calcTotalAmount(input.lines);
    const now = Date.now();
    const purchaseOrderId = generatePurchaseOrderId();

    const created = await prisma.$transaction(async (tx) => {
      // PRD 5.6：服务端自动生成采购单号（PO-YYYY-NNNN），传入时优先使用传入值
      const poNumber = input.poNumber || await nextBusinessNumber(tx, 'PO');
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          id: purchaseOrderId,
          poNumber,
          status: 'Draft',
          currency: input.currency,
          totalAmount,
          exchangeRate: input.exchangeRate ?? null,
          baseCurrency: input.baseCurrency ?? 'CNY',
          supplierRelationId: input.supplierRelationId ?? null,
          supplierName: input.supplierName ?? null,
          supplierCode: input.supplierCode ?? null,
          orderDate: input.orderDate,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          deliveryTerms: input.deliveryTerms ?? null,
          paymentTerms: input.paymentTerms ?? null,
          shipToAddress: input.shipToAddress ?? null,
          orderId: input.orderId ?? null,
          quotationId: input.quotationId ?? null,
          bomId: input.bomId ?? null,
          buyer: input.buyer ?? null,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
          lines: {
            create: input.lines.map((line, i) => ({
              id: generateLineId(),
              lineNumber: i + 1,
              materialCode: line.materialCode ?? null,
              description: line.description,
              category: line.category ?? null,
              specification: line.specification ?? null,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              amount: calcLineAmount(line.quantity, line.unitPrice),
              notes: line.notes ?? null,
              createdAt: now,
            })),
          },
        },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: purchaseOrderId,
          detail: { source: 'api:procurement', after: { poNumber: input.poNumber, totalAmount, lineCount: input.lines.length } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：purchasedFrom / forOrder / fromBom / fromQuotation
      await syncPurchaseOrderReferences(prisma, purchaseOrder, { source: 'api:procurement' }, tx);

      return purchaseOrder;
    });

    logger.info('[ProcurementService] purchase order created', { id: purchaseOrderId, poNumber: input.poNumber, totalAmount });
    return created as PurchaseOrderDetail;
  }

  // ── 更新采购单（仅 Draft 状态可编辑） ──
  async function updatePurchaseOrder(id: string, input: UpdatePurchaseOrderInput, actorId: string): Promise<PurchaseOrderDetail> {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`采购单 ${id} 状态为 ${existing.status}，仅 Draft 状态可编辑`);
    }

    const now = Date.now();
    const lines = input.lines;
    const totalAmount = lines ? calcTotalAmount(lines) : Number(existing.totalAmount);

    const updated = await prisma.$transaction(async (tx) => {
      if (lines && lines.length > 0) {
        await tx.purchaseLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseLine.createMany({
          data: lines.map((line, i) => ({
            id: generateLineId(),
            purchaseOrderId: id,
            lineNumber: i + 1,
            materialCode: line.materialCode ?? null,
            description: line.description,
            category: line.category ?? null,
            specification: line.specification ?? null,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            amount: calcLineAmount(line.quantity, line.unitPrice),
            notes: line.notes ?? null,
            createdAt: now,
          })),
        });
      }

      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: {
          poNumber: input.poNumber ?? undefined,
          currency: input.currency ?? undefined,
          totalAmount,
          exchangeRate: input.exchangeRate ?? undefined,
          baseCurrency: input.baseCurrency ?? undefined,
          supplierRelationId: input.supplierRelationId ?? undefined,
          supplierName: input.supplierName ?? undefined,
          supplierCode: input.supplierCode ?? undefined,
          orderDate: input.orderDate ?? undefined,
          expectedDeliveryDate: input.expectedDeliveryDate ?? undefined,
          deliveryTerms: input.deliveryTerms ?? undefined,
          paymentTerms: input.paymentTerms ?? undefined,
          shipToAddress: input.shipToAddress ?? undefined,
          buyer: input.buyer ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { poNumber: existing.poNumber }, after: { poNumber: input.poNumber ?? existing.poNumber } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      // EntityLink 图谱：FK 快照随 update 同步
      await syncPurchaseOrderReferences(prisma, purchaseOrder, { source: 'api:procurement' }, tx);

      return purchaseOrder;
    });

    logger.info('[ProcurementService] purchase order updated', { id });
    return updated as PurchaseOrderDetail;
  }

  // ── 软删除采购单（仅 Draft 状态可删除） ──
  async function deletePurchaseOrder(id: string, actorId: string): Promise<void> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`采购单 ${id} 状态为 ${existing.status}，仅 Draft 状态可删除`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      // EntityLink 图谱：软删同步失效发出的关联
      await deactivateEntityLinks(tx, 'purchaseOrder', id, BigInt(now));
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { poNumber: existing.poNumber, status: existing.status } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });

    logger.info('[ProcurementService] purchase order deleted', { id });
  }

  // ── 查询采购单列表 ──
  async function listPurchaseOrders(params: {
    status?: string;
    supplierRelationId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: PurchaseOrder[]; total: number }> {
    const where: any = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.supplierRelationId) where.supplierRelationId = params.supplierRelationId;
    if (params.dateFrom || params.dateTo) {
      where.orderDate = {};
      if (params.dateFrom) where.orderDate.gte = params.dateFrom;
      if (params.dateTo) where.orderDate.lte = params.dateTo;
    }
    if (params.search) {
      where.OR = [
        { poNumber: { contains: params.search } },
        { supplierName: { contains: params.search } },
        { buyer: { contains: params.search } },
      ];
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return { items, total };
  }

  // ── 查询单个采购单（含行明细 + 收料记录） ──
  async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        receipts: { orderBy: { receivedDate: 'desc' } },
      },
    });
    if (!purchaseOrder || purchaseOrder.deletedAt) return null;
    return purchaseOrder as PurchaseOrderDetail;
  }

  // ── 状态转换：发送采购单 Draft → Sent ──
  async function sendPurchaseOrder(id: string, actorId: string): Promise<PurchaseOrderDetail> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Sent');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'Sent', updatedAt: now },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'send_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { status: 'Draft' }, after: { status: 'Sent' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Draft',
          afterValue: 'Sent',
          transactionId: null,
        },
      });

      return purchaseOrder;
    });

    // 发布 PurchaseOrderSent 事件
    try {
      businessEventBus.publish({
        id: `bev_po_sent_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'PurchaseOrderSent',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: id,
        payload: {
          purchaseOrderId: id,
          poNumber: existing.poNumber,
          supplierName: existing.supplierName,
          supplierRelationId: existing.supplierRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lineCount: existing.lines.length,
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[ProcurementService] PurchaseOrderSent event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[ProcurementService] purchase order sent', { id, poNumber: existing.poNumber });
    return updated as PurchaseOrderDetail;
  }

  // ── 状态转换：确认采购单 Sent → Confirmed ──
  async function confirmPurchaseOrder(id: string, actorId: string): Promise<PurchaseOrderDetail> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Confirmed');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'Confirmed', updatedAt: now },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'confirm_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { status: 'Sent' }, after: { status: 'Confirmed' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Sent',
          afterValue: 'Confirmed',
          transactionId: null,
        },
      });

      return purchaseOrder;
    });

    // 发布 PurchaseOrderConfirmed 事件
    try {
      businessEventBus.publish({
        id: `bev_po_conf_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'PurchaseOrderConfirmed',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: id,
        payload: {
          purchaseOrderId: id,
          poNumber: existing.poNumber,
          supplierName: existing.supplierName,
          supplierRelationId: existing.supplierRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lines: existing.lines.map(l => ({
            materialCode: l.materialCode,
            description: l.description,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
          })),
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[ProcurementService] PurchaseOrderConfirmed event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[ProcurementService] purchase order confirmed', { id, poNumber: existing.poNumber });
    return updated as PurchaseOrderDetail;
  }

  // ── 取消采购单 ──
  async function cancelPurchaseOrder(id: string, actorId: string, reason?: string): Promise<PurchaseOrderDetail> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Cancelled');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'Cancelled', notes: reason ? `${existing.notes || ''}\n[取消原因] ${reason}`.trim() : existing.notes, updatedAt: now },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'cancel_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { status: existing.status }, after: { status: 'Cancelled', reason } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: existing.status,
          afterValue: 'Cancelled',
          transactionId: null,
        },
      });

      return purchaseOrder;
    });

    logger.info('[ProcurementService] purchase order cancelled', { id, poNumber: existing.poNumber });
    return updated as PurchaseOrderDetail;
  }

  // ── 关闭采购单 ──
  async function closePurchaseOrder(id: string, actorId: string): Promise<PurchaseOrderDetail> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Closed');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'Closed', actualDeliveryDate: existing.actualDeliveryDate ?? new Date().toISOString().slice(0, 10), updatedAt: now },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          receipts: { orderBy: { receivedDate: 'desc' } },
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'close_purchase_order',
          targetType: 'PurchaseOrder',
          targetId: id,
          detail: { source: 'api:procurement', before: { status: existing.status }, after: { status: 'Closed' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: existing.status,
          afterValue: 'Closed',
          transactionId: null,
        },
      });

      return purchaseOrder;
    });

    logger.info('[ProcurementService] purchase order closed', { id });
    return updated as PurchaseOrderDetail;
  }

  // ── 来料检验记录 ──
  async function createMaterialReceipt(
    purchaseOrderId: string,
    input: MaterialReceiptInput,
    actorId: string,
  ): Promise<MaterialReceipt> {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`采购单 ${purchaseOrderId} 不存在`);
    if (existing.status !== 'Confirmed' && existing.status !== 'PartiallyReceived' && existing.status !== 'Received') {
      throw new Error(`采购单 ${purchaseOrderId} 状态为 ${existing.status}，仅 Confirmed/PartiallyReceived/Received 状态可收料`);
    }

    const now = Date.now();
    const receiptId = generateReceiptId();

    // 判断收料后状态：全部收齐 → Received，部分收齐 → PartiallyReceived
    const totalOrdered = existing.lines.reduce((sum, l) => sum + Number(l.quantity), 0);
    const totalPreviouslyReceived = existing.lines.reduce((sum, l) => sum + Number(l.receivedQuantity), 0);
    const totalNowReceived = totalPreviouslyReceived + input.totalAccepted;

    let newStatus: PurchaseOrderStatus;
    if (totalNowReceived >= totalOrdered) {
      newStatus = 'Received';
    } else {
      newStatus = 'PartiallyReceived';
    }

    const result = await prisma.$transaction(async (tx) => {
      // 创建收料记录
      const receipt = await tx.materialReceipt.create({
        data: {
          id: receiptId,
          receiptNumber: input.receiptNumber,
          purchaseOrderId,
          status: input.totalRejected === 0 ? 'Accepted' : input.totalAccepted === 0 ? 'Rejected' : 'PartiallyAccepted',
          receivedDate: input.receivedDate,
          receivedBy: input.receivedBy ?? null,
          inspectedBy: actorId || 'system',
          inspectionDate: input.receivedDate,
          warehouseId: input.warehouseId ?? null,
          warehouseName: input.warehouseName ?? null,
          totalReceived: input.totalReceived,
          totalAccepted: input.totalAccepted,
          totalRejected: input.totalRejected,
          rejectionReason: input.rejectionReason ?? null,
          qualityNotes: input.qualityNotes ?? null,
          notes: input.notes ?? null,
          createdAt: now,
        },
      });

      // 更新采购单状态
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: newStatus, updatedAt: now },
      });

      // 审计日志
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_material_receipt',
          targetType: 'PurchaseOrder',
          targetId: purchaseOrderId,
          detail: { source: 'api:procurement', after: { receiptId, receiptNumber: input.receiptNumber, totalAccepted: input.totalAccepted, totalRejected: input.totalRejected, newStatus } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return { receipt, purchaseOrder };
    });

    // 发布 MaterialReceived 事件
    try {
      businessEventBus.publish({
        id: `bev_mr_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: purchaseOrderId,
        payload: {
          purchaseOrderId,
          poNumber: existing.poNumber,
          receiptId,
          receiptNumber: input.receiptNumber,
          supplierName: existing.supplierName,
          supplierRelationId: existing.supplierRelationId,
          totalReceived: input.totalReceived,
          totalAccepted: input.totalAccepted,
          totalRejected: input.totalRejected,
          warehouseName: input.warehouseName,
          purchaseOrderStatus: newStatus,
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[ProcurementService] MaterialReceived event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[ProcurementService] material receipt created', {
      purchaseOrderId, receiptId, totalAccepted: input.totalAccepted, newStatus,
    });

    // H1c：全部收齐 → 自动追加交期评分（幂等：同采购单只评一次；无档案供应商静默跳过）
    if (newStatus === 'Received' && existing.supplierRelationId) {
      try {
        const { createFactoryService, deliveryScoreForDaysLate } = await import('../suppliers/factoryService');
        const factoryService = createFactoryService(prisma);
        const DAY_MS = 86_400_000;
        const parse = (s?: string | null) => {
          if (!s) return null;
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
          return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
        };
        const expectedMs = parse(existing.expectedDeliveryDate);
        const actualMs = parse(input.receivedDate);
        const daysLate = expectedMs !== null && actualMs !== null ? Math.round((actualMs - expectedMs) / DAY_MS) : null;
        await factoryService.recordAutoEvaluation({
          relationId: existing.supplierRelationId,
          kind: 'delivery',
          score: deliveryScoreForDaysLate(daysLate),
          sourceType: 'purchaseOrder',
          sourceId: purchaseOrderId,
          evaluatedAt: input.receivedDate,
          note: `采购单 ${existing.poNumber} 全部收齐${daysLate !== null ? `，交期偏差 ${daysLate} 天` : '（未约定交期）'}`,
          actorId: actorId || 'system',
        });
      } catch (e: any) {
        logger.warn('[ProcurementService] delivery auto-evaluation failed (non-blocking)', { error: e?.message });
      }
    }

    return result.receipt;
  }

  return {
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    listPurchaseOrders,
    getPurchaseOrder,
    sendPurchaseOrder,
    confirmPurchaseOrder,
    cancelPurchaseOrder,
    closePurchaseOrder,
    createMaterialReceipt,
  };
}

export type ProcurementService = ReturnType<typeof createProcurementService>;
