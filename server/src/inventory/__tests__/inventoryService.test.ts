import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createInventoryService, WarehouseInput, InventoryItemInput, StockMovementInput } from '../inventoryService';
import { businessEventBus } from '../../events/businessEventBus';

/**
 * task ERP-P2-inventory-service-foundation:
 * 覆盖 inventoryService 的仓库/库存物料 CRUD + 库存变动（入库/出库/调拨/盘点/锁定/解锁）
 * + 余额校验 + 事务回滚 + 审计 + 预警事件发布 + fail-closed 契约。
 *
 * 设计：
 *   - 用 $transaction: (fn) => fn(tx) 透明穿透模式，验证 audit reject → 事务回滚
 *   - 所有 mutation 都在事务内写 auditLog，audit reject 必须回滚业务操作
 *   - 库存变动在事务提交后 publish 预警事件（StockLowAlarm / StockOverstockAlarm）
 *   - 余额不可为负：Outbound / Transfer / Lock 校验 sufficient stock，fail-closed
 *   - 变动类型严格校验：非法类型抛错
 *   - 调拨：源仓库出库 + 目标仓库入库（同事务双写）
 */

// ── Mock businessEventBus.publish（fire-and-forget，但需验证调用契约） ──
const publishSpy = vi.spyOn(businessEventBus, 'publish').mockResolvedValue(undefined);

// ── 工厂：构造 mock prisma + tx ──
function makePrisma(opts: {
  existingWarehouse?: any;
  existingItem?: any;
  existingTargetItem?: any;
  targetWarehouse?: any;
  auditFail?: boolean;
  movementCreateFail?: boolean;
  itemUpdateFail?: boolean;
  warehouseCount?: number;
} = {}) {
  const existingWarehouse = opts.existingWarehouse ?? null;
  const existingItem = opts.existingItem ?? null;
  const existingTargetItem = opts.existingTargetItem ?? null;

  // Warehouse
  const warehouseFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id === existingWarehouse?.id || where.code === existingWarehouse?.code) return existingWarehouse;
    if (where.id === opts.targetWarehouse?.id) return opts.targetWarehouse;
    return null;
  });
  const warehouseFindMany = vi.fn().mockResolvedValue(existingWarehouse ? [existingWarehouse] : []);
  const warehouseCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    ...data,
    items: [],
  }));
  const warehouseUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => ({
    ...existingWarehouse,
    ...data,
    id: where.id,
  }));

  // InventoryItem
  const inventoryItemFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    if (where.id === existingItem?.id) return existingItem;
    return null;
  });
  const inventoryItemFindFirst = vi.fn().mockImplementation(async () => existingTargetItem);
  const inventoryItemFindMany = vi.fn().mockResolvedValue(existingItem ? [existingItem] : []);
  const inventoryItemCount = vi.fn().mockResolvedValue(opts.warehouseCount ?? 0);
  const inventoryItemCreate = vi.fn().mockImplementation(async ({ data, include }: any) => ({
    ...data,
    warehouse: existingWarehouse,
  }));
  const inventoryItemUpdate = opts.itemUpdateFail
    ? vi.fn().mockRejectedValue(new Error('UPDATE_BOOM'))
    : vi.fn().mockImplementation(async ({ where, data, include }: any) => ({
        ...existingItem,
        ...data,
        id: where.id,
        warehouse: existingWarehouse,
      }));

  // StockMovement
  const stockMovementCreate = opts.movementCreateFail
    ? vi.fn().mockRejectedValue(new Error('SM_BOOM'))
    : vi.fn().mockImplementation(async ({ data }: any) => ({ ...data }));
  const stockMovementFindMany = vi.fn().mockResolvedValue([]);
  const stockMovementCount = vi.fn().mockResolvedValue(0);

  // Audit
  const auditCreate = opts.auditFail
    ? vi.fn().mockRejectedValue(new Error('AUDIT_REJECT'))
    : vi.fn().mockResolvedValue({ id: 'AL-1' });

  const tx: any = {
    warehouse: { update: warehouseUpdate, findUnique: warehouseFindUnique },
    inventoryItem: {
      create: inventoryItemCreate,
      update: inventoryItemUpdate,
      findFirst: inventoryItemFindFirst,
    },
    stockMovement: { create: stockMovementCreate },
    auditLog: { create: auditCreate },
    // EntityLink 图谱（W-C A1）：syncStockMovementReferences 走 tx 内 upsert
    entityReference: { upsert: vi.fn().mockResolvedValue({}) },
    entityLink: { upsert: vi.fn().mockResolvedValue({}) },
  };

  const prisma: any = {
    warehouse: {
      findUnique: warehouseFindUnique,
      findMany: warehouseFindMany,
      create: warehouseCreate,
      update: warehouseUpdate,
    },
    inventoryItem: {
      findUnique: inventoryItemFindUnique,
      findFirst: inventoryItemFindFirst,
      findMany: inventoryItemFindMany,
      count: inventoryItemCount,
      create: inventoryItemCreate,
      update: inventoryItemUpdate,
    },
    stockMovement: {
      create: stockMovementCreate,
      findMany: stockMovementFindMany,
      count: stockMovementCount,
    },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return {
    prisma, tx,
    warehouseFindUnique, warehouseFindMany, warehouseCreate, warehouseUpdate,
    inventoryItemFindUnique, inventoryItemFindFirst, inventoryItemFindMany, inventoryItemCount,
    inventoryItemCreate, inventoryItemUpdate,
    stockMovementCreate, stockMovementFindMany, stockMovementCount,
    auditCreate,
  };
}

