/**
 * REQ2-16 样品间管理回归测试（设计文档 §6 验收锚点）
 *
 * 覆盖（DR-057 三决策）：
 *   ① 实体/逻辑分轨：colorCardCode 弱关联；② 借还统一流水 append-only + 状态机；
 *   ③ 编号 SC-YYYYMMDD-NNN 当日递增
 *   ④ 借出占用/看样即看即还/逾期派生/退役终态/重复借还 409
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createSampleRoomService } from '../sampleRoomService';

function makePrisma(seed: { items?: any[]; loans?: any[]; relations?: any[] } = {}) {
  const state = {
    items: [...(seed.items ?? [])],
    loans: [...(seed.loans ?? [])],
    relations: [...(seed.relations ?? [])],
    auditLogs: [] as any[],
  };
  const prisma: any = {
    sampleCardItem: {
      count: async ({ where }: any) =>
        state.items.filter((i: any) => String(i.code ?? '').startsWith(String(where?.code?.startsWith ?? ''))).length,
      findFirst: async ({ where }: any) =>
        state.items.find((i: any) => (where.id ? i.id === where.id : true) && (where.deletedAt === null ? i.deletedAt == null : true)) ?? null,
      findMany: async ({ where, select, take, skip }: any) => {
        let rows = state.items.filter((i: any) => {
          if (where?.deletedAt !== undefined && where.deletedAt === null && i.deletedAt != null) return false;
          if (where?.status && i.status !== where.status) return false;
          if (where?.cardType && i.cardType !== where.cardType) return false;
          if (where?.code && i.code !== where.code) return false;
          if (where?.id?.in && !where.id.in.includes(i.id)) return false;
          if (where?.OR) {
            const hit = where.OR.some((cond: any) =>
              (cond.name?.contains ? i.name.includes(cond.name.contains) : true)
              && (cond.code?.contains ? i.code.includes(cond.code.contains) : true)
              && (cond.location?.contains ? (i.location || '').includes(cond.location.contains) : true));
            if (!hit) return false;
          }
          return true;
        });
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
        let rows = state.loans.filter((l: any) => {
          if (where?.itemId?.in) {
            if (!where.itemId.in.includes(l.itemId)) return false;
          } else if (where?.itemId && l.itemId !== where.itemId) return false;
          if (where?.loanType && l.loanType !== where.loanType) return false;
          if (where?.returnedAt === null && l.returnedAt != null) return false;
          if (where?.returnedAt?.not != null && l.returnedAt == null) return false;
          return true;
        });
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
      findFirst: async ({ where }: any) => state.relations.find((r: any) => r.id === where.id) ?? null,
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
});

describe('借出/归还状态机（DR-057-②）', () => {
  it('借出 → borrowed；在借再借 409；归还 → in_stock（append-only 补记）', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', deletedAt: null }],
    });
    const svc = createSampleRoomService(prisma);
    const dueAt = Date.now() + 3 * 24 * 3600 * 1000;
    const loan = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小张', dueAt }, 'u2');
    expect(loan.ok).toBe(true);
    expect(state.items[0].status).toBe('borrowed');

    const again = await svc.createLoan('SCI-1', { loanType: 'borrow', borrowerName: '小李' });
    expect((again as any).error.code).toBe('LOAN_ALREADY_ACTIVE');

    const ret = await svc.returnLoan((loan as any).data.loan.id, '边角轻微磨损', 'u2');
    expect(ret.ok).toBe(true);
    expect(state.items[0].status).toBe('in_stock');
    const loanRow = state.loans[0];
    expect(loanRow.returnedAt).toBeGreaterThan(0);
    expect(loanRow.conditionNote).toBe('边角轻微磨损');
    expect(loanRow.borrowerName).toBe('小张'); // append-only：历史行内容不被改写

    const retAgain = await svc.returnLoan((loan as any).data.loan.id);
    expect((retAgain as any).error.code).toBe('LOAN_ALREADY_ACTIVE'); // 重复归还 409
  });

  it('逾期派生标记（dueAt < now 且未归还）；归还后消除', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', deletedAt: null }],
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

describe('看样登记（DR-057-② viewing 即看即还）', () => {
  it('看样挂客户快照，不占借出状态；客户不存在 400', async () => {
    const { prisma, state } = makePrisma({
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', deletedAt: null }],
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
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', deletedAt: null }],
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
      items: [{ id: 'SCI-1', code: 'SC-20260820-001', name: '样卡一', cardType: 'fabric', status: 'in_stock', deletedAt: null }],
      loans: [
        { id: 'SCL-1', itemId: 'SCI-1', loanType: 'borrow', borrowerName: 'A', loanedAt: 1000, returnedAt: 2000 },
        { id: 'SCL-2', itemId: 'SCI-1', loanType: 'viewing', borrowerName: 'B', loanedAt: 3000, returnedAt: 3000 },
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
