import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const ownerToken = jwt.sign({ userId: 'u1', roles: ['owner'] }, SECRET);
const viewerToken = jwt.sign({ userId: 'u2', roles: ['viewer'] }, SECRET);
const validApiKey = 'test-key';
const apiKeys = new Set([validApiKey]);

import { createRiskRouter } from '../riskRoute';

/**
 * Mock Prisma：内存存储 H3 五个模型 + 关联真源（Invoice/Relation/Order/CreditLimit/
 * CustomsDeclaration/CustomsDeclarationLine/HsCode/InspectionReport）。
 * 语义对齐真实 client 的本测试用到的子集（where 条件、多字段 orderBy、
 * riskAlert.dedupKey 唯一约束 → P2002）。
 */
function makeMockPrisma() {
  let seq = 0;
  const exchangeRates: any[] = [];
  const fxRateLocks: any[] = [];
  const riskAlerts: any[] = [];
  const creditRatings: any[] = [];
  const complianceChecks: any[] = [];
  const invoices: any[] = [];
  const relations: any[] = [];
  const orders: any[] = [];
  const creditLimits: any[] = [];
  const customsDeclarations: any[] = [];
  const customsDeclarationLines: any[] = [];
  const hsCodes: any[] = [];
  const inspectionReports: any[] = [];

  const matchWhere = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as any[]).some(sub => matchWhere(row, sub));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cond: any = v;
        if ('not' in cond) return cond.not === null ? row[k] !== null : row[k] !== cond.not;
        if ('in' in cond) return cond.in.includes(row[k]);
        if ('equals' in cond) {
          return cond.mode === 'insensitive'
            ? String(row[k] ?? '').toLowerCase() === String(cond.equals).toLowerCase()
            : row[k] === cond.equals;
        }
        if ('contains' in cond) return String(row[k] || '').toLowerCase().includes(String(cond.contains).toLowerCase());
        if ('lt' in cond && !(row[k] < cond.lt)) return false;
        if ('lte' in cond && !(row[k] <= cond.lte)) return false;
        if ('gt' in cond && !(row[k] > cond.gt)) return false;
        if ('gte' in cond && !(row[k] >= cond.gte)) return false;
        return true;
      }
      return row[k] === v;
    });

  // 支持单字段对象或多字段数组两种 orderBy 形式
  const applyOrderBy = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((x, y) => {
      for (const o of orders) {
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

  const exchangeRate = {
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(exchangeRates.filter(r => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) =>
      applyTakeSkip(applyOrderBy(exchangeRates.filter(r => matchWhere(r, where)), orderBy), take, skip),
    count: async ({ where }: any = {}) => exchangeRates.filter(r => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { source: 'manual', note: null, ...data, id: data.id || `FXR__T${++seq}` };
      exchangeRates.push(row);
      return row;
    },
  };

  const fxRateLock = {
    findUnique: async ({ where }: any) => fxRateLocks.find(l => l.id === where.id) || null,
    findFirst: async ({ where }: any = {}) => fxRateLocks.find(l => matchWhere(l, where)) || null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) =>
      applyTakeSkip(applyOrderBy(fxRateLocks.filter(l => matchWhere(l, where)), orderBy), take, skip),
    count: async ({ where }: any = {}) => fxRateLocks.filter(l => matchWhere(l, where)).length,
    create: async ({ data }: any) => {
      const row = { note: null, lockedById: null, deletedAt: null, ...data, id: data.id || `FXL__T${++seq}` };
      fxRateLocks.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = fxRateLocks.find(l => l.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const riskAlert = {
    findUnique: async ({ where }: any) =>
      riskAlerts.find(a => (where.id !== undefined ? a.id === where.id : a.dedupKey === where.dedupKey)) || null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) =>
      applyTakeSkip(applyOrderBy(riskAlerts.filter(a => matchWhere(a, where)), orderBy), take, skip),
    count: async ({ where }: any = {}) => riskAlerts.filter(a => matchWhere(a, where)).length,
    create: async ({ data }: any) => {
      // dedupKey @unique 幂等真源：与真实 DB 一致撞键抛 P2002
      if (riskAlerts.some(a => a.dedupKey === data.dedupKey)) {
        const err: any = new Error('Unique constraint failed on the fields: (`dedupKey`)');
        err.code = 'P2002';
        throw err;
      }
      const row = { relatedType: null, relatedId: null, status: 'Open', resolvedAt: null, ...data, id: data.id || `RSKA__T${++seq}` };
      riskAlerts.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = riskAlerts.find(a => a.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const creditRating = {
    create: async ({ data }: any) => {
      const row = { evaluatedBy: null, ...data, id: data.id || `CDR__T${++seq}` };
      creditRatings.push(row);
      return row;
    },
    findMany: async ({ where, orderBy, take, skip }: any = {}) =>
      applyTakeSkip(applyOrderBy(creditRatings.filter(r => matchWhere(r, where)), orderBy), take, skip),
  };

  const complianceCheck = {
    create: async ({ data }: any) => {
      const row = { details: null, checkedById: null, ...data, id: data.id || `CPC__T${++seq}` };
      complianceChecks.push(row);
      return row;
    },
    findMany: async ({ where, orderBy, take, skip }: any = {}) =>
      applyTakeSkip(applyOrderBy(complianceChecks.filter(r => matchWhere(r, where)), orderBy), take, skip),
    count: async ({ where }: any = {}) => complianceChecks.filter(r => matchWhere(r, where)).length,
  };

  const invoice = {
    findMany: async ({ where }: any = {}) => invoices.filter(i => matchWhere(i, where)),
  };

  const relation = {
    findUnique: async ({ where }: any) => relations.find(r => r.id === where.id) || null,
  };

  const order = {
    findUnique: async ({ where }: any) => orders.find(o => o.id === where.id) || null,
    findMany: async ({ where }: any = {}) => orders.filter(o => matchWhere(o, where)),
  };

  const creditLimit = {
    findMany: async ({ where }: any = {}) => creditLimits.filter(c => matchWhere(c, where)),
    update: async ({ where, data }: any) => {
      const row = creditLimits.find(c => c.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };

  const customsDeclaration = {
    findUnique: async ({ where }: any) => customsDeclarations.find(d => d.id === where.id) || null,
  };

  const customsDeclarationLine = {
    findMany: async ({ where }: any = {}) => customsDeclarationLines.filter(l => matchWhere(l, where)),
  };

  const hsCode = {
    findUnique: async ({ where }: any) => hsCodes.find(h => h.code === where.code) || null,
    count: async ({ where }: any = {}) => (where ? hsCodes.filter(h => matchWhere(h, where)).length : hsCodes.length),
  };

  const inspectionReport = {
    findMany: async ({ where, take }: any = {}) =>
      applyTakeSkip(inspectionReports.filter(r => matchWhere(r, where)), take),
  };

  return {
    exchangeRate,
    fxRateLock,
    riskAlert,
    creditRating,
    complianceCheck,
    invoice,
    relation,
    order,
    creditLimit,
    customsDeclaration,
    customsDeclarationLine,
    hsCode,
    inspectionReport,
    _stores: {
      exchangeRates, fxRateLocks, riskAlerts, creditRatings, complianceChecks,
      invoices, relations, orders, creditLimits, customsDeclarations,
      customsDeclarationLines, hsCodes, inspectionReports,
    },
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
  app.use('/api/v1/risk', createRiskRouter({ prisma, requireAuth: true, apiKeys }));
  return app;
}

const auth = () => ({ Cookie: `bambook_token=${ownerToken}` });
const viewerAuth = () => ({ Cookie: `bambook_token=${viewerToken}` });

/** 相对今日的本地日期串（服务侧按真实今日计算，测试须同步口径） */
function dateDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentQuarter(): string {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

// ════════════════════════════════════════════════════════════════
// 汇率（PRD 15.1）
// ════════════════════════════════════════════════════════════════

describe('H3 · 汇率档案与波动预警', () => {
  let prisma: any;
  beforeEach(() => { prisma = makeMockPrisma(); });

  const addRate = (app: any, body: Record<string, any>) =>
    request(app).post('/api/v1/risk/fx-rates').set(auth()).send(body);

  it('录入校验：缺币种 / rate≤0 / 日期格式非法 → 400；币种归一化大写', async () => {
    const app = makeApp(prisma);
    expect((await addRate(app, { rate: 7.1 })).status).toBe(400);
    expect((await addRate(app, { currency: 'USD', rate: 0 })).status).toBe(400);
    expect((await addRate(app, { currency: 'USD', rate: -1 })).status).toBe(400);
    expect((await addRate(app, { currency: 'USD', rate: 7.1, effectiveDate: '2026/08/01' })).status).toBe(400);

    const ok = await addRate(app, { currency: 'usd', rate: 7.1, effectiveDate: '2026-08-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.item.currency).toBe('USD');
    expect(ok.body.item.source).toBe('manual');
  });

  it('波动 ≥2% 触发 warning、≥5% 升 critical；同 dedupKey 幂等；<2% 不触发', async () => {
    const app = makeApp(prisma);
    await addRate(app, { currency: 'USD', rate: 7.10, effectiveDate: '2026-08-01' });

    // +2.11% → warning
    await addRate(app, { currency: 'USD', rate: 7.25, effectiveDate: '2026-08-02' });
    let alerts = await request(app).get('/api/v1/risk/alerts?type=fx_volatility').set(auth());
    expect(alerts.body.total).toBe(1);
    expect(alerts.body.items[0].level).toBe('warning');
    expect(alerts.body.items[0].title).toContain('USD');
    expect(alerts.body.items[0].dedupKey).toBe('fx_volatility:USD:2026-08-02');
    expect(alerts.body.items[0].status).toBe('Open');

    // 同 effectiveDate 再录入一条 -2.07% 的汇率：波动达阈值但 dedupKey 撞键 → 幂等不产生新预警
    await addRate(app, { currency: 'USD', rate: 7.10, effectiveDate: '2026-08-02' });
    alerts = await request(app).get('/api/v1/risk/alerts?type=fx_volatility').set(auth());
    expect(alerts.body.total).toBe(1);

    // +0.14% < 2% → 不触发
    await addRate(app, { currency: 'USD', rate: 7.11, effectiveDate: '2026-08-03' });
    alerts = await request(app).get('/api/v1/risk/alerts?type=fx_volatility').set(auth());
    expect(alerts.body.total).toBe(1);

    // -5.625% → critical
    await addRate(app, { currency: 'EUR', rate: 8.00, effectiveDate: '2026-08-01' });
    await addRate(app, { currency: 'EUR', rate: 7.55, effectiveDate: '2026-08-02' });
    alerts = await request(app).get('/api/v1/risk/alerts?type=fx_volatility').set(auth());
    expect(alerts.body.total).toBe(2);
    const critical = alerts.body.items.find((a: any) => a.level === 'critical');
    expect(critical.title).toContain('EUR');
  });

  it('GET /fx-rates 按币种过滤（大小写不敏感）；GET /fx-rates-latest 各币种取最新一条', async () => {
    const app = makeApp(prisma);
    await addRate(app, { currency: 'USD', rate: 7.10, effectiveDate: '2026-08-01' });
    await addRate(app, { currency: 'USD', rate: 7.20, effectiveDate: '2026-08-05' });
    await addRate(app, { currency: 'EUR', rate: 8.30, effectiveDate: '2026-08-03' });

    const usd = await request(app).get('/api/v1/risk/fx-rates?currency=usd').set(auth());
    expect(usd.body.total).toBe(2);
    expect(usd.body.items[0].effectiveDate).toBe('2026-08-05'); // effectiveDate 降序

    const latest = await request(app).get('/api/v1/risk/fx-rates-latest').set(auth());
    expect(latest.body.total).toBe(2);
    expect(latest.body.items[0].currency).toBe('EUR'); // 按币种排序
    expect(latest.body.items[0].rate).toBe(8.30);
    expect(latest.body.items[1].currency).toBe('USD');
    expect(latest.body.items[1].rate).toBe(7.20);
    expect(latest.body.items[1].effectiveDate).toBe('2026-08-05');
  });

  it('写操作仅 API-Key → 401（JWT 强制）', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/api/v1/risk/fx-rates')
      .set('x-bambook-api-key', validApiKey)
      .send({ currency: 'USD', rate: 7.1 });
    expect(res.status).toBe(401);
    // 读可走 API-Key
    const read = await request(app).get('/api/v1/risk/fx-rates').set('x-bambook-api-key', validApiKey);
    expect(read.status).toBe(200);
  });
});

describe('H3 · 汇率锁定', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.orders.push({ id: 'O1', customer: 'Alpha', status: 'Confirmed', millRelationId: 'FAC1', deletedAt: null });
  });

  it('缺省取最新汇率；无汇率 → 400；重复锁定 → 400；软删后可重新锁定', async () => {
    const app = makeApp(prisma);

    // 无可用汇率
    const noRate = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O1', currency: 'USD' });
    expect(noRate.status).toBe(400);
    expect(noRate.body.error.message).toContain('无可用汇率');

    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'USD', rate: 7.10, effectiveDate: '2026-08-01' });
    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'USD', rate: 7.22, effectiveDate: '2026-08-06' });

    // 缺省取最新（7.22 @ 08-06）
    const locked = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O1', currency: 'usd' });
    expect(locked.status).toBe(201);
    expect(locked.body.item.rate).toBe(7.22);
    expect(locked.body.item.currency).toBe('USD');
    expect(locked.body.item.lockedById).toBe('u1');

    // 同订单同币种重复锁定 → 400
    const dup = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O1', currency: 'USD' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('已锁定汇率');

    // 显式汇率锁定另一币种
    const eur = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O1', currency: 'EUR', rate: 7.8 });
    expect(eur.status).toBe(201);
    expect(eur.body.item.rate).toBe(7.8);

    const list = await request(app).get('/api/v1/risk/fx-locks?orderId=O1').set(auth());
    expect(list.body.total).toBe(2);

    // 软删后可重新锁定
    const del = await request(app).delete(`/api/v1/risk/fx-locks/${locked.body.item.id}`).set(auth());
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/v1/risk/fx-locks?orderId=O1').set(auth());
    expect(after.body.total).toBe(1);
    const relock = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O1', currency: 'USD' });
    expect(relock.status).toBe(201);

    // 删除不存在 → 404
    const delGone = await request(app).delete('/api/v1/risk/fx-locks/FXL__NOPE').set(auth());
    expect(delGone.status).toBe(404);
  });

  it('订单不存在 → 404', async () => {
    const app = makeApp(prisma);
    const res = await request(app).post('/api/v1/risk/fx-locks').set(auth()).send({ orderId: 'O_GONE', currency: 'USD', rate: 7.1 });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('订单不存在');
  });
});

// ════════════════════════════════════════════════════════════════
// 信用（PRD 15.2）
// ════════════════════════════════════════════════════════════════

describe('H3 · 信用评级', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.relations.push(
      { id: 'REL_C1', name: '客户A', category: 'Customer', isOrganization: true, deletedAt: null },
      { id: 'REL_C2', name: '客户B', category: 'Customer', isOrganization: true, deletedAt: null },
      { id: 'REL_S1', name: '供应商C', category: 'Supplier', isOrganization: true, deletedAt: null },
    );
  });

  it('因子口径：onTimeRate / 当前逾期扣分 / 合作年限；grade 边界 70→B', async () => {
    const app = makeApp(prisma);
    prisma._stores.invoices.push(
      // 准时结清（结算日 375 天前 ≤ 到期日 370 天前）
      { id: 'INV1', invoiceNumber: 'INV-1', type: 'Receivable', status: 'Paid', amount: 100, currency: 'USD', issueDate: dateDaysAgo(400), dueDate: dateDaysAgo(370), settlementDate: dateDaysAgo(375), customerRelationId: 'REL_C1', deletedAt: null },
      // 逾期结清（结算日 160 天前 > 到期日 170 天前）
      { id: 'INV2', invoiceNumber: 'INV-2', type: 'Receivable', status: 'Paid', amount: 100, currency: 'USD', issueDate: dateDaysAgo(200), dueDate: dateDaysAgo(170), settlementDate: dateDaysAgo(160), customerRelationId: 'REL_C1', deletedAt: null },
      // 当前逾期 10 天
      { id: 'INV3', invoiceNumber: 'INV-3', type: 'Receivable', status: 'Issued', amount: 100, currency: 'USD', issueDate: dateDaysAgo(100), dueDate: dateDaysAgo(10), settlementDate: null, customerRelationId: 'REL_C1', deletedAt: null },
      // 已软删不计入
      { id: 'INV4', invoiceNumber: 'INV-4', type: 'Receivable', status: 'Issued', amount: 999, currency: 'USD', issueDate: dateDaysAgo(500), dueDate: dateDaysAgo(400), settlementDate: null, customerRelationId: 'REL_C1', deletedAt: BigInt(Date.now()) },
      // 其他客户不计入（REL_OTHER 不参与本测试评估）
      { id: 'INV5', invoiceNumber: 'INV-5', type: 'Receivable', status: 'Issued', amount: 100, currency: 'USD', issueDate: dateDaysAgo(100), dueDate: dateDaysAgo(90), settlementDate: null, customerRelationId: 'REL_OTHER', deletedAt: null },
    );

    const res = await request(app).post('/api/v1/risk/credit-ratings/evaluate').set(auth()).send({ relationId: 'REL_C1' });
    expect(res.status).toBe(201);
    const r = res.body.item;
    // onTimeRate = 1/2 → -20；当前逾期 1 张 → -10；合作 ≈1.1 年不扣 → 70 → B
    expect(r.score).toBe(70);
    expect(r.grade).toBe('B');
    expect(r.factors.onTimeRate).toBe(0.5);
    expect(r.factors.overdueCount).toBe(1);
    expect(r.factors.maxDaysOverdue).toBe(10);
    expect(r.factors.settledCount).toBe(2);
    expect(r.factors.evaluatedBy).toBe('u1');

    // 无发票客户：onTimeRate=null，仅合作 <1 年 -5 → 95 → A
    const res2 = await request(app).post('/api/v1/risk/credit-ratings/evaluate').set(auth()).send({ relationId: 'REL_C2' });
    expect(res2.body.item.score).toBe(95);
    expect(res2.body.item.grade).toBe('A');
    expect(res2.body.item.factors.onTimeRate).toBeNull();

    // latestOnly 每客户取最新
    const latest = await request(app).get('/api/v1/risk/credit-ratings?latestOnly=true').set(auth());
    expect(latest.body.total).toBe(2);
    const byRel = latest.body.items.map((i: any) => i.relationId).sort();
    expect(byRel).toEqual(['REL_C1', 'REL_C2']);
    const c1Only = await request(app).get('/api/v1/risk/credit-ratings?relationId=REL_C1').set(auth());
    expect(c1Only.body.total).toBe(1);
  });

  it('非 Customer / 不存在 → 400 / 404', async () => {
    const app = makeApp(prisma);
    const sup = await request(app).post('/api/v1/risk/credit-ratings/evaluate').set(auth()).send({ relationId: 'REL_S1' });
    expect(sup.status).toBe(400);
    expect(sup.body.error.message).toContain('仅 category=Customer');
    const gone = await request(app).post('/api/v1/risk/credit-ratings/evaluate').set(auth()).send({ relationId: 'REL_GONE' });
    expect(gone.status).toBe(404);
  });
});

describe('H3 · 信用风险扫描', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.creditLimits.push(
      { id: 'CL_1', relationId: 'REL_C1', totalLimit: 100000, usedAmount: 0, currency: 'CNY', status: 'Active', deletedAt: null },
      { id: 'CL_2', relationId: 'REL_C1', totalLimit: 50000, usedAmount: 0, currency: 'CNY', status: 'Active', deletedAt: null },
      { id: 'CL_3', relationId: 'REL_C2', totalLimit: 80000, usedAmount: 0, currency: 'CNY', status: 'Active', deletedAt: null },
    );
    prisma._stores.invoices.push(
      // REL_C1：逾期 70 天（>60 → 冻结其全部 Active 额度）
      { id: 'INV_A', invoiceNumber: 'INV-A', type: 'Receivable', status: 'Issued', amount: 1000, currency: 'USD', issueDate: dateDaysAgo(100), dueDate: dateDaysAgo(70), settlementDate: null, customerRelationId: 'REL_C1', deletedAt: null },
      // REL_C1：逾期 200 天（>180 → 坏账预警）
      { id: 'INV_B', invoiceNumber: 'INV-B', type: 'Receivable', status: 'PartiallyPaid', amount: 2000, currency: 'USD', issueDate: dateDaysAgo(230), dueDate: dateDaysAgo(200), settlementDate: null, customerRelationId: 'REL_C1', deletedAt: null },
      // REL_C2：逾期 30 天（未达阈值）
      { id: 'INV_C', invoiceNumber: 'INV-C', type: 'Receivable', status: 'Issued', amount: 500, currency: 'USD', issueDate: dateDaysAgo(60), dueDate: dateDaysAgo(30), settlementDate: null, customerRelationId: 'REL_C2', deletedAt: null },
      // 已结清/已软删不参与
      { id: 'INV_D', invoiceNumber: 'INV-D', type: 'Receivable', status: 'Paid', amount: 1, currency: 'USD', issueDate: dateDaysAgo(300), dueDate: dateDaysAgo(250), settlementDate: dateDaysAgo(260), customerRelationId: 'REL_C2', deletedAt: null },
      { id: 'INV_E', invoiceNumber: 'INV-E', type: 'Receivable', status: 'Issued', amount: 1, currency: 'USD', issueDate: dateDaysAgo(300), dueDate: dateDaysAgo(250), settlementDate: null, customerRelationId: 'REL_C2', deletedAt: BigInt(Date.now()) },
    );
  });

  it('逾期 >60 天冻结 Active 额度 + credit_frozen 预警；>180 天 bad_debt；重复扫描幂等', async () => {
    const app = makeApp(prisma);
    const res = await request(app).post('/api/v1/risk/credit-risk-scan').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, frozenCount: 2, badDebtCount: 1 });

    const stores = prisma._stores;
    expect(stores.creditLimits.find((c: any) => c.id === 'CL_1').status).toBe('Frozen');
    expect(stores.creditLimits.find((c: any) => c.id === 'CL_2').status).toBe('Frozen');
    expect(stores.creditLimits.find((c: any) => c.id === 'CL_3').status).toBe('Active');

    const frozen = await request(app).get('/api/v1/risk/alerts?type=credit_frozen').set(auth());
    expect(frozen.body.total).toBe(2);
    expect(frozen.body.items[0].level).toBe('critical');
    const badDebt = await request(app).get('/api/v1/risk/alerts?type=bad_debt').set(auth());
    expect(badDebt.body.total).toBe(1);
    expect(badDebt.body.items[0].dedupKey).toBe('bad_debt:INV_B');
    expect(badDebt.body.items[0].relatedType).toBe('Invoice');

    // 幂等：额度已 Frozen 不再重复冻结；bad_debt dedupKey 唯一不重复预警
    const again = await request(app).post('/api/v1/risk/credit-risk-scan').set(auth());
    expect(again.body).toMatchObject({ ok: true, frozenCount: 0, badDebtCount: 0 });
    const allAlerts = await request(app).get('/api/v1/risk/alerts').set(auth());
    expect(allAlerts.body.total).toBe(3);
  });

  it('viewer 角色触发扫描 → 403（owner/admin/manager 专属）', async () => {
    const app = makeApp(prisma);
    const res = await request(app).post('/api/v1/risk/credit-risk-scan').set(viewerAuth());
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════
// 合规（PRD 15.3）
// ════════════════════════════════════════════════════════════════

describe('H3 · HS Code 校验', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.customsDeclarations.push(
      { id: 'CD_1', declarationNumber: 'D-1', destinationCountry: 'US', deletedAt: null },
      { id: 'CD_2', declarationNumber: 'D-2', destinationCountry: 'DE', deletedAt: null },
      { id: 'CD_3', declarationNumber: 'D-3', destinationCountry: 'JP', deletedAt: null },
    );
    prisma._stores.customsDeclarationLines.push(
      // CD_1：两种可接受格式 → pass
      { id: 'CDL_1', declarationId: 'CD_1', lineNumber: 1, productName: '棉织物', hsCode: '5208.52' },
      { id: 'CDL_2', declarationId: 'CD_1', lineNumber: 2, productName: '化纤织物', hsCode: '5208520000' },
      // CD_2：缺失 + 格式非法 → fail
      { id: 'CDL_3', declarationId: 'CD_2', lineNumber: 1, productName: '无编码商品', hsCode: null },
      { id: 'CDL_4', declarationId: 'CD_2', lineNumber: 2, productName: '坏编码商品', hsCode: 'ABC' },
      // CD_3：注册表有 5208.52；6204.62 格式合法但未注册 → warn
      { id: 'CDL_5', declarationId: 'CD_3', lineNumber: 1, productName: '棉织物', hsCode: '5208.52' },
      { id: 'CDL_6', declarationId: 'CD_3', lineNumber: 2, productName: '女裤', hsCode: '6204.62' },
    );
  });

  it('pass / fail / warn 三分支 + fail 触发 compliance_fail 预警', async () => {
    const app = makeApp(prisma);

    // 注册表为空 → 跳过注册检查 → 全部通过
    const pass = await request(app).post('/api/v1/risk/compliance-checks/hs-code').set(auth()).send({ declarationId: 'CD_1' });
    expect(pass.status).toBe(201);
    expect(pass.body.item.result).toBe('pass');
    expect(pass.body.item.summary).toBe('2 行全部通过');
    expect(pass.body.item.type).toBe('hs_code');
    expect(pass.body.item.targetType).toBe('CustomsDeclaration');

    // 缺失 + 非法 → fail + 预警
    const fail = await request(app).post('/api/v1/risk/compliance-checks/hs-code').set(auth()).send({ declarationId: 'CD_2' });
    expect(fail.body.item.result).toBe('fail');
    expect(fail.body.item.summary).toContain('1 行缺失 HS 编码');
    expect(fail.body.item.summary).toContain('1 行 HS 编码格式非法');
    expect(fail.body.item.details.lines).toHaveLength(2);
    const failAlerts = await request(app).get('/api/v1/risk/alerts?type=compliance_fail').set(auth());
    expect(failAlerts.body.total).toBe(1);
    expect(failAlerts.body.items[0].level).toBe('warning');

    // 注册表非空 + 未注册编码 → warn（未注册不代表非法）
    prisma._stores.hsCodes.push({ id: 'HS_1', code: '5208.52', description: '棉织物', isActive: true });
    const warn = await request(app).post('/api/v1/risk/compliance-checks/hs-code').set(auth()).send({ declarationId: 'CD_3' });
    expect(warn.body.item.result).toBe('warn');
    expect(warn.body.item.summary).toContain('1 行 HS 编码未注册');
    // warn 不产生预警
    const afterWarn = await request(app).get('/api/v1/risk/alerts?type=compliance_fail').set(auth());
    expect(afterWarn.body.total).toBe(1);

    // 报关单不存在 → 404
    const gone = await request(app).post('/api/v1/risk/compliance-checks/hs-code').set(auth()).send({ declarationId: 'CD_GONE' });
    expect(gone.status).toBe(404);

    // 列表按 checkedAt 降序
    const list = await request(app).get('/api/v1/risk/compliance-checks?type=hs_code').set(auth());
    expect(list.body.total).toBe(3);
  });
});

