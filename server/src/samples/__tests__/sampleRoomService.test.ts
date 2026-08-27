/**
 * REQ2-16 样品间管理回归测试（设计文档 §6 验收锚点 + v2 库存联动）
 *
 * 覆盖（DR-057 三决策 + v2 升级）：
 *   ① 实体/逻辑分轨：colorCardCode 弱关联；② 借还统一流水 append-only + 状态机；
 *   ③ 编号 SC-YYYYMMDD-NNN 当日递增
 *   ④ 借出占用/看样即看即还/逾期派生/退役终态/重复借还 409
 *   v2：⑤ 库存字段（quantity/availableQty/minStock/maxStock/warehouseId/devCaseId/orderId）
 *       ⑥ 借出数量 loanQuantity + 部分借出 + INSUFFICIENT_QTY 校验
 *       ⑦ 盘点 adjustQuantity + 低库存预警 listLowStock
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createSampleRoomService } from '../sampleRoomService';

function makePrisma(seed: { items?: any[]; loans?: any[]; relations?: any[]; warehouses?: any[]; devCases?: any[]; orders?: any[]; productAssets?: any[] } = {}) {
  const state = {
    items: [...(seed.items ?? [])],
    loans: [...(seed.loans ?? [])],
    relations: [...(seed.relations ?? [])],
    warehouses: [...(seed.warehouses ?? [])],
    devCases: [...(seed.devCases ?? [])],
    orders: [...(seed.orders ?? [])],
    productAssets: [...(seed.productAssets ?? [])],
    auditLogs: [] as any[],
  };
  const matchWhere = (row: any, where: any) => {
    if (!where) return true;
    for (const k of Object.keys(where)) {
      const v = where[k];
      if (k === 'OR') {
        if (!v.some((cond: any) => matchWhere(row, cond))) return false;
        continue;
      }
      if (v === null) {
        // IS NULL check
        if (row[k] != null) return false;
      } else if (typeof v === 'object') {
        // object form: { in, not, contains, startsWith, ... }
        if ('in' in v) {
          if (!v.in.includes(row[k])) return false;
        } else if ('not' in v) {
          if (row[k] === v.not) return false;
        } else if ('contains' in v) {
          if (!String(row[k] ?? '').includes(v.contains)) return false;
        } else if ('startsWith' in v) {
          if (!String(row[k] ?? '').startsWith(v.startsWith)) return false;
        }
      } else {
        // primitive equality (string/number/boolean)
        if (row[k] !== v) return false;
      }
    }
    return true;
  };
  const prisma: any = {
    sampleCardItem: {
      count: async ({ where }: any) => state.items.filter((i: any) => matchWhere(i, where)).length,
      findFirst: async ({ where }: any) => state.items.find((i: any) => matchWhere(i, where)) ?? null,
      findMany: async ({ where, select, take, skip, orderBy }: any) => {
        let rows = state.items.filter((i: any) => matchWhere(i, where));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt));
        if (orderBy?.availableQty === 'asc') rows = [...rows].sort((a: any, b: any) => Number(a.availableQty) - Number(b.availableQty));
        rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
        return rows.map((r: any) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r));
      },
      create: async ({ data }: any) => { state.items.push(data); return data; },
      update: async ({ where, data }: any) => {
        const it = state.items.find((x: any) => x.id === where.id);
        Object.assign(it, data);
        return it;
      },
    },
    sampleCardLoan: {
      findUnique: async ({ where }: any) => state.loans.find((l: any) => l.id === where.id) ?? null,
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = state.loans.filter((l: any) => matchWhere(l, where));
        if (orderBy?.loanedAt === 'desc') rows = [...rows].sort((a: any, b: any) => b.loanedAt - a.loanedAt);
        if (orderBy?.loanedAt === 'asc') rows = [...rows].sort((a: any, b: any) => a.loanedAt - b.loanedAt);
        return rows.slice(0, take ?? 50);
      },
      create: async ({ data }: any) => { state.loans.push(data); return data; },
      update: async ({ where, data }: any) => {
        const l = state.loans.find((x: any) => x.id === where.id);
        Object.assign(l, data);
        return l;
      },
    },
    relation: {
      findFirst: async ({ where }: any) => state.relations.find((r: any) => r.id === where.id && (where.deletedAt === null ? r.deletedAt == null : true)) ?? null,
    },
    warehouse: {
      findUnique: async ({ where }: any) => state.warehouses.find((w: any) => w.id === where.id) ?? null,
      findMany: async ({ where, select }: any) => {
        const rows = state.warehouses.filter((w: any) => matchWhere(w, where));
        return rows.map((r: any) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r));
      },
    },
    developmentCase: {
      findUnique: async ({ where }: any) => state.devCases.find((d: any) => d.id === where.id) ?? null,
      findMany: async ({ where, select }: any) => {
        const rows = state.devCases.filter((d: any) => matchWhere(d, where));
        return rows.map((r: any) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r));
      },
    },
    order: {
      findUnique: async ({ where }: any) => state.orders.find((o: any) => o.id === where.id) ?? null,
      findMany: async ({ where, select }: any) => {
        const rows = state.orders.filter((o: any) => matchWhere(o, where));
        return rows.map((r: any) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r));
      },
    },
    productAsset: {
      findUnique: async ({ where, select }: any) => {
        const r = state.productAssets.find((p: any) => p.id === where.id) ?? null;
        return r && select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r;
      },
      findMany: async ({ where, select }: any) => {
        const rows = state.productAssets.filter((p: any) => matchWhere(p, where));
        return rows.map((r: any) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]])) : r));
      },
    },
    auditLog: { create: async ({ data }: any) => { state.auditLogs.push(data); return { id: data.id }; } },
  };
  return { prisma, state };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('样卡登记与编号（DR-057-③）', () => {
  it('编号当日递增 SC-YYYYMMDD-NNN；cardType 枚举校验', async () => {
    const { prisma, state } = makePrisma();
    const svc = createSampleRoomService(prisma);
    const a = await svc.createItem({ name: '苎麻衬衫面料卡', cardType: 'fabric', location: 'A-01' }, 'u1');
    const b = await svc.createItem({ name: 'Classic Blue 色卡', cardType: 'colorcard', colorCardCode: '19-4052 TCX' }, 'u1');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect((a as any).data.item.code).toMatch(/^SC-\d{8}-001$/);
    expect((b as any).data.item.code).toMatch(/^SC-\d{8}-002$/);
    expect((b as any).data.item.colorCardCode).toBe('19-4052 TCX'); // 逻辑色卡弱关联
    expect(state.auditLogs.map((x: any) => x.action)).toContain('sample_card_create');

    const bad = await svc.createItem({ name: 'X', cardType: 'weird' });
    expect((bad as any).error.code).toBe('VALIDATION_FAILED');
    const noName = await svc.createItem({});
    expect((noName as any).error.code).toBe('VALIDATION_FAILED');
  });

  it('v2：登记带 quantity/minStock/warehouseId/devCaseId/orderId', async () => {
    const { prisma, state } = makePrisma({
      warehouses: [{ id: 'WH-1', code: 'WH-001', name: '样品间主仓' }],
      devCases: [{ id: 'DC-1', code: 'DEV-20260825-001', name: '夏季衬衫开发' }],
      orders: [{ id: 'OD-1', poNumber: 'PO-2025-001', customer: 'Peerless' }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.createItem({
      name: '夏季色卡', cardType: 'colorcard',
      quantity: 10, minStock: 3, maxStock: 20, unit: '张',
      warehouseId: 'WH-1', devCaseId: 'DC-1', orderId: 'OD-1',
    }, 'u1');
    expect(r.ok).toBe(true);
    const item = (r as any).data.item;
    expect(item.quantity).toBe(10);
    expect(item.availableQty).toBe(10);
    expect(item.minStock).toBe(3);
    expect(item.maxStock).toBe(20);
    expect(item.warehouseId).toBe('WH-1');
    expect(item.devCaseId).toBe('DC-1');
    expect(item.orderId).toBe('OD-1');

    // 关联不存在校验
    const bad = await svc.createItem({ name: 'X', warehouseId: 'WH-X' });
    expect((bad as any).error.code).toBe('VALIDATION_FAILED');
  });

  it('v2：minStock > maxStock 校验失败', async () => {
    const { prisma } = makePrisma();
    const svc = createSampleRoomService(prisma);
    const r = await svc.createItem({ name: 'X', minStock: 10, maxStock: 5 });
    expect((r as any).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('借出/归还状态机（DR-057-②）', () => {
  it('借出 → borrowed；在借再借 409；归还 → in_stock（append-only 补记）', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const dueAt = Date.now() + 3 * 24 * 3600 * 1000;
    const loan = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小张', dueAt }, 'u2');
    expect(loan.ok).toBe(true);
    expect(state.items[0].status).toBe('borrowed');
    expect(state.items[0].availableQty).toBe(0); // v2：扣减

    const again = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小李' });
    expect((again as any).error.code).toBe('INSUFFICIENT_QTY'); // v2：可用不足

    const ret = await svc.returnLoan((loan as any).data.loan.id, '边角轻微磨损', 'u2');
    expect(ret.ok).toBe(true);
    expect(state.items[0].status).toBe('in_stock');
    expect(state.items[0].availableQty).toBe(1); // v2：归还后恢复
    const loanRow = state.loans[0];
    expect(loanRow.returnedAt).toBeGreaterThan(0);
    expect(loanRow.conditionNote).toBe('边角轻微磨损');
    expect(loanRow.borrowerName).toBe('小张'); // append-only：历史行内容不被改写
    expect(loanRow.loanQuantity).toBe(1); // v2：默认 1

    const retAgain = await svc.returnLoan((loan as any).data.loan.id);
    expect((retAgain as any).error.code).toBe('LOAN_ALREADY_ACTIVE'); // 重复归还 409
  });

  it('逾期派生标记（dueAt < now 且未归还）；归还后消除', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const overdueDue = Date.now() - 24 * 3600 * 1000;
    const loan = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '老王', dueAt: overdueDue });
    expect((loan as any).data.loan.overdue).toBe(true);

    const list = await svc.listItems({});
    expect((list as any).data.items[0].overdue).toBe(true);

    const overdueLoans = await svc.listLoans({ overdue: true });
    expect((overdueLoans as any).data.loans).toHaveLength(1);

    await svc.returnLoan((loan as any).data.loan.id);
    const after = await svc.listLoans({ overdue: true });
    expect((after as any).data.loans).toHaveLength(0);
  });
});

describe('v2：多数量借出 + 部分借出', () => {
  it('10 张库存，先借 4 → 仍 in_stock（剩 6），再借 6 → borrowed（剩 0）', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-M', code: 'SC-20260825-001', name: '多量样卡', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 10, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);

    const l1 = await svc.createLoan('SCI-M', { loanType: 'borrow', borrowerName: '小李', loanQuantity: 4 });
    expect(l1.ok).toBe(true);
    expect(state.items[0].availableQty).toBe(6);
    expect(state.items[0].status).toBe('in_stock'); // 部分借出，仍可借

    const l2 = await svc.createLoan('SCI-M', { loanType: 'borrow', borrowerName: '小王', loanQuantity: 6 });
    expect(l2.ok).toBe(true);
    expect(state.items[0].availableQty).toBe(0);
    expect(state.items[0].status).toBe('borrowed');

    // 归还第一笔 4 张
    await svc.returnLoan((l1 as any).data.loan.id);
    expect(state.items[0].availableQty).toBe(4);
    expect(state.items[0].status).toBe('in_stock'); // 又可借
  });

  it('借出超过总库存 → VALIDATION_FAILED；超过可用 → INSUFFICIENT_QTY', async () => {
    const { prisma } = makePrisma({
      items: [{ id: 'SCI-X', code: 'SC-20260825-002', name: 'X', cardType: 'fabric', status: 'in_stock', quantity: 5, availableQty: 2, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);

    const over = await svc.createLoan('SCI-X', { loanType: 'borrow', borrowerName: 'A', loanQuantity: 10 });
    expect((over as any).error.code).toBe('VALIDATION_FAILED'); // 超过总库存

    const ins = await svc.createLoan('SCI-X', { loanType: 'borrow', borrowerName: 'B', loanQuantity: 5 });
    expect((ins as any).error.code).toBe('INSUFFICIENT_QTY'); // 超过可用（2<5）
  });
});

describe('v2：盘点调整 adjustQuantity', () => {
  it('调整 quantity + minStock/maxStock；保留在借数量', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-A', code: 'SC-20260825-003', name: '盘点样卡', cardType: 'fabric', status: 'borrowed', quantity: 10, availableQty: 0, minStock: 2, maxStock: 15, deletedAt: null }],
      loans: [{ id: 'SCL-A', itemId: 'SCI-A', loanType: 'borrow', loanQuantity: 10, borrowerName: '小张', loanedAt: 1000, returnedAt: null }],
    });
    const svc = createSampleRoomService(prisma);

    // 调整 quantity=15（在借 10，新可用=5）
    const r = await svc.adjustQuantity('SCI-A', { newQuantity: 15, newMinStock: 3, newMaxStock: 30, reason: '补充库存' }, 'u1');
    expect(r.ok).toBe(true);
    const item = (r as any).data.item;
    expect(item.quantity).toBe(15);
    expect(item.availableQty).toBe(5); // 15 - 10(在借) = 5
    expect(item.status).toBe('in_stock'); // availableQty > 0
    expect(item.minStock).toBe(3);
    expect(item.maxStock).toBe(30);

    // 新数量 < 在借数量 → 失败
    const bad = await svc.adjustQuantity('SCI-A', { newQuantity: 5 });
    expect((bad as any).error.code).toBe('VALIDATION_FAILED');
  });

  it('退役样卡不可盘点', async () => {
    const { prisma } = makePrisma({
      items: [{ id: 'SCI-R', code: 'SC-20260825-004', name: '已退役', cardType: 'fabric', status: 'retired', quantity: 5, availableQty: 5, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.adjustQuantity('SCI-R', { newQuantity: 10 });
    expect((r as any).error.code).toBe('ITEM_RETIRED');
  });
});

describe('v2：低库存预警 listLowStock', () => {
  it('availableQty <= minStock 返回预警 + shortage/severity', async () => {
    const { prisma } = makePrisma({
      items: [
        { id: 'SCI-1', code: 'SC-1', name: 'A', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 0, minStock: 3, deletedAt: null },
        { id: 'SCI-2', code: 'SC-2', name: 'B', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 2, minStock: 3, deletedAt: null },
        { id: 'SCI-3', code: 'SC-3', name: 'C', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 5, minStock: 3, deletedAt: null }, // 不预警
        { id: 'SCI-4', code: 'SC-4', name: 'D', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 10, deletedAt: null }, // 无 minStock
        { id: 'SCI-5', code: 'SC-5', name: 'E', cardType: 'fabric', status: 'retired', quantity: 10, availableQty: 0, minStock: 3, deletedAt: null }, // 退役排除
      ],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.listLowStock();
    expect(r.ok).toBe(true);
    const items = (r as any).data.items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('SCI-1'); // availableQty=0 优先
    expect(items[0].severity).toBe('critical');
    expect(items[0].shortage).toBe(3);
    expect(items[1].id).toBe('SCI-2');
    expect(items[1].severity).toBe('warning');
  });
});

describe('看样登记（DR-057-② viewing 即看即还）', () => {
  it('看样挂客户快照，不占借出状态；客户不存在 400', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, deletedAt: null }],
      relations: [{ id: 'REL-1', name: 'Peerless Clothing', deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const v = await svc.createLoan('SCI-1', { loanType: 'viewing', borrowerName: 'Alice', relationId: 'REL-1' }, 'u3');
    expect(v.ok).toBe(true);
    const loan = (v as any).data.loan;
    expect(loan.relationName).toBe('Peerless Clothing');
    expect(loan.returnedAt).toBeGreaterThan(0); // 即看即还
    expect(state.items[0].status).toBe('in_stock'); // 不占借出状态
    expect(state.auditLogs.map((x: any) => x.action)).toContain('sample_card_viewing');

    const bad = await svc.createLoan('SCI-1', { loanType: 'viewing', borrowerName: 'X', relationId: 'REL-X' });
    expect((bad as any).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('退役与边界（DR-057-② 终态）', () => {
  it('在借退役 409；归还后退役成功；退役后不可借/不可再退役', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const loan = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小张' });
    const r1 = await svc.retireItem('SCI-1', '样卡褪色报废');
    expect((r1 as any).error.code).toBe('ITEM_NOT_BORROWABLE');

    await svc.returnLoan((loan as any).data.loan.id);
    const r2 = await svc.retireItem('SCI-1', '样卡褪色报废');
    expect(r2.ok).toBe(true);
    expect(state.items[0].status).toBe('retired');

    const borrow = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小李' });
    expect((borrow as any).error.code).toBe('ITEM_RETIRED');
    const view = await svc.createLoan('SCI-1', { loanType: 'viewing', borrowerName: '访客' });
    expect((view as any).error.code).toBe('ITEM_RETIRED');
    const r3 = await svc.retireItem('SCI-1');
    expect((r3 as any).error.code).toBe('ITEM_RETIRED');
  });

  it('详情含借还历史正序；按 code 直达；404 边界', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, deletedAt: null }],
      loans: [
        { id: 'SCL-1', itemId: 'SCI-1', loanType: 'borrow', loanQuantity: 1, borrowerName: 'A', loanedAt: 1000, returnedAt: 2000 },
        { id: 'SCL-2', itemId: 'SCI-1', loanType: 'viewing', loanQuantity: 1, borrowerName: 'B', loanedAt: 3000, returnedAt: 3000 },
      ],
    });
    const svc = createSampleRoomService(prisma);
    const d = await svc.getItem('SCI-1');
    expect((d as any).data.loans.map((l: any) => l.id)).toEqual(['SCL-1', 'SCL-2']);

    const byCode = await svc.listItems({ code: 'SC-20260820-001' });
    expect((byCode as any).data.items).toHaveLength(1);

    const nf = await svc.getItem('NOPE');
    expect((nf as any).error.code).toBe('NOT_FOUND');
    const nfLoan = await svc.returnLoan('NOPE');
    expect((nfLoan as any).error.code).toBe('NOT_FOUND');
  });
});

describe('v2：列表关联单据摘要 join', () => {
  it('listItems 返回 devCaseCode/orderPoNumber/warehouseCode 摘要', async () => {
    const { prisma } = makePrisma({
      items: [{
        id: 'SCI-L', code: 'SC-20260825-099', name: '联动样卡', cardType: 'fabric', status: 'in_stock',
        quantity: 5, availableQty: 5, warehouseId: 'WH-1', devCaseId: 'DC-1', orderId: 'OD-1', deletedAt: null,
      }],
      warehouses: [{ id: 'WH-1', code: 'WH-SAMPLE', name: '样品仓' }],
      devCases: [{ id: 'DC-1', code: 'DEV-2026-001', name: '开发单A' }],
      orders: [{ id: 'OD-1', poNumber: 'PO-2025-099', customer: 'Acme' }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.listItems({});
    expect(r.ok).toBe(true);
    const item = (r as any).data.items[0];
    expect(item.devCaseCode).toBe('DEV-2026-001');
    expect(item.devCaseName).toBe('开发单A');
    expect(item.orderPoNumber).toBe('PO-2025-099');
    expect(item.orderCustomer).toBe('Acme');
    expect(item.warehouseCode).toBe('WH-SAMPLE');
    expect(item.warehouseName).toBe('样品仓');
  });

  it('listItems 按 devCaseId/orderId/warehouseId 过滤 + lowStock 过滤', async () => {
    const { prisma } = makePrisma({
      items: [
        { id: 'SCI-1', code: 'SC-1', name: 'A', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 1, minStock: 3, devCaseId: 'DC-1', deletedAt: null },
        { id: 'SCI-2', code: 'SC-2', name: 'B', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 8, minStock: 3, devCaseId: 'DC-1', deletedAt: null },
        { id: 'SCI-3', code: 'SC-3', name: 'C', cardType: 'fabric', status: 'in_stock', quantity: 10, availableQty: 5, minStock: 3, devCaseId: 'DC-2', deletedAt: null },
      ],
    });
    const svc = createSampleRoomService(prisma);

    // 按 devCaseId 过滤
    const byDev = await svc.listItems({ devCaseId: 'DC-1' });
    expect((byDev as any).data.items).toHaveLength(2);

    // lowStock 过滤（DC-1 下：SCI-1 1<=3 预警；SCI-2 8>3 不预警）
    const low = await svc.listItems({ devCaseId: 'DC-1', lowStock: true });
    expect((low as any).data.items).toHaveLength(1);
    expect((low as any).data.items[0].id).toBe('SCI-1');
  });
});

describe('v2：数字档案 productAssetId 联动', () => {
  it('createItem 带 productAssetId：写入 + 审计日志记录', async () => {
    const { prisma, state } = makePrisma({
      productAssets: [{ id: 'PA-1', sku: 'FAB-COTTON-TWILL', name: '棉弹力斜纹', mainCategory: 'fabric' }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.createItem({
      name: '棉弹力斜纹样卡', cardType: 'fabric',
      productAssetId: 'PA-1',
    }, 'u1');
    expect(r.ok).toBe(true);
    const item = (r as any).data.item;
    expect(item.productAssetId).toBe('PA-1');
    expect(state.items[0].productAssetId).toBe('PA-1');
    // 审计日志 detail.after 包含 productAssetId
    const auditDetail = state.auditLogs[0].detail;
    expect(auditDetail.after.productAssetId).toBe('PA-1');
  });

  it('createItem productAssetId 不存在 → VALIDATION_FAILED', async () => {
    const { prisma } = makePrisma();
    const svc = createSampleRoomService(prisma);
    const r = await svc.createItem({ name: '孤儿样卡', productAssetId: 'PA-GHOST' });
    expect((r as any).error.code).toBe('VALIDATION_FAILED');
    expect((r as any).error.message).toContain('数字档案');
  });

  it('listItems 返回 productAssetSku/productAssetName/productAssetCategory 摘要 join', async () => {
    const { prisma } = makePrisma({
      items: [{
        id: 'SCI-PA', code: 'SC-20260825-PA1', name: '档案联动样卡', cardType: 'fabric', status: 'in_stock',
        quantity: 5, availableQty: 5, productAssetId: 'PA-1', deletedAt: null,
      }],
      productAssets: [{ id: 'PA-1', sku: 'FAB-COTTON-TWILL', name: '棉弹力斜纹', mainCategory: 'fabric' }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.listItems({});
    expect(r.ok).toBe(true);
    const item = (r as any).data.items[0];
    expect(item.productAssetSku).toBe('FAB-COTTON-TWILL');
    expect(item.productAssetName).toBe('棉弹力斜纹');
    expect(item.productAssetCategory).toBe('fabric');
  });

  it('listItems 按 productAssetId 过滤', async () => {
    const { prisma } = makePrisma({
      items: [
        { id: 'SCI-1', code: 'SC-1', name: 'A', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, productAssetId: 'PA-1', deletedAt: null },
        { id: 'SCI-2', code: 'SC-2', name: 'B', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, productAssetId: 'PA-2', deletedAt: null },
        { id: 'SCI-3', code: 'SC-3', name: 'C', cardType: 'fabric', status: 'in_stock', quantity: 1, availableQty: 1, productAssetId: 'PA-1', deletedAt: null },
      ],
      productAssets: [
        { id: 'PA-1', sku: 'SKU-1', name: '档案1', mainCategory: 'fabric' },
        { id: 'PA-2', sku: 'SKU-2', name: '档案2', mainCategory: 'fabric' },
      ],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.listItems({ productAssetId: 'PA-1' });
    expect(r.ok).toBe(true);
    expect((r as any).data.items).toHaveLength(2);
    expect((r as any).data.items.map((i: any) => i.id).sort()).toEqual(['SCI-1', 'SCI-3']);
    // 摘要 join 也正常返回
    expect((r as any).data.items[0].productAssetSku).toBe('SKU-1');
  });

  it('getItem 返回 productAsset 摘要', async () => {
    const { prisma } = makePrisma({
      items: [{
        id: 'SCI-D', code: 'SC-20260825-DET', name: '详情样卡', cardType: 'fabric', status: 'in_stock',
        quantity: 1, availableQty: 1, productAssetId: 'PA-1', deletedAt: null,
      }],
      productAssets: [{ id: 'PA-1', sku: 'SKU-D', name: '档案详情', mainCategory: 'fabric' }],
    });
    const svc = createSampleRoomService(prisma);
    const d = await svc.getItem('SCI-D');
    expect(d.ok).toBe(true);
    const item = (d as any).data.item;
    expect(item.productAssetSku).toBe('SKU-D');
    expect(item.productAssetName).toBe('档案详情');
    expect(item.productAssetCategory).toBe('fabric');
  });

  it('无 productAssetId 的样卡，摘要字段为 null', async () => {
    const { prisma } = makePrisma({
      items: [{
        id: 'SCI-NULL', code: 'SC-20260825-NUL', name: '无档案样卡', cardType: 'colorcard', status: 'in_stock',
        quantity: 1, availableQty: 1, deletedAt: null,
      }],
    });
    const svc = createSampleRoomService(prisma);
    const r = await svc.listItems({});
    expect(r.ok).toBe(true);
    const item = (r as any).data.items[0];
    expect(item.productAssetSku).toBeNull();
    expect(item.productAssetName).toBeNull();
    expect(item.productAssetCategory).toBeNull();
  });
});
