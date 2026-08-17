/**
 * DR-016 合票建模 — ShipmentOrderAllocation 分配记录服务
 *
 * 职责：
 *   1. 分配记录 CRUD（POST/DELETE/PATCH）
 *   2. 合票校验：同客户同业务线（assertConsolidationAllowed）
 *   3. 跨票累计上限：ORDER_LINE_OVER_ALLOCATED
 *   4. Shipment.orderId 投影维护（首条分配 orderId）
 *
 * 设计原则：
 *   - 服务工厂模式 createAllocationService(prisma)
 *   - 事务内操作，审计失败即回滚（fail-closed）
 *   - 无软删：随 Shipment 软删过滤
 */

import { PrismaClient } from '@prisma/client';
import { writeRouteAuditLog } from '../audit/routeAudit';

// ────────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────────

export type AllocationErrorCode =
  | 'NOT_FOUND'
  | 'SHIPMENT_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ALLOCATION_NOT_FOUND'
  | 'CONSOLIDATION_CUSTOMER_MISMATCH'
  | 'CONSOLIDATION_BUSINESS_LINE_MISMATCH'
  | 'ORDER_LINE_OVER_ALLOCATED'
  | 'VALIDATION_FAILED'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED';

export interface AllocationResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: AllocationErrorCode; message: string };
}

export interface AllocationInput {
  orderId: string;
  orderLineId?: string | null;
  plannedQty?: number | string | null;
  actualQty?: number | string | null;
  unit?: string | null;
  status?: string;
  batchOrCartonNote?: string | null;
  exception?: string | null;
}

export interface AllocationPatch {
  plannedQty?: number | string | null;
  actualQty?: number | string | null;
  unit?: string | null;
  status?: string;
  batchOrCartonNote?: string | null;
  exception?: string | null;
}

const ALLOCATION_STATUSES = new Set(['Planned', 'PartiallyShipped', 'Fulfilled', 'ShortShipped', 'Cancelled']);

function fail<T>(code: AllocationErrorCode, message: string): AllocationResult<T> {
  return { ok: false, error: { code, message } };
}

