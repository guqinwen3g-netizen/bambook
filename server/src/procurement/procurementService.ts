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

import { PrismaClient, PurchaseOrder, PurchaseLine, MaterialReceipt, SupplierInquiry } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';
import { deactivateEntityLinks, syncMaterialReceiptReferences, syncPurchaseOrderReferences } from '../entities/sync';
import { accumulateCompletedPurchaseOrderStats } from '../suppliers/factoryService';

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

/**
 * 可手动流转的目标状态（Agent Flow / route 共用此真源）。
 * PartiallyReceived/Received 由来料检验（createMaterialReceipt）驱动，Draft 为初始态，均不可手动设置。
 */
export const MANUAL_PURCHASE_ORDER_TRANSITION_TARGETS: readonly PurchaseOrderStatus[] = ['Sent', 'Confirmed', 'Cancelled', 'Closed'];

/** 采购单创建可写字段白名单（route / Agent Flow 共用真源；lines 元素字段见 PurchaseLineInput） */
export const PURCHASE_ORDER_CREATE_FIELDS: readonly string[] = [
  'poNumber', 'currency', 'supplierRelationId', 'supplierName', 'supplierCode', 'orderDate',
  'expectedDeliveryDate', 'deliveryTerms', 'paymentTerms', 'shipToAddress', 'orderId', 'quotationId',
  'bomId', 'buyer', 'exchangeRate', 'baseCurrency', 'notes', 'lines',
];

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
  /**
   * D6 行级收货明细（可选）：每行本次收了多少。
   * 传入时按明细精确回写各行 receivedQuantity（真源在行），并强校验
   * Σaccepted === totalAccepted / Σrejected === totalRejected（数字正确，不一致 409）；
   * 缺省退回旧的按行号贪心分摊路径（兼容历史调用方）。
   */
  lineReceipts?: MaterialReceiptLineInput[];
}

/** D6 行级收货明细行 */
export interface MaterialReceiptLineInput {
  /** PurchaseLine.id（必须属于本采购单） */
  lineId: string;
  /** 本次该行合格数量（行级回写 + L8 入库口径） */
  accepted: number;
  /** 本次该行不合格数量（仅汇总入账；无行级子表不做行级拒收回写） */
  rejected?: number;
}

/**
 * MaterialReceived 事件 payload.stockInLines 行级入库增量（L8 消费契约）。
 *
 * 口径裁决（真源 docs/design/04-模块设计/03-订单与生产/Procurement-采购管理/采购到货与质检.md）：
 *   - §五「PO 状态自动流转」：totalNowReceived = 累计已收 + input.totalAccepted
 *     → PO 流转以「合格数 totalAccepted」为唯一累计口径，receivedQuantity 与其保持一致；
 *   - §七 7.2「自动入库联动设计」：quantity: totalAccepted, // 仅合格数量入库
 *     → L8 入库数量即本字段的行级分配值。
 *
 * L8 断层修复说明：payload 携带行级增量后，多张部分收料时 L8 只入库"本次"数量，
 * 不会把历史累计值重复入一遍库。
 */
export interface MaterialReceivedStockInLine {
  lineId: string;
  materialCode: string | null;
  description: string;
  category: string | null;
  specification: string | null;
  unit: string | null;
  unitPrice: number | null;
  /** 本次该行入库增量（合格数口径），非累计值 */
  quantity: number;
}

// ─── 卡点 3：供应商询价比价（剧本 2.10） ───

export interface SupplierQuoteRecord {
  id: string;
  supplierId?: string;
  supplierName: string;
  quoteAmount: number;
  currency: string;
  exchangeRate?: number;
  baseAmount?: number;
  quoteDate: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  isSelected?: boolean;
}

export interface CreateSupplierInquiryInput {
  description: string;
  materialCode?: string;
  quantity?: number;
  unit?: string;
  currency: string;
  expectedDeliveryDate?: string;
  orderId?: string;
  bomId?: string;
  buyer?: string;
  notes?: string;
}

