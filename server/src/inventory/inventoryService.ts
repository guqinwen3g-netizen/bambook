/**
 * 库存管理服务 Inventory Service
 *
 * 职责：
 *   1. 仓库 CRUD（多仓库支持）
 *   2. 库存物料 CRUD（按仓库+物料维度）
 *   3. 库存变动：入库/出库/调拨/盘点调整（事务内更新余额 + 写流水）
 *   4. 库存锁定/解锁（已分配未出库）
 *   5. 库存预警（低于最低库存 / 超过最高库存）
 *   6. 业务事件发布（StockLowAlarm / StockOverstockAlarm）
 *
 * 设计原则：
 *   - 软删除（deletedAt BigInt），不物理删除
 *   - 所有库存变动在事务内完成：更新余额 + 写流水 + 审计日志
 *   - 变动类型严格校验（Inbound 增 / Outbound 减 / Transfer 双仓 / Adjustment 任意）
 *   - 余额不可为负（Outbound 时校验 sufficient stock，fail-closed）
 *   - 事件发布失败不阻断业务（fire-and-forget）
 */

import { PrismaClient, Warehouse, InventoryItem, StockMovement } from '@prisma/client';
import { logger } from '../lib/logger';
import { businessEventBus } from '../events/businessEventBus';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export type WarehouseType = 'Main' | 'Auxiliary' | 'Temporary' | 'Virtual';

export interface WarehouseInput {
  code: string;
  name: string;
  type: WarehouseType;
  address?: string;
  manager?: string;
  phone?: string;
  isActive?: boolean;
  sortOrder?: number;
  notes?: string;
}

export type StockMovementType = 'Inbound' | 'Outbound' | 'Transfer' | 'Adjustment' | 'Lock' | 'Unlock';

export interface InventoryItemInput {
  warehouseId: string;
  productAssetId?: string;
  materialCode?: string;
  description: string;
  category?: string;
  specification?: string;
  batchNumber?: string;
  locationCode?: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  currency?: string;
  minStock?: number;
  maxStock?: number;
  notes?: string;
}

export interface StockMovementInput {
  itemId: string;
  type: StockMovementType;
  quantity: number;
  unit?: string;
  unitCost?: number;
  targetWarehouseId?: string; // 仅 Transfer
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  movementDate?: string;
  notes?: string;
}

export interface InventoryItemDetail extends InventoryItem {
  warehouse?: Warehouse | null;
  movements?: StockMovement[];
}

// ────────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────────

const VALID_MOVEMENT_TYPES: StockMovementType[] = ['Inbound', 'Outbound', 'Transfer', 'Adjustment', 'Lock', 'Unlock'];

// ────────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────────