function newId(prefix: string): string {
  return `${prefix}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createAllocationService(prisma: PrismaClient) {
  const db = prisma as any;
  const now = () => Date.now();

  /**
   * 加载票并验证未软删
   */
  async function loadShipment(t: any, shipmentId: string) {
    const sh = await t.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, deletedAt: true, orderId: true },
    });
    if (!sh || sh.deletedAt) {
      throw Object.assign(new Error(`运单 ${shipmentId} 不存在或已删除`), { code: 'SHIPMENT_NOT_FOUND' });
    }
    return sh;
  }

  /**
   * 加载订单并验证未软删
   */
  async function loadOrder(t: any, orderId: string) {
    const order = await t.order.findUnique({
      where: { id: orderId },
      select: { id: true, deletedAt: true, customerRelationId: true, businessLine: true, customer: true },
    });
    if (!order || order.deletedAt) {
      throw Object.assign(new Error(`订单 ${orderId} 不存在或已删除`), { code: 'ORDER_NOT_FOUND' });
    }
    return order;
  }

  /**
   * 合票校验：票内全部分配的来源订单 → 同一 customerRelationId 且同一 businessLine
   * 任一不符抛 CONSOLIDATION_CUSTOMER_MISMATCH / CONSOLIDATION_BUSINESS_LINE_MISMATCH
   */
  async function assertConsolidationAllowed(t: any, shipmentId: string): Promise<void> {
    const allocations = await t.shipmentOrderAllocation.findMany({
      where: { shipmentId },
      select: { orderId: true },
    });
    if (allocations.length <= 1) return; // 单票或空票无需校验

    const orderIds = [...new Set(allocations.map((a: any) => a.orderId))];
    const orders = await t.order.findMany({
      where: { id: { in: orderIds }, deletedAt: null },
      select: { id: true, customerRelationId: true, businessLine: true, customer: true },
    });

    if (orders.length !== orderIds.length) {
      const found = new Set(orders.map((o: any) => o.id));
      const missing = orderIds.filter(id => !found.has(id));
      throw Object.assign(
        new Error(`合票校验失败：订单 ${missing.join(', ')} 不存在或已删除`),
        { code: 'ORDER_NOT_FOUND' },
      );
    }

    const first = orders[0];
    for (let i = 1; i < orders.length; i++) {
      const o = orders[i];
      // customerRelationId 为 null 时用 customer name 兜底比较（兼容旧数据）
      const firstCustomer = first.customerRelationId ?? first.customer;
      const currCustomer = o.customerRelationId ?? o.customer;
      if (firstCustomer !== currCustomer) {
        throw Object.assign(
          new Error(`合票校验失败：订单 ${o.id} 签约客户与首单不一致（仅同客户允许合票）`),
          { code: 'CONSOLIDATION_CUSTOMER_MISMATCH' },
        );
      }
      const firstLine = first.businessLine ?? 'other';
      const currLine = o.businessLine ?? 'other';
      if (firstLine !== currLine) {
        throw Object.assign(
          new Error(`合票校验失败：订单 ${o.id} 业务线（${currLine}）与首单（${firstLine}）不一致，禁止合票`),
          { code: 'CONSOLIDATION_BUSINESS_LINE_MISMATCH' },
        );
      }
    }
  }

  /**
   * 跨票累计上限校验：该 orderLine 全部分配（排除已取消票）actualQty 累计 + 本次 ≤ OrderLine.quantity
   * 整单分配（orderLineId=null）按订单行汇总同规则
   */
  async function assertOrderLineNotOverAllocated(
    t: any,
    shipmentId: string,
    orderId: string,
    orderLineId: string | null,
    newActualQty: number | null,
  ): Promise<void> {
    if (newActualQty === null || newActualQty === undefined) return; // 无实际数量不校验

    if (orderLineId) {
      // 行级分配：校验该行跨票累计
      const line = await t.orderLine.findUnique({ where: { id: orderLineId }, select: { quantity: true } });
      if (!line) {
        throw Object.assign(new Error(`订单行 ${orderLineId} 不存在`), { code: 'VALIDATION_FAILED' });
      }
      const lineQty = Number(line.quantity);
      if (lineQty === null || lineQty === undefined) return; // 行数量未设置不校验

      // 排除已取消票（Cancelled 状态的 Shipment 不计入累计）
      const allocations = await t.shipmentOrderAllocation.findMany({
        where: {
          orderLineId,
          shipmentId: { not: shipmentId }, // 排除本票
        },
        select: { actualQty: true, shipmentId: true },
      });
      const shipmentIds = [...new Set(allocations.map((a: any) => a.shipmentId))];
      const shipments = await t.shipment.findMany({
        where: { id: { in: shipmentIds }, deletedAt: null },
        select: { id: true, status: true },
      });
      const activeShipmentIds = new Set(
        shipments.filter((s: any) => s.status !== 'Cancelled').map((s: any) => s.id),
      );
      const cumulative = allocations
        .filter((a: any) => activeShipmentIds.has(a.shipmentId))
        .reduce((sum: number, a: any) => sum + (Number(a.actualQty) || 0), 0);

      if (cumulative + newActualQty > lineQty) {
        throw Object.assign(
          new Error(
            `跨票累计超限：订单行 ${orderLineId} 可出运量 ${lineQty}，已分配 ${cumulative}，本次 ${newActualQty} 超出`,
          ),
          { code: 'ORDER_LINE_OVER_ALLOCATED' },
        );
      }
    } else {
      // 整单分配：按订单所有行汇总校验
      // 查询条件：该订单的所有分配（包括行级分配和整单分配），排除已取消票
      const lines = await t.orderLine.findMany({
        where: { orderId },
        select: { id: true, quantity: true },
      });
      if (lines.length === 0) return; // 无行不校验

      // 查询该订单的所有分配（行级 + 整单级），排除本票
      const allAllocations = await t.shipmentOrderAllocation.findMany({
        where: {
          orderId,
          shipmentId: { not: shipmentId },
        },
        select: { actualQty: true, shipmentId: true, orderLineId: true },
      });
      const shipmentIds = [...new Set(allAllocations.map((a: any) => a.shipmentId))];
      const shipments = await t.shipment.findMany({
        where: { id: { in: shipmentIds }, deletedAt: null },
        select: { id: true, status: true },
      });
      const activeShipmentIds = new Set(
        shipments.filter((s: any) => s.status !== 'Cancelled').map((s: any) => s.id),
      );
      const activeAllocations = allAllocations.filter((a: any) => activeShipmentIds.has(a.shipmentId));

      // 整单分配（orderLineId=null）按行数均分校验
      const totalAllocated = activeAllocations.reduce((sum: number, a: any) => sum + (Number(a.actualQty) || 0), 0);
      const perLineQty = newActualQty / lines.length;
      const perLineAllocated = totalAllocated / lines.length;

      for (const line of lines) {
        const lineQty = Number(line.quantity);
        if (lineQty === null || lineQty === undefined) continue;

        if (perLineAllocated + perLineQty > lineQty) {
          throw Object.assign(
            new Error(
              `跨票累计超限：订单 ${orderId} 行 ${line.id} 可出运量 ${lineQty}，已分配 ${perLineAllocated.toFixed(4)}，本次均分 ${perLineQty.toFixed(4)} 超出`,
            ),
            { code: 'ORDER_LINE_OVER_ALLOCATED' },
          );
        }
      }
    }
  }

  /**
   * 维护 Shipment.orderId 投影（= 票内第一条分配的 orderId）
   */
  async function syncShipmentOrderIdProjection(t: any, shipmentId: string): Promise<void> {
    const first = await t.shipmentOrderAllocation.findFirst({
      where: { shipmentId },
      orderBy: { createdAt: 'asc' },
      select: { orderId: true },
    });
    await t.shipment.update({
      where: { id: shipmentId },
      data: { orderId: first?.orderId ?? null },
    });
  }

  /**
   * 新增分配记录
   */
  async function createAllocation(
    shipmentId: string,
    input: AllocationInput,
    actorId: string,
    ip?: string | null,
  ): Promise<AllocationResult<{ allocation: any }>> {
    try {
      const result = await db.$transaction(async (t: any) => {
        await loadShipment(t, shipmentId);
        await loadOrder(t, input.orderId);

        if (input.status && !ALLOCATION_STATUSES.has(input.status)) {
          throw Object.assign(new Error(`非法分配状态：${input.status}`), { code: 'VALIDATION_FAILED' });
        }

        const plannedQty = toDecimal(input.plannedQty);
        const actualQty = toDecimal(input.actualQty);

        // 跨票累计上限校验
        await assertOrderLineNotOverAllocated(t, shipmentId, input.orderId, input.orderLineId ?? null, actualQty);

        // 合票校验（新增前校验现有分配，新增后校验全量）
        await assertConsolidationAllowed(t, shipmentId);

        const id = newId('SHPA');
        const allocation = await t.shipmentOrderAllocation.create({
          data: {
            id,
            shipmentId,
            orderId: input.orderId,
            orderLineId: input.orderLineId ?? null,
            plannedQty,
            actualQty,
            unit: input.unit ?? null,
            status: input.status ?? 'Planned',
            batchOrCartonNote: input.batchOrCartonNote ?? null,
            exception: input.exception ?? null,
            createdAt: BigInt(now()),
            updatedAt: BigInt(now()),
          },
        });

        // 合票校验（含新增后的全量）
        await assertConsolidationAllowed(t, shipmentId);

        // 维护投影
        await syncShipmentOrderIdProjection(t, shipmentId);

        // 审计
        await writeRouteAuditLog({
          prisma: t,
          actorId,
          source: 'shipping-allocation',
          operation: 'ALLOCATION_CREATE',
          targetType: 'ShipmentOrderAllocation',
          targetId: id,
          after: allocation,
          ip,
        });

        return allocation;
      });
      return { ok: true, data: { allocation: result } };
    } catch (e: any) {
      return fail(e.code ?? 'CREATE_FAILED', e.message);
    }
  }

  /**
   * 更新分配记录
   */
  async function updateAllocation(
    shipmentId: string,
    allocationId: string,
    patch: AllocationPatch,
    actorId: string,
    ip?: string | null,
  ): Promise<AllocationResult<{ allocation: any }>> {
    try {
      const result = await db.$transaction(async (t: any) => {
        await loadShipment(t, shipmentId);

        const existing = await t.shipmentOrderAllocation.findUnique({
          where: { id: allocationId },
        });
        if (!existing || existing.shipmentId !== shipmentId) {
          throw Object.assign(new Error(`分配记录 ${allocationId} 不存在或不属于票 ${shipmentId}`), {
            code: 'ALLOCATION_NOT_FOUND',
          });
        }

        if (patch.status && !ALLOCATION_STATUSES.has(patch.status)) {
          throw Object.assign(new Error(`非法分配状态：${patch.status}`), { code: 'VALIDATION_FAILED' });
        }

        const plannedQty = patch.plannedQty !== undefined ? toDecimal(patch.plannedQty) : existing.plannedQty;
        const actualQty = patch.actualQty !== undefined ? toDecimal(patch.actualQty) : existing.actualQty;

        // 跨票累计上限校验（actualQty 变更时）
        if (patch.actualQty !== undefined) {
          await assertOrderLineNotOverAllocated(t, shipmentId, existing.orderId, existing.orderLineId, actualQty);
        }

        const before = { ...existing };
        const allocation = await t.shipmentOrderAllocation.update({
          where: { id: allocationId },
          data: {
            plannedQty,
            actualQty,
            unit: patch.unit !== undefined ? (patch.unit ?? null) : existing.unit,
            status: patch.status ?? existing.status,
            batchOrCartonNote: patch.batchOrCartonNote !== undefined ? (patch.batchOrCartonNote ?? null) : existing.batchOrCartonNote,
            exception: patch.exception !== undefined ? (patch.exception ?? null) : existing.exception,
            updatedAt: BigInt(now()),
          },
        });

        // 审计
        await writeRouteAuditLog({
          prisma: t,
          actorId,
          source: 'shipping-allocation',
          operation: 'ALLOCATION_UPDATE',
          targetType: 'ShipmentOrderAllocation',
          targetId: allocationId,
          before,
          after: allocation,
          ip,
        });

        return allocation;
      });
      return { ok: true, data: { allocation: result } };
    } catch (e: any) {
      return fail(e.code ?? 'UPDATE_FAILED', e.message);
    }
  }

  /**
   * 删除分配记录
   */
  async function deleteAllocation(
    shipmentId: string,
    allocationId: string,
    actorId: string,
    ip?: string | null,
  ): Promise<AllocationResult<{ allocation: any }>> {
    try {
      const result = await db.$transaction(async (t: any) => {
        await loadShipment(t, shipmentId);

        const existing = await t.shipmentOrderAllocation.findUnique({
          where: { id: allocationId },
        });
        if (!existing || existing.shipmentId !== shipmentId) {
          throw Object.assign(new Error(`分配记录 ${allocationId} 不存在或不属于票 ${shipmentId}`), {
            code: 'ALLOCATION_NOT_FOUND',
          });
        }

        await t.shipmentOrderAllocation.delete({ where: { id: allocationId } });

        // 维护投影
        await syncShipmentOrderIdProjection(t, shipmentId);

        // 审计
        await writeRouteAuditLog({
          prisma: t,
          actorId,
          source: 'shipping-allocation',
          operation: 'ALLOCATION_DELETE',
          targetType: 'ShipmentOrderAllocation',
          targetId: allocationId,
          before: existing,
          ip,
        });

        return existing;
      });
      return { ok: true, data: { allocation: result } };
    } catch (e: any) {
      return fail(e.code ?? 'DELETE_FAILED', e.message);
    }
  }

  /**
   * 列出票内分配记录
   */
  async function listAllocations(shipmentId: string): Promise<AllocationResult<{ items: any[] }>> {
    try {
      const items = await db.shipmentOrderAllocation.findMany({
        where: { shipmentId },
        orderBy: { createdAt: 'asc' },
      });
      return { ok: true, data: { items } };
    } catch (e: any) {
      return fail('NOT_FOUND', e.message);
    }
  }

  /**
   * 按订单查询分配记录（跨票）
   */
  async function listAllocationsByOrder(orderId: string): Promise<AllocationResult<{ items: any[] }>> {
    try {
      const items = await db.shipmentOrderAllocation.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      // 补充票状态（用于前端过滤已取消票）
      const shipmentIds = [...new Set(items.map((a: any) => a.shipmentId))];
      const shipments = await db.shipment.findMany({
        where: { id: { in: shipmentIds }, deletedAt: null },
        select: { id: true, status: true, shipmentNumber: true },
      });
      const shipMap = new Map(shipments.map((s: any) => [s.id, s]));
      const enriched = items.map((a: any) => ({
        ...a,
        shipmentStatus: (shipMap.get(a.shipmentId) as any)?.status ?? null,
        shipmentNumber: (shipMap.get(a.shipmentId) as any)?.shipmentNumber ?? null,
      }));
      return { ok: true, data: { items: enriched } };
    } catch (e: any) {
      return fail('NOT_FOUND', e.message);
    }
  }

  return {
    createAllocation,
    updateAllocation,
    deleteAllocation,
    listAllocations,
    listAllocationsByOrder,
    assertConsolidationAllowed, // 暴露供外部（如 QC 门禁）调用
  };
}