describe('H3 · 出口管制与人工合规录入', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.customsDeclarations.push(
      { id: 'CD_KP', declarationNumber: 'D-KP', destinationCountry: 'KP', deletedAt: null },
      { id: 'CD_IR', declarationNumber: 'D-IR', destinationCountry: 'Iran', deletedAt: null },
      { id: 'CD_NULL', declarationNumber: 'D-NULL', destinationCountry: null, deletedAt: null },
      { id: 'CD_US', declarationNumber: 'D-US', destinationCountry: 'US', deletedAt: null },
    );
  });

  it('禁运国（ISO 码 / 英文名不敏感）→ fail + critical 预警；空目的国 → warn；其他 → pass', async () => {
    const app = makeApp(prisma);

    const kp = await request(app).post('/api/v1/risk/compliance-checks/export-control').set(auth()).send({ declarationId: 'CD_KP' });
    expect(kp.body.item.result).toBe('fail');
    expect(kp.body.item.summary).toContain('KP');

    const ir = await request(app).post('/api/v1/risk/compliance-checks/export-control').set(auth()).send({ declarationId: 'CD_IR' });
    expect(ir.body.item.result).toBe('fail');

    const alerts = await request(app).get('/api/v1/risk/alerts?type=compliance_fail&level=critical').set(auth());
    expect(alerts.body.total).toBe(2);

    const empty = await request(app).post('/api/v1/risk/compliance-checks/export-control').set(auth()).send({ declarationId: 'CD_NULL' });
    expect(empty.body.item.result).toBe('warn');
    expect(empty.body.item.summary).toContain('无法判定');

    const us = await request(app).post('/api/v1/risk/compliance-checks/export-control').set(auth()).send({ declarationId: 'CD_US' });
    expect(us.body.item.result).toBe('pass');

    const list = await request(app).get('/api/v1/risk/compliance-checks?type=export_control&result=fail').set(auth());
    expect(list.body.total).toBe(2);
  });

  it('人工录入 origin_rule：封闭集校验（type/result）', async () => {
    const app = makeApp(prisma);
    const badType = await request(app).post('/api/v1/risk/compliance-checks').set(auth()).send({
      type: 'hack', targetType: 'Order', targetId: 'O1', result: 'pass', summary: 'x',
    });
    expect(badType.status).toBe(400);
    const badResult = await request(app).post('/api/v1/risk/compliance-checks').set(auth()).send({
      type: 'origin_rule', targetType: 'Order', targetId: 'O1', result: 'maybe', summary: 'x',
    });
    expect(badResult.status).toBe(400);

    const ok = await request(app).post('/api/v1/risk/compliance-checks').set(auth()).send({
      type: 'origin_rule', targetType: 'Order', targetId: 'O1', result: 'pass',
      summary: '原产地证书已核验', details: { certificateNo: 'CO-2026-001' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.item.type).toBe('origin_rule');
    expect(ok.body.item.checkedById).toBe('u1');
  });
});