export interface UpdateSupplierInquiryInput extends Partial<CreateSupplierInquiryInput> {
  status?: string;
}

export interface AddSupplierQuoteInput {
  supplierId?: string;
  supplierName: string;
  quoteAmount: number;
  currency: string;
  exchangeRate?: number;
  quoteDate: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  expectedDeliveryDate?: string;
  notes?: string;
}

export const SUPPLIER_INQUIRY_CREATE_FIELDS: readonly string[] = [
  'description', 'materialCode', 'quantity', 'unit', 'currency',
  'expectedDeliveryDate', 'orderId', 'bomId', 'buyer', 'notes',
];

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

/**
 * L8 断层修复：将本次收料的合格数量按行分配到 PurchaseLine。
 *
 * 背景：MaterialReceipt 为 PO 级汇总模型（无行级子表，见 schema.prisma P1-4 设计决策①——
 * 行级收货明细为独立债务，不在本模型强行补建），回写需确定性分配规则。
 *
 * 分配规则：按 lineNumber 升序贪心填充各行剩余需求（quantity − receivedQuantity）；
 * 超采余额挂最后一行。
 *
 * 超采裁决（允许 receivedQuantity 超过 orderedQuantity）：
 *   文档 §二 2.2 收料前置校验表「Received | ✅ | 超收（已全部到货后补收）」，
 *   且 §五状态流转表「超收 | 累计 > 订单数 | Received」→ 超收为受支持场景，不做封顶。
 *
 * 口径裁决：receivedQuantity 仅累计合格数（totalAccepted），与 PO 状态流转
 * （totalPreviouslyReceived + input.totalAccepted）及文档 §七 7.2「仅合格数量入库」一致；
 * rejectedQuantity 不在此回写（无行级子表无法定位拒收归属行，且当前无消费方，
 * 待 MaterialReceiptLine 子表落地后按文档 §7.3 补齐）。
 */
function allocateAcceptedQuantity(
  lines: Array<Pick<PurchaseLine, 'lineNumber' | 'quantity' | 'receivedQuantity'>>,
  totalAccepted: number,
): Array<{ line: PurchaseLine; quantity: number }> {
  if (totalAccepted <= 0 || lines.length === 0) return [];
  const ordered = ([...lines] as PurchaseLine[]).sort((a, b) => a.lineNumber - b.lineNumber);
  let remain = Math.round(totalAccepted * 10000) / 10000;
  const allocations: Array<{ line: PurchaseLine; quantity: number }> = [];

  // 第一轮：按 lineNumber 升序贪心填充各行剩余需求（quantity − receivedQuantity）
  for (const line of ordered) {
    if (remain <= 0) break;
    const capacity = Math.max(Number(line.quantity) - Number(line.receivedQuantity), 0);
    if (capacity <= 0) continue;
    const alloc = Math.round(Math.min(capacity, remain) * 10000) / 10000;
    if (alloc <= 0) continue;
    allocations.push({ line, quantity: alloc });
    remain = Math.round((remain - alloc) * 10000) / 10000;
  }

  // 第二轮：超采余额挂最后一行——允许超过 orderedQuantity（裁决见函数注释），保证 Σ(回写增量) === totalAccepted
  if (remain > 0 && ordered.length > 0) {
    const lastLine = ordered[ordered.length - 1];
    const existing = allocations.find((a) => a.line === lastLine);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + remain) * 10000) / 10000;
    } else {
      allocations.push({ line: lastLine, quantity: remain });
    }
  }
  return allocations;
}

