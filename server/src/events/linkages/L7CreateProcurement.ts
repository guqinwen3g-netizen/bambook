/**
 * Phase 2 跨模块联动 — L7
 *
 * 业务规则：BOM 确认（BOMConfirmed）→ 自动生成采购需求草稿
 *
 * 设计决策：
 *   - 仅创建 Draft 采购单，需采购员审核后发送
 *   - BOM 每行物料 → PurchaseLine（materialCode/description/quantity/unit/unitPrice=unitCost）
 *   - 采购单关联 bomId + orderId（从 BOM 继承），便于追溯
 *   - 若 BOM 无 orderId，采购单仅关联 bomId
 *   - 供应商信息为空（需采购员指定）
 *
 * 幂等性：
 *   - in-process: `auto:L7:${bomId}` 去重
 *   - 业务层: 查询是否已有 bomId 关联的未删除采购单，有则跳过
 */

import { businessEventBus } from '../businessEventBus';
import { createProcurementService } from '../../procurement/procurementService';
import { isLinkageEnabled } from '../../config/automationConfig';
import { logger } from '../../lib/logger';

export function registerL7CreateProcurement(): void {
  businessEventBus.registerLinkage({
    id: 'L7_create_procurement',
    eventType: 'BOMConfirmed',
    idempotencyKey: (e) => `auto:L7:${e.sourceEntityId}`,
    execute: async (prisma, event) => {
      if (!isLinkageEnabled('L7_create_procurement')) {
        logger.info('[L7] linkage disabled, skipping', { bomId: event.sourceEntityId });
        return { ok: true, created: null, error: 'linkage disabled' };
      }

      const bomId = event.sourceEntityId;
      const payload = event.payload as {
        bomId?: string;
        bomNumber?: string;
        orderId?: string;
        description?: string;
        currency?: string;
      };

      if (!bomId) {
        logger.warn('[L7] BOMConfirmed event missing bomId, skipping', { eventId: event.id });
        return { ok: true, created: null, error: 'no bomId' };
      }

      try {
        // 查询 BOM 完整信息（含物料行）
        const bom = await prisma.bOM.findUnique({
          where: { id: bomId },
          include: {
            lines: { orderBy: { lineNumber: 'asc' } },
          },
        });

        if (!bom || bom.deletedAt) {
          logger.warn('[L7] BOM not found or deleted', { bomId });
          return { ok: false, error: `BOM ${bomId} not found` };
        }

        // 幂等：检查是否已有该 bomId 关联的未删除采购单
        const existingPO = await prisma.purchaseOrder.findFirst({
          where: { bomId, deletedAt: null },
          select: { id: true, poNumber: true },
        });
        if (existingPO) {
          logger.info('[L7] purchase order already exists for this BOM, skipping', {
            bomId, poId: existingPO.id, poNumber: existingPO.poNumber,
          });
          return { ok: true, created: null, error: 'purchase order already exists' };
        }

        // BOM 无物料行 → 跳过
        if (!bom.lines || bom.lines.length === 0) {
          logger.info('[L7] BOM has no lines, skipping procurement creation', { bomId });
          return { ok: true, created: null, error: 'BOM has no lines' };
        }

        // 映射 BOM 行 → 采购行
        const purchaseLines = bom.lines.map(line => ({
          materialCode: line.materialCode ?? undefined,
          description: line.description,
          category: line.category ?? undefined,
          specification: line.specification ?? undefined,
          quantity: Number(line.effectiveQty),  // 使用实际用量（含损耗）
          unit: line.unit,
          unitPrice: Number(line.unitCost),
          notes: line.notes ?? undefined,
        }));

        // 创建 Draft 采购单
        const service = createProcurementService(prisma);
        const today = new Date().toISOString().slice(0, 10);
        const poNumber = `PO-AUTO-${today.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        const po = await service.createPurchaseOrder({
          poNumber,
          currency: bom.currency || 'CNY',
          orderDate: today,
          bomId,
          orderId: bom.orderId ?? undefined,
          notes: `由 BOM ${bom.bomNumber} 确认后自动生成（L7 联动）`,
          lines: purchaseLines,
        }, event.actorId || 'agent:auto');

        logger.info('[L7] purchase order draft created from BOM', {
          bomId, bomNumber: bom.bomNumber,
          poId: po.id, poNumber: po.poNumber,
          lineCount: purchaseLines.length,
        });

        return {
          ok: true,
          created: {
            purchaseOrderId: po.id,
            poNumber: po.poNumber,
            lineCount: purchaseLines.length,
          },
        };
      } catch (e: any) {
        logger.error('[L7] createProcurement from BOM failed', {
          error: e?.message,
          bomId,
          eventId: event.id,
        });
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });
}
