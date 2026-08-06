/**
 * Phase 2 跨模块联动 — L8
 *
 * 业务规则：采购来料接收（MaterialReceived）→ 自动入库
 *
 * 设计决策：
 *   - 查询采购单行明细，为每个有 materialCode 的行创建/更新库存项 + 入库流水
 *   - 默认入库到主仓（type=Main, isActive=true 的第一个仓库）
 *   - 若无主仓，尝试任意 active 仓库；若无仓库则跳过并告警
 *   - 入库数量 = PurchaseLine.receivedQty（来料接收数量）
 *   - 入库流水 referenceType=PurchaseOrder，referenceId=purchaseOrderId
 *
 * 幂等性：
 *   - in-process: `auto:L8:${receiptId}` 去重
 *   - 业务层: 查询是否已有 referenceId=receiptId 的入库流水，有则跳过
 */

import { businessEventBus } from '../businessEventBus';
import { createInventoryService } from '../../inventory/inventoryService';
import { isLinkageEnabled } from '../../config/automationConfig';
import { logger } from '../../lib/logger';

export function registerL8AutoStockIn(): void {
  businessEventBus.registerLinkage({
    id: 'L8_auto_stock_in',
    eventType: 'MaterialReceived',
    idempotencyKey: (e) => {
      const payload = e.payload as { receiptId?: string };
      return `auto:L8:${payload.receiptId ?? e.sourceEntityId}`;
    },
    execute: async (prisma, event) => {
      if (!isLinkageEnabled('L8_auto_stock_in')) {
        logger.info('[L8] linkage disabled, skipping', { purchaseOrderId: event.sourceEntityId });
        return { ok: true, created: null, error: 'linkage disabled' };
      }

      const payload = event.payload as {
        purchaseOrderId?: string;
        poNumber?: string;
        receiptId?: string;
        receiptNumber?: string;
        warehouseName?: string;
      };

      const purchaseOrderId = payload.purchaseOrderId ?? event.sourceEntityId;
      const receiptId = payload.receiptId;

      if (!purchaseOrderId || !receiptId) {
        logger.warn('[L8] MaterialReceived event missing purchaseOrderId/receiptId', { eventId: event.id });
        return { ok: true, created: null, error: 'missing purchaseOrderId or receiptId' };
      }

      try {
        // 幂等：检查是否已有该 receiptId 的入库流水
        const existingMovement = await prisma.stockMovement.findFirst({
          where: {
            referenceType: 'PurchaseOrder',
            referenceId: receiptId,
          },
          select: { id: true },
        });
        if (existingMovement) {
          logger.info('[L8] stock-in already processed for this receipt, skipping', {
            receiptId, movementId: existingMovement.id,
          });
          return { ok: true, created: null, error: 'already stocked in' };
        }

        // 查询采购单 + 行明细
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: purchaseOrderId },
          include: { lines: true },
        });

        if (!po || po.deletedAt) {
          logger.warn('[L8] purchase order not found', { purchaseOrderId });
          return { ok: false, error: `PO ${purchaseOrderId} not found` };
        }

        // 筛选有接收数量的行
        const receivedLines = po.lines.filter(
          (line: any) => line.receivedQuantity && Number(line.receivedQuantity) > 0,
        );

        if (receivedLines.length === 0) {
          logger.info('[L8] no lines with received quantity, skipping', { purchaseOrderId });
          return { ok: true, created: null, error: 'no received lines' };
        }

        // 查找默认仓库（优先 Main 类型）
        let warehouse = await prisma.warehouse.findFirst({
          where: { type: 'Main', isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        });
        if (!warehouse) {
          warehouse = await prisma.warehouse.findFirst({
            where: { isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          });
        }
        if (!warehouse) {
          logger.warn('[L8] no active warehouse found, skipping stock-in', { purchaseOrderId });
          return { ok: false, error: 'no active warehouse' };
        }

        const inventoryService = createInventoryService(prisma);
        const movementDate = new Date().toISOString().slice(0, 10);
        const createdMovements: string[] = [];

        for (const line of receivedLines) {
          const receivedQty = Number(line.receivedQuantity);
          const materialCode = line.materialCode;
          const description = line.description || materialCode || '未知物料';

          // 查找或创建库存项
          let inventoryItem = null;
          if (materialCode) {
            inventoryItem = await prisma.inventoryItem.findFirst({
              where: {
                warehouseId: warehouse.id,
                materialCode,
                deletedAt: null,
              },
            });
          }

          let itemId: string;
          if (inventoryItem) {
            itemId = inventoryItem.id;
          } else {
            // 创建新库存项（初始数量 0，随后通过入库变动增加）
            const newItem = await inventoryService.createInventoryItem({
              warehouseId: warehouse.id,
              materialCode: materialCode ?? undefined,
              description,
              category: line.category ?? undefined,
              specification: line.specification ?? undefined,
              quantity: 0,
              unit: line.unit || 'PC',
              unitCost: line.unitPrice ? Number(line.unitPrice) : undefined,
              notes: `由采购单 ${po.poNumber} 来料自动创建`,
            }, event.actorId || 'agent:auto');
            itemId = newItem.id;
          }

          // 创建入库变动
          const movement = await inventoryService.createStockMovement({
            itemId,
            type: 'Inbound',
            quantity: receivedQty,
            unit: line.unit || 'PC',
            unitCost: line.unitPrice ? Number(line.unitPrice) : undefined,
            reason: `采购到货：${po.poNumber}`,
            referenceType: 'PurchaseOrder',
            referenceId: receiptId,
            movementDate,
            notes: `L8 联动自动入库，采购行：${description}`,
          }, event.actorId || 'agent:auto');

          createdMovements.push(movement.id);
        }

        logger.info('[L8] auto stock-in completed', {
          purchaseOrderId, poNumber: po.poNumber,
          receiptId, warehouseId: warehouse.id,
          movementCount: createdMovements.length,
        });

        return {
          ok: true,
          created: {
            warehouseId: warehouse.id,
            movementIds: createdMovements,
            movementCount: createdMovements.length,
          },
        };
      } catch (e: any) {
        logger.error('[L8] auto stock-in failed', {
          error: e?.message,
          purchaseOrderId,
          receiptId,
          eventId: event.id,
        });
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });
}