// ════════════════════════════════════════════════════════════════
// 质量（PRD 15.4）
// ════════════════════════════════════════════════════════════════

describe('H3 · 疵点趋势', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.orders.push(
      { id: 'O1', millRelationId: 'FAC1', deletedAt: null },
      { id: 'O2', millRelationId: 'FAC1', deletedAt: null },
      { id: 'O3', millRelationId: null, deletedAt: null },
      // 已软删订单视同未关联
      { id: 'O4', millRelationId: 'FAC9', deletedAt: BigInt(Date.now()) },
    );
    prisma._stores.inspectionReports.push(
      { id: 'R1', orderId: 'O1', inspectionType: 'final', result: 'fail', criticalDefects: 1, majorDefects: 2, minorDefects: 3, defectSummary: '跳线x3 污渍x2', inspectionDate: '2026-07-15' },
      { id: 'R2', orderId: 'O2', inspectionType: 'final', result: 'pass', criticalDefects: 0, majorDefects: 1, minorDefects: 1, defectSummary: '跳线x1，色花 x 2', inspectionDate: '2026-08-01' },
      { id: 'R3', orderId: 'O3', inspectionType: 'midline', result: 'conditional', criticalDefects: 0, majorDefects: 1, minorDefects: 0, defectSummary: '污渍x1', inspectionDate: '2026-04-10' },
      { id: 'R4', orderId: 'O4', inspectionType: 'final', result: 'fail', criticalDefects: 0, majorDefects: 5, minorDefects: 0, defectSummary: null, inspectionDate: null },
      { id: 'R5', orderId: 'O_GONE', inspectionType: 'final', result: 'pass', criticalDefects: 0, majorDefects: 0, minorDefects: 2, defectSummary: '断经x2', inspectionDate: '2026-05-20' },
    );
  });

  it('groupBy=factory：聚合疵点计数与高频词（去数量缀）；null/软删订单归入未关联工厂', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/risk/quality/defect-trends?groupBy=factory').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBe('factory');
    expect(res.body.items).toHaveLength(2);

    // 按 reports 降序：未关联工厂（R3/R4/R5）在前
    const unlinked = res.body.items[0];
    expect(unlinked.factoryId).toBeNull();
    expect(unlinked.factoryLabel).toBe('未关联工厂');
    expect(unlinked.reports).toBe(3);
    expect(unlinked.failCount).toBe(1); // 仅 R4 fail
    expect(unlinked.majorDefects).toBe(6);

    const fac1 = res.body.items[1];
    expect(fac1.factoryId).toBe('FAC1');
    expect(fac1.reports).toBe(2);
    expect(fac1.failCount).toBe(1);
    expect(fac1.criticalDefects).toBe(1);
    expect(fac1.majorDefects).toBe(3);
    expect(fac1.minorDefects).toBe(4);
    // 疵点词解析：跳线x3→跳线、跳线x1→跳线（计数 2）；色花 x 2→色花（带空格数量缀）
    expect(fac1.defectKeywords[0]).toEqual({ keyword: '跳线', count: 2 });
    const keywords = fac1.defectKeywords.map((k: any) => k.keyword);
    expect(keywords).toContain('色花');
    expect(keywords).toContain('污渍');
    expect(keywords).not.toContain('x');
  });

  it('groupBy=quarter：按 YYYY-Q 聚合，inspectionDate 缺失的行跳过', async () => {
    const app = makeApp(prisma);
    const res = await request(app).get('/api/v1/risk/quality/defect-trends?groupBy=quarter').set(auth());
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].quarter).toBe('2026-Q2'); // 升序
    expect(res.body.items[0].reports).toBe(2); // R3 + R5
    expect(res.body.items[1].quarter).toBe('2026-Q3');
    expect(res.body.items[1].reports).toBe(2); // R1 + R2（R4 无 inspectionDate 跳过）
  });
});

