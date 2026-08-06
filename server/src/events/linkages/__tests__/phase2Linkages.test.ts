/**
 * Phase 2 跨模块联动 — L6/L7/L8 单元测试
 *
 * 覆盖：
 *   L6: OrderConfirmed → createBOMDraft（含模板复制、无模板占位、幂等跳过）
 *   L7: BOMConfirmed → createProcurement（含采购行映射、幂等跳过、无行跳过）
 *   L8: MaterialReceived → autoStockIn（含入库流水、幂等跳过、无仓库跳过）
 *
 * 测试策略：
 *   - Mock service 工厂（createBOMService/createProcurementService/createInventoryService）
 *   - Mock prisma（含 bOM/purchaseOrder/inventoryItem/stockMovement/warehouse/order）
 *   - 验证幂等性 + 业务逻辑 + 错误隔离
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock 依赖服务工厂 — 使用 vi.hoisted 确保 mock 变量在 vi.mock 工厂中可用
const { mockCreateBOM, mockCreatePurchaseOrder, mockCreateInventoryItem, mockCreateStockMovement } = vi.hoisted(() => ({
  mockCreateBOM: vi.fn(),
  mockCreatePurchaseOrder: vi.fn(),
  mockCreateInventoryItem: vi.fn(),
  mockCreateStockMovement: vi.fn(),
}));

vi.mock('../../../bom/bomService', () => ({
  createBOMService: vi.fn().mockReturnValue({
    createBOM: mockCreateBOM,
  }),
}));
vi.mock('../../../procurement/procurementService', () => ({
  createProcurementService: vi.fn().mockReturnValue({
    createPurchaseOrder: mockCreatePurchaseOrder,
  }),
}));
vi.mock('../../../inventory/inventoryService', () => ({
  createInventoryService: vi.fn().mockReturnValue({
    createInventoryItem: mockCreateInventoryItem,
    createStockMovement: mockCreateStockMovement,
  }),
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { businessEventBus, publishBusinessEvent } from '../../businessEventBus';
import { registerAllLinkages } from '../index';

// ── Mock Prisma 工厂 ──
function makeMockPrisma(overrides: Record<string, any> = {}) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.order,
    },
    bOM: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.bOM,
    },
    purchaseOrder: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.purchaseOrder,
    },
    inventoryItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.inventoryItem,
    },
    stockMovement: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.stockMovement,
    },
    warehouse: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.warehouse,
    },
    agentJob: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.agentJob,
    },
    ...overrides,
  } as any;
}

describe('Phase 2 Linkage Handlers', () => {
  let prisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    businessEventBus.reset();
    prisma = makeMockPrisma();
    businessEventBus.setPrisma(prisma);
    registerAllLinkages();
  });

  // ── L6: OrderConfirmed → createBOMDraft ──
  describe('L6: OrderConfirmed → createBOMDraft', () => {
    it('从模板 BOM 复制 → 创建 Draft BOM', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord_1',
        product: '男款西装外套',
        poNumber: 'PO-001',
        customer: 'ACME',
        currency: 'USD',
      });
      prisma.bOM.findFirst
        // 第一次调用：检查是否已有 BOM（返回 null = 不存在）
        .mockResolvedValueOnce(null)
        // 第二次调用：查找模板 BOM
        .mockResolvedValueOnce({
          id: 'bom_template',
          bomNumber: 'BOM-TEMPLATE-001',
          description: '男款西装外套 标准款',
          currency: 'CNY',
          sellingPrice: '5000.00',
          lines: [
            {
              materialType: 'Main',
              materialCode: 'FAB-001',
              description: '主面料',
              category: 'Fabric',
              specification: '150D',
              quantity: '100',
              unit: 'YD',
              wastagePercent: '5',
              unitCost: '12.50',
              notes: null,
            },
          ],
          costEstimates: [
            { costType: 'Labor', description: '裁剪人工', amount: '500', notes: null },
          ],
        });
      mockCreateBOM.mockResolvedValue({
        id: 'bom_new',
        bomNumber: 'BOM-AUTO-001',
        status: 'Draft',
      });

      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_1',
        orderId: 'ord_1',
        payload: { poNumber: 'PO-001' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateBOM).toHaveBeenCalledTimes(1);
      const input = mockCreateBOM.mock.calls[0][0];
      expect(input.orderId).toBe('ord_1');
      expect(input.lines).toHaveLength(1);
      expect(input.lines[0].materialType).toBe('Main');
      expect(input.lines[0].quantity).toBe(100);
      expect(input.lines[0].unitCost).toBe(12.5);
      expect(input.costEstimates).toHaveLength(1);
      expect(input.sellingPrice).toBe(5000);
    });

    it('无模板 → 创建占位 BOM（单行占位物料）', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord_2',
        product: '新产品',
        poNumber: 'PO-002',
        customer: 'ACME',
        currency: 'CNY',
      });
      prisma.bOM.findFirst
        .mockResolvedValueOnce(null) // 无已有 BOM
        .mockResolvedValueOnce(null); // 无模板
      mockCreateBOM.mockResolvedValue({
        id: 'bom_new_2',
        bomNumber: 'BOM-AUTO-002',
        status: 'Draft',
      });

      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_2',
        orderId: 'ord_2',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateBOM).toHaveBeenCalledTimes(1);
      const input = mockCreateBOM.mock.calls[0][0];
      expect(input.lines).toHaveLength(1);
      expect(input.lines[0].materialType).toBe('Main');
      expect(input.lines[0].unitCost).toBe(0);
    });

    it('已有 BOM → 跳过（幂等）', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord_3',
        product: '产品',
        poNumber: 'PO-003',
        currency: 'CNY',
      });
      prisma.bOM.findFirst.mockResolvedValueOnce({
        id: 'bom_existing',
        bomNumber: 'BOM-EXISTING',
      });

      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_3',
        orderId: 'ord_3',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateBOM).not.toHaveBeenCalled();
    });

    it('无 orderId → 跳过', async () => {
      await publishBusinessEvent({
        type: 'OrderConfirmed',
        sourceEntityType: 'Order',
        sourceEntityId: 'ord_4',
        payload: {},
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateBOM).not.toHaveBeenCalled();
    });
  });

  // ── L7: BOMConfirmed → createProcurement ──
  describe('L7: BOMConfirmed → createProcurement', () => {
    it('从 BOM 行 → 创建 Draft 采购单', async () => {
      prisma.bOM.findUnique.mockResolvedValue({
        id: 'bom_1',
        bomNumber: 'BOM-001',
        deletedAt: null,
        currency: 'CNY',
        orderId: 'ord_1',
        lines: [
          {
            materialCode: 'FAB-001',
            description: '主面料',
            category: 'Fabric',
            specification: '150D',
            effectiveQty: '105',
            unit: 'YD',
            unitCost: '12.50',
            notes: null,
          },
          {
            materialCode: 'THR-001',
            description: '缝纫线',
            category: 'Trimmings',
            specification: null,
            effectiveQty: '200',
            unit: 'M',
            unitCost: '0.50',
            notes: null,
          },
        ],
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null); // 无已有 PO
      mockCreatePurchaseOrder.mockResolvedValue({
        id: 'po_1',
        poNumber: 'PO-AUTO-001',
      });

      await publishBusinessEvent({
        type: 'BOMConfirmed',
        sourceEntityType: 'BOM',
        sourceEntityId: 'bom_1',
        payload: {
          bomId: 'bom_1',
          bomNumber: 'BOM-001',
          orderId: 'ord_1',
          currency: 'CNY',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreatePurchaseOrder).toHaveBeenCalledTimes(1);
      const input = mockCreatePurchaseOrder.mock.calls[0][0];
      expect(input.bomId).toBe('bom_1');
      expect(input.orderId).toBe('ord_1');
      expect(input.lines).toHaveLength(2);
      expect(input.lines[0].quantity).toBe(105); // effectiveQty
      expect(input.lines[0].unitPrice).toBe(12.5);
      expect(input.lines[1].quantity).toBe(200);
      expect(input.lines[1].unitPrice).toBe(0.5);
    });

    it('已有采购单 → 跳过（幂等）', async () => {
      prisma.bOM.findUnique.mockResolvedValue({
        id: 'bom_2',
        bomNumber: 'BOM-002',
        deletedAt: null,
        currency: 'CNY',
        lines: [{ effectiveQty: '100', unit: 'YD', unitCost: '10', description: '面料' }],
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po_existing',
        poNumber: 'PO-EXISTING',
      });

      await publishBusinessEvent({
        type: 'BOMConfirmed',
        sourceEntityType: 'BOM',
        sourceEntityId: 'bom_2',
        payload: { bomId: 'bom_2', bomNumber: 'BOM-002' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
    });

    it('BOM 无物料行 → 跳过', async () => {
      prisma.bOM.findUnique.mockResolvedValue({
        id: 'bom_3',
        bomNumber: 'BOM-003',
        deletedAt: null,
        currency: 'CNY',
        lines: [],
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await publishBusinessEvent({
        type: 'BOMConfirmed',
        sourceEntityType: 'BOM',
        sourceEntityId: 'bom_3',
        payload: { bomId: 'bom_3', bomNumber: 'BOM-003' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
    });

    it('BOM 不存在 → 返回 not-ok', async () => {
      prisma.bOM.findUnique.mockResolvedValue(null);

      await publishBusinessEvent({
        type: 'BOMConfirmed',
        sourceEntityType: 'BOM',
        sourceEntityId: 'bom_missing',
        payload: { bomId: 'bom_missing' },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
    });
  });

  // ── L8: MaterialReceived → autoStockIn ──
  describe('L8: MaterialReceived → autoStockIn', () => {
    it('来料接收 → 创建库存项 + 入库流水', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po_1',
        poNumber: 'PO-001',
        deletedAt: null,
        lines: [
          {
            materialCode: 'FAB-001',
            description: '主面料',
            category: 'Fabric',
            specification: '150D',
            receivedQuantity: '100',
            unit: 'YD',
            unitPrice: '12.50',
          },
        ],
      });
      prisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh_1',
        code: 'WH-001',
        name: '主仓库',
        type: 'Main',
      });
      prisma.inventoryItem.findFirst.mockResolvedValue(null); // 无已有库存项
      prisma.stockMovement.findFirst.mockResolvedValue(null); // 无已有入库流水
      mockCreateInventoryItem.mockResolvedValue({ id: 'inv_1' });
      mockCreateStockMovement.mockResolvedValue({ id: 'sm_1' });

      await publishBusinessEvent({
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: 'po_1',
        payload: {
          purchaseOrderId: 'po_1',
          poNumber: 'PO-001',
          receiptId: 'rpt_1',
          receiptNumber: 'RPT-001',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      // 验证创建了库存项
      expect(mockCreateInventoryItem).toHaveBeenCalledTimes(1);
      const itemInput = mockCreateInventoryItem.mock.calls[0][0];
      expect(itemInput.warehouseId).toBe('wh_1');
      expect(itemInput.materialCode).toBe('FAB-001');
      expect(itemInput.quantity).toBe(0); // 初始 0，通过入库变动增加

      // 验证创建了入库变动
      expect(mockCreateStockMovement).toHaveBeenCalledTimes(1);
      const moveInput = mockCreateStockMovement.mock.calls[0][0];
      expect(moveInput.type).toBe('Inbound');
      expect(moveInput.quantity).toBe(100);
      expect(moveInput.referenceType).toBe('PurchaseOrder');
      expect(moveInput.referenceId).toBe('rpt_1');
    });

    it('已有库存项 → 直接入库（不创建新库存项）', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po_2',
        poNumber: 'PO-002',
        deletedAt: null,
        lines: [
          {
            materialCode: 'FAB-002',
            description: '辅料',
            receivedQuantity: '50',
            unit: 'KG',
            unitPrice: '8.00',
          },
        ],
      });
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh_1', code: 'WH-001', name: '主仓' });
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'inv_existing' });
      prisma.stockMovement.findFirst.mockResolvedValue(null);
      mockCreateStockMovement.mockResolvedValue({ id: 'sm_2' });

      await publishBusinessEvent({
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: 'po_2',
        payload: {
          purchaseOrderId: 'po_2',
          receiptId: 'rpt_2',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      // 不应创建新库存项（已有）
      expect(mockCreateInventoryItem).not.toHaveBeenCalled();
      // 但应创建入库变动
      expect(mockCreateStockMovement).toHaveBeenCalledTimes(1);
      expect(mockCreateStockMovement.mock.calls[0][0].itemId).toBe('inv_existing');
    });

    it('已入库 → 跳过（幂等）', async () => {
      prisma.stockMovement.findFirst.mockResolvedValue({ id: 'sm_existing' });

      await publishBusinessEvent({
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: 'po_3',
        payload: {
          purchaseOrderId: 'po_3',
          receiptId: 'rpt_3',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateInventoryItem).not.toHaveBeenCalled();
      expect(mockCreateStockMovement).not.toHaveBeenCalled();
    });

    it('无 active 仓库 → 返回 not-ok', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po_4',
        poNumber: 'PO-004',
        deletedAt: null,
        lines: [
          {
            materialCode: 'FAB-003',
            description: '面料',
            receivedQuantity: '30',
            unit: 'YD',
            unitPrice: '10',
          },
        ],
      });
      prisma.warehouse.findFirst.mockResolvedValue(null); // 无仓库
      prisma.stockMovement.findFirst.mockResolvedValue(null);

      await publishBusinessEvent({
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: 'po_4',
        payload: {
          purchaseOrderId: 'po_4',
          receiptId: 'rpt_4',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateStockMovement).not.toHaveBeenCalled();
    });

    it('无接收数量行 → 跳过', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po_5',
        poNumber: 'PO-005',
        deletedAt: null,
        lines: [
          {
            materialCode: 'FAB-004',
            description: '面料',
            receivedQuantity: '0',
            unit: 'YD',
            unitPrice: '10',
          },
        ],
      });
      prisma.stockMovement.findFirst.mockResolvedValue(null);

      await publishBusinessEvent({
        type: 'MaterialReceived',
        sourceEntityType: 'PurchaseOrder',
        sourceEntityId: 'po_5',
        payload: {
          purchaseOrderId: 'po_5',
          receiptId: 'rpt_5',
        },
        actorId: 'test',
      });
      await new Promise(r => setTimeout(r, 50));

      expect(mockCreateStockMovement).not.toHaveBeenCalled();
    });
  });
});
