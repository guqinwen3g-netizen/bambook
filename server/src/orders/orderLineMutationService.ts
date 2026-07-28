/**
 * ERP-P1-order-line-mutation-route-foundation
 *
 * OrderLine create/update service（route + Agent flow 共用契约）。
 * OrderLine create/update + syncOrderLineEntityReferences + AuditLog 同事务闭环，失败 fail closed。
 * 显式校验 parent Order 存在且未 deleted。
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';
import { syncOrderLineEntityReferences, deactivateEntityLinks } from '../entities/sync';
import { advanceStage } from '../production/stageService';
import { nextItemNo } from './orderLineItems';

export type OrderLineMutationErrorCode =
  | 'INVALID_INPUT'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_LINE_NOT_FOUND'
  | 'DUPLICATE_ITEM_NO'
  | 'CREATE_LINE_FAILED'
  | 'UPDATE_LINE_FAILED';

export interface OrderLineMutationError {
  code: OrderLineMutationErrorCode;
  message: string;
}

export interface CreateOrderLineParams {
  prisma: PrismaClient;
  orderId: string;
  itemNo?: string; // 可选：不传则事务内自动计算下一个
  materialCode?: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  type?: string; // 从 parent Order.type 透传，决定 linkKind
  fieldSources?: Record<string, unknown>;
  actorId?: string;
  extra?: Record<string, unknown>; // 其他可写字段（millQuality/width 等）
}

export interface CreateOrderLineResult {
  ok: boolean;
  error?: OrderLineMutationError;
  data?: { line: any; auditId: string };
}

export async function createOrderLine(params: CreateOrderLineParams): Promise<CreateOrderLineResult> {
  const { prisma, orderId, itemNo, materialCode, description, quantity, unit, unitPrice, type, fieldSources, actorId, extra } = params;
  const now = BigInt(Date.now());

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // parent Order 校验（存在且未 deleted）
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.deletedAt) {
        throw Object.assign(new Error(`Order ${orderId} not found or deleted`), { code: 'ORDER_NOT_FOUND', statusCode: 404 });
      }

      // 事务内计算 lineNumber + itemNo（基于 tx.orderLine.findMany，避免 route/service contract drift）
      const existingLines = await tx.orderLine.findMany({ where: { orderId }, select: { itemNo: true } });
      const existingItemNos = existingLines.map((l: any) => l.itemNo).filter(Boolean) as string[];
      const finalItemNo = itemNo || nextItemNo(existingItemNos);
      const lineNumber = existingLines.length + 1;

      // 重复 itemNo 校验
      if (itemNo && existingItemNos.includes(itemNo)) {
        throw Object.assign(new Error(`OrderLine with itemNo ${itemNo} already exists in order ${orderId}`), { code: 'DUPLICATE_ITEM_NO', statusCode: 409 });
      }

      const lineId = `${orderId}__${finalItemNo}`;
      const lineType = type || order.type;
      const created = await tx.orderLine.create({
        data: {
          id: lineId,
          orderId,
          lineNumber,
          itemNo: finalItemNo,
          materialCode: materialCode || null,
          description: description || null,
          quantity,
          unit: unit || null,
          unitPrice: unitPrice ?? null,
          status: 'Pending',
          fieldSources: fieldSources || { _manual: true },
          ...(extra || {}),
        } as any,
      });

      // sync（同事务，fail closed）— type 从 parent order 透传
      const lineForSync = { ...created, type: lineType };
      await syncOrderLineEntityReferences(prisma, lineForSync as any, { source: 'route:order-line:create' }, tx);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:order-line:create',
        operation: 'create_order_line', targetType: 'OrderLine', targetId: created.id,
        after: { id: created.id, orderId, itemNo: finalItemNo, materialCode: materialCode || null, lineNumber },
      });

      // hydrate parent order（前端 serializeOrderLine 读 line.order）
      return { line: { ...created, order }, auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'CREATE_LINE_FAILED', message: `Create order line failed: ${String(e?.message ?? e)}` } };
  }
}

export interface UpdateOrderLineParams {
  prisma: PrismaClient;
  lineId: string;
  patch: Record<string, unknown>;
  actorId?: string;
}

export interface UpdateOrderLineResult {
  ok: boolean;
  error?: OrderLineMutationError;
  data?: { line: any; auditId: string };
}

export async function updateOrderLine(params: UpdateOrderLineParams): Promise<UpdateOrderLineResult> {
  const { prisma, lineId, patch, actorId } = params;
  const now = BigInt(Date.now());

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.orderLine.findUnique({ where: { id: lineId } });
      if (!existing) {
        throw Object.assign(new Error(`OrderLine ${lineId} not found`), { code: 'ORDER_LINE_NOT_FOUND', statusCode: 404 });
      }

      // parent Order 校验
      const order = await tx.order.findUnique({ where: { id: existing.orderId } });
      if (!order || order.deletedAt) {
        throw Object.assign(new Error(`Parent Order ${existing.orderId} not found or deleted`), { code: 'ORDER_NOT_FOUND', statusCode: 404 });
      }

      const updated = await tx.orderLine.update({
        where: { id: lineId },
        data: { ...patch } as any,
      });

      // sync（materialCode 变化时）— type 从 parent order 透传
      const lineForSync = { ...updated, type: order.type };
      await syncOrderLineEntityReferences(prisma, lineForSync as any, { source: 'route:order-line:update' }, tx);

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:order-line:update',
        operation: 'update_order_line', targetType: 'OrderLine', targetId: lineId,
        before: { materialCode: existing.materialCode, quantity: Number(existing.quantity) },
        after: { materialCode: updated.materialCode, quantity: Number(updated.quantity) },
      });

      // hydrate parent order（前端 serializeOrderLine 读 line.order）
      return { line: { ...updated, order }, auditId };
    });

    // 生产管线联动：检查订单所有 OrderLine 的 productionSteps 是否全部 done
    // 如果是，自动推进 manufacturing 阶段
    const allLines = await prisma.orderLine.findMany({
      where: { orderId: result.line.orderId },
      select: { productionSteps: true },
    });
    const allStepsDone = allLines.length > 0 && allLines.every((line: any) => {
      const steps = Array.isArray(line.productionSteps) ? line.productionSteps : [];
      return steps.length > 0 && steps.every((s: any) => s.status === 'done');
    });
    if (allStepsDone) {
      await advanceStage({
        prisma,
        orderId: result.line.orderId,
        stageKey: 'manufacturing',
        operator: actorId || 'system',
        note: '所有工序行已完成（自动推进）',
      }).catch(() => {});
    }

    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'UPDATE_LINE_FAILED', message: `Update order line failed: ${String(e?.message ?? e)}` } };
  }
}

export async function deleteOrderLine(params: {
  prisma: PrismaClient;
  lineId: string;
  actorId?: string;
}): Promise<{ ok: true; data: { auditId: string } } | { ok: false; error: { code: string; message: string } }> {
  const { prisma, lineId, actorId } = params;
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.orderLine.findUnique({ where: { id: lineId }, select: { id: true, orderId: true, itemNo: true, lineNumber: true } });
      if (!existing) throw Object.assign(new Error(`order line ${lineId} not found`), { code: 'ORDER_LINE_NOT_FOUND', statusCode: 404 });

      // 检查是否有关联的发货/发票记录（通过 EntityLink 查）
      const linkCount = await tx.entityLink.count({ where: { sourceType: 'orderLine', sourceId: lineId, deletedAt: null } }).catch(() => 0);
      if (linkCount > 0) {
        await deactivateEntityLinks(tx, 'orderLine', lineId, BigInt(Date.now()));
      }

      await tx.orderLine.delete({ where: { id: lineId } });

      const auditId = await writeRouteAuditLog({
        prisma: tx, actorId: actorId || 'api', source: 'route:order-line:delete',
        operation: 'delete_order_line', targetType: 'OrderLine', targetId: lineId,
        before: { id: lineId, orderId: existing.orderId, itemNo: existing.itemNo, lineNumber: existing.lineNumber },
      });
      return { auditId };
    });
    return { ok: true, data: result };
  } catch (e: any) {
    if (e.code) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'DELETE_LINE_FAILED', message: `Delete order line failed: ${String(e?.message ?? e)}` } };
  }
}