describe('H3 · 重复疵点扫描', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    prisma._stores.orders.push(
      { id: 'O1', millRelationId: 'FAC1', deletedAt: null },
      { id: 'O2', millRelationId: 'FAC1', deletedAt: null },
      { id: 'O3', millRelationId: 'FAC2', deletedAt: null },
      { id: 'O4', millRelationId: null, deletedAt: null },
    );
    prisma._stores.inspectionReports.push(
      // FAC1 跳线 ×2 张 → 预警
      { id: 'R1', orderId: 'O1', result: 'fail', criticalDefects: 0, majorDefects: 2, minorDefects: 0, defectSummary: '跳线x2 污渍x1', inspectionDate: dateDaysAgo(10) },
      { id: 'R2', orderId: 'O2', result: 'pass', criticalDefects: 0, majorDefects: 1, minorDefects: 0, defectSummary: '跳线x1', inspectionDate: dateDaysAgo(5) },
      // FAC2 跳线仅 1 张 → 不预警（跨工厂不合并）
      { id: 'R3', orderId: 'O3', result: 'pass', criticalDefects: 0, majorDefects: 1, minorDefects: 0, defectSummary: '跳线x4', inspectionDate: dateDaysAgo(3) },
      // 未关联工厂 破洞 ×2 张 → 预警
      { id: 'R4', orderId: 'O4', result: 'fail', criticalDefects: 1, majorDefects: 0, minorDefects: 0, defectSummary: '破洞x1', inspectionDate: dateDaysAgo(2) },
      { id: 'R5', orderId: 'O_GONE', result: 'fail', criticalDefects: 1, majorDefects: 0, minorDefects: 0, defectSummary: '破洞x3', inspectionDate: dateDaysAgo(1) },
      // 90 天窗口外的同词报告 → 被 DB 过滤不预警
      { id: 'R6', orderId: 'O1', result: 'fail', criticalDefects: 0, majorDefects: 1, minorDefects: 0, defectSummary: '旧疵x9', inspectionDate: dateDaysAgo(120) },
      { id: 'R7', orderId: 'O2', result: 'fail', criticalDefects: 0, majorDefects: 1, minorDefects: 0, defectSummary: '旧疵x1', inspectionDate: dateDaysAgo(100) },
    );
  });

  it('近 90 天同工厂同疵点 ≥2 张报告 → 预警；重复扫描幂等', async () => {
    const app = makeApp(prisma);
    const res = await request(app).post('/api/v1/risk/quality/repeat-scan').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, alerted: 2 });

    const alerts = await request(app).get('/api/v1/risk/alerts?type=quality_repeat').set(auth());
    expect(alerts.body.total).toBe(2);
    const keys = alerts.body.items.map((a: any) => a.dedupKey).sort();
    expect(keys).toEqual([
      `quality_repeat:FAC1:跳线:${currentQuarter()}`,
      `quality_repeat:unlinked:破洞:${currentQuarter()}`,
    ]);
    const fac1Alert = alerts.body.items.find((a: any) => a.relatedId === 'FAC1');
    expect(fac1Alert.relatedType).toBe('Relation');
    expect(fac1Alert.level).toBe('warning');

    // 幂等：dedupKey 含季度，季度内重复扫描不再产生新预警
    const again = await request(app).post('/api/v1/risk/quality/repeat-scan').set(auth());
    expect(again.body).toMatchObject({ ok: true, alerted: 0 });
  });
});