const baseWarehouseInput: WarehouseInput = {
  code: 'WH-001',
  name: '上海主仓',
  type: 'Main',
  address: '上海市浦东新区',
  manager: '张三',
  phone: '13800000000',
};

const baseItemInput: InventoryItemInput = {
  warehouseId: 'WH_1',
  description: '面料 A - 蓝色',
  materialCode: 'FAB-001',
  category: 'Fabric',
  quantity: 100,
  unit: 'YD',
  unitCost: 5.5,
  minStock: 20,
  maxStock: 500,
};

// ═══════════════════════════════════════════════════════════════
// createWarehouse
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createWarehouse', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('成功创建 → 事务外 create + audit', async () => {
    const { prisma, warehouseCreate, auditCreate } = makePrisma();
    const service = createInventoryService(prisma);

    const result = await service.createWarehouse(baseWarehouseInput, 'u_test');

    expect(warehouseCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: 'WH-001',
        name: '上海主仓',
        type: 'Main',
        isActive: true,
        sortOrder: 0,
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'create_warehouse',
        targetType: 'Warehouse',
        actorId: 'u_test',
        operationType: 'create',
      }),
    }));
    expect(result.code).toBe('WH-001');
  });

  it('仓库编码已存在（未删除）→ 抛错', async () => {
    const existing = { id: 'WH_1', code: 'WH-001', deletedAt: null };
    const { prisma } = makePrisma({ existingWarehouse: existing });

    const service = createInventoryService(prisma);
    await expect(service.createWarehouse(baseWarehouseInput, 'u_test')).rejects.toThrow('已存在');
  });

  it('actorId 为空时使用 system 作为 actor', async () => {
    const { prisma, auditCreate } = makePrisma();
    const service = createInventoryService(prisma);

    await service.createWarehouse(baseWarehouseInput, '');

    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'system' }),
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// listWarehouses
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: listWarehouses', () => {
  it('默认仅返回活跃仓库', async () => {
    const { prisma, warehouseFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listWarehouses();

    expect(warehouseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, deletedAt: null },
    }));
  });

  it('includeInactive=true → 返回全部', async () => {
    const { prisma, warehouseFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listWarehouses(true);

    expect(warehouseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// updateWarehouse
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: updateWarehouse', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('成功更新 → 事务内 update + audit', async () => {
    const existing = { id: 'WH_1', code: 'WH-001', name: '老名字', deletedAt: null };
    const { prisma, tx, auditCreate } = makePrisma({ existingWarehouse: existing });

    const service = createInventoryService(prisma);
    const result = await service.updateWarehouse('WH_1', { name: '新名字', manager: '李四' }, 'u_test');

    expect(tx.warehouse.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'WH_1' },
      data: expect.objectContaining({ name: '新名字', manager: '李四' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'update_warehouse',
        operationType: 'update',
      }),
    }));
    expect(result.name).toBe('新名字');
  });

  it('仓库不存在 → 抛错', async () => {
    const { prisma, tx } = makePrisma({ existingWarehouse: null });
    const service = createInventoryService(prisma);

    await expect(service.updateWarehouse('NOT_EXIST', { name: 'x' }, 'u_test')).rejects.toThrow('不存在');
    expect(tx.warehouse.update).not.toHaveBeenCalled();
  });

  it('已软删除 → 抛错', async () => {
    const existing = { id: 'WH_1', deletedAt: 123456 };
    const { prisma } = makePrisma({ existingWarehouse: existing });
    const service = createInventoryService(prisma);

    await expect(service.updateWarehouse('WH_1', { name: 'x' }, 'u_test')).rejects.toThrow('不存在');
  });

  it('audit reject → 事务回滚', async () => {
    const existing = { id: 'WH_1', name: '老', deletedAt: null };
    const { prisma, tx } = makePrisma({ existingWarehouse: existing, auditFail: true });
    const service = createInventoryService(prisma);

    await expect(service.updateWarehouse('WH_1', { name: '新' }, 'u_test')).rejects.toThrow('AUDIT_REJECT');
    expect(tx.warehouse.update).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteWarehouse
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: deleteWarehouse', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('成功软删除 → 事务内 update + audit', async () => {
    const existing = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const { prisma, tx, auditCreate } = makePrisma({ existingWarehouse: existing, warehouseCount: 0 });

    const service = createInventoryService(prisma);
    await service.deleteWarehouse('WH_1', 'u_test');

    expect(tx.warehouse.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'WH_1' },
      data: expect.objectContaining({ deletedAt: expect.any(Number), isActive: false }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'delete_warehouse', operationType: 'delete' }),
    }));
  });

  it('仓库不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existingWarehouse: null });
    const service = createInventoryService(prisma);

    await expect(service.deleteWarehouse('NOT_EXIST', 'u_test')).rejects.toThrow('不存在');
  });

  it('仓库仍有非零库存项 → 抛错（fail-closed）', async () => {
    const existing = { id: 'WH_1', code: 'WH-001', deletedAt: null };
    const { prisma, tx } = makePrisma({ existingWarehouse: existing, warehouseCount: 3 });

    const service = createInventoryService(prisma);
    await expect(service.deleteWarehouse('WH_1', 'u_test')).rejects.toThrow('不可删除');
    expect(tx.warehouse.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// createInventoryItem
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createInventoryItem', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('成功创建（初始数量>0）→ 事务内 create item + create Inbound movement + audit', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', isActive: true, deletedAt: null };
    const { prisma, tx, inventoryItemCreate, stockMovementCreate, auditCreate } = makePrisma({ existingWarehouse: warehouse });

    const service = createInventoryService(prisma);
    const result = await service.createInventoryItem(baseItemInput, 'u_test');

    // create inventory item
    expect(tx.inventoryItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        warehouseId: 'WH_1',
        description: '面料 A - 蓝色',
        materialCode: 'FAB-001',
        quantity: 100,
        lockedQuantity: 0,
        unit: 'YD',
        unitCost: 5.5,
        minStock: 20,
        maxStock: 500,
      }),
      include: { warehouse: true },
    }));
    // 初始数量>0 → 自动写一条入库流水
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Inbound',
        quantity: 100,
        unit: 'YD',
        balanceBefore: 0,
        balanceAfter: 100,
        reason: '初始入库',
      }),
    }));
    // audit
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'create_inventory_item',
        targetType: 'InventoryItem',
        operationType: 'create',
      }),
    }));
    expect(result.description).toBe('面料 A - 蓝色');
  });

  it('初始数量=0 → 不写入库流水', async () => {
    const warehouse = { id: 'WH_1', isActive: true, deletedAt: null };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse });
    const service = createInventoryService(prisma);

    await service.createInventoryItem({ ...baseItemInput, quantity: 0 }, 'u_test');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('仓库不存在 → 抛错', async () => {
    const { prisma, tx } = makePrisma({ existingWarehouse: null });
    const service = createInventoryService(prisma);

    await expect(service.createInventoryItem(baseItemInput, 'u_test')).rejects.toThrow('不存在或已停用');
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('仓库已停用 → 抛错', async () => {
    const warehouse = { id: 'WH_1', isActive: false, deletedAt: null };
    const { prisma } = makePrisma({ existingWarehouse: warehouse });
    const service = createInventoryService(prisma);

    await expect(service.createInventoryItem(baseItemInput, 'u_test')).rejects.toThrow('不存在或已停用');
  });

  it('audit reject → 事务回滚（不伪成功）', async () => {
    const warehouse = { id: 'WH_1', isActive: true, deletedAt: null };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, auditFail: true });
    const service = createInventoryService(prisma);

    await expect(service.createInventoryItem(baseItemInput, 'u_test')).rejects.toThrow('AUDIT_REJECT');
  });
});

