/**
 * DR-029 服装/面料样品 QC 双链 + DR-014 出运资格 + DR-027 开发样排除 + 双签 路由测试
 *
 * 验收场景映射：
 *   - QC-29-B3  链路由/权限隔离          → describe「路由隔离与链边界」
 *   - QC-29-A1  服装链非二值评审          → 「服装链评审」
 *   - QC-29-A3 / QC-008-C1 寄送门禁      → 「寄送门禁」
 *   - QC-29-A4  直接打回工厂重做          → 「直接打回」
 *   - QC-29-B2 / REL-14-A5 面料链评审    → 「面料链评审」
 *   - REL-14-A1 每轮独立报告不可覆盖      → 「同轮重复提交 → 409」
 *   - DR-027 / QC-29-B1 开发样排除       → 「开发样排除」
 *   - QC-014-C2 出运三条件并行           → 「DR-014 出运资格」
 *   - 质量门禁 §9.3-② 双签               → 「signatures 双签」
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const validApiKey = 'test-key';
const apiKeys = new Set([validApiKey]);

import { createQcRouter } from '../qcRoute';
import { createQcService } from '../qcService';

// roles 仅作 legacy fallback；链 scope 走 permissions 数组直查
const ownerToken = jwt.sign({ userId: 'u-owner', roles: ['owner'], permissions: [], departmentIds: [] }, SECRET);
const garmentQcToken = jwt.sign(
  { userId: 'QC-G1', roles: ['sales'], permissions: ['qc:read', 'qc:write', 'qc:garment_chain:write'], departmentIds: [] },
  SECRET,
);
const fabricQcToken = jwt.sign(
  { userId: 'QC-F1', roles: ['sales'], permissions: ['qc:read', 'qc:fabric_chain:write'], departmentIds: [] },
  SECRET,
);
const salesToken = jwt.sign({ userId: 'SALES-1', roles: ['sales'], permissions: ['qc:read'], departmentIds: [] }, SECRET);
const financeToken = jwt.sign({ userId: 'FIN-1', roles: ['finance'], permissions: ['qc:read'], departmentIds: [] }, SECRET);

const asOwner = () => ({ Cookie: `bambook_token=${ownerToken}` });
const asGarmentQc = () => ({ Cookie: `bambook_token=${garmentQcToken}` });
const asFabricQc = () => ({ Cookie: `bambook_token=${fabricQcToken}` });
const asSales = () => ({ Cookie: `bambook_token=${salesToken}` });
const asFinance = () => ({ Cookie: `bambook_token=${financeToken}` });

// ────────────────────────────────────────────────────────────────
// Mock Prisma（语义对齐本测试用到的 client 子集 + $transaction 直通）
// ────────────────────────────────────────────────────────────────
function makeMockPrisma() {
  const orders: any[] = [];
  const inspectionReports: any[] = [];
  const fabricShipmentSamples: any[] = [];
  const earlyProductionSamples: any[] = [];
  const departments: any[] = [];
  const auditLogs: any[] = [];
  const notifications: any[] = [];

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

  const client: any = {
    order: {
      findUnique: async ({ where }: any) => orders.find(o => o.id === where.id) || null,
      findMany: async ({ where }: any = {}) => orders.filter(o => matchWhere(o, where)),
    },
    inspectionReport: {
      findUnique: async ({ where }: any) => inspectionReports.find(r => r.id === where.id) || null,
      findMany: async ({ where, orderBy }: any = {}) =>
        applyOrderBy(inspectionReports.filter(r => matchWhere(r, where)), orderBy),
      create: async ({ data }: any) => {
        const row = { ...data };
        inspectionReports.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = inspectionReports.find(r => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    fabricShipmentSample: {
      findFirst: async ({ where }: any = {}) => fabricShipmentSamples.find(s => matchWhere(s, where)) || null,
      findMany: async ({ where, orderBy }: any = {}) =>
        applyOrderBy(fabricShipmentSamples.filter(s => matchWhere(s, where)), orderBy),
      update: async ({ where, data }: any) => {
        const row = fabricShipmentSamples.find(s => s.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    earlyProductionSample: {
      findFirst: async ({ where }: any = {}) => earlyProductionSamples.find(s => matchWhere(s, where)) || null,
      update: async ({ where, data }: any) => {
        const row = earlyProductionSamples.find(s => s.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      },
    },
    department: {
      findUnique: async ({ where }: any) => departments.find(d => d.id === where.id) || null,
    },
    notificationPreference: {
      findMany: async () => [],
    },
    notification: {
      create: async ({ data }: any) => {
        const row = { ...data };
        notifications.push(row);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(client),
    _stores: { orders, inspectionReports, fabricShipmentSamples, earlyProductionSamples, departments, auditLogs, notifications },
  };
  return client;
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

// ────────────────────────────────────────────────────────────────
// 种子辅助
// ────────────────────────────────────────────────────────────────
function seedGarmentOrder(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: over.id ?? 'ORD-G1',
    poNumber: 'PO-G-1001',
    customer: 'Acme',
    product: 'Tee',
    status: 'InProduction',
    businessLine: 'garment',
    type: 'Garment',
    ownerId: 'SALES-1',
    departmentId: 'DEPT-1',
    deletedAt: null,
    ...over,
  };
  prisma._stores.orders.push(row);
  return row;
}

function seedFabricOrder(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: over.id ?? 'ORD-F1',
    poNumber: 'PO-F-1001',
    customer: 'Acme',
    product: 'Cotton Poplin',
    status: 'InProduction',
    businessLine: 'fabric',
    type: 'Fabric',
    ownerId: 'SALES-1',
    fabricSampleSentDate: null,
    fabricSampleConfirmedDate: null,
    deletedAt: null,
    ...over,
  };
  prisma._stores.orders.push(row);
  return row;
}

function seedSsSample(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: over.id ?? 'FSS-1',
    sampleCode: 'FSS-20260801-001',
    shipmentId: 'SHP-1',
    orderId: 'ORD-F1',
    customerStatus: 'pending',
    customerFeedbackDate: null,
    qcInspectionReportId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
  prisma._stores.fabricShipmentSamples.push(row);
  return row;
}

const GARMENT_REVIEW_BODY = {
  sampleLevel: 'pp',
  round: 1,
  conclusion: 'pass',
  opinion: '左右袖长度差 0.5cm，需修正后可寄客户',
  criticalDefects: 0,
  majorDefects: 1,
  minorDefects: 3,
  defectSummary: '跳线x3',
  evidence: ['ev-photo-1', 'ev-photo-2'],
  inspectionDate: '2026-08-10',
};

// ════════════════════════════════════════════════════════════════
// QC-29-B3 路由隔离与链边界（4 维独立中的路由 + 权限校验两维）
// ════════════════════════════════════════════════════════════════
describe('DR-029 · 路由隔离与链边界（QC-29-B3）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedGarmentOrder(prisma);
    seedFabricOrder(prisma);
  });

  it('链写端点：无链 scope（业务员）→ 403 INSUFFICIENT_SCOPE；跨链 scope → 403', async () => {
    const app = makeApp(prisma);
    // 业务员（仅 qc:read，fallback SALES 矩阵也无链写 scope）→ 服装链 403
    const salesRes = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asSales())
      .send(GARMENT_REVIEW_BODY);
    expect(salesRes.status).toBe(403);
    expect(salesRes.body.message ?? salesRes.body.error?.message ?? '').toContain('INSUFFICIENT_SCOPE');

    // 面料 scope 调服装端点 → 403
    const crossRes = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asFabricQc())
      .send(GARMENT_REVIEW_BODY);
    expect(crossRes.status).toBe(403);

    // 服装 scope 调面料端点 → 403
    const crossRes2 = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asGarmentQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'pass', opinion: 'x' });
    expect(crossRes2.status).toBe(403);
  });

  it('链写端点：API key 通道 → 401（写 scope 强制 JWT）；无 token → 401', async () => {
    const app = makeApp(prisma);
    const apiKeyRes = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set('X-Bambook-API-Key', validApiKey)
      .send(GARMENT_REVIEW_BODY);
    expect(apiKeyRes.status).toBe(401);

    const noAuthRes = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'pass', opinion: 'x' });
    expect(noAuthRes.status).toBe(401);
  });

  it('服务层链别校验：服装端点打面料订单 → 400 INVALID_CHAIN_SCOPE；面料端点打服装订单同理', async () => {
    const app = makeApp(prisma);
    const wrongChain = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-F1/review')
      .set(asGarmentQc())
      .send(GARMENT_REVIEW_BODY);
    expect(wrongChain.status).toBe(400);
    expect(wrongChain.body.error.code).toBe('INVALID_CHAIN_SCOPE');

    seedSsSample(prisma, { id: 'FSS-X', orderId: 'ORD-G1' });
    const wrongChain2 = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-G1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-X', conclusion: 'pass', opinion: 'x' });
    expect(wrongChain2.status).toBe(400);
    expect(wrongChain2.body.error.code).toBe('INVALID_CHAIN_SCOPE');
  });
});

// ════════════════════════════════════════════════════════════════
// 服装链评审（QC-29-A1 非二值评审 / REL-14-A1 每轮独立 / DR-027 开发样排除）
// ════════════════════════════════════════════════════════════════
describe('DR-029 · 服装链评审（QC-29-A1 / REL-14-A1 / DR-027）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedGarmentOrder(prisma);
  });

  it('QC-29-A1：PP 评审落库非二值字段（文本意见 + 三级疵点 + 证据 + chain 元数据）→ 201', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send(GARMENT_REVIEW_BODY);
    expect(res.status).toBe(201);
    const report = res.body.report;
    expect(report.id).toBe('INR__ORD-G1__smp__pp__r1');
    expect(report.inspectionType).toBe('sample_pp__r1');
    expect(report.result).toBe('pass');
    // 非压缩二值：文本意见 + 三级疵点 + 证据引用完整保留
    expect(report.notes).toBe(GARMENT_REVIEW_BODY.opinion);
    expect(report.criticalDefects).toBe(0);
    expect(report.majorDefects).toBe(1);
    expect(report.minorDefects).toBe(3);
    expect(report.defectSummary).toBe('跳线x3');
    expect(report.signatures.chain).toMatchObject({
      chain: 'garment',
      sampleLevel: 'pp',
      round: 1,
      disposition: 'STANDARD',
      qcReviewerId: 'QC-G1',
      evidence: ['ev-photo-1', 'ev-photo-2'],
    });
    // gate 一并返回：该轮已评审且通过
    expect(res.body.gate).toMatchObject({ reviewed: true, passed: true, blockedCode: null });
    // 审计留痕
    expect(prisma._stores.auditLogs.some((l: any) => l.action === 'garment_sample_review' && l.targetId === report.id)).toBe(true);
  });

  it('评审输入校验：缺 opinion → 400；非法疵点计数 → 400；非法 round → 400', async () => {
    const app = makeApp(prisma);
    const noOpinion = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, opinion: '' });
    expect(noOpinion.status).toBe(400);
    expect(noOpinion.body.error.message).toContain('opinion');

    const badDefects = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, majorDefects: -1 });
    expect(badDefects.status).toBe(400);

    const badRound = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, round: 0 });
    expect(badRound.status).toBe(400);
  });

  it('DR-027：开发样级别（fit / confirmation）不进入 QC 门禁 → 400 DEV_SAMPLE_EXCLUDED', async () => {
    const app = makeApp(prisma);
    for (const level of ['fit', 'confirmation', 'FIT-Sample']) {
      const res = await request(app)
        .post('/api/v1/qc/chain/garment/ORD-G1/review')
        .set(asGarmentQc())
        .send({ ...GARMENT_REVIEW_BODY, sampleLevel: level });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DEV_SAMPLE_EXCLUDED');
    }
    // 服务直测：开发样类型归一化判定
    const svc = createQcService(prisma);
    expect(svc.shouldExcludeFromQc('handloom')).toBe(true);
    expect(svc.shouldExcludeFromQc('Lab Dip')).toBe(true);
    expect(svc.shouldExcludeFromQc('strike-off')).toBe(true);
    expect(svc.shouldExcludeFromQc('pp')).toBe(false);
    expect(svc.shouldExcludeFromQc('top')).toBe(false);
    expect(svc.shouldExcludeFromQc(null)).toBe(false);
  });

  it('REL-14-A1：同轮重复提交 → 409 ROUND_ALREADY_REVIEWED；新一轮 round=2 → 独立报告并存', async () => {
    const app = makeApp(prisma);
    const r1 = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send(GARMENT_REVIEW_BODY);
    expect(r1.status).toBe(201);

    const dup = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send(GARMENT_REVIEW_BODY);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ROUND_ALREADY_REVIEWED');

    const r2 = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, round: 2, conclusion: 'fail', opinion: '第 2 轮袖长仍偏差' });
    expect(r2.status).toBe(201);
    expect(r2.body.report.id).toBe('INR__ORD-G1__smp__pp__r2');
    expect(r2.body.report.inspectionType).toBe('sample_pp__r2');

    // 两条独立报告并存，Round 1 未被覆盖
    const reports = prisma._stores.inspectionReports.filter((r: any) => r.orderId === 'ORD-G1');
    expect(reports).toHaveLength(2);
    expect(reports.find((r: any) => r.id === 'INR__ORD-G1__smp__pp__r1').result).toBe('pass');
  });
});

// ════════════════════════════════════════════════════════════════
// 寄送门禁（DR-008 / QC-008-C1 / QC-29-A3：fail-closed 三态）
// ════════════════════════════════════════════════════════════════
describe('DR-008 · 服装样品寄送门禁（QC-008-C1 / QC-29-A3）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedGarmentOrder(prisma);
  });

  it('无报告 → RE_INSPECTION_REQUIRED；fail → SAMPLE_QC_GATE_NOT_PASSED；pass → 放行', async () => {
    const app = makeApp(prisma);
    // QC-29-A3：新一轮未评审 → 拦截
    const noReport = await request(app)
      .get('/api/v1/qc/chain/garment/ORD-G1/gate?sampleLevel=pp&round=1')
      .set(asSales());
    expect(noReport.status).toBe(200);
    expect(noReport.body.gate).toMatchObject({
      reviewed: false,
      passed: false,
      blockedCode: 'RE_INSPECTION_REQUIRED',
    });

    // QC-008-C1：QC fail → 内部门禁拦截
    await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, conclusion: 'fail', opinion: 'major 超标，不可寄' });
    const failed = await request(app)
      .get('/api/v1/qc/chain/garment/ORD-G1/gate?sampleLevel=pp&round=1')
      .set(asSales());
    expect(failed.body.gate).toMatchObject({
      reviewed: true,
      passed: false,
      conclusion: 'fail',
      blockedCode: 'SAMPLE_QC_GATE_NOT_PASSED',
    });

    // 第 2 轮 pass → 放行
    await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send({ ...GARMENT_REVIEW_BODY, round: 2 });
    const passed = await request(app)
      .get('/api/v1/qc/chain/garment/ORD-G1/gate?sampleLevel=pp&round=2')
      .set(asSales());
    expect(passed.body.gate).toMatchObject({ reviewed: true, passed: true, blockedCode: null });
  });
});

// ════════════════════════════════════════════════════════════════
// QC-29-A4 直接打回工厂重做
// ════════════════════════════════════════════════════════════════
describe('DR-029 · 直接打回（QC-29-A4）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedGarmentOrder(prisma);
  });

  it('缺 rejectReason → 400 REJECT_REASON_REQUIRED', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/direct-reject')
      .set(asGarmentQc())
      .send({ sampleLevel: 'pp', round: 3, opinion: '返工重做', criticalDefects: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REJECT_REASON_REQUIRED');
  });

  it('正常打回 → disposition=DIRECT_REJECT + 通知业务员 + gate=SAMPLE_DIRECTLY_REJECTED + 工厂重做要求快照', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/direct-reject')
      .set(asGarmentQc())
      .send({
        sampleLevel: 'pp',
        round: 3,
        opinion: '返工重做；领型与面料全错，建议重新对封样',
        rejectReason: '领型完全错误且面料用错，即使寄客户也必被拒',
        criticalDefects: 2,
        majorDefects: 3,
        minorDefects: 5,
      });
    expect(res.status).toBe(201);
    const report = res.body.report;
    expect(report.result).toBe('fail');
    expect(report.signatures.chain).toMatchObject({
      disposition: 'DIRECT_REJECT',
      rejectReason: '领型完全错误且面料用错，即使寄客户也必被拒',
    });
    // 工厂重做要求（关联 QC 评审 ID 与意见快照）
    expect(report.signatures.chain.factoryRework).toMatchObject({
      required: true,
      issuedBy: 'QC-G1',
      status: 'pending',
    });

    // 通知业务员（订单 ownerId），含打回原因
    const ntfs = prisma._stores.notifications.filter((n: any) => n.type === 'qc_sample_direct_reject');
    expect(ntfs).toHaveLength(1);
    expect(ntfs[0].userId).toBe('SALES-1');
    expect(ntfs[0].body).toContain('领型完全错误且面料用错');
    expect(ntfs[0].metadata).toMatchObject({ orderId: 'ORD-G1', disposition: 'DIRECT_REJECT', round: 3 });

    // 该批不得寄客户（fail-closed）
    const gate = await request(app)
      .get('/api/v1/qc/chain/garment/ORD-G1/gate?sampleLevel=pp&round=3')
      .set(asSales());
    expect(gate.body.gate.blockedCode).toBe('SAMPLE_DIRECTLY_REJECTED');

    // 审计：direct_reject 操作独立留痕
    expect(prisma._stores.auditLogs.some((l: any) => l.action === 'garment_sample_direct_reject')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 面料链评审（QC-29-B2 / REL-14-A5）
// ════════════════════════════════════════════════════════════════
describe('DR-029 · 面料链评审（QC-29-B2 / REL-14-A5）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedFabricOrder(prisma);
    seedSsSample(prisma);
  });

  it('S/S 评审 pass → 201 + 回写样品 qcInspectionReportId + inspectionType 面料链命名空间', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'pass', opinion: '色泽与手感一致', inspectionDate: '2026-08-12' });
    expect(res.status).toBe(201);
    const report = res.body.report;
    expect(report.id).toBe('INR__ORD-F1__fqc__FSS-1__1');
    expect(report.inspectionType).toBe('fabric_ss__r1');
    expect(report.signatures.chain).toMatchObject({
      chain: 'fabric',
      sampleKind: 'SS',
      sampleId: 'FSS-1',
      disposition: 'STANDARD',
    });
    // DR-029 面料链关联位回写
    const sample = prisma._stores.fabricShipmentSamples.find((s: any) => s.id === 'FSS-1');
    expect(sample.qcInspectionReportId).toBe(report.id);
    expect(prisma._stores.auditLogs.some((l: any) => l.action === 'fabric_sample_review')).toBe(true);
  });

  it('QC-29-B2：非 pass 缺 factoryAdjustment.requirement → 400；带技术调整要求 → 201 disposition=REQUIRES_FACTORY_TECH_ADJUST', async () => {
    const app = makeApp(prisma);
    const missing = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'fail', opinion: '偏蓝 0.5 级' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('FACTORY_ADJUSTMENT_REQUIRED');

    const okRes = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({
        sampleKind: 'SS',
        sampleId: 'FSS-1',
        conclusion: 'fail',
        opinion: '偏蓝 0.5 级，需加黄调整',
        factoryAdjustment: {
          requirement: '染整加黄 0.5 级调整',
          parameters: { dye: 'yellow', level: 0.5 },
          factoryName: '某染厂',
          followUpBy: 'QC-F1',
        },
      });
    expect(okRes.status).toBe(201);
    expect(okRes.body.report.signatures.chain.disposition).toBe('REQUIRES_FACTORY_TECH_ADJUST');
    expect(okRes.body.report.signatures.chain.factoryAdjustment).toMatchObject({
      requirement: '染整加黄 0.5 级调整',
      factoryName: '某染厂',
      followUpBy: 'QC-F1',
      issuedBy: 'QC-F1',
    });
  });

  it('样品归属校验：样品不存在 → 404；样品不属于订单 → 400 SAMPLE_ORDER_MISMATCH', async () => {
    const app = makeApp(prisma);
    const notFound = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-NOPE', conclusion: 'pass', opinion: 'x' });
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('SAMPLE_NOT_FOUND');

    seedFabricOrder(prisma, { id: 'ORD-F2' });
    seedSsSample(prisma, { id: 'FSS-2', orderId: 'ORD-F2' });
    const mismatch = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-2', conclusion: 'pass', opinion: 'x' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('SAMPLE_ORDER_MISMATCH');
  });

  it('REL-14-A5：同样品二次评审 → 独立 seq=2 报告，不覆盖首条', async () => {
    const app = makeApp(prisma);
    const first = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'fail', opinion: '偏蓝', factoryAdjustment: { requirement: '加黄' } });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'pass', opinion: '调整后合格' });
    expect(second.status).toBe(201);
    expect(second.body.report.id).toBe('INR__ORD-F1__fqc__FSS-1__2');
    expect(second.body.report.inspectionType).toBe('fabric_ss__r2');

    const reports = prisma._stores.inspectionReports.filter((r: any) => r.orderId === 'ORD-F1');
    expect(reports).toHaveLength(2);
    expect(reports[0].result).toBe('fail');
    expect(reports[1].result).toBe('pass');
  });

  it('链报告列表：仅返回样品链报告（大货 final/midline 天然隔离），chain 过滤生效', async () => {
    const app = makeApp(prisma);
    await request(app)
      .post('/api/v1/qc/chain/fabric/ORD-F1/review')
      .set(asFabricQc())
      .send({ sampleKind: 'SS', sampleId: 'FSS-1', conclusion: 'pass', opinion: 'ok' });
    // 混入大货 final 报告（非链命名空间）
    prisma._stores.inspectionReports.push({
      id: 'INR__ORD-F1',
      orderId: 'ORD-F1',
      inspectionType: 'final',
      result: 'pass',
      createdAt: BigInt(1),
    });

    const all = await request(app).get('/api/v1/qc/chain/ORD-F1/reports').set(asSales());
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(1);
    expect(all.body.items[0].chain).toBe('fabric');

    const garmentOnly = await request(app).get('/api/v1/qc/chain/ORD-F1/reports?chain=garment').set(asSales());
    expect(garmentOnly.body.items).toHaveLength(0);

    const badChain = await request(app).get('/api/v1/qc/chain/ORD-F1/reports?chain=bulk').set(asSales());
    expect(badChain.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// DR-014 出运资格三条件并行（QC-014-C2）
// ════════════════════════════════════════════════════════════════
describe('DR-014 · 出运资格三条件并行（QC-014-C2）', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = makeMockPrisma();
    seedFabricOrder(prisma);
  });

  const eligibility = (app: any, orderId = 'ORD-F1') =>
    request(app).get(`/api/v1/qc/orders/${orderId}/shipment-eligibility`).set(asSales());

  it('三条件全缺 → eligible=false，missingGates 分别列出 3 条链（非完成度百分比）', async () => {
    const app = makeApp(prisma);
    const res = await eligibility(app);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      orderId: 'ORD-F1',
      applicable: true,
      eligible: false,
      missingGates: ['BULK_QC_NOT_PASSED', 'SS_NOT_CONFIRMED'],
    });
    expect(res.body.conditions.bulkQc.satisfied).toBe(false);
    expect(res.body.conditions.ss.satisfied).toBe(false);
    // RC 未启用（未寄匹头样）→ 不计门禁
    expect(res.body.conditions.rc).toMatchObject({ enabled: false, satisfied: true });
  });

  it('并行顺序无关：仅 QC pass → 缺 S/S；仅 S/S approved → 缺 bulkQc（互不前置）', async () => {
    const app = makeApp(prisma);
    // 场景①：先完成大货 QC（D8 统一口径：合格数量达标 + 致命疵点 0 + 业务批准）
    prisma._stores.inspectionReports.push({
      id: 'INR__ORD-F1',
      orderId: 'ORD-F1',
      inspectionType: 'final',
      result: 'pass',
      totalUnits: 100,
      passedUnits: 98,
      criticalDefects: 0,
      approvedByBusiness: true,
      inspectedBy: 'QC-F1',
      inspectionDate: '2026-08-10',
      createdAt: BigInt(1),
    });
    const afterQc = await eligibility(app);
    expect(afterQc.body.conditions.bulkQc.satisfied).toBe(true);
    expect(afterQc.body.eligible).toBe(false);
    expect(afterQc.body.missingGates).toEqual(['SS_NOT_CONFIRMED']);

    // 场景②：换成仅 S/S 确认，QC 未做（重开库模拟反向顺序）
    const prisma2 = makeMockPrisma();
    seedFabricOrder(prisma2);
    seedSsSample(prisma2, { customerStatus: 'approved', customerFeedbackDate: '2026-08-05' });
    const app2 = makeApp(prisma2);
    const afterSs = await eligibility(app2);
    expect(afterSs.body.conditions.ss.satisfied).toBe(true);
    expect(afterSs.body.eligible).toBe(false);
    expect(afterSs.body.missingGates).toEqual(['BULK_QC_NOT_PASSED']);
  });

  it('RC 启用未确认 → RC_NOT_CONFIRMED；三条件齐全 → eligible=true', async () => {
    prisma._stores.orders[0].fabricSampleSentDate = '2026-08-08';
    const app = makeApp(prisma);
    prisma._stores.inspectionReports.push({
      id: 'INR__ORD-F1',
      orderId: 'ORD-F1',
      inspectionType: 'final',
      result: 'pass',
      totalUnits: 100,
      passedUnits: 98,
      criticalDefects: 0,
      approvedByBusiness: true,
      createdAt: BigInt(1),
    });
    seedSsSample(prisma, { customerStatus: 'approved' });

    const withRcMissing = await eligibility(app);
    expect(withRcMissing.body.conditions.rc).toMatchObject({ enabled: true, satisfied: false });
    expect(withRcMissing.body.missingGates).toEqual(['RC_NOT_CONFIRMED']);
    expect(withRcMissing.body.eligible).toBe(false);

    prisma._stores.orders[0].fabricSampleConfirmedDate = '2026-08-11';
    const allDone = await eligibility(app);
    expect(allDone.body.eligible).toBe(true);
    expect(allDone.body.missingGates).toEqual([]);
    expect(allDone.body.conditions.rc).toMatchObject({ enabled: true, satisfied: true, confirmedDate: '2026-08-11' });
  });

  it('大货 QC fail 不算通过；服装订单 → applicable=false（链边界）；订单不存在 → 404', async () => {
    prisma._stores.inspectionReports.push({
      id: 'INR__ORD-F1',
      orderId: 'ORD-F1',
      inspectionType: 'final',
      result: 'fail',
      createdAt: BigInt(1),
    });
    seedSsSample(prisma, { customerStatus: 'approved' });
    const app = makeApp(prisma);
    const res = await eligibility(app);
    expect(res.body.eligible).toBe(false);
    expect(res.body.missingGates).toContain('BULK_QC_NOT_PASSED');

    seedGarmentOrder(app ? prisma : prisma);
    const garmentRes = await eligibility(app, 'ORD-G1');
    expect(garmentRes.status).toBe(200);
    expect(garmentRes.body.applicable).toBe(false);
    expect(garmentRes.body.reason).toContain('面料');

    const notFound = await eligibility(app, 'ORD-NOPE');
    expect(notFound.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// signatures 双签（质量门禁 §9.3-②）
// ════════════════════════════════════════════════════════════════
describe('InspectionReport signatures 双签（§9.3-②）', () => {
  let prisma: any;
  beforeEach(async () => {
    prisma = makeMockPrisma();
    seedGarmentOrder(prisma);
    // 建一条含 chain 命名空间的样品链报告（验证双签与 chain 共存互不覆盖）
    const app = makeApp(prisma);
    await request(app)
      .post('/api/v1/qc/chain/garment/ORD-G1/review')
      .set(asGarmentQc())
      .send(GARMENT_REVIEW_BODY);
  });

  const REPORT_ID = 'INR__ORD-G1__smp__pp__r1';

  it('qc 签 → qcSignedAt/qcSignerId 写入且 chain 命名空间保留；同角色重复签 → 400', async () => {
    const app = makeApp(prisma);
    const res = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asGarmentQc())
      .send({ role: 'qc' });
    expect(res.status).toBe(200);
    expect(res.body.item.signatures.qcSignedAt).toBeTypeOf('number');
    expect(res.body.item.signatures.qcSignerId).toBe('QC-G1');
    // chain 命名空间不被覆盖
    expect(res.body.item.signatures.chain).toMatchObject({ chain: 'garment', round: 1 });

    // 字段级审计
    expect(
      prisma._stores.auditLogs.some(
        (l: any) => l.action === 'inspection_report_sign_qc' && l.fieldPath === 'signatures.qcSignedAt',
      ),
    ).toBe(true);

    const dup = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asGarmentQc())
      .send({ role: 'qc' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('已签署');
  });

  it('business 签 → businessSignedAt 写入；双签齐全后两字段共存', async () => {
    const app = makeApp(prisma);
    await request(app).post(`/api/v1/qc/reports/${REPORT_ID}/sign`).set(asGarmentQc()).send({ role: 'qc' });
    const biz = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asSales())
      .send({ role: 'business' });
    expect(biz.status).toBe(200);
    const sig = biz.body.item.signatures;
    expect(sig.businessSignedAt).toBeTypeOf('number');
    expect(sig.businessSignerId).toBe('SALES-1');
    expect(sig.qcSignedAt).toBeTypeOf('number');
    expect(sig.chain).toMatchObject({ chain: 'garment' });
  });

  it('非法 role → 400；报告不存在 → 404；无 qc:write（财务）→ 403；API key → 401', async () => {
    const app = makeApp(prisma);
    const badRole = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asGarmentQc())
      .send({ role: 'admin' });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.message).toContain('非法签署角色');

    const notFound = await request(app)
      .post('/api/v1/qc/reports/INR__NOPE/sign')
      .set(asGarmentQc())
      .send({ role: 'qc' });
    expect(notFound.status).toBe(404);

    const forbidden = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asFinance())
      .send({ role: 'qc' });
    expect(forbidden.status).toBe(403);

    const apiKeyRes = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set('X-Bambook-API-Key', validApiKey)
      .send({ role: 'qc' });
    expect(apiKeyRes.status).toBe(401);
  });

  it('QCG-EXC-2 场景①：QC 容器代签业务侧 → 403 PP_SIGN_BUSINESS_ROLE_REQUIRED；部门主管可签', async () => {
    const app = makeApp(prisma);
    // QC-G1 非订单负责人、非部门主管 → 403（双签职责分离 fail-closed）
    const qcProxySign = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set(asGarmentQc())
      .send({ role: 'business' });
    expect(qcProxySign.status).toBe(403);
    expect(qcProxySign.body.error.message).toContain('PP_SIGN_BUSINESS_ROLE_REQUIRED');
    // 未写入任何签字（fail-closed 不留半成品）
    expect(prisma._stores.inspectionReports.find((r: any) => r.id === REPORT_ID).signatures.businessSignedAt).toBeUndefined();

    // 订单归属部门主管（DEPT-1.headId=MGR-1）→ 放行
    prisma._stores.departments.push({ id: 'DEPT-1', headId: 'MGR-1' });
    const mgrToken = jwt.sign(
      { userId: 'MGR-1', roles: ['sales'], permissions: ['qc:read', 'qc:write'], departmentIds: ['DEPT-1'] },
      SECRET,
    );
    const mgrSign = await request(app)
      .post(`/api/v1/qc/reports/${REPORT_ID}/sign`)
      .set('Cookie', `bambook_token=${mgrToken}`)
      .send({ role: 'business' });
    expect(mgrSign.status).toBe(200);
    expect(mgrSign.body.item.signatures.businessSignerId).toBe('MGR-1');
  });

  it('报告读取端点：GET /reports/:id 返回 signatures；GET /orders/:orderId/reports 列表', async () => {
    const app = makeApp(prisma);
    await request(app).post(`/api/v1/qc/reports/${REPORT_ID}/sign`).set(asGarmentQc()).send({ role: 'qc' });

    const single = await request(app).get(`/api/v1/qc/reports/${REPORT_ID}`).set(asSales());
    expect(single.status).toBe(200);
    expect(single.body.item.signatures.qcSignerId).toBe('QC-G1');

    const list = await request(app).get('/api/v1/qc/orders/ORD-G1/reports').set(asSales());
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(REPORT_ID);

    const list404 = await request(app).get('/api/v1/qc/orders/ORD-NOPE/reports').set(asSales());
    expect(list404.status).toBe(404);
  });
});
