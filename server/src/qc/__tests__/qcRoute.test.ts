import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, SECRET);
const validApiKey = 'test-key';
const apiKeys = new Set([validApiKey]);

import { createQcRouter } from '../qcRoute';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mock Prisma：内存存储 QCLocation / QCAssignment + 关联真源
 * （Order / UserAccount / InspectionReport）。
 * 语义对齐真实 client 的本测试用到的子集（where 条件、orderBy、
 * qCAssignment.findMany 的 include: { location: true }）。
 */
function makeMockPrisma() {
  let seq = 0;
  const locations: any[] = [];
  const assignments: any[] = [];
  const orders: any[] = [];
  const userAccounts: any[] = [];
  const inspectionReports: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as any[]).some(sub => matchWhere(row, sub));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('not' in cond) return cond.not === null ? row[k] !== null : row[k] !== cond.not;
        if ('in' in cond) return cond.in.includes(row[k]);
        if ('notIn' in cond) return !cond.notIn.includes(row[k]);
        if ('lt' in cond && !(row[k] < cond.lt)) return false;
        if ('lte' in cond && !(row[k] <= cond.lte)) return false;
        if ('gt' in cond && !(row[k] > cond.gt)) return false;
        if ('gte' in cond && !(row[k] >= cond.gte)) return false;
        return true;
      }
      return row[k] === v;
    });

  const applyOrderBy = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const orders_ = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((x, y) => {
      for (const o of orders_) {
        const [[field, dir]] = Object.entries(o) as [string, string][];
        const xv = x[field] ?? null;
        const yv = y[field] ?? null;
        if (xv === yv) continue;
        if (xv === null) return 1;
        if (yv === null) return -1;
        if (xv < yv) return dir === 'desc' ? 1 : -1;
        if (xv > yv) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  };

  const applyTakeSkip = (rows: any[], take?: number, skip?: number) =>
    rows.slice(skip || 0, (skip || 0) + (take ?? rows.length));

  const qCLocation = {
    findUnique: async ({ where }: any) =>
      locations.find(l => (where.id !== undefined ? l.id === where.id : l.code === where.code)) || null,
    findMany: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(locations.filter(l => matchWhere(l, where)), orderBy),
    create: async ({ data }: any) => {
      const row = { region: null, focus: null, address: null, notes: null, deletedAt: null, ...data, id: data.id || `QCL__T${++seq}` };
      locations.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = locations.find(l => l.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const withLocation = (row: any, include: any) =>
    include?.location ? { ...row, location: locations.find(l => l.id === row.locationId) ?? null } : row;

  const qCAssignment = {
    findUnique: async ({ where }: any) => assignments.find(a => a.id === where.id) || null,
    findFirst: async ({ where }: any = {}) => assignments.find(a => matchWhere(a, where)) || null,
    findMany: async ({ where, orderBy, take, skip, include }: any = {}) =>
      applyTakeSkip(applyOrderBy(assignments.filter(a => matchWhere(a, where)), orderBy), take, skip)
        .map(r => withLocation(r, include)),
    count: async ({ where }: any = {}) => assignments.filter(a => matchWhere(a, where)).length,
    create: async ({ data }: any) => {
      const row = { locationId: null, factoryRelationId: null, status: 'Assigned', dueDate: null, assignedById: null, completedAt: null, reportId: null, notes: null, deletedAt: null, ...data, id: data.id || `QCA__T${++seq}` };
      assignments.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = assignments.find(a => a.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const order = {
    findUnique: async ({ where }: any) => orders.find(o => o.id === where.id) || null,
    findMany: async ({ where }: any = {}) => orders.filter(o => matchWhere(o, where)),
  };

  const userAccount = {
    findUnique: async ({ where }: any) => userAccounts.find(u => u.id === where.id) || null,
  };

  const inspectionReport = {
    findUnique: async ({ where }: any) => inspectionReports.find(r => r.id === where.id) || null,
  };

  return {
    qCLocation,
    qCAssignment,
    order,
    userAccount,
    inspectionReport,
    _stores: { locations, assignments, orders, userAccounts, inspectionReports },
  };
}

function makeApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (req.headers.cookie) {
      const cookies: Record<string, string> = {};
      req.headers.cookie.split(';').forEach((c: string) => {
        const [k, v] = c.trim().split('=');
        cookies[k] = v;
      });
      req.cookies = cookies;
    }
    next();
  });
  app.use('/api/v1/qc', createQcRouter({ prisma, requireAuth: true, apiKeys }));
  return app;
}

const auth = () => ({ Cookie: `bambook_token=${ownerToken}` });

function seedOrder(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: over.id ?? `ORD-${prisma._stores.orders.length + 1}`,
    poNumber: 'PO-1001',
    customer: 'Acme',
    product: 'Tee',
    quantity: 1000,
    status: 'InProduction',
    dueDate: '2026-09-01',
    clientDate: '2026-08-20',
    businessLine: 'garment',
    millRelationId: 'REL-MILL-1',
    deletedAt: null,
    ...over,
  };
  prisma._stores.orders.push(row);
  return row;
}

function seedUser(prisma: any, over: Record<string, any> = {}) {
  const row = { id: over.id ?? `QC-U${prisma._stores.userAccounts.length + 1}`, displayName: ' QC 甲', status: 'active', deletedAt: null, ...over };
  prisma._stores.userAccounts.push(row);
  return row;
}

// ════════════════════════════════════════════════════════════════
// 驻地 CRUD
// ════════════════════════════════════════════════════════════════

describe('P0 · QC 驻地 CRUD', () => {
  let prisma: any;
  beforeEach(() => { prisma = makeMockPrisma(); });

  const createLoc = (app: any, body: Record<string, any>) =>
    request(app).post('/api/v1/qc/locations').set(auth()).send(body);

  it('创建：code 归一小写；缺 code/name → 400；重复 → 400', async () => {
    const app = makeApp(prisma);
    const ok = await createLoc(app, { code: 'WenZhou', name: '温州驻场', focus: 'garment' });
    expect(ok.status).toBe(201);
    expect(ok.body.item.code).toBe('wenzhou');

    expect((await createLoc(app, { name: '苏州驻场' })).status).toBe(400);
    expect((await createLoc(app, { code: 'suzhou' })).status).toBe(400);
    const dup = await createLoc(app, { code: 'WENZHOU', name: '温州二场' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('驻地代码已存在');
  });

  it('更新：code 不可改 → 400；删除：有任务引用 → 400，无引用软删后不列出', async () => {
    const app = makeApp(prisma);
    const wz = (await createLoc(app, { code: 'wenzhou', name: '温州驻场' })).body.item;
    const sz = (await createLoc(app, { code: 'suzhou', name: '苏州驻场' })).body.item;

    const codeChange = await request(app).patch(`/api/v1/qc/locations/${wz.id}`).set(auth()).send({ code: 'other' });
    expect(codeChange.status).toBe(400);

    // 有未删除任务引用 → 禁删
    seedOrder(prisma, { id: 'ORD-L1' });
    seedUser(prisma, { id: 'QC-1' });
    await request(app).post('/api/v1/qc/assignments').set(auth())
      .send({ orderId: 'ORD-L1', inspectionType: 'final', qcUserId: 'QC-1', locationId: wz.id });
    const blocked = await request(app).delete(`/api/v1/qc/locations/${wz.id}`).set(auth());
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('仍有验货任务引用此驻地，不可删除');

    expect((await request(app).delete(`/api/v1/qc/locations/${sz.id}`).set(auth())).status).toBe(200);
    const list = await request(app).get('/api/v1/qc/locations').set(auth());
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].code).toBe('wenzhou');
  });

  it('API-Key 写操作 → 401；读操作放行', async () => {
    const app = makeApp(prisma);
    await createLoc(app, { code: 'wenzhou', name: '温州驻场' });
    expect((await request(app).post('/api/v1/qc/locations').set('X-Bambook-API-Key', validApiKey)
      .send({ code: 'suzhou', name: '苏州驻场' })).status).toBe(401);
    expect((await request(app).get('/api/v1/qc/locations').set('X-Bambook-API-Key', validApiKey)).status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════
// 验货任务：创建校验 + 状态机
// ════════════════════════════════════════════════════════════════

describe('P0 · QC 验货任务', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedOrder(prisma, { id: 'ORD-1' });
    seedOrder(prisma, { id: 'ORD-2' });
    seedUser(prisma, { id: 'QC-1' });
    seedUser(prisma, { id: 'QC-2' });
  });

  const createAssignment = (app: any, body: Record<string, any>) =>
    request(app).post('/api/v1/qc/assignments').set(auth()).send(body);

  it('创建校验：订单 404 / 非法类型 400 / QC 人员 404 / 非 active 400 / 驻地 404；factoryRelationId 冗余自订单', async () => {
    const app = makeApp(prisma);
    seedUser(prisma, { id: 'QC-OFF', status: 'disabled' });

    expect((await createAssignment(app, { orderId: 'ORD-NOPE', inspectionType: 'final', qcUserId: 'QC-1' })).status).toBe(404);
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'inline', qcUserId: 'QC-1' })).status).toBe(400);
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-NOPE' })).status).toBe(404);
    const inactive = await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-OFF' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.message).toContain('必须是 active');
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1', locationId: 'QCL__NOPE' })).status).toBe(404);
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1', dueDate: '2026/08/01' })).status).toBe(400);

    const ok = await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1', dueDate: '2026-08-15' });
    expect(ok.status).toBe(201);
    expect(ok.body.item.status).toBe('Assigned');
    expect(ok.body.item.factoryRelationId).toBe('REL-MILL-1');
    expect(ok.body.item.assignedAt).toBeTypeOf('number');
  });

  it('同订单同类型已有进行中任务 → 400；Cancelled 后可再派', async () => {
    const app = makeApp(prisma);
    const first = (await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'midline', qcUserId: 'QC-1' })).body.item;

    const dup = await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'midline', qcUserId: 'QC-2' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('已有进行中任务');

    // 不同类型不受限
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-2' })).status).toBe(201);

    // 取消后可再派同类型
    await request(app).post(`/api/v1/qc/assignments/${first.id}/cancel`).set(auth());
    expect((await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'midline', qcUserId: 'QC-2' })).status).toBe(201);
  });

  it('状态机：start/complete/cancel 合法流转与非法拒绝；report 订单不匹配 400；已完成不可取消', async () => {
    const app = makeApp(prisma);
    prisma._stores.inspectionReports.push({ id: 'INR__ORD-1', orderId: 'ORD-1', inspectionType: 'final' });
    prisma._stores.inspectionReports.push({ id: 'INR__ORD-2', orderId: 'ORD-2', inspectionType: 'final' });

    const a = (await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1' })).body.item;

    // start：Assigned → InProgress；重复 start → 400
    const started = await request(app).post(`/api/v1/qc/assignments/${a.id}/start`).set(auth());
    expect(started.status).toBe(200);
    expect(started.body.item.status).toBe('InProgress');
    expect((await request(app).post(`/api/v1/qc/assignments/${a.id}/start`).set(auth())).status).toBe(400);

    // complete：report 订单不匹配 → 400；不存在 → 404
    const mismatch = await request(app).post(`/api/v1/qc/assignments/${a.id}/complete`).set(auth()).send({ reportId: 'INR__ORD-2' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.message).toContain('报告与任务订单不匹配');
    expect((await request(app).post(`/api/v1/qc/assignments/${a.id}/complete`).set(auth()).send({ reportId: 'INR__NOPE' })).status).toBe(404);

    const completed = await request(app).post(`/api/v1/qc/assignments/${a.id}/complete`).set(auth()).send({ reportId: 'INR__ORD-1' });
    expect(completed.status).toBe(200);
    expect(completed.body.item.status).toBe('Completed');
    expect(completed.body.item.reportId).toBe('INR__ORD-1');
    expect(completed.body.item.completedAt).toBeTypeOf('number');

    // Completed 不可取消 / 不可修改
    const cancelCompleted = await request(app).post(`/api/v1/qc/assignments/${a.id}/cancel`).set(auth());
    expect(cancelCompleted.status).toBe(400);
    expect(cancelCompleted.body.error.message).toContain('已完成任务不可取消');
    expect((await request(app).patch(`/api/v1/qc/assignments/${a.id}`).set(auth()).send({ notes: 'x' })).status).toBe(400);

    // cancel：Assigned → Cancelled；Cancelled 不可修改
    const b = (await createAssignment(app, { orderId: 'ORD-2', inspectionType: 'midline', qcUserId: 'QC-2' })).body.item;
    const cancelled = await request(app).post(`/api/v1/qc/assignments/${b.id}/cancel`).set(auth());
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.item.status).toBe('Cancelled');
    expect((await request(app).patch(`/api/v1/qc/assignments/${b.id}`).set(auth()).send({ notes: 'x' })).status).toBe(400);
  });

  it('改派 qcUserId 同样校验 UserAccount；列表过滤 + Order 快照 + location include', async () => {
    const app = makeApp(prisma);
    const loc = (await request(app).post('/api/v1/qc/locations').set(auth()).send({ code: 'wenzhou', name: '温州驻场' })).body.item;
    const a = (await createAssignment(app, { orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1', locationId: loc.id })).body.item;

    const reassignBad = await request(app).patch(`/api/v1/qc/assignments/${a.id}`).set(auth()).send({ qcUserId: 'QC-NOPE' });
    expect(reassignBad.status).toBe(404);
    const reassign = await request(app).patch(`/api/v1/qc/assignments/${a.id}`).set(auth()).send({ qcUserId: 'QC-2', notes: '改派' });
    expect(reassign.status).toBe(200);
    expect(reassign.body.item.qcUserId).toBe('QC-2');

    const list = await request(app).get('/api/v1/qc/assignments?qcUserId=QC-2&status=Assigned').set(auth());
    expect(list.body.total).toBe(1);
    const item = list.body.items[0];
    expect(item.location.code).toBe('wenzhou');
    expect(item.order).toMatchObject({ poNumber: 'PO-1001', customer: 'Acme', product: 'Tee', businessLine: 'garment' });
  });
});

// ════════════════════════════════════════════════════════════════
// QC 工作台
// ════════════════════════════════════════════════════════════════

describe('P0 · QC 工作台', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedOrder(prisma, { id: 'ORD-1' });
    seedUser(prisma, { id: 'QC-1' });
    seedUser(prisma, { id: 'QC-2' });
  });

  it('按状态分组；completed 仅近 30 天；qcUserId 过滤', async () => {
    const app = makeApp(prisma);
    const create = (body: Record<string, any>) => request(app).post('/api/v1/qc/assignments').set(auth()).send(body);

    const assigned = (await create({ orderId: 'ORD-1', inspectionType: 'midline', qcUserId: 'QC-1' })).body.item;
    const inProgress = (await create({ orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-1' })).body.item;
    await request(app).post(`/api/v1/qc/assignments/${inProgress.id}/start`).set(auth());

    // 直接造数：QC-2 的近 30 天内已完成 + 40 天前已完成（应被窗口排除）
    const now = Date.now();
    prisma._stores.assignments.push(
      { id: 'QCA__OLD1', orderId: 'ORD-1', inspectionType: 'final', qcUserId: 'QC-2', locationId: null, factoryRelationId: null, status: 'Completed', dueDate: null, assignedAt: BigInt(now - 35 * DAY_MS), assignedById: 'u1', completedAt: BigInt(now - 5 * DAY_MS), reportId: null, notes: null, createdAt: BigInt(now - 35 * DAY_MS), updatedAt: BigInt(now - 5 * DAY_MS), deletedAt: null },
      { id: 'QCA__OLD2', orderId: 'ORD-1', inspectionType: 'midline', qcUserId: 'QC-2', locationId: null, factoryRelationId: null, status: 'Completed', dueDate: null, assignedAt: BigInt(now - 60 * DAY_MS), assignedById: 'u1', completedAt: BigInt(now - 40 * DAY_MS), reportId: null, notes: null, createdAt: BigInt(now - 60 * DAY_MS), updatedAt: BigInt(now - 40 * DAY_MS), deletedAt: null },
    );

    const wb = await request(app).get('/api/v1/qc/workbench?qcUserId=QC-1').set(auth());
    expect(wb.body.assigned.map((a: any) => a.id)).toEqual([assigned.id]);
    expect(wb.body.inProgress.map((a: any) => a.id)).toEqual([inProgress.id]);
    expect(wb.body.completed).toEqual([]);
    expect(wb.body.assigned[0].order.poNumber).toBe('PO-1001');

    const wb2 = await request(app).get('/api/v1/qc/workbench?qcUserId=QC-2').set(auth());
    expect(wb2.body.assigned).toEqual([]);
    expect(wb2.body.completed.map((a: any) => a.id)).toEqual(['QCA__OLD1']); // 40 天前的被排除

    // 不传 qcUserId → 全部分组
    const wbAll = await request(app).get('/api/v1/qc/workbench').set(auth());
    expect(wbAll.body.assigned.length).toBe(1);
    expect(wbAll.body.inProgress.length).toBe(1);
    expect(wbAll.body.completed.length).toBe(1);
  });
});