// ═══════════════════════════════════════════════════════════════
// listInventoryItems
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: listInventoryItems', () => {
  it('按仓库筛选 + 分页', async () => {
    const { prisma, inventoryItemFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listInventoryItems({ warehouseId: 'WH_1', limit: 50, offset: 10 });

    expect(inventoryItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warehouseId: 'WH_1', deletedAt: null }),
      take: 50,
      skip: 10,
      include: { warehouse: true },
    }));
  });

  it('搜索关键词 → OR 条件', async () => {
    const { prisma, inventoryItemFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listInventoryItems({ search: '蓝色' });

    const call = inventoryItemFindMany.mock.calls[0][0];
    expect(call.where.OR).toHaveLength(3);
    expect(call.where.OR[0]).toEqual({ description: { contains: '蓝色' } });
  });

  it('lowStockOnly → 内存过滤 quantity <= minStock', async () => {
    const lowItem = { id: 'INV_1', quantity: 10, minStock: 20, deletedAt: null };
    const okItem = { id: 'INV_2', quantity: 100, minStock: 20, deletedAt: null };
    const { prisma } = makePrisma();
    prisma.inventoryItem.findMany.mockResolvedValue([lowItem, okItem]);
    const service = createInventoryService(prisma);

    const result = await service.listInventoryItems({ lowStockOnly: true });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('INV_1');
    expect(result.total).toBe(1);
  });

  it('limit 上限 500', async () => {
    const { prisma, inventoryItemFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listInventoryItems({ limit: 9999 });

    expect(inventoryItemFindMany.mock.calls[0][0].take).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getInventoryItem
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: getInventoryItem', () => {
  it('存在 → 返回详情（含仓库 + 最近流水）', async () => {
    const item = { id: 'INV_1', description: '面料', deletedAt: null, warehouse: { id: 'WH_1' }, movements: [] };
    const { prisma, inventoryItemFindUnique } = makePrisma({ existingItem: item });
    const service = createInventoryService(prisma);

    const result = await service.getInventoryItem('INV_1');

    expect(inventoryItemFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_1' },
      include: { warehouse: true, movements: expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 50 }) },
    }));
    expect(result?.id).toBe('INV_1');
  });

  it('不存在 → 返回 null', async () => {
    const { prisma } = makePrisma({ existingItem: null });
    const service = createInventoryService(prisma);

    const result = await service.getInventoryItem('NOT_EXIST');
    expect(result).toBeNull();
  });

  it('已软删除 → 返回 null', async () => {
    const item = { id: 'INV_1', deletedAt: 123456 };
    const { prisma } = makePrisma({ existingItem: item });
    const service = createInventoryService(prisma);

    const result = await service.getInventoryItem('INV_1');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// updateInventoryItem
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: updateInventoryItem', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('成功更新（不改 quantity）→ 事务内 update + audit', async () => {
    const existing = { id: 'INV_1', description: '老', quantity: 100, deletedAt: null };
    const { prisma, tx, auditCreate } = makePrisma({ existingItem: existing });

    const service = createInventoryService(prisma);
    const result = await service.updateInventoryItem('INV_1', { materialCode: 'FAB-NEW', minStock: 30 }, 'u_test');

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_1' },
      data: expect.objectContaining({ materialCode: 'FAB-NEW', minStock: 30 }),
    }));
    // quantity 不在可更新字段中
    expect(tx.inventoryItem.update.mock.calls[0][0].data.quantity).toBeUndefined();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'update_inventory_item', operationType: 'update' }),
    }));
    expect(result.materialCode).toBe('FAB-NEW');
  });

  it('库存项不存在 → 抛错', async () => {
    const { prisma, tx } = makePrisma({ existingItem: null });
    const service = createInventoryService(prisma);

    await expect(service.updateInventoryItem('NOT_EXIST', { notes: 'x' }, 'u_test')).rejects.toThrow('不存在');
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteInventoryItem
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: deleteInventoryItem', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('quantity=0 → 成功软删除', async () => {
    const existing = { id: 'INV_1', description: '已清零', quantity: 0, deletedAt: null };
    const { prisma, tx, auditCreate } = makePrisma({ existingItem: existing });

    const service = createInventoryService(prisma);
    await service.deleteInventoryItem('INV_1', 'u_test');

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_1' },
      data: expect.objectContaining({ deletedAt: expect.any(Number) }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'delete_inventory_item', operationType: 'delete' }),
    }));
  });

  it('quantity != 0 → 抛错（不可删除）', async () => {
    const existing = { id: 'INV_1', quantity: 50, unit: 'YD', deletedAt: null };
    const { prisma, tx } = makePrisma({ existingItem: existing });

    const service = createInventoryService(prisma);
    await expect(service.deleteInventoryItem('INV_1', 'u_test')).rejects.toThrow('不可删除');
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('库存项不存在 → 抛错', async () => {
    const { prisma } = makePrisma({ existingItem: null });
    const service = createInventoryService(prisma);

    await expect(service.deleteInventoryItem('NOT_EXIST', 'u_test')).rejects.toThrow('不存在');
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — Inbound
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement Inbound', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('入库 → 数量增加 + 写流水 + 更新 lastInDate + audit', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: 500,
      lastInDate: '2026-08-01', lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx, stockMovementCreate, auditCreate } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    const movement = await service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 50, unitCost: 6, reason: '采购到货',
    }, 'u_test');

    // 流水：balanceBefore=100, balanceAfter=150
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Inbound',
        quantity: 50,
        unit: 'YD',
        unitCost: 6,
        balanceBefore: 100,
        balanceAfter: 150,
        reason: '采购到货',
        operator: 'u_test',
      }),
    }));
    // 库存项更新：quantity=150, lastInDate=今日
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_1' },
      data: expect.objectContaining({ quantity: 150, lastInDate: expect.any(String) }),
    }));
    // audit
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'stock_movement_inbound',
        operationType: 'increment',
        fieldPath: 'quantity',
        beforeValue: 100,
        afterValue: 150,
      }),
    }));
    expect(movement.type).toBe('Inbound');
  });

  it('入库后超过 maxStock → 发布 StockOverstockAlarm 事件', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 480, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: 500,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 50,
    }, 'u_test');

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('StockOverstockAlarm');
    expect(event.sourceEntityType).toBe('InventoryItem');
    expect(event.sourceEntityId).toBe('INV_1');
    expect(event.payload.currentQty).toBe(530);
    expect(event.payload.maxStock).toBe(500);
    expect(event.payload.warehouseCode).toBe('WH-001');
  });

  it('入库未超过 maxStock → 不发布积压事件', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: 500,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({ itemId: 'INV_1', type: 'Inbound', quantity: 50 }, 'u_test');

    expect(publishSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — Outbound
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement Outbound', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('出库 → 数量减少 + 写流水 + 更新 lastOutDate + audit（decrement）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: 500,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx, auditCreate } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    const movement = await service.createStockMovement({
      itemId: 'INV_1', type: 'Outbound', quantity: 30, reason: '生产领料',
    }, 'u_test');

    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Outbound',
        quantity: 30,
        balanceBefore: 100,
        balanceAfter: 70,
      }),
    }));
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 70, lastOutDate: expect.any(String) }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'stock_movement_outbound',
        operationType: 'decrement',
        beforeValue: 100,
        afterValue: 70,
      }),
    }));
    expect(movement.type).toBe('Outbound');
  });

  it('库存不足 → 抛错（fail-closed）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 10, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Outbound', quantity: 50,
    }, 'u_test')).rejects.toThrow('库存不足');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  // B3：锁定量拦截 —— 总量够但锁定后可用量不足 → 拒绝出库（409 文案含锁定量数值）
  it('总量足够但含锁定量后可用量不足 → 抛错（文案含锁定量数值）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 80, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    // 总量 100 >= 50，但可用量 = 100 - 80 = 20 < 50
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Outbound', quantity: 50,
    }, 'u_test')).rejects.toThrow('库存不足（含锁定量 80 YD）');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('可用量充足（总量 - 锁定量 >= 出库量）→ 正常出库', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 80, unit: 'YD', minStock: null, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    // 可用量 = 100 - 80 = 20，出库 20 恰好放行
    const movement = await service.createStockMovement({
      itemId: 'INV_1', type: 'Outbound', quantity: 20, reason: '生产领料',
    }, 'u_test');

    expect(movement.type).toBe('Outbound');
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 80, lockedQuantity: 80 }),
    }));
  });

  it('出库后低于 minStock → 发布 StockLowAlarm 事件', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 25, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({ itemId: 'INV_1', type: 'Outbound', quantity: 10 }, 'u_test');

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const event = publishSpy.mock.calls[0][0];
    expect(event.type).toBe('StockLowAlarm');
    expect(event.payload.currentQty).toBe(15);
    expect(event.payload.minStock).toBe(20);
    expect(event.payload.movementType).toBe('Outbound');
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — Adjustment (盘点)
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement Adjustment', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('盘点 → quantity 设为目标绝对值（非增减）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 98, lockedQuantity: 0, unit: 'YD', minStock: null, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Adjustment', quantity: 100, reason: '盘点盈盈+2', notes: '实物盘点',
    }, 'u_test');

    // balanceBefore=98（账面）, balanceAfter=100（实物）
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Adjustment',
        quantity: 100,
        balanceBefore: 98,
        balanceAfter: 100,
        notes: '实物盘点',
      }),
    }));
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 100 }),
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — Lock / Unlock
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement Lock/Unlock', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('锁定 → lockedQuantity 增加，quantity 不变', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 20, unit: 'YD', minStock: null, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Lock', quantity: 30, reason: '订单分配',
    }, 'u_test');

    // quantity 不变，lockedQuantity 增加
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 100, lockedQuantity: 50 }),
    }));
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'Lock', quantity: 30, balanceBefore: 100, balanceAfter: 100 }),
    }));
  });

  it('可锁定库存不足 → 抛错（locked + new > quantity）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 80, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Lock', quantity: 30,
    }, 'u_test')).rejects.toThrow('可锁定库存不足');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('解锁 → lockedQuantity 减少，quantity 不变', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 100, lockedQuantity: 50, unit: 'YD', minStock: null, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Unlock', quantity: 20, reason: '订单取消',
    }, 'u_test');

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 100, lockedQuantity: 30 }),
    }));
  });

  it('解锁数量超过已锁定 → 抛错', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 10, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Unlock', quantity: 50,
    }, 'u_test')).rejects.toThrow('解锁数量超过已锁定');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — Transfer (调拨)
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement Transfer', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('调拨（目标仓库无同物料）→ 源仓出库 + 目标仓新建库存项 + 双流水', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '上海仓', deletedAt: null };
    const targetWarehouse = { id: 'WH_2', code: 'WH-002', name: '广州仓', isActive: true, deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      productAssetId: null, category: 'Fabric', specification: null, batchNumber: null,
      quantity: 100, lockedQuantity: 0, unit: 'YD', unitCost: 5, currency: 'CNY',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({
      existingWarehouse: warehouse, targetWarehouse, existingItem: item, existingTargetItem: null,
    });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Transfer', quantity: 30, targetWarehouseId: 'WH_2', reason: '调拨至广州',
    }, 'u_test');

    // 源仓流水（Transfer）
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Transfer',
        itemId: 'INV_1',
        warehouseId: 'WH_1',
        targetWarehouseId: 'WH_2',
        quantity: 30,
        balanceBefore: 100,
        balanceAfter: 70,
      }),
    }));
    // 源仓库存减少
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_1' },
      data: expect.objectContaining({ quantity: 70 }),
    }));
    // 目标仓新建库存项（notes 使用源仓库 code）
    expect(tx.inventoryItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        warehouseId: 'WH_2',
        description: '面料',
        materialCode: 'FAB-001',
        quantity: 30,
        lockedQuantity: 0,
        unit: 'YD',
        notes: expect.stringContaining('WH-001'),
      }),
    }));
    // 目标仓入库流水
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'Inbound',
        warehouseId: 'WH_2',
        quantity: 30,
        referenceType: 'Transfer',
      }),
    }));
  });

  it('调拨（目标仓库已有同物料）→ 目标库存项数量累加', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '上海仓', deletedAt: null };
    const targetWarehouse = { id: 'WH_2', code: 'WH-002', name: '广州仓', isActive: true, deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      productAssetId: null, category: 'Fabric', specification: null, batchNumber: null,
      quantity: 100, lockedQuantity: 0, unit: 'YD', unitCost: 5, currency: 'CNY',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const targetItem = { id: 'INV_2', warehouseId: 'WH_2', quantity: 20, unit: 'YD', deletedAt: null };
    const { prisma, tx } = makePrisma({
      existingWarehouse: warehouse, targetWarehouse, existingItem: item, existingTargetItem: targetItem,
    });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Transfer', quantity: 30, targetWarehouseId: 'WH_2',
    }, 'u_test');

    // 目标仓库存项 update（而非 create）
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INV_2' },
      data: expect.objectContaining({ quantity: 50 }), // 20 + 30
    }));
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('未指定 targetWarehouseId → 抛错', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Transfer', quantity: 30,
    }, 'u_test')).rejects.toThrow('调拨必须指定目标仓库');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('库存不足 → 抛错（不可调拨）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 10, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Transfer', quantity: 50, targetWarehouseId: 'WH_2',
    }, 'u_test')).rejects.toThrow('库存不足');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  // B3：锁定量拦截 —— 调拨出库同样按可用量校验（文案含锁定量数值）
  it('调拨：总量足够但含锁定量后可用量不足 → 抛错（文案含锁定量数值）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 80, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    // 可用量 = 100 - 80 = 20 < 50
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Transfer', quantity: 50, targetWarehouseId: 'WH_2',
    }, 'u_test')).rejects.toThrow('库存不足（含锁定量 80 YD）');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// createStockMovement — 通用校验
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: createStockMovement 通用校验', () => {
  beforeEach(() => { publishSpy.mockClear(); });

  it('非法变动类型 → validateMovementType 抛错', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'InvalidType' as any, quantity: 10,
    }, 'u_test')).rejects.toThrow('非法库存变动类型');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('库存项不存在 → 抛错', async () => {
    const { prisma, tx } = makePrisma({ existingItem: null });
    const service = createInventoryService(prisma);

    await expect(service.createStockMovement({
      itemId: 'NOT_EXIST', type: 'Inbound', quantity: 10,
    }, 'u_test')).rejects.toThrow('不存在');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('库存项已软删除 → 抛错', async () => {
    const item = { id: 'INV_1', deletedAt: 123456, quantity: 100, lockedQuantity: 0, unit: 'YD' };
    const { prisma, tx } = makePrisma({ existingItem: item });
    const service = createInventoryService(prisma);

    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 10,
    }, 'u_test')).rejects.toThrow('不存在');

    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('audit reject → 事务回滚（fail-closed）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, existingItem: item, auditFail: true });
    const service = createInventoryService(prisma);

    await expect(service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 10,
    }, 'u_test')).rejects.toThrow('AUDIT_REJECT');
  });

  it('事件发布失败不阻断业务（fire-and-forget）', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', description: '面料', materialCode: 'FAB-001',
      quantity: 5, lockedQuantity: 0, unit: 'YD', minStock: 20, maxStock: null,
      lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma } = makePrisma({ existingWarehouse: warehouse, existingItem: item });
    publishSpy.mockRejectedValueOnce(new Error('EVENT_BUS_DOWN'));

    const service = createInventoryService(prisma);
    // 触发 StockLowAlarm（5 + 10 = 15 <= 20）
    const result = await service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 10,
    }, 'u_test');
    // 不抛错 — 事件发布是 fire-and-forget
    expect(result.type).toBe('Inbound');
  });

  it('actorId 为空时使用 system 作为 operator', async () => {
    const warehouse = { id: 'WH_1', code: 'WH-001', name: '主仓', deletedAt: null };
    const item = {
      id: 'INV_1', warehouseId: 'WH_1', quantity: 100, lockedQuantity: 0, unit: 'YD',
      minStock: null, maxStock: null, lastInDate: null, lastOutDate: null, deletedAt: null,
    };
    const { prisma, tx } = makePrisma({ existingWarehouse: warehouse, existingItem: item });

    const service = createInventoryService(prisma);
    await service.createStockMovement({
      itemId: 'INV_1', type: 'Inbound', quantity: 10,
    }, '');

    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operator: 'system' }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'system' }),
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// listStockMovements
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: listStockMovements', () => {
  it('按库存项 + 类型筛选 + 分页', async () => {
    const { prisma, stockMovementFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listStockMovements({ itemId: 'INV_1', type: 'Inbound', limit: 50, offset: 10 });

    expect(stockMovementFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: 'INV_1', type: 'Inbound' },
      take: 50,
      skip: 10,
    }));
  });

  it('日期范围筛选', async () => {
    const { prisma, stockMovementFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listStockMovements({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

    expect(stockMovementFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { movementDate: { gte: '2026-08-01', lte: '2026-08-31' } },
    }));
  });

  it('limit 上限 500', async () => {
    const { prisma, stockMovementFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.listStockMovements({ limit: 9999 });

    expect(stockMovementFindMany.mock.calls[0][0].take).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getLowStockItems
// ═══════════════════════════════════════════════════════════════
describe('inventoryService: getLowStockItems', () => {
  it('返回 quantity <= minStock 的库存项（内存过滤）', async () => {
    const lowItem = { id: 'INV_1', quantity: 10, minStock: 20, deletedAt: null, warehouse: { id: 'WH_1' } };
    const okItem = { id: 'INV_2', quantity: 100, minStock: 20, deletedAt: null, warehouse: { id: 'WH_1' } };
    const noMinItem = { id: 'INV_3', quantity: 5, minStock: null, deletedAt: null, warehouse: { id: 'WH_1' } };
    const { prisma } = makePrisma();
    prisma.inventoryItem.findMany.mockResolvedValue([lowItem, okItem, noMinItem]);
    const service = createInventoryService(prisma);

    const result = await service.getLowStockItems();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('INV_1');
  });

  it('查询条件包含 minStock not null', async () => {
    const { prisma, inventoryItemFindMany } = makePrisma();
    const service = createInventoryService(prisma);

    await service.getLowStockItems();

    expect(inventoryItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, minStock: { not: null } },
      include: { warehouse: true },
    }));
  });
});