function generateReceiptId(): string {
  return `MR_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateInquiryId(): string {
  return `SI_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateQuoteId(): string {
  return `SQ_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

// ─── 供应商询价状态转换（Open → Compared → Closed；C9：Compared → Open 撤回比价） ───
const INQUIRY_TRANSITIONS: Record<string, string[]> = {
  Open: ['Compared', 'Closed'],
  Compared: ['Closed', 'Open'], // Open = 撤回比价（C9：选错中选供应商可回退重新决策，报价行保留）
  Closed: [], // 终态
};

function validateInquiryStatusTransition(from: string, to: string): void {
  const allowed = INQUIRY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`询价单非法状态转换：${from} → ${to}（允许的目标：${allowed?.join(', ') || '无（终态）'}）`);
  }
}

/** 计算报价的基准币种金额（用于横向比价） */
function calcBaseAmount(quoteAmount: number, exchangeRate?: number): number {
  const rate = exchangeRate && exchangeRate > 0 ? exchangeRate : 1;
  return Math.round(quoteAmount * rate * 10000) / 10000;
}

/**
 * B2：询价比价报价门禁 — 报价供应商必须来自供应商档案且未被拉黑
 * （与 createPurchaseOrder 的 PRD 13.1 黑名单门禁同源：身份真源 Relation → FactoryProfile 1:1。
 *   此前报价环节 supplierName 手打，黑名单供应商可绕过门禁报价甚至中选，本校验收口该旁路。）
 */
async function assertQuotableSupplier(prisma: PrismaClient, supplierId: string | undefined, supplierName?: string): Promise<void> {
  if (!supplierId) {
    throw new Error('报价供应商必须从供应商档案中选择（supplierId 必填，禁止手打供应商名称）');
  }
  const factory = await (prisma as any).factoryProfile?.findUnique?.({ where: { relationId: supplierId } });
  if (!factory || factory.deletedAt !== null) {
    throw new Error(`供应商 ${supplierName || supplierId} 不存在于供应商档案，禁止报价`);
  }
  if (factory.blacklistedAt !== null) {
    throw new Error('该供应商已被拉黑，禁止报价');
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
    /** Excel 台账导出=true：忽略分页上限全量导出（route 层 format=xlsx 专用） */
    exportAll?: boolean;
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

    const limit = params.exportAll ? undefined : Math.min(params.limit ?? 50, 200);
    const offset = params.exportAll ? 0 : (params.offset ?? 0);
    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        ...(limit != null ? { take: limit, skip: offset } : {}),
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

  // ── 状态转换统一入口：按既有状态机流转到目标状态（Agent Flow 与 route 共用） ──
  // 仅委托既有 send/confirm/cancel/close 原子方法，状态机真源仍是 TRANSITIONS + validateStatusTransition；
  // PartiallyReceived/Received 由来料检验驱动，Draft 为初始态，手动设置一律拒绝。
  async function transitionPurchaseOrderStatus(id: string, toStatus: PurchaseOrderStatus, actorId: string, reason?: string): Promise<PurchaseOrderDetail> {
    switch (toStatus) {
      case 'Sent': return sendPurchaseOrder(id, actorId);
      case 'Confirmed': return confirmPurchaseOrder(id, actorId);
      case 'Cancelled': return cancelPurchaseOrder(id, actorId, reason);
      case 'Closed': return closePurchaseOrder(id, actorId);
      default:
        throw new Error(`采购单状态 ${toStatus} 不可手动流转（PartiallyReceived/Received 由来料检验驱动，Draft 为初始态）`);
    }
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

    // C6 幂等口径前置快照：是否「首次进入 Received」（事务内 update 后 existing 可能被复用为返回对象，前态必须先行捕获）
    const isFirstFullReceipt = newStatus === 'Received' && existing.status !== 'Received';

    // 行级回写分配（L8 断层修复）：在事务外按快照确定性计算，事务内执行增量 update。
    // D6：客户端传 lineReceipts 行级明细时按明细精确回写（真源在行，不再按行号分摊）；
    //     缺省退回旧的贪心分摊路径（兼容历史调用方）。
    let stockInLineAllocations: Array<{ line: PurchaseLine; quantity: number }>;
    if (input.lineReceipts && input.lineReceipts.length > 0) {
      const lineById = new Map(existing.lines.map(l => [l.id, l] as const));
      const seen = new Set<string>();
      let sumAccepted = 0;
      let sumRejected = 0;
      stockInLineAllocations = [];
      for (const lr of input.lineReceipts) {
        const line = lineById.get(lr.lineId);
        if (!line) throw new Error(`行级收货明细引用了不属于采购单 ${purchaseOrderId} 的行：${lr.lineId}`);
        if (seen.has(lr.lineId)) throw new Error(`行级收货明细行 ${lr.lineId} 重复`);
        seen.add(lr.lineId);
        const acc = Number(lr.accepted);
        const rej = Number(lr.rejected ?? 0);
        if (!Number.isFinite(acc) || acc < 0) throw new Error(`行级收货明细行 ${lr.lineId} 合格数量非法（须为非负数字）`);
        if (!Number.isFinite(rej) || rej < 0) throw new Error(`行级收货明细行 ${lr.lineId} 不合格数量非法（须为非负数字）`);
        sumAccepted += acc;
        sumRejected += rej;
        if (acc > 0) stockInLineAllocations.push({ line, quantity: Math.round(acc * 10000) / 10000 });
      }
      // 数字正确：行级合计必须与单头总数一致（防"明细一套、总数一套"双口径漂移）
      sumAccepted = Math.round(sumAccepted * 10000) / 10000;
      sumRejected = Math.round(sumRejected * 10000) / 10000;
      if (sumAccepted !== Math.round(Number(input.totalAccepted) * 10000) / 10000) {
        throw new Error(`行级合格合计 ${sumAccepted} 与收货单总合格数 ${input.totalAccepted} 不一致`);
      }
      if (sumRejected !== Math.round(Number(input.totalRejected) * 10000) / 10000) {
        throw new Error(`行级不合格合计 ${sumRejected} 与收货单总不合格数 ${input.totalRejected} 不一致`);
      }
    } else {
      stockInLineAllocations = allocateAcceptedQuantity(existing.lines, input.totalAccepted);
    }
    let replayedDuplicate = false;

    const result = await prisma.$transaction(async (tx) => {
      // 幂等防重：同一采购单下相同收料单号重复确认 → 返回既有记录，不二次累计回写、不发布事件。
      // 最小实现：业务级查重（schema 冻结期不加 unique 约束）；
      // 并发同号双投存在残余竞态窗口，由审计流水 detail.lineWriteback 支持事后追溯。
      const duplicateReceipt = await tx.materialReceipt.findFirst({
        where: { purchaseOrderId, receiptNumber: input.receiptNumber },
      });
      if (duplicateReceipt) {
        replayedDuplicate = true;
        logger.warn('[ProcurementService] duplicate material receipt confirmation ignored', {
          purchaseOrderId,
          receiptNumber: input.receiptNumber,
          existingReceiptId: duplicateReceipt.id,
        });
        return { receipt: duplicateReceipt, purchaseOrder: existing };
      }

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

      // W-C A1：MaterialReceipt 图谱入链（S2 三击追溯）——同事务双写 entityReference/entityLink，
      // 幂等重放路径已在上方提前返回，不会重复挂载。
      await syncMaterialReceiptReferences(prisma, receipt, { source: 'api:procurement' }, tx);

      // 行级回写（L8 断层修复）：PurchaseLine.receivedQuantity += 本次合格数量的行级分配
      // 口径 = 合格数（totalAccepted），与 PO 状态流转及「仅合格数量入库」一致（见 allocateAcceptedQuantity 注释）；
      // 超采允许累计超过 orderedQuantity。回写必须在事务内、事件发布前完成，
      // 保证 MaterialReceived 事件触发 L8 时行级数据已就绪。
      const lineWritebackAudit: Array<{ lineId: string; quantity: number }> = [];
      for (const { line, quantity } of stockInLineAllocations) {
        await tx.purchaseLine.update({
          where: { id: line.id },
          data: { receivedQuantity: { increment: quantity } },
        });
        lineWritebackAudit.push({ lineId: line.id, quantity });
      }

      // 更新采购单状态
      const purchaseOrder = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: newStatus, updatedAt: now },
      });

      // C6：首次全部收齐（→Received）→ 供应商累计单数/金额同事务累加。
      // 幂等口径：仅「首次进入 Received」累加；超收补收（Received → Received）不重复计数。
      // 无工厂档案的供应商静默跳过。
      if (isFirstFullReceipt && existing.supplierRelationId) {
        await accumulateCompletedPurchaseOrderStats(tx, {
          relationId: existing.supplierRelationId,
          amount: Number(existing.totalAmount ?? 0),
          updatedAt: BigInt(now),
        });
      }

      // 审计日志
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_material_receipt',
          targetType: 'PurchaseOrder',
          targetId: purchaseOrderId,
          detail: { source: 'api:procurement', after: { receiptId, receiptNumber: input.receiptNumber, totalAccepted: input.totalAccepted, totalRejected: input.totalRejected, newStatus, lineWriteback: lineWritebackAudit } } as any,
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

    // 幂等重放：重复确认直接返回原收料单，不发布事件、不触发 L8、不计交期评分
    if (replayedDuplicate) {
      return result.receipt;
    }

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
          // D5：收货表单所选仓库随事件透传（收料单 warehouseId/warehouseName 已同事务落库；
          // L8 自动入库消费方据此入库到表单仓库而非默认主仓）
          warehouseId: input.warehouseId ?? null,
          warehouseName: input.warehouseName,
          purchaseOrderStatus: newStatus,
          // L8 行级入库增量契约（MaterialReceivedStockInLine）：仅本次合格数量（合格数口径），
          // 多张部分收料时 L8 不会把历史累计值重复入库；全拒收（totalAccepted=0）时为空数组 → L8 跳过
          stockInLines: stockInLineAllocations.map(({ line, quantity }): MaterialReceivedStockInLine => ({
            lineId: line.id,
            materialCode: line.materialCode ?? null,
            description: line.description || line.materialCode || '未知物料',
            category: line.category ?? null,
            specification: line.specification ?? null,
            unit: line.unit ?? null,
            unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
            quantity,
          })),
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

  // ─── 卡点 3：供应商询价比价（剧本 2.10 验收点） ───

  // ── 创建询价单（Open 状态） ──
  async function createSupplierInquiry(input: CreateSupplierInquiryInput, actorId: string): Promise<SupplierInquiry> {
    const now = Date.now();
    const inquiryId = generateInquiryId();

    const created = await prisma.$transaction(async (tx) => {
      const inquiryNumber = await nextBusinessNumber(tx, 'SI');
      const inquiry = await tx.supplierInquiry.create({
        data: {
          id: inquiryId,
          inquiryNumber,
          status: 'Open',
          description: input.description,
          materialCode: input.materialCode ?? null,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          currency: input.currency,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          orderId: input.orderId ?? null,
          bomId: input.bomId ?? null,
          buyer: input.buyer ?? null,
          supplierQuotes: [],
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_supplier_inquiry',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', after: { inquiryNumber, description: input.description } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return inquiry;
    });

    logger.info('[ProcurementService] supplier inquiry created', { id: inquiryId });
    return created;
  }

  // ── 更新询价单（仅 Open 状态可编辑；C9：Compared → Open 撤回比价专用分支） ──
  async function updateSupplierInquiry(id: string, input: UpdateSupplierInquiryInput, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${id} 不存在`);

    // C9 撤回比价（Compared → Open）：body 携带与现态不同的 status 时按状态机处理。
    // 撤回后回到可编辑/可增删报价/可重新决策态；清除中选快照与决策备注（决策留痕转审计），
    // 报价行全部保留但 isSelected 清零（可重新勾选决策）。
    if (input.status !== undefined && input.status !== existing.status) {
      validateInquiryStatusTransition(existing.status, input.status);
      if (!(existing.status === 'Compared' && input.status === 'Open')) {
        throw new Error(`询价单状态流转 ${existing.status} → ${input.status} 请使用专属操作（比价决策/关闭询价），更新接口仅支持 Compared → Open 撤回比价`);
      }
      const now = Date.now();
      const quotes: SupplierQuoteRecord[] = Array.isArray(existing.supplierQuotes) ? (existing.supplierQuotes as unknown as SupplierQuoteRecord[]) : [];
      const cleared = quotes.map(q => ({ ...q, isSelected: false }));
      const updated = await prisma.$transaction(async (tx) => {
        const inquiry = await tx.supplierInquiry.update({
          where: { id },
          data: {
            status: 'Open',
            supplierQuotes: cleared as any,
            selectedSupplierId: null,
            selectedSupplierName: null,
            decisionNote: null,
            updatedAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
            actorId: actorId || 'system',
            action: 'reopen_supplier_inquiry',
            targetType: 'SupplierInquiry',
            targetId: id,
            detail: { source: 'api:procurement', before: { status: existing.status, selectedSupplierName: existing.selectedSupplierName ?? null, decisionNote: existing.decisionNote ?? null }, after: { status: 'Open' } } as any,
            ip: null,
            operationType: 'transition',
            fieldPath: 'status',
            beforeValue: existing.status,
            afterValue: 'Open',
            transactionId: null,
          },
        });
        return inquiry;
      });

      logger.info('[ProcurementService] supplier comparison reverted (Compared → Open)', { id });
      return updated;
    }

    if (existing.status !== 'Open') {
      throw new Error(`询价单 ${id} 状态为 ${existing.status}，仅 Open 状态可编辑`);
    }

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id },
        data: {
          description: input.description ?? undefined,
          materialCode: input.materialCode ?? undefined,
          quantity: input.quantity ?? undefined,
          unit: input.unit ?? undefined,
          currency: input.currency ?? undefined,
          expectedDeliveryDate: input.expectedDeliveryDate ?? undefined,
          orderId: input.orderId ?? undefined,
          bomId: input.bomId ?? undefined,
          buyer: input.buyer ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_supplier_inquiry',
          targetType: 'SupplierInquiry',
          targetId: id,
          detail: { source: 'api:procurement' } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return inquiry;
    });

    logger.info('[ProcurementService] supplier inquiry updated', { id });
    return updated;
  }

  // ── 软删除询价单（仅 Open 状态） ──
  async function deleteSupplierInquiry(id: string, actorId: string): Promise<void> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${id} 不存在`);
    if (existing.status !== 'Open') {
      throw new Error(`询价单 ${id} 状态为 ${existing.status}，仅 Open 状态可删除`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.supplierInquiry.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_supplier_inquiry',
          targetType: 'SupplierInquiry',
          targetId: id,
          detail: { source: 'api:procurement', before: { inquiryNumber: existing.inquiryNumber, status: existing.status } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });

    logger.info('[ProcurementService] supplier inquiry deleted', { id });
  }

  // ── 查询询价单列表 ──
  async function listSupplierInquiries(params: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: SupplierInquiry[]; total: number }> {
    const where: any = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { inquiryNumber: { contains: params.search } },
        { description: { contains: params.search } },
        { materialCode: { contains: params.search } },
        { buyer: { contains: params.search } },
      ];
    }
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      prisma.supplierInquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.supplierInquiry.count({ where }),
    ]);
    return { items, total };
  }

  // ── 查询单个询价单 ──
  async function getSupplierInquiry(id: string): Promise<SupplierInquiry | null> {
    const inquiry = await prisma.supplierInquiry.findUnique({ where: { id } });
    if (!inquiry || inquiry.deletedAt) return null;
    return inquiry;
  }

  // ── 添加供应商报价（验收点②：多供应商报价记录） ──
  async function addSupplierQuote(inquiryId: string, input: AddSupplierQuoteInput, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${inquiryId} 不存在`);
    if (existing.status !== 'Open') {
      throw new Error(`询价单 ${inquiryId} 状态为 ${existing.status}，仅 Open 状态可添加报价`);
    }

    // B2：报价供应商档案校验（存在且未拉黑；黑名单供应商 403 由路由层映射）
    await assertQuotableSupplier(prisma, input.supplierId, input.supplierName);

    const quotes: SupplierQuoteRecord[] = Array.isArray(existing.supplierQuotes) ? (existing.supplierQuotes as unknown as SupplierQuoteRecord[]) : [];
    const newQuote: SupplierQuoteRecord = {
      id: generateQuoteId(),
      supplierId: input.supplierId ?? undefined,
      supplierName: input.supplierName,
      quoteAmount: input.quoteAmount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      baseAmount: calcBaseAmount(input.quoteAmount, input.exchangeRate),
      quoteDate: input.quoteDate,
      deliveryTerms: input.deliveryTerms ?? undefined,
      paymentTerms: input.paymentTerms ?? undefined,
      expectedDeliveryDate: input.expectedDeliveryDate ?? undefined,
      notes: input.notes ?? undefined,
      isSelected: false,
    };
    quotes.push(newQuote);

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id: inquiryId },
        data: { supplierQuotes: quotes as any, updatedAt: now },
      });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'add_supplier_quote',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', after: { supplierName: input.supplierName, quoteAmount: input.quoteAmount, currency: input.currency } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: 'supplierQuotes',
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
      return inquiry;
    });

    logger.info('[ProcurementService] supplier quote added', { inquiryId, supplierName: input.supplierName });
    return updated;
  }

  // ── 更新供应商报价 ──
  async function updateSupplierQuote(inquiryId: string, quoteId: string, input: Partial<AddSupplierQuoteInput>, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${inquiryId} 不存在`);
    if (existing.status !== 'Open') {
      throw new Error(`询价单 ${inquiryId} 状态为 ${existing.status}，仅 Open 状态可编辑报价`);
    }

    const quotes: SupplierQuoteRecord[] = Array.isArray(existing.supplierQuotes) ? (existing.supplierQuotes as unknown as SupplierQuoteRecord[]) : [];
    const idx = quotes.findIndex(q => q.id === quoteId);
    if (idx < 0) throw new Error(`报价 ${quoteId} 不存在于询价单 ${inquiryId}`);
    const prev = quotes[idx];
    // B2：编辑报价若改动供应商身份（supplierId/supplierName），同样过档案校验，
    // 防止"先加正常供应商报价、再改成黑名单供应商"的旁路；仅改金额等非身份字段不拦截（兼容存量手打报价）
    if (input.supplierId !== undefined || input.supplierName !== undefined) {
      await assertQuotableSupplier(prisma, input.supplierId ?? prev.supplierId, input.supplierName ?? prev.supplierName);
    }
    const next: SupplierQuoteRecord = {
      ...prev,
      supplierId: input.supplierId ?? prev.supplierId,
      supplierName: input.supplierName ?? prev.supplierName,
      quoteAmount: input.quoteAmount ?? prev.quoteAmount,
      currency: input.currency ?? prev.currency,
      exchangeRate: input.exchangeRate ?? prev.exchangeRate,
      quoteDate: input.quoteDate ?? prev.quoteDate,
      deliveryTerms: input.deliveryTerms ?? prev.deliveryTerms,
      paymentTerms: input.paymentTerms ?? prev.paymentTerms,
      expectedDeliveryDate: input.expectedDeliveryDate ?? prev.expectedDeliveryDate,
      notes: input.notes ?? prev.notes,
    };
    // 金额/汇率变化时重算 baseAmount（用于横向比价）
    if (input.quoteAmount != null || input.exchangeRate != null) {
      next.baseAmount = calcBaseAmount(next.quoteAmount, next.exchangeRate);
    }
    quotes[idx] = next;

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id: inquiryId },
        data: { supplierQuotes: quotes as any, updatedAt: now },
      });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_supplier_quote',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', quoteId } as any,
          ip: null,
          operationType: 'update',
          fieldPath: 'supplierQuotes',
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
      return inquiry;
    });

    logger.info('[ProcurementService] supplier quote updated', { inquiryId, quoteId });
    return updated;
  }

  // ── 删除供应商报价 ──
  async function removeSupplierQuote(inquiryId: string, quoteId: string, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${inquiryId} 不存在`);
    if (existing.status !== 'Open') {
      throw new Error(`询价单 ${inquiryId} 状态为 ${existing.status}，仅 Open 状态可删除报价`);
    }

    const quotes: SupplierQuoteRecord[] = Array.isArray(existing.supplierQuotes) ? (existing.supplierQuotes as unknown as SupplierQuoteRecord[]) : [];
    const filtered = quotes.filter(q => q.id !== quoteId);
    if (filtered.length === quotes.length) throw new Error(`报价 ${quoteId} 不存在于询价单 ${inquiryId}`);

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id: inquiryId },
        data: { supplierQuotes: filtered as any, updatedAt: now },
      });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'remove_supplier_quote',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', quoteId } as any,
          ip: null,
          operationType: 'update',
          fieldPath: 'supplierQuotes',
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
      return inquiry;
    });

    logger.info('[ProcurementService] supplier quote removed', { inquiryId, quoteId });
    return updated;
  }

  // ── 比价决策：选定中选供应商（Open → Compared）（验收点③：比价决策可记录） ──
  async function selectSupplier(inquiryId: string, quoteId: string, decisionNote: string, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${inquiryId} 不存在`);
    validateInquiryStatusTransition(existing.status, 'Compared');

    const quotes: SupplierQuoteRecord[] = Array.isArray(existing.supplierQuotes) ? (existing.supplierQuotes as unknown as SupplierQuoteRecord[]) : [];
    const selected = quotes.find(q => q.id === quoteId);
    if (!selected) throw new Error(`报价 ${quoteId} 不存在于询价单 ${inquiryId}，无法比价决策`);

    // 标记中选/落选
    const marked = quotes.map(q => ({ ...q, isSelected: q.id === quoteId }));

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id: inquiryId },
        data: {
          status: 'Compared',
          supplierQuotes: marked as any,
          selectedSupplierId: selected.supplierId ?? null,
          selectedSupplierName: selected.supplierName,
          decisionNote: decisionNote || null,
          updatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'select_supplier',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', before: { status: existing.status }, after: { status: 'Compared', selectedSupplierName: selected.supplierName, decisionNote } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: existing.status,
          afterValue: 'Compared',
          transactionId: null,
        },
      });
      return inquiry;
    });

    logger.info('[ProcurementService] supplier selected', { inquiryId, quoteId, supplierName: selected.supplierName });
    return updated;
  }

  // ── 关闭询价单（Compared → Closed） ──
  async function closeSupplierInquiry(inquiryId: string, actorId: string): Promise<SupplierInquiry> {
    const existing = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId } });
    if (!existing || existing.deletedAt) throw new Error(`询价单 ${inquiryId} 不存在`);
    validateInquiryStatusTransition(existing.status, 'Closed');

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.supplierInquiry.update({
        where: { id: inquiryId },
        data: { status: 'Closed', updatedAt: now },
      });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'close_supplier_inquiry',
          targetType: 'SupplierInquiry',
          targetId: inquiryId,
          detail: { source: 'api:procurement', before: { status: existing.status }, after: { status: 'Closed' } } as any,
          ip: null,
          operationType: 'transition',
          fieldPath: 'status',
          beforeValue: existing.status,
          afterValue: 'Closed',
          transactionId: null,
        },
      });
      return inquiry;
    });

    logger.info('[ProcurementService] supplier inquiry closed', { inquiryId });
    return updated;
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
    transitionPurchaseOrderStatus,
    createMaterialReceipt,
    createSupplierInquiry,
    updateSupplierInquiry,
    deleteSupplierInquiry,
    listSupplierInquiries,
    getSupplierInquiry,
    addSupplierQuote,
    updateSupplierQuote,
    removeSupplierQuote,
    selectSupplier,
    closeSupplierInquiry,
  };
}

export type ProcurementService = ReturnType<typeof createProcurementService>;
