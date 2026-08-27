/**
 * sampleRoomService.ts — REQ2-16 样品间管理（DR-057 v2）
 *
 * 设计真源：docs/design/04-模块设计/03-订单与生产/Development-开发/样品间管理.md
 *
 * DR-057 v2 升级（库存管理联动）：
 *   ① SampleCardItem 增加库存字段（quantity/availableQty/minStock/maxStock/unit）
 *   ② 软关联 warehouseId/devCaseId/orderId（与 DevelopmentCase.linkedOrderId 一致风格）
 *   ③ 借出支持 loanQuantity（一次借多张），availableQty 校验 + 部分借出
 *   ④ 盘点 adjustQuantity + 低库存预警 listLowStock
 *   ⑤ 列表 join devCase.code / order.poNumber 摘要（双向联动展示）
 *
 * DR-057 原决策保留：
 *   ① 实体样卡与逻辑色卡分轨（SampleCardItem 实物 ≠ ColorCard 逻辑色；colorCardCode 可选关联）
 *   ② 借出与看样统一 Loan 流水（append-only：归还只补 returnedAt/conditionNote）
 *   ③ 二维码载荷 = 样卡编号（SC-YYYYMMDD-NNN 当日递增；前端 qrcode 打印，扫码按 code 直达）
 *
 * 状态机：in_stock → borrowed（availableQty=0）→ in_stock（归还后 availableQty>0）；retired 终态。
 * 逾期 = dueAt < now 且未归还（列表派生标记，不落状态字段）。
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { writeRouteAuditLog } from '../audit/routeAudit';

const CARD_TYPES = ['fabric', 'garment', 'colorcard', 'trim', 'other'];
const LOAN_TYPES = ['borrow', 'viewing'];

export type SampleRoomResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };

const fail = (code: string, message: string, status = 400): SampleRoomResult<never> =>
  ({ ok: false, error: { code, message, status } });

function generateId(prefix: string): string {
  return `${prefix}__${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function createSampleRoomService(prisma: PrismaClient) {
  const db = prisma as any;

  /** 样卡编号：SC-YYYYMMDD-NNN（当日递增，二维码载荷） */
  async function nextItemCode(): Promise<string> {
    const prefix = `SC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const count = await db.sampleCardItem.count({ where: { code: { startsWith: prefix } } });
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  /** 单条借还行的派生视图（逾期/活跃） */
  function serializeLoan(loan: any) {
    const nowTs = Date.now();
    const active = loan.returnedAt == null;
    return {
      ...loan,
      active,
      overdue: active && loan.dueAt != null && Number(loan.dueAt) < nowTs,
    };
  }

  function serializeItem(item: any, activeLoan?: any, links?: { devCase?: any; order?: any; warehouse?: any; productAsset?: any }) {
    const loan = activeLoan ? serializeLoan(activeLoan) : undefined;
    return {
      ...item,
      activeLoan: loan ?? null,
      overdue: loan?.overdue ?? false,
      devCaseCode: links?.devCase?.code ?? null,
      devCaseName: links?.devCase?.name ?? null,
      orderPoNumber: links?.order?.poNumber ?? null,
      orderCustomer: links?.order?.customer ?? null,
      warehouseCode: links?.warehouse?.code ?? null,
      warehouseName: links?.warehouse?.name ?? null,
      productAssetSku: links?.productAsset?.sku ?? null,
      productAssetName: links?.productAsset?.name ?? null,
      productAssetCategory: links?.productAsset?.mainCategory ?? null,
    };
  }

  // ── 登记 ──
  async function createItem(input: {
    name?: string; cardType?: string; colorCardCode?: string; location?: string; notes?: string;
    quantity?: number; minStock?: number; maxStock?: number; unit?: string;
    warehouseId?: string; devCaseId?: string; orderId?: string; productAssetId?: string;
  }, actorId?: string): Promise<SampleRoomResult<any>> {
    try {
      const name = String(input.name ?? '').trim();
      if (!name) return fail('VALIDATION_FAILED', 'name 必填（样卡名称）');
      const cardType = input.cardType ? String(input.cardType) : 'fabric';
      if (!CARD_TYPES.includes(cardType)) return fail('VALIDATION_FAILED', `cardType 必须是: ${CARD_TYPES.join(', ')}`);

      // 可选逻辑色卡关联（DR-057-①）：不存在不阻断（快照式弱关联）
      const colorCardCode = input.colorCardCode ? String(input.colorCardCode).trim() : null;

      // 库存参数校验
      const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
      const minStock = input.minStock != null ? Math.max(0, Math.floor(Number(input.minStock))) : null;
      const maxStock = input.maxStock != null ? Math.max(0, Math.floor(Number(input.maxStock))) : null;
      if (minStock != null && maxStock != null && minStock > maxStock) {
        return fail('VALIDATION_FAILED', 'minStock 不能大于 maxStock');
      }
      const unit = input.unit ? String(input.unit).slice(0, 16) : '张';

      // 软关联校验（warehouseId/devCaseId/orderId/productAssetId 存在性弱校验）
      const warehouseId = input.warehouseId ? String(input.warehouseId) : null;
      const devCaseId = input.devCaseId ? String(input.devCaseId) : null;
      const orderId = input.orderId ? String(input.orderId) : null;
      const productAssetId = input.productAssetId ? String(input.productAssetId) : null;

      if (warehouseId) {
        const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
        if (!wh) return fail('VALIDATION_FAILED', `仓库 ${warehouseId} 不存在`);
      }
      if (devCaseId) {
        const dc = await db.developmentCase.findUnique({ where: { id: devCaseId } });
        if (!dc) return fail('VALIDATION_FAILED', `开发单 ${devCaseId} 不存在`);
      }
      if (orderId) {
        const od = await db.order.findUnique({ where: { id: orderId } });
        if (!od) return fail('VALIDATION_FAILED', `大货订单 ${orderId} 不存在`);
      }
      if (productAssetId) {
        const pa = await db.productAsset.findUnique({ where: { id: productAssetId }, select: { id: true, mainCategory: true } });
        if (!pa) return fail('VALIDATION_FAILED', `数字档案 ${productAssetId} 不存在`);
      }

      const ts = Date.now();
      const item = await db.sampleCardItem.create({
        data: {
          id: generateId('SCI'),
          code: await nextItemCode(),
          name,
          cardType,
          colorCardCode,
          location: input.location ? String(input.location).trim() : null,
          notes: input.notes ? String(input.notes).slice(0, 500) : null,
          status: 'in_stock',
          quantity,
          availableQty: quantity,
          minStock,
          maxStock,
          unit,
          warehouseId,
          devCaseId,
          orderId,
          productAssetId,
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_create', targetType: 'SampleCardItem', targetId: item.id,
        after: { code: item.code, name, cardType, quantity, warehouseId, devCaseId, orderId, productAssetId }, operationType: 'create',
      });
      return { ok: true, data: { item } };
    } catch (e: any) {
      logger.error('[sample-room] createItem failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '样卡登记失败', 500);
    }
  }

  // ── 列表（状态/类型/搜索/编号直达/关联过滤/低库存；附活跃借出摘要+关联单据摘要+逾期派生） ──
  async function listItems(filter: {
    status?: string; cardType?: string; search?: string; code?: string;
    warehouseId?: string; devCaseId?: string; orderId?: string; productAssetId?: string; lowStock?: boolean;
    limit?: number; offset?: number;
  } = {}): Promise<SampleRoomResult<any>> {
    try {
      const where: any = { deletedAt: null };
      if (filter.status) where.status = filter.status;
      if (filter.cardType) where.cardType = filter.cardType;
      if (filter.code) where.code = filter.code;
      if (filter.warehouseId) where.warehouseId = filter.warehouseId;
      if (filter.devCaseId) where.devCaseId = filter.devCaseId;
      if (filter.orderId) where.orderId = filter.orderId;
      if (filter.productAssetId) where.productAssetId = filter.productAssetId;
      if (filter.search) {
        where.OR = [
          { name: { contains: filter.search } },
          { code: { contains: filter.search } },
          { location: { contains: filter.search } },
        ];
      }
      const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
      const offset = Math.max(Number(filter.offset) || 0, 0);
      let [items, total] = await Promise.all([
        db.sampleCardItem.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        db.sampleCardItem.count({ where }),
      ]);

      // 低库存预警过滤（派生：availableQty <= minStock，且 minStock != null）
      if (filter.lowStock === true) {
        items = items.filter((i: any) => i.minStock != null && Number(i.availableQty) <= Number(i.minStock));
      }

      // 活跃借出摘要（borrow 未归还）
      const activeLoans = await db.sampleCardLoan.findMany({
        where: { itemId: { in: items.map((i: any) => i.id) }, loanType: 'borrow', returnedAt: null },
        orderBy: { loanedAt: 'desc' },
      });
      const activeByItem = new Map<string, any>();
      for (const l of activeLoans) if (!activeByItem.has(l.itemId)) activeByItem.set(l.itemId, l);

      // 关联单据摘要（warehouseId/devCaseId/orderId/productAssetId join）
      const warehouseIds = [...new Set(items.map((i: any) => i.warehouseId).filter(Boolean))];
      const devCaseIds = [...new Set(items.map((i: any) => i.devCaseId).filter(Boolean))];
      const orderIds = [...new Set(items.map((i: any) => i.orderId).filter(Boolean))];
      const productAssetIds = [...new Set(items.map((i: any) => i.productAssetId).filter(Boolean))];
      const [warehouses, devCases, orders, productAssets] = await Promise.all([
        warehouseIds.length ? db.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, code: true, name: true } }) : [],
        devCaseIds.length ? db.developmentCase.findMany({ where: { id: { in: devCaseIds } }, select: { id: true, code: true, name: true } }) : [],
        orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, poNumber: true, customer: true } }) : [],
        productAssetIds.length ? db.productAsset.findMany({ where: { id: { in: productAssetIds } }, select: { id: true, sku: true, name: true, mainCategory: true } }) : [],
      ]);
      const whMap = new Map(warehouses.map((w: any) => [w.id, w]));
      const dcMap = new Map(devCases.map((d: any) => [d.id, d]));
      const odMap = new Map(orders.map((o: any) => [o.id, o]));
      const paMap = new Map(productAssets.map((p: any) => [p.id, p]));

      return {
        ok: true,
        data: {
          items: items.map((i: any) => serializeItem(i, activeByItem.get(i.id), {
            devCase: dcMap.get(i.devCaseId) ?? null,
            order: odMap.get(i.orderId) ?? null,
            warehouse: whMap.get(i.warehouseId) ?? null,
            productAsset: paMap.get(i.productAssetId) ?? null,
          })),
          total: filter.lowStock === true ? items.length : total,
        },
      };
    } catch (e: any) {
      logger.error('[sample-room] listItems failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '样卡列表查询失败', 500);
    }
  }

  // ── 详情（含借还历史正序） ──
  async function getItem(id: string): Promise<SampleRoomResult<any>> {
    try {
      const item = await db.sampleCardItem.findFirst({ where: { id, deletedAt: null } });
      if (!item) return fail('NOT_FOUND', `样卡 ${id} 不存在`, 404);
      const loans = await db.sampleCardLoan.findMany({ where: { itemId: id }, orderBy: { loanedAt: 'asc' } });
      const activeLoan = loans.filter((l: any) => l.loanType === 'borrow' && l.returnedAt == null).pop();

      // 关联单据摘要
      const links: any = {};
      if (item.devCaseId) links.devCase = await db.developmentCase.findUnique({ where: { id: item.devCaseId }, select: { id: true, code: true, name: true } });
      if (item.orderId) links.order = await db.order.findUnique({ where: { id: item.orderId }, select: { id: true, poNumber: true, customer: true } });
      if (item.warehouseId) links.warehouse = await db.warehouse.findUnique({ where: { id: item.warehouseId }, select: { id: true, code: true, name: true } });
      if (item.productAssetId) links.productAsset = await db.productAsset.findUnique({ where: { id: item.productAssetId }, select: { id: true, sku: true, name: true, mainCategory: true } });

      return { ok: true, data: { item: serializeItem(item, activeLoan, links), loans: loans.map(serializeLoan) } };
    } catch (e: any) {
      logger.error('[sample-room] getItem failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '样卡详情查询失败', 500);
    }
  }

  // ── 退役（终态；在借不可退役） ──
  async function retireItem(id: string, note?: string, actorId?: string): Promise<SampleRoomResult<any>> {
    try {
      const item = await db.sampleCardItem.findFirst({ where: { id, deletedAt: null } });
      if (!item) return fail('NOT_FOUND', `样卡 ${id} 不存在`, 404);
      if (item.status === 'borrowed') return fail('ITEM_NOT_BORROWABLE', '样卡在借中，须先归还再退役', 409);
      if (item.status === 'retired') return fail('ITEM_RETIRED', '样卡已退役（终态）', 409);
      const ts = Date.now();
      const updated = await db.sampleCardItem.update({
        where: { id },
        data: { status: 'retired', notes: note ? String(note).slice(0, 500) : item.notes, updatedAt: ts },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_retire', targetType: 'SampleCardItem', targetId: id,
        after: { code: item.code, note }, operationType: 'update', fieldPath: 'status',
      });
      return { ok: true, data: { item: updated } };
    } catch (e: any) {
      logger.error('[sample-room] retireItem failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '样卡退役失败', 500);
    }
  }

  // ── 借出 / 看样登记（DR-057-② 统一流水；v2 支持 loanQuantity） ──
  async function createLoan(
    itemId: string,
    input: { loanType?: string; loanQuantity?: number; borrowerName?: string; borrowerUserId?: string; relationId?: string; dueAt?: number },
    actorId?: string,
  ): Promise<SampleRoomResult<any>> {
    try {
      const item = await db.sampleCardItem.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!item) return fail('NOT_FOUND', `样卡 ${itemId} 不存在`, 404);
      const loanType = String(input.loanType ?? 'borrow');
      if (!LOAN_TYPES.includes(loanType)) return fail('VALIDATION_FAILED', `loanType 必须是: ${LOAN_TYPES.join(', ')}`);
      const borrowerName = String(input.borrowerName ?? '').trim();
      if (!borrowerName) return fail('VALIDATION_FAILED', 'borrowerName 必填（借用人/看样联系人）');

      if (item.status === 'retired') return fail('ITEM_RETIRED', '样卡已退役，不可借出/看样', 409);

      // v2：借出数量校验（默认 1，向后兼容）
      const loanQuantity = Math.max(1, Math.floor(Number(input.loanQuantity) || 1));
      if (loanQuantity > Number(item.quantity)) {
        return fail('VALIDATION_FAILED', `借出数量 ${loanQuantity} 超过总库存 ${item.quantity}`);
      }

      // 借出占用状态机；看样即看即还（不占借出状态，仍落流水挂客户）
      if (loanType === 'borrow') {
        // v2：availableQty 校验 + 部分借出
        if (Number(item.availableQty) < loanQuantity) {
          return fail('INSUFFICIENT_QTY', `可用数量不足（剩余 ${item.availableQty}，申请 ${loanQuantity}）`, 409);
        }
        const dueAt = input.dueAt != null ? Number(input.dueAt) : null;
        if (dueAt != null && !Number.isFinite(dueAt)) return fail('VALIDATION_FAILED', 'dueAt 必须是毫秒时间戳');
        const ts = Date.now();
        const loan = await db.sampleCardLoan.create({
          data: {
            id: generateId('SCL'),
            itemId,
            loanType,
            loanQuantity,
            borrowerName,
            borrowerUserId: input.borrowerUserId ? String(input.borrowerUserId) : null,
            relationId: null,
            relationName: null,
            loanedAt: ts,
            dueAt,
            operatorId: actorId || null,
            createdAt: ts,
          },
        });
        // v2：扣减 availableQty；若 availableQty = 0 则 status = borrowed
        const newAvailable = Number(item.availableQty) - loanQuantity;
        const updated = await db.sampleCardItem.update({
          where: { id: itemId },
          data: {
            availableQty: newAvailable,
            status: newAvailable === 0 ? 'borrowed' : item.status,
            updatedAt: ts,
          },
        });
        await writeRouteAuditLog({
          prisma: db, actorId: actorId || 'system', source: 'sample-room',
          operation: 'sample_card_loan', targetType: 'SampleCardItem', targetId: itemId,
          after: { code: item.code, loanId: loan.id, borrowerName, dueAt, loanQuantity, availableAfter: newAvailable }, operationType: 'link',
        });
        return { ok: true, data: { loan: serializeLoan(loan), item: updated } };
      }

      // viewing：relationId 关联客户（快照 relationName），即看即还
      const relationId = input.relationId ? String(input.relationId) : null;
      let relationName: string | null = null;
      if (relationId) {
        const rel = await db.relation.findFirst({ where: { id: relationId, deletedAt: null }, select: { name: true } });
        if (!rel) return fail('VALIDATION_FAILED', `客户 ${relationId} 不存在`);
        relationName = rel.name;
      }
      const ts = Date.now();
      const loan = await db.sampleCardLoan.create({
        data: {
          id: generateId('SCL'),
          itemId,
          loanType,
          loanQuantity,
          borrowerName,
          borrowerUserId: null,
          relationId,
          relationName,
          loanedAt: ts,
          dueAt: null,
          returnedAt: ts, // 看样即看即还：登记即归还态，历史可查
          operatorId: actorId || null,
          createdAt: ts,
        },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_viewing', targetType: 'SampleCardItem', targetId: itemId,
        after: { code: item.code, loanId: loan.id, relationId, relationName, viewer: borrowerName, loanQuantity }, operationType: 'link',
      });
      return { ok: true, data: { loan: serializeLoan(loan), item } };
    } catch (e: any) {
      logger.error('[sample-room] createLoan failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '借出/看样登记失败', 500);
    }
  }

  // ── 归还（append-only：只补 returnedAt/conditionNote；v2 增加 availableQty） ──
  async function returnLoan(loanId: string, conditionNote?: string, actorId?: string): Promise<SampleRoomResult<any>> {
    try {
      const loan = await db.sampleCardLoan.findUnique({ where: { id: loanId } });
      if (!loan) return fail('NOT_FOUND', `借出记录 ${loanId} 不存在`, 404);
      if (loan.returnedAt != null) return fail('LOAN_ALREADY_ACTIVE', '该借出已归还（重复归还）', 409);
      if (loan.loanType !== 'borrow') return fail('VALIDATION_FAILED', '看样记录即看即还，无需归还操作');
      const ts = Date.now();
      const updated = await db.sampleCardLoan.update({
        where: { id: loanId },
        data: { returnedAt: ts, conditionNote: conditionNote ? String(conditionNote).slice(0, 500) : null },
      });
      // v2：归还后恢复 availableQty；若 availableQty > 0 则 status = in_stock
      const item = await db.sampleCardItem.findFirst({ where: { id: loan.itemId } });
      const newAvailable = Number(item.availableQty) + Number(loan.loanQuantity || 1);
      const newStatus = newAvailable > 0 ? 'in_stock' : item.status;
      const updatedItem = await db.sampleCardItem.update({
        where: { id: loan.itemId },
        data: { availableQty: newAvailable, status: newStatus, updatedAt: ts },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_return', targetType: 'SampleCardItem', targetId: loan.itemId,
        after: { loanId, overdue: loan.dueAt != null && Number(loan.dueAt) < ts, conditionNote, returnedQty: loan.loanQuantity, availableAfter: newAvailable }, operationType: 'update', fieldPath: 'returnedAt',
      });
      return { ok: true, data: { loan: serializeLoan(updated), item: updatedItem } };
    } catch (e: any) {
      logger.error('[sample-room] returnLoan failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '归还登记失败', 500);
    }
  }

  // ── 盘点调整（v2 新增：调整 quantity/availableQty/minStock/maxStock） ──
  async function adjustQuantity(
    id: string,
    input: { newQuantity?: number; newMinStock?: number | null; newMaxStock?: number | null; reason?: string },
    actorId?: string,
  ): Promise<SampleRoomResult<any>> {
    try {
      const item = await db.sampleCardItem.findFirst({ where: { id, deletedAt: null } });
      if (!item) return fail('NOT_FOUND', `样卡 ${id} 不存在`, 404);
      if (item.status === 'retired') return fail('ITEM_RETIRED', '样卡已退役，不可盘点', 409);

      const oldQuantity = Number(item.quantity);
      const oldAvailable = Number(item.availableQty);
      const inLoanQty = oldQuantity - oldAvailable; // 在借未归还数量

      const newQuantity = input.newQuantity != null ? Math.max(inLoanQty, Math.floor(Number(input.newQuantity))) : oldQuantity;
      if (input.newQuantity != null && Number(input.newQuantity) < inLoanQty) {
        return fail('VALIDATION_FAILED', `新数量 ${input.newQuantity} 不能小于在借数量 ${inLoanQty}`);
      }

      const newMinStock = input.newMinStock !== undefined
        ? (input.newMinStock === null ? null : Math.max(0, Math.floor(Number(input.newMinStock))))
        : item.minStock;
      const newMaxStock = input.newMaxStock !== undefined
        ? (input.newMaxStock === null ? null : Math.max(0, Math.floor(Number(input.newMaxStock))))
        : item.maxStock;
      if (newMinStock != null && newMaxStock != null && newMinStock > newMaxStock) {
        return fail('VALIDATION_FAILED', 'minStock 不能大于 maxStock');
      }

      const newAvailable = newQuantity - inLoanQty;
      const ts = Date.now();
      const updated = await db.sampleCardItem.update({
        where: { id },
        data: {
          quantity: newQuantity,
          availableQty: newAvailable,
          minStock: newMinStock,
          maxStock: newMaxStock,
          status: newAvailable === 0 ? 'borrowed' : (item.status === 'borrowed' ? 'in_stock' : item.status),
          updatedAt: ts,
        },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_adjust', targetType: 'SampleCardItem', targetId: id,
        after: {
          code: item.code, oldQuantity, newQuantity, oldAvailable, newAvailable, inLoanQty,
          newMinStock, newMaxStock, reason: input.reason,
        },
        operationType: 'update', fieldPath: 'quantity',
      });
      return { ok: true, data: { item: updated } };
    } catch (e: any) {
      logger.error('[sample-room] adjustQuantity failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '盘点调整失败', 500);
    }
  }

  // ── 低库存预警（v2 新增：availableQty <= minStock） ──
  async function listLowStock(limit = 100): Promise<SampleRoomResult<any>> {
    try {
      const items = await db.sampleCardItem.findMany({
        where: { deletedAt: null, status: { not: 'retired' }, minStock: { not: null } },
        orderBy: { availableQty: 'asc' },
        take: Math.min(Math.max(Number(limit) || 100, 1), 500),
      });
      const lowStockItems = items
        .filter((i: any) => Number(i.availableQty) <= Number(i.minStock))
        .map((i: any) => ({
          ...i,
          shortage: Number(i.minStock) - Number(i.availableQty),
          severity: Number(i.availableQty) === 0 ? 'critical' : 'warning',
        }));
      return { ok: true, data: { items: lowStockItems, total: lowStockItems.length } };
    } catch (e: any) {
      logger.error('[sample-room] listLowStock failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '低库存预警查询失败', 500);
    }
  }

  // ── 借还流水列表（在借/逾期/历史/看样） ──
  async function listLoans(filter: {
    active?: boolean; overdue?: boolean; loanType?: string; itemId?: string; limit?: number;
  } = {}): Promise<SampleRoomResult<any>> {
    try {
      const where: any = {};
      if (filter.active === true) where.returnedAt = null;
      if (filter.active === false) where.returnedAt = { not: null };
      if (filter.loanType) where.loanType = filter.loanType;
      if (filter.itemId) where.itemId = filter.itemId;
      const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
      let loans = await db.sampleCardLoan.findMany({ where, orderBy: { loanedAt: 'desc' }, take: limit });
      loans = loans.map(serializeLoan);
      if (filter.overdue === true) loans = loans.filter((l: any) => l.overdue);
      // 附样卡摘要（code/name）
      const itemIds = [...new Set(loans.map((l: any) => l.itemId))];
      const items = itemIds.length ? await db.sampleCardItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true } }) : [];
      const itemById = new Map(items.map((i: any) => [i.id, i]));
      return {
        ok: true,
        data: { loans: loans.map((l: any) => ({ ...l, item: itemById.get(l.itemId) ?? null })) },
      };
    } catch (e: any) {
      logger.error('[sample-room] listLoans failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '借还流水查询失败', 500);
    }
  }

  return { createItem, listItems, getItem, retireItem, createLoan, returnLoan, listLoans, adjustQuantity, listLowStock };
}
