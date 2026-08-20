/**
 * sampleRoomService.ts — REQ2-16 样品间管理（DR-057）
 *
 * 设计真源：docs/design/04-模块设计/03-订单与生产/Development-开发/样品间管理.md
 *
 * DR-057 三决策：
 *   ① 实体样卡与逻辑色卡分轨（SampleCardItem 实物 ≠ ColorCard 逻辑色；colorCardCode 可选关联）
 *   ② 借出与看样统一 Loan 流水（append-only：归还只补 returnedAt/conditionNote）
 *   ③ 二维码载荷 = 样卡编号（SC-YYYYMMDD-NNN 当日递增；前端 qrcode 打印，扫码按 code 直达）
 *
 * 状态机：in_stock → borrowed → in_stock；retired 终态（在借不可退役/退役不可借）。
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

  function serializeItem(item: any, activeLoan?: any) {
    const loan = activeLoan ? serializeLoan(activeLoan) : undefined;
    return {
      ...item,
      activeLoan: loan ?? null,
      overdue: loan?.overdue ?? false,
    };
  }

  // ── 登记 ──
  async function createItem(input: {
    name?: string; cardType?: string; colorCardCode?: string; location?: string; notes?: string;
  }, actorId?: string): Promise<SampleRoomResult<any>> {
    try {
      const name = String(input.name ?? '').trim();
      if (!name) return fail('VALIDATION_FAILED', 'name 必填（样卡名称）');
      const cardType = input.cardType ? String(input.cardType) : 'fabric';
      if (!CARD_TYPES.includes(cardType)) return fail('VALIDATION_FAILED', `cardType 必须是: ${CARD_TYPES.join(', ')}`);

      // 可选逻辑色卡关联（DR-057-①）：不存在不阻断（快照式弱关联）
      const colorCardCode = input.colorCardCode ? String(input.colorCardCode).trim() : null;

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
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_create', targetType: 'SampleCardItem', targetId: item.id,
        after: { code: item.code, name, cardType }, operationType: 'create',
      });
      return { ok: true, data: { item } };
    } catch (e: any) {
      logger.error('[sample-room] createItem failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '样卡登记失败', 500);
    }
  }

  // ── 列表（状态/类型/搜索/编号直达；附活跃借出摘要与逾期派生标记） ──
  async function listItems(filter: {
    status?: string; cardType?: string; search?: string; code?: string; limit?: number; offset?: number;
  } = {}): Promise<SampleRoomResult<any>> {
    try {
      const where: any = { deletedAt: null };
      if (filter.status) where.status = filter.status;
      if (filter.cardType) where.cardType = filter.cardType;
      if (filter.code) where.code = filter.code;
      if (filter.search) {
        where.OR = [
          { name: { contains: filter.search } },
          { code: { contains: filter.search } },
          { location: { contains: filter.search } },
        ];
      }
      const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
      const offset = Math.max(Number(filter.offset) || 0, 0);
      const [items, total] = await Promise.all([
        db.sampleCardItem.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        db.sampleCardItem.count({ where }),
      ]);
      // 活跃借出摘要（borrow 未归还）
      const activeLoans = await db.sampleCardLoan.findMany({
        where: { itemId: { in: items.map((i: any) => i.id) }, loanType: 'borrow', returnedAt: null },
        orderBy: { loanedAt: 'desc' },
      });
      const activeByItem = new Map<string, any>();
      for (const l of activeLoans) if (!activeByItem.has(l.itemId)) activeByItem.set(l.itemId, l);
      return {
        ok: true,
        data: { items: items.map((i: any) => serializeItem(i, activeByItem.get(i.id))), total },
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
      return { ok: true, data: { item: serializeItem(item, activeLoan), loans: loans.map(serializeLoan) } };
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

  // ── 借出 / 看样登记（DR-057-② 统一流水） ──
  async function createLoan(
    itemId: string,
    input: { loanType?: string; borrowerName?: string; borrowerUserId?: string; relationId?: string; dueAt?: number },
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

      // 借出占用状态机；看样即看即还（不占借出状态，仍落流水挂客户）
      if (loanType === 'borrow') {
        if (item.status === 'borrowed') return fail('LOAN_ALREADY_ACTIVE', '样卡已在借中（先归还再借出）', 409);
        const dueAt = input.dueAt != null ? Number(input.dueAt) : null;
        if (dueAt != null && !Number.isFinite(dueAt)) return fail('VALIDATION_FAILED', 'dueAt 必须是毫秒时间戳');
        const ts = Date.now();
        const loan = await db.sampleCardLoan.create({
          data: {
            id: generateId('SCL'),
            itemId,
            loanType,
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
        const updated = await db.sampleCardItem.update({ where: { id: itemId }, data: { status: 'borrowed', updatedAt: ts } });
        await writeRouteAuditLog({
          prisma: db, actorId: actorId || 'system', source: 'sample-room',
          operation: 'sample_card_loan', targetType: 'SampleCardItem', targetId: itemId,
          after: { code: item.code, loanId: loan.id, borrowerName, dueAt }, operationType: 'link',
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
        after: { code: item.code, loanId: loan.id, relationId, relationName, viewer: borrowerName }, operationType: 'link',
      });
      return { ok: true, data: { loan: serializeLoan(loan), item } };
    } catch (e: any) {
      logger.error('[sample-room] createLoan failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '借出/看样登记失败', 500);
    }
  }

  // ── 归还（append-only：只补 returnedAt/conditionNote） ──
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
      const item = await db.sampleCardItem.update({ where: { id: loan.itemId }, data: { status: 'in_stock', updatedAt: ts } });
      await writeRouteAuditLog({
        prisma: db, actorId: actorId || 'system', source: 'sample-room',
        operation: 'sample_card_return', targetType: 'SampleCardItem', targetId: loan.itemId,
        after: { loanId, overdue: loan.dueAt != null && Number(loan.dueAt) < ts, conditionNote }, operationType: 'update', fieldPath: 'returnedAt',
      });
      return { ok: true, data: { loan: serializeLoan(updated), item } };
    } catch (e: any) {
      logger.error('[sample-room] returnLoan failed', { error: e?.message });
      return fail('INTERNAL_ERROR', e?.message || '归还登记失败', 500);
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

  return { createItem, listItems, getItem, retireItem, createLoan, returnLoan, listLoans };
}