function generateWarehouseId(): string {
  return `WH_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateInventoryId(): string {
  return `INV_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateMovementId(): string {
  return `SM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDecimal(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function validateMovementType(type: string): asserts type is StockMovementType {
  if (!VALID_MOVEMENT_TYPES.includes(type as StockMovementType)) {
    throw new Error(`非法库存变动类型：${type}（允许：${VALID_MOVEMENT_TYPES.join(', ')}）`);
  }
}

// ────────────────────────────────────────────────────────────────
// 服务工厂
// ────────────────────────────────────────────────────────────────

export function createInventoryService(prisma: PrismaClient) {
  // ════════════════════════════════════════
  // 仓库 CRUD
  // ════════════════════════════════════════

  async function createWarehouse(input: WarehouseInput, actorId: string): Promise<Warehouse> {
    const existing = await prisma.warehouse.findUnique({ where: { code: input.code } });
    if (existing && !existing.deletedAt) {
      throw new Error(`仓库编码 ${input.code} 已存在`);
    }

    const now = Date.now();
    const warehouse = await prisma.warehouse.create({
      data: {
        id: generateWarehouseId(),
        code: input.code,
        name: input.name,
        type: input.type,
        address: input.address ?? null,
        manager: input.manager ?? null,
        phone: input.phone ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    await prisma.auditLog.create({
      data: {
        id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: actorId || 'system',
        action: 'create_warehouse',
        targetType: 'Warehouse',
        targetId: warehouse.id,
        detail: { source: 'api:inventory', after: { code: input.code, name: input.name, type: input.type } } as any,
        ip: null,
        operationType: 'create',
        fieldPath: null,
        beforeValue: null as any,
        afterValue: null as any,
        transactionId: null,
      },
    });

    logger.info('[InventoryService] warehouse created', { id: warehouse.id, code: input.code });
    return warehouse;
  }

  async function listWarehouses(includeInactive = false): Promise<Warehouse[]> {
    const where: any = includeInactive ? {} : { isActive: true, deletedAt: null };
    return prisma.warehouse.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async function updateWarehouse(id: string, input: Partial<WarehouseInput>, actorId: string): Promise<Warehouse> {
    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`仓库 ${id} 不存在`);

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          type: input.type ?? undefined,
          address: input.address ?? undefined,
          manager: input.manager ?? undefined,
          phone: input.phone ?? undefined,
          isActive: input.isActive ?? undefined,
          sortOrder: input.sortOrder ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_warehouse',
          targetType: 'Warehouse',
          targetId: id,
          detail: { source: 'api:inventory', before: { name: existing.name }, after: { name: input.name } } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return warehouse;
    });

    return updated;
  }

  async function deleteWarehouse(id: string, actorId: string): Promise<void> {
    const existing = await prisma.warehouse.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`仓库 ${id} 不存在`);

    // 检查是否有关联库存项
    const itemCount = await prisma.inventoryItem.count({ where: { warehouseId: id, deletedAt: null, quantity: { gt: 0 } } });
    if (itemCount > 0) {
      throw new Error(`仓库 ${id} 仍有 ${itemCount} 个非零库存项，不可删除`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.warehouse.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedAt: now } });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_warehouse',
          targetType: 'Warehouse',
          targetId: id,
          detail: { source: 'api:inventory', before: { code: existing.code, name: existing.name } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });
  }

  // ════════════════════════════════════════
  // 库存物料 CRUD
  // ════════════════════════════════════════

  async function createInventoryItem(input: InventoryItemInput, actorId: string): Promise<InventoryItemDetail> {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse || !warehouse.isActive || warehouse.deletedAt) {
      throw new Error(`仓库 ${input.warehouseId} 不存在或已停用`);
    }

    const now = Date.now();
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: {
          id: generateInventoryId(),
          warehouseId: input.warehouseId,
          productAssetId: input.productAssetId ?? null,
          materialCode: input.materialCode ?? null,
          description: input.description,
          category: input.category ?? null,
          specification: input.specification ?? null,
          batchNumber: input.batchNumber ?? null,
          locationCode: input.locationCode ?? null,
          quantity: input.quantity,
          lockedQuantity: 0,
          unit: input.unit,
          unitCost: input.unitCost ?? null,
          currency: input.currency ?? 'CNY',
          minStock: input.minStock ?? null,
          maxStock: input.maxStock ?? null,
          lastInDate: input.quantity > 0 ? new Date().toISOString().slice(0, 10) : null,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        },
        include: { warehouse: true },
      });

      // 如果初始数量 > 0，自动生成一条入库流水
      if (input.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            id: generateMovementId(),
            movementNumber: `SM-INIT-${now}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'Inbound',
            itemId: created.id,
            warehouseId: input.warehouseId,
            quantity: input.quantity,
            unit: input.unit,
            unitCost: input.unitCost ?? null,
            balanceBefore: 0,
            balanceAfter: input.quantity,
            reason: '初始入库',
            referenceType: 'Manual',
            movementDate: new Date().toISOString().slice(0, 10),
            createdAt: now,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'create_inventory_item',
          targetType: 'InventoryItem',
          targetId: created.id,
          detail: { source: 'api:inventory', after: { description: input.description, quantity: input.quantity, unit: input.unit } } as any,
          ip: null,
          operationType: 'create',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return created;
    });

    logger.info('[InventoryService] inventory item created', { id: item.id, description: input.description });
    return item as InventoryItemDetail;
  }

  async function listInventoryItems(params: {
    warehouseId?: string;
    category?: string;
    materialCode?: string;
    search?: string;
    lowStockOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InventoryItemDetail[]; total: number }> {
    const where: any = { deletedAt: null };
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.category) where.category = params.category;
    if (params.materialCode) where.materialCode = { contains: params.materialCode };
    if (params.search) {
      where.OR = [
        { description: { contains: params.search } },
        { materialCode: { contains: params.search } },
        { batchNumber: { contains: params.search } },
      ];
    }
    if (params.lowStockOnly) {
      where.minStock = { not: null };
      // lowStock: quantity <= minStock
      // Prisma 无法直接做跨字段比较，用 raw filter
    }

    const limit = Math.min(params.limit ?? 100, 500);
    const offset = params.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { warehouse: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    // 内存过滤 lowStockOnly（跨字段比较）
    const filtered = params.lowStockOnly
      ? items.filter((item: any) => item.minStock != null && Number(item.quantity) <= Number(item.minStock))
      : items;

    return { items: filtered as InventoryItemDetail[], total: params.lowStockOnly ? filtered.length : total };
  }

  async function getInventoryItem(id: string): Promise<InventoryItemDetail | null> {
    const item = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        warehouse: true,
        movements: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!item || item.deletedAt) return null;
    return item as InventoryItemDetail;
  }

  async function updateInventoryItem(id: string, input: Partial<InventoryItemInput>, actorId: string): Promise<InventoryItemDetail> {
    const existing = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`库存项 ${id} 不存在`);

    const now = Date.now();
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.update({
        where: { id },
        data: {
          materialCode: input.materialCode ?? undefined,
          description: input.description ?? undefined,
          category: input.category ?? undefined,
          specification: input.specification ?? undefined,
          batchNumber: input.batchNumber ?? undefined,
          locationCode: input.locationCode ?? undefined,
          unitCost: input.unitCost ?? undefined,
          currency: input.currency ?? undefined,
          minStock: input.minStock ?? undefined,
          maxStock: input.maxStock ?? undefined,
          notes: input.notes ?? undefined,
          updatedAt: now,
        },
        include: { warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'update_inventory_item',
          targetType: 'InventoryItem',
          targetId: id,
          detail: { source: 'api:inventory', after: input } as any,
          ip: null,
          operationType: 'update',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });

      return item;
    });

    return updated as InventoryItemDetail;
  }

  async function deleteInventoryItem(id: string, actorId: string): Promise<void> {
    const existing = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error(`库存项 ${id} 不存在`);
    if (Number(existing.quantity) !== 0) {
      throw new Error(`库存项 ${id} 仍有库存 ${existing.quantity} ${existing.unit}，不可删除（请先出库或盘点清零）`);
    }

    const now = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: 'delete_inventory_item',
          targetType: 'InventoryItem',
          targetId: id,
          detail: { source: 'api:inventory', before: { description: existing.description } } as any,
          ip: null,
          operationType: 'delete',
          fieldPath: null,
          beforeValue: null as any,
          afterValue: null as any,
          transactionId: null,
        },
      });
    });
  }

  // ════════════════════════════════════════
  // 库存变动（核心：入库/出库/调拨/盘点/锁定）
  // ════════════════════════════════════════

  async function createStockMovement(input: StockMovementInput, actorId: string): Promise<StockMovement> {
    validateMovementType(input.type);

    const item = await prisma.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item || item.deletedAt) throw new Error(`库存项 ${input.itemId} 不存在`);

    const warehouse = await prisma.warehouse.findUnique({ where: { id: item.warehouseId } });
    if (!warehouse || warehouse.deletedAt) throw new Error(`仓库 ${item.warehouseId} 不存在`);

    const now = Date.now();
    const movementDate = input.movementDate || new Date().toISOString().slice(0, 10);
    const currentQty = Number(item.quantity);
    const currentLocked = Number(item.lockedQuantity);
    const moveQty = input.quantity;
    const unit = input.unit || item.unit;

    // 计算变动后余额
    let balanceAfter: number;
    let newQty: number;
    let newLockedQty = currentLocked;
    let lastInDate = item.lastInDate;
    let lastOutDate = item.lastOutDate;

    switch (input.type) {
      case 'Inbound':
        newQty = toDecimal(currentQty + moveQty);
        balanceAfter = newQty;
        lastInDate = movementDate;
        break;
      case 'Outbound':
        if (moveQty > currentQty) {
          throw new Error(`库存不足：当前 ${currentQty} ${unit}，尝试出库 ${moveQty} ${unit}`);
        }
        newQty = toDecimal(currentQty - moveQty);
        balanceAfter = newQty;
        lastOutDate = movementDate;
        break;
      case 'Adjustment':
        // Adjustment: quantity 为目标绝对值（盘点后实际数量）
        newQty = toDecimal(moveQty);
        balanceAfter = newQty;
        break;
      case 'Lock':
        if (toDecimal(currentLocked + moveQty) > currentQty) {
          throw new Error(`可锁定库存不足：当前可用 ${currentQty - currentLocked} ${unit}，尝试锁定 ${moveQty} ${unit}`);
        }
        newQty = currentQty; // 锁定不改变 quantity
        newLockedQty = toDecimal(currentLocked + moveQty);
        balanceAfter = newQty; // 余额不变
        break;
      case 'Unlock':
        if (moveQty > currentLocked) {
          throw new Error(`解锁数量超过已锁定：当前锁定 ${currentLocked} ${unit}，尝试解锁 ${moveQty} ${unit}`);
        }
        newQty = currentQty;
        newLockedQty = toDecimal(currentLocked - moveQty);
        balanceAfter = newQty;
        break;
      case 'Transfer':
        // 调拨：从源仓库出库，在目标仓库入库（分两步，但同一事务）
        if (!input.targetWarehouseId) throw new Error('调拨必须指定目标仓库');
        if (moveQty > currentQty) {
          throw new Error(`库存不足：当前 ${currentQty} ${unit}，尝试调拨 ${moveQty} ${unit}`);
        }
        newQty = toDecimal(currentQty - moveQty);
        balanceAfter = newQty;
        lastOutDate = movementDate;
        break;
      default:
        throw new Error(`未实现的变动类型：${input.type}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. 创建流水记录
      const movement = await tx.stockMovement.create({
        data: {
          id: generateMovementId(),
          movementNumber: `SM-${movementDate.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          type: input.type,
          itemId: input.itemId,
          warehouseId: item.warehouseId,
          targetWarehouseId: input.targetWarehouseId ?? null,
          quantity: moveQty,
          unit,
          unitCost: input.unitCost ?? null,
          balanceBefore: currentQty,
          balanceAfter,
          reason: input.reason ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          operator: actorId || 'system',
          movementDate,
          notes: input.notes ?? null,
          createdAt: now,
        },
      });

      // 2. 更新库存项余额
      const updatedItem = await tx.inventoryItem.update({
        where: { id: input.itemId },
        data: {
          quantity: newQty,
          lockedQuantity: newLockedQty,
          lastInDate,
          lastOutDate,
          updatedAt: now,
        },
      });

      // 3. 调拨：在目标仓库创建/更新库存项 + 写入库流水
      let targetMovement: any = null;
      if (input.type === 'Transfer' && input.targetWarehouseId) {
        const targetWarehouse = await tx.warehouse.findUnique({ where: { id: input.targetWarehouseId } });
        if (!targetWarehouse || !targetWarehouse.isActive || targetWarehouse.deletedAt) {
          throw new Error(`目标仓库 ${input.targetWarehouseId} 不存在或已停用`);
        }

        // 查找目标仓库是否已有同物料库存项
        let targetItem = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: input.targetWarehouseId,
            materialCode: item.materialCode ?? undefined,
            productAssetId: item.productAssetId ?? undefined,
            batchNumber: item.batchNumber ?? undefined,
            deletedAt: null,
          },
        });

        if (!targetItem) {
          targetItem = await tx.inventoryItem.create({
            data: {
              id: generateInventoryId(),
              warehouseId: input.targetWarehouseId,
              productAssetId: item.productAssetId ?? null,
              materialCode: item.materialCode ?? null,
              description: item.description,
              category: item.category ?? null,
              specification: item.specification ?? null,
              batchNumber: item.batchNumber ?? null,
              locationCode: null,
              quantity: moveQty,
              lockedQuantity: 0,
              unit: item.unit,
              unitCost: item.unitCost ?? null,
              currency: item.currency,
              minStock: item.minStock ?? null,
              maxStock: item.maxStock ?? null,
              lastInDate: movementDate,
              notes: `从仓库 ${warehouse.code} 调入`,
              createdAt: now,
              updatedAt: now,
            },
          });
        } else {
          targetItem = await tx.inventoryItem.update({
            where: { id: targetItem.id },
            data: {
              quantity: toDecimal(Number(targetItem.quantity) + moveQty),
              lastInDate: movementDate,
              updatedAt: now,
            },
          });
        }

        // 写目标仓库入库流水
        targetMovement = await tx.stockMovement.create({
          data: {
            id: generateMovementId(),
            movementNumber: `SM-${movementDate.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            type: 'Inbound',
            itemId: targetItem.id,
            warehouseId: input.targetWarehouseId,
            quantity: moveQty,
            unit,
            unitCost: input.unitCost ?? null,
            balanceBefore: Number(targetItem.quantity) - moveQty,
            balanceAfter: Number(targetItem.quantity),
            reason: `从仓库 ${warehouse.code} 调入`,
            referenceType: 'Transfer',
            referenceId: movement.id,
            operator: actorId || 'system',
            movementDate,
            createdAt: now,
          },
        });
      }

      // 4. 审计日志
      await tx.auditLog.create({
        data: {
          id: `alog_${now}_${Math.random().toString(36).slice(2, 8)}`,
          actorId: actorId || 'system',
          action: `stock_movement_${input.type.toLowerCase()}`,
          targetType: 'InventoryItem',
          targetId: input.itemId,
          detail: {
            source: 'api:inventory',
            after: { movementId: movement.id, type: input.type, quantity: moveQty, balanceBefore: currentQty, balanceAfter },
          } as any,
          ip: null,
          operationType: input.type === 'Outbound' || input.type === 'Transfer' ? 'decrement' : 'increment',
          fieldPath: 'quantity',
          beforeValue: currentQty as any,
          afterValue: balanceAfter as any,
          transactionId: null,
        },
      });

      return { movement, updatedItem, targetMovement };
    });

    // 5. 库存预警事件（事务提交后，fire-and-forget）
    try {
      if (item.minStock != null && newQty <= Number(item.minStock)) {
        businessEventBus.publish({
          id: `bev_stock_low_${now}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'StockLowAlarm',
          sourceEntityType: 'InventoryItem',
          sourceEntityId: input.itemId,
          payload: {
            itemId: input.itemId,
            description: item.description,
            materialCode: item.materialCode,
            warehouseCode: warehouse.code,
            warehouseName: warehouse.name,
            currentQty: newQty,
            minStock: Number(item.minStock),
            unit: item.unit,
            movementType: input.type,
          },
          occurredAt: now,
          actorId: actorId || 'system',
        });
      }
      if (item.maxStock != null && newQty >= Number(item.maxStock) && input.type === 'Inbound') {
        businessEventBus.publish({
          id: `bev_stock_over_${now}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'StockOverstockAlarm',
          sourceEntityType: 'InventoryItem',
          sourceEntityId: input.itemId,
          payload: {
            itemId: input.itemId,
            description: item.description,
            materialCode: item.materialCode,
            warehouseCode: warehouse.code,
            warehouseName: warehouse.name,
            currentQty: newQty,
            maxStock: Number(item.maxStock),
            unit: item.unit,
          },
          occurredAt: now,
          actorId: actorId || 'system',
        });
      }
    } catch (e: any) {
      logger.warn('[InventoryService] stock alarm event publish failed (non-blocking)', { error: e?.message });
    }

    logger.info('[InventoryService] stock movement created', {
      itemId: input.itemId, type: input.type, qty: moveQty, balanceBefore: currentQty, balanceAfter,
    });

    return result.movement;
  }

  // ════════════════════════════════════════
  // 库存变动流水查询
  // ════════════════════════════════════════

  async function listStockMovements(params: {
    itemId?: string;
    warehouseId?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: StockMovement[]; total: number }> {
    const where: any = {};
    if (params.itemId) where.itemId = params.itemId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.type) where.type = params.type;
    if (params.dateFrom || params.dateTo) {
      where.movementDate = {};
      if (params.dateFrom) where.movementDate.gte = params.dateFrom;
      if (params.dateTo) where.movementDate.lte = params.dateTo;
    }

    const limit = Math.min(params.limit ?? 100, 500);
    const offset = params.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return { items, total };
  }

  // ════════════════════════════════════════
  // 库存预警查询
  // ════════════════════════════════════════

  async function getLowStockItems(): Promise<InventoryItemDetail[]> {
    const items = await prisma.inventoryItem.findMany({
      where: { deletedAt: null, minStock: { not: null } },
      include: { warehouse: true },
    });
    return items.filter((item: any) => Number(item.quantity) <= Number(item.minStock)) as InventoryItemDetail[];
  }

  return {
    // 仓库
    createWarehouse,
    listWarehouses,
    updateWarehouse,
    deleteWarehouse,
    // 库存物料
    createInventoryItem,
    listInventoryItems,
    getInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    // 库存变动
    createStockMovement,
    listStockMovements,
    // 预警
    getLowStockItems,
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