// ════════════════════════════════════════════════════════════════
// 统一预警状态机
// ════════════════════════════════════════════════════════════════

describe('H3 · 预警状态机与总览', () => {
  let prisma: any;
  beforeEach(() => { prisma = makeMockPrisma(); });

  async function seedFxAlert(app: any) {
    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'USD', rate: 7.10, effectiveDate: '2026-08-01' });
    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'USD', rate: 7.25, effectiveDate: '2026-08-02' });
    const alerts = await request(app).get('/api/v1/risk/alerts').set(auth());
    return alerts.body.items[0];
  }

  it('Open → Acknowledged → Resolved；Resolved 写 resolvedAt；非法状态 400；不存在 404', async () => {
    const app = makeApp(prisma);
    const alert = await seedFxAlert(app);
    expect(alert.status).toBe('Open');

    const ack = await request(app).patch(`/api/v1/risk/alerts/${alert.id}`).set(auth()).send({ status: 'Acknowledged' });
    expect(ack.status).toBe(200);
    expect(ack.body.item.status).toBe('Acknowledged');
    expect(ack.body.item.resolvedAt).toBeNull();

    const resolved = await request(app).patch(`/api/v1/risk/alerts/${alert.id}`).set(auth()).send({ status: 'Resolved' });
    expect(resolved.body.item.status).toBe('Resolved');
    expect(resolved.body.item.resolvedAt).toBeGreaterThan(0);

    const bad = await request(app).patch(`/api/v1/risk/alerts/${alert.id}`).set(auth()).send({ status: 'Closed' });
    expect(bad.status).toBe(400);
    const gone = await request(app).patch('/api/v1/risk/alerts/RSKA__NOPE').set(auth()).send({ status: 'Resolved' });
    expect(gone.status).toBe(404);

    // overview：Resolved 后不再计入 Open
    const overview = await request(app).get('/api/v1/risk/overview').set(auth());
    expect(overview.body.openByType.fx_volatility).toBeUndefined();
    expect(overview.body.recent).toHaveLength(0);
  });

  it('overview 按类型/级别聚合 Open 预警，recent 取最近 10 条', async () => {
    const app = makeApp(prisma);
    await seedFxAlert(app); // USD warning
    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'EUR', rate: 8.0, effectiveDate: '2026-08-01' });
    await request(app).post('/api/v1/risk/fx-rates').set(auth()).send({ currency: 'EUR', rate: 7.5, effectiveDate: '2026-08-02' }); // -6.25% critical

    const overview = await request(app).get('/api/v1/risk/overview').set(auth());
    expect(overview.body.openByType).toEqual({ fx_volatility: 2 });
    expect(overview.body.openByLevel).toEqual({ warning: 1, critical: 1 });
    expect(overview.body.recent).toHaveLength(2);
    expect(overview.body.recent.map((a: any) => a.level).sort()).toEqual(['critical', 'warning']);

    // 状态过滤
    const openOnly = await request(app).get('/api/v1/risk/alerts?status=Open&level=critical').set(auth());
    expect(openOnly.body.total).toBe(1);
  });
});
