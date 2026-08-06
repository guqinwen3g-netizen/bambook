/**
 * 报价管理服务 Quotation Service
 *
 * 职责：
 *   1. 报价单 CRUD（含行明细，事务内创建/更新）
 *   2. 状态流转：Draft → Sent → Accepted/Rejected/Expired
 *   3. 业务事件发布（QuotationIssued / QuotationAccepted）
 *   4. 行金额自动计算 + 报价总金额汇总
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 事务内创建报价 + 行 + 审计日志
 *   - 状态转换有严格校验（非法转换抛 409）
 *   - 事件发布失败不阻断业务（通知系统是 fire-and-forget）
 */

import { PrismaClient, Quotation, QuotationLine } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export interface QuotationLineInput {
  fabricCode?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

export interface CreateQuotationInput {
  quotationNumber: string;
  currency: string;
  customerRelationId?: string;
  customerName?: string;
  customerCode?: string;
  issueDate: string;
  validUntil?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  salesperson?: string;
  inquiryRef?: string;
  exchangeRate?: number;
  baseCurrency?: string;
  notes?: string;
  lines: QuotationLineInput[];
}

export interface UpdateQuotationInput extends Partial<CreateQuotationInput> {
  status?: string;
}

export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired';

export interface QuotationDetail extends Quotation {
  lines: QuotationLine[];
}

// ────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────

const VALID_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

// 状态转换矩阵：key → 允许的目标状态
const TRANSITIONS: Record<string, QuotationStatus[]> = {
  Draft: ['Sent', 'Expired'],
  Sent: ['Accepted', 'Rejected', 'Expired'],
  Accepted: [], // 终态
  Rejected: [], // 终态
  Expired: [], // 终态
};

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

function generateQuotationId(): string {
  return `QT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateLineId(): string {
  return `QTL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function calcLineAmount(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 10000) / 10000; // 4 位小数
}

function calcTotalAmount(lines: QuotationLineInput[]): number {
  return lines.reduce((sum, l) => sum + calcLineAmount(l.quantity, l.unitPrice), 0);
}

function validateStatusTransition(from: string, to: QuotationStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`非法状态转换：${from} → ${to}（允许的目标：${allowed?.join(', ') || '无（终态）'}）`);
  }
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createQuotationService(prisma: PrismaClient) {
  // ── 创建报价单（含行明细，事务） ──
  async function createQuotation(input: CreateQuotationInput, actorId: string): Promise<QuotationDetail> {
    const totalAmount = calcTotalAmount(input.lines);
    const now = Date.now();
    const quotationId = generateQuotationId();

    const created = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.create({
        data: {
          id: quotationId,
          quotationNumber: input.quotationNumber,
          status: 'Draft',
          currency: input.currency,
          totalAmount,
          exchangeRate: input.exchangeRate ?? null,
          baseCurrency: input.baseCurrency ?? 'CNY',
          customerRelationId: input.customerRelationId ?? null,
          customerName: input.customerName ?? null,
          customerCode: input.customerCode ?? null,
          issueDate: input.issueDate,
          validUntil: input.validUntil ?? null,
          deliveryTerms: input.deliveryTerms ?? null,
          paymentTerms: input.paymentTerms ?? null,
          salesperson: input.salesperson ?? null,
          inquiryRef: input.inquiryRef ?? null,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
          lines: {
            create: input.lines.map((line, i) => ({
              id: generateLineId(),
              lineNumber: i + 1,
              fabricCode: line.fabricCode ?? null,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              amount: calcLineAmount(line.quantity, line.unitPrice),
              notes: line.notes ?? null,
              createdAt: now,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 审计日志
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_quotation',
          targetType: 'Quotation',
          targetId: quotationId,
          detail: { source: 'api:quotation', after: { quotationNumber: input.quotationNumber, totalAmount, lineCount: input.lines.length } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return quotation;
    });

    logger.info('[QuotationService] quotation created', { id: quotationId, quotationNumber: input.quotationNumber, totalAmount });
    return created as QuotationDetail;
  }

  // ── 更新报价单（仅 Draft 状态可编辑） ──
  async function updateQuotation(id: string, input: UpdateQuotationInput, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Draft 状态可编辑`);
    }

    const now = Date.now();
    const lines = input.lines;
    const totalAmount = lines ? calcTotalAmount(lines) : Number(existing.totalAmount);

    const updated = await prisma.$transaction(async (tx) => {
      // 若提供新行明细，先删后建
      if (lines && lines.length > 0) {
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
        await tx.quotationLine.createMany({
          data: lines.map((line, i) => ({
            id: generateLineId(),
            quotationId: id,
            lineNumber: i + 1,
            fabricCode: line.fabricCode ?? null,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            amount: calcLineAmount(line.quantity, line.unitPrice),
            notes: line.notes ?? null,
            createdAt: now,
          })),
        });
      }

      const quotation = await tx.quotation.update({
        where: { id },
        data: {
          quotationNumber: input.quotationNumber ?? undefined,
          currency: input.currency ?? undefined,
          totalAmount,
          exchangeRate: input.exchangeRate ?? undefined,
          baseCurrency: input.baseCurrency ?? undefined,
          customerRelationId: input.customerRelationId ?? undefined,
          customerName: input.customerName ?? undefined,
          customerCode: input.customerCode ?? undefined,
          issueDate: input.issueDate ?? undefined,
          validUntil: input.validUntil ?? undefined,
          deliveryTerms: input.deliveryTerms ?? undefined,
          paymentTerms: input.paymentTerms ?? undefined,
          salesperson: input.salesperson ?? undefined,
          inquiryRef: input.inquiryRef ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { quotationNumber: existing.quotationNumber }, after: { quotationNumber: input.quotationNumber ?? existing.quotationNumber } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return quotation;
    });

    logger.info('[QuotationService] quotation updated', { id });
    return updated as QuotationDetail;
  }

  // ── 软删除报价单（仅 Draft 状态可删除） ──
  async function deleteQuotation(id: string, actorId: string): Promise<void> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Draft 状态可删除`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { quotationNumber: existing.quotationNumber, status: existing.status } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });

    logger.info('[QuotationService] quotation deleted', { id });
  }

  // ── 查询报价单列表 ──
  async function listQuotations(params: {
    status?: string;
    customerRelationId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Quotation[]; total: number }> {
    const where: any = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.customerRelationId) where.customerRelationId = params.customerRelationId;
    if (params.dateFrom || params.dateTo) {
      where.issueDate = {};
      if (params.dateFrom) where.issueDate.gte = params.dateFrom;
      if (params.dateTo) where.issueDate.lte = params.dateTo;
    }
    if (params.search) {
      where.OR = [
        { quotationNumber: { contains: params.search } },
        { customerName: { contains: params.search } },
        { inquiryRef: { contains: params.search } },
      ];
    }

    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.quotation.count({ where }),
    ]);

    return { items, total };
  }

  // ── 查询单个报价单（含行明细） ──
  async function getQuotation(id: string): Promise<QuotationDetail | null> {
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!quotation || quotation.deletedAt) return null;
    return quotation as QuotationDetail;
  }

  // ── 状态转换：发送报价单 Draft → Sent ──
  async function sendQuotation(id: string, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Sent');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Sent', updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'send_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Draft' }, after: { status: 'Sent' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Draft',
          afterValue: 'Sent',
          transactionId: null,
        },
      });

      return quotation;
    });

    // 发布 QuotationIssued 业务事件（fire-and-forget，不阻断业务）
    try {
      businessEventBus.publish({
        id: `bev_qt_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'QuotationIssued',
        sourceEntityType: 'Quotation',
        sourceEntityId: id,
        payload: {
          quotationId: id,
          quotationNumber: existing.quotationNumber,
          customerName: existing.customerName,
          customerRelationId: existing.customerRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lineCount: existing.lines.length,
        },
        occurredAt: now,
        actorId: actorId || 'system',
      });
    } catch (e: any) {
      logger.warn('[QuotationService] QuotationIssued event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[QuotationService] quotation sent', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 状态转换：接受报价单 Sent → Accepted ──
  async function acceptQuotation(id: string, actorId: string, note?: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id }, include: { lines: true } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Accepted');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Accepted', updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'accept_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Sent' }, after: { status: 'Accepted', note } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Sent',
          afterValue: 'Accepted',
          transactionId: null,
        },
      });

      return quotation;
    });

    // 发布 QuotationAccepted 业务事件
    try {
      businessEventBus.publish({
        id: `bev_qa_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'QuotationAccepted',
        sourceEntityType: 'Quotation',
        sourceEntityId: id,
        payload: {
          quotationId: id,
          quotationNumber: existing.quotationNumber,
          customerName: existing.customerName,
          customerRelationId: existing.customerRelationId,
          totalAmount: Number(existing.totalAmount),
          currency: existing.currency,
          lines: existing.lines.map(l => ({
            fabricCode: l.fabricCode,
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
      logger.warn('[QuotationService] QuotationAccepted event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[QuotationService] quotation accepted', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 状态转换：拒绝报价单 Sent → Rejected ──
  async function rejectQuotation(id: string, actorId: string, note?: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    validateStatusTransition(existing.status, 'Rejected');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'Rejected', updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'reject_quotation',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', before: { status: 'Sent' }, after: { status: 'Rejected', note } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: 'Sent',
          afterValue: 'Rejected',
          transactionId: null,
        },
      });

      return quotation;
    });

    logger.info('[QuotationService] quotation rejected', { id, quotationNumber: existing.quotationNumber });
    return updated as QuotationDetail;
  }

  // ── 标记过期（调度器或手动触发） ──
  async function expireQuotation(id: string, actorId: string): Promise<QuotationDetail> {
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Draft' && existing.status !== 'Sent') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，不可标记过期`);
    }

    const now = Date.now();
    const updated = await prisma.quotation.update({
      where: { id },
      data: { status: 'Expired', updatedAt: now },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    logger.info('[QuotationService] quotation expired', { id });
    return updated as QuotationDetail;
  }

  // ── 转为正式订单（Accepted → Order） ──
  // 将已接受的报价单转为生产订单，自动映射字段 + 创建订单行 + 标记 convertedOrderId
  async function convertToOrder(
    id: string,
    actorId: string,
    overrides?: { poNumber?: string; millName?: string; type?: string; dueDate?: string },
  ): Promise<{ orderId: string; quotation: QuotationDetail }> {
    const existing = await prisma.quotation.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!existing || existing.deletedAt) throw new Error(`报价单 ${id} 不存在`);
    if (existing.status !== 'Accepted') {
      throw new Error(`报价单 ${id} 状态为 ${existing.status}，仅 Accepted 可转为订单`);
    }
    if (existing.convertedOrderId) {
      throw new Error(`报价单 ${id} 已转为订单 ${existing.convertedOrderId}，不可重复转换`);
    }

    const now = Date.now();
    const orderId = `ORD-QT-${String(now).slice(-8)}`;
    const poNumber = overrides?.poNumber || existing.quotationNumber;
    const millName = overrides?.millName || '';
    const orderType = overrides?.type || 'Fabric';
    const dueDate = overrides?.dueDate || existing.validUntil || '';
    const totalAmount = Number(existing.totalAmount);

    const result = await prisma.$transaction(async (tx) => {
      // 1. 创建订单
      const order = await tx.order.create({
        data: {
          id: orderId,
          customer: existing.customerName || existing.customerCode || '未知客户',
          product: existing.lines[0]?.description || '',
          type: orderType,
          quantity: existing.lines.reduce((sum, l) => sum + Number(l.quantity), 0),
          status: 'Pending',
          dueDate,
          quoteAmount: totalAmount,
          poNumber,
          customerCode: existing.customerCode,
          currency: existing.currency,
          deliveryTerms: existing.deliveryTerms,
          paymentTerms: existing.paymentTerms,
          customerRelationId: existing.customerRelationId,
          millName,
          source: 'quotation-convert',
          salesCurrency: existing.currency,
          purchaseCurrency: existing.baseCurrency || 'CNY',
          fieldSources: { source: 'quotation-convert' } as any,
          updatedAt: BigInt(now),
          importedAt: BigInt(now),
          lines: {
            create: existing.lines.map((line, i) => ({
              id: `OL-${orderId}-${i + 1}`,
              lineNumber: i + 1,
              materialCode: line.fabricCode,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              netValue: line.amount,
              status: 'Pending',
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 2. 更新报价单 — 标记已转换
      const quotation = await tx.quotation.update({
        where: { id },
        data: { convertedOrderId: orderId, updatedAt: now },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // 3. 审计日志 — 报价单转换
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'convert_quotation_to_order',
          targetType: 'Quotation',
          targetId: id,
          detail: { source: 'api:quotation', after: { orderId, poNumber } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'convertedOrderId',
          beforeValue: null as any,
          afterValue: orderId as any,
          transactionId: null,
        },
      });

      // 4. 审计日志 — 订单创建
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_order_from_quotation',
          targetType: 'Order',
          targetId: orderId,
          detail: { source: 'quotation-convert', after: { quotationId: id, poNumber, totalAmount } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return { order, quotation };
    });

    logger.info('[QuotationService] quotation converted to order', {
      id, orderId, poNumber, lineCount: existing.lines.length,
    });

    return { orderId: result.order.id, quotation: result.quotation as QuotationDetail };
  }

  return {
    createQuotation,
    updateQuotation,
    deleteQuotation,
    listQuotations,
    getQuotation,
    sendQuotation,
    acceptQuotation,
    rejectQuotation,
    expireQuotation,
    convertToOrder,
  };
}

export type QuotationService = ReturnType<typeof createQuotationService>;
