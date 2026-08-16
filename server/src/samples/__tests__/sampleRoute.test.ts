import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSampleRouter } from '../sampleRoute';
import { authHeader } from '../../__tests__/authTestHelper';

/**
 * 样品域路由契约测试：
 *  - 写操作必须 JWT（API key 不可写，fail-closed）
 *  - scope 守卫（无 scope → 403）
 *  - DR-008 内部门禁（QC 未通过提交客户 → 409）
 *  - DR-012 资格判定端点输出
 *  - DR-039 寄送必填校验透传
 */
vi.mock('../../audit/routeAudit', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id') };
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const noScopeToken = jwt.sign({ userId: 'u_noscope', roles: [], permissions: [] }, JWT_SECRET);

function makeFabricOrder(overrides: any = {}) {
  return {
    id: 'ORD-F1',
    orderNo: 'SO-F-1',
    type: 'Fabric',
    businessLine: 'fabric',
    status: 'in_production',
    clientDate: '2099-12-31',
    deletedAt: null,
    ...overrides,
  };
}

function makeGarmentCase(overrides: any = {}) {
  return {
    id: 'CASE-G1',
    code: 'DEV-G-1',
    type: 'garment',
    attachments: {},
    createdAt: BigInt(1000),
    updatedAt: BigInt(1000),
    deletedAt: null,
    ...overrides,
  };
}

function makeApp(opts: { requireAuth?: boolean; apiKeys?: Set<string> } = {}) {
  const state: any = {
    order: makeFabricOrder(),
    devCase: makeGarmentCase(),
    samples: [],
    eps: [],
    node: {
      id: 'SN__CASE-G1__pp',
      developmentCaseId: 'CASE-G1',
      level: 'pp',
      round: 1,
      status: 'sent',
      approvedAt: null,
      approvedBy: null,
      feedback: null,
      notes: null,
      createdAt: BigInt(1000),
      updatedAt: BigInt(1000),
      deletedAt: null,
    },
    seq: 0,
  };
  const fabricShipmentSample: any = {
    create: vi.fn().mockImplementation(async ({ data }: any) => {
      const row = { createdAt: BigInt(1000), updatedAt: BigInt(1000), deletedAt: null, ...data };
      state.samples.push(row);
      return row;
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
      state.samples.find((s: any) => s.id === where.id && !s.deletedAt) ?? null,
    ),
    findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
      let rows = state.samples.filter((s: any) => !s.deletedAt);
      if (where?.orderId) rows = rows.filter((s: any) => s.orderId === where.orderId);
      return rows;
    }),
    count: vi.fn().mockImplementation(async ({ where }: any = {}) =>
      where?.sampleCode?.startsWith
        ? state.samples.filter((s: any) => s.sampleCode.startsWith(where.sampleCode.startsWith)).length
        : state.samples.length,
    ),
    update: vi.fn().mockImplementation(async ({ where, data }: any) => {
      const idx = state.samples.findIndex((s: any) => s.id === where.id);
      if (idx >= 0) state.samples[idx] = { ...state.samples[idx], ...data };
      return state.samples[idx];
    }),
  };
  const earlyProductionSample: any = {
    create: vi.fn().mockImplementation(async ({ data }: any) => {
      const row = { createdAt: BigInt(1000), updatedAt: BigInt(1000), deletedAt: null, ...data };
      state.eps.push(row);
      return row;
    }),
    findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
      state.eps.find((s: any) => s.id === where.id && !s.deletedAt) ?? null,
    ),
    findMany: vi.fn().mockImplementation(async ({ where }: any = {}) => {
      let rows = state.eps.filter((s: any) => !s.deletedAt);
      if (where?.orderId) rows = rows.filter((s: any) => s.orderId === where.orderId);
      return rows;
    }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockImplementation(async ({ where, data }: any) => {
      const idx = state.eps.findIndex((s: any) => s.id === where.id);
      if (idx >= 0) state.eps[idx] = { ...state.eps[idx], ...data };
      return state.eps[idx];
    }),
  };
  const developmentCase: any = {
    findFirst: vi.fn().mockImplementation(async () => state.devCase),
    update: vi.fn().mockImplementation(async ({ data }: any) => {
      state.devCase = { ...state.devCase, ...data };
      return state.devCase;
    }),
  };
  const sampleNode: any = {
    upsert: vi.fn().mockImplementation(async ({ create }: any) => ({ ...create })),
    findUnique: vi.fn().mockImplementation(async () => state.node),
    findMany: vi.fn().mockImplementation(async () => (state.node ? [state.node] : [])),
    update: vi.fn().mockImplementation(async ({ data }: any) => {
      state.node = { ...state.node, ...data };
      return state.node;
    }),
  };
  const inspectionReport: any = { findUnique: vi.fn().mockResolvedValue(null) };
  const tx: any = { fabricShipmentSample, earlyProductionSample, developmentCase, sampleNode, inspectionReport };
  const prisma: any = {
    order: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
        state.order && (!where?.id || state.order.id === where.id) ? state.order : null,
      ),
    },
    fabricShipmentSample,
    earlyProductionSample,
    developmentCase,
    sampleNode,
    inspectionReport,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const onDataChange = vi.fn();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/samples',
    createSampleRouter({
      prisma,
      requireAuth: opts.requireAuth ?? false,
      apiKeys: opts.apiKeys ?? new Set<string>(),
      onDataChange,
    }),
  );
  return { app, state, onDataChange };
}

describe('面料 S/S + RC 路由', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /fabric/:orderId/shipment-sample → 201 + sampleCode FSS- + onDataChange', async () => {
    const { app, onDataChange } = makeApp();
    const res = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/shipment-sample')
      .set(authHeader())
      .send({ sampleQuantity: 2, cuttingDate: '2099-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.sample.sampleCode).toMatch(/^FSS-/);
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({ entity: 'samples', action: 'create_shipment_sample' }));
  });

  it('POST /fabric/:orderId/head-sample → 201 RC + 留痕', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/head-sample')
      .set(authHeader())
      .send({ enabledReason: 'Separates 客户要求' });
    expect(res.status).toBe(201);
    expect(res.body.sample.sampleCode).toMatch(/^FRC-/);
  });

  it('POST /:id/ship + /:id/confirm 全链路 → GET shipment-eligibility eligible=true（DR-012）', async () => {
    const { app } = makeApp();
    const created = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/shipment-sample')
      .set(authHeader())
      .send({ sampleQuantity: 2, cuttingDate: '2099-01-01' });
    const sampleId = created.body.sample.id;

    // 未确认前：不具备正常发货条件
    const before = await request(app).get('/api/v1/samples/fabric/ORD-F1/shipment-eligibility').set(authHeader());
    expect(before.status).toBe(200);
    expect(before.body.eligibility.eligibleForNormalShipment).toBe(false);
    expect(before.body.eligibility.blockingReasons).toContain('SS_NOT_SENT');

    const ship = await request(app)
      .post(`/api/v1/samples/${sampleId}/ship`)
      .set(authHeader())
      .send({ courier: 'DHL', trackingNumber: 'T-1', recipientName: 'ABC QA' });
    expect(ship.status).toBe(200);
    expect(ship.body.sample.sentToCustomer).toBe(true);

    const mid = await request(app).get('/api/v1/samples/fabric/ORD-F1/shipment-eligibility').set(authHeader());
    expect(mid.body.eligibility.blockingReasons).toContain('SS_NOT_CONFIRMED');

    const confirm = await request(app)
      .post(`/api/v1/samples/${sampleId}/confirm`)
      .set(authHeader())
      .send({ result: 'approved', confirmationDate: '2099-01-10', channel: 'email' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.sample.customerStatus).toBe('approved');

    const after = await request(app).get('/api/v1/samples/fabric/ORD-F1/shipment-eligibility').set(authHeader());
    expect(after.body.eligibility.eligibleForNormalShipment).toBe(true);
  });

  it('POST /:id/ship 缺 DR-039 必填字段 → 400 INVALID_INPUT', async () => {
    const { app, state } = makeApp();
    state.samples.push({
      id: 'FSS__x',
      sampleCode: 'FSS-1',
      orderId: 'ORD-F1',
      sentToCustomer: false,
      customerStatus: 'pending',
      attachments: { sampleKind: 'SS' },
      deletedAt: null,
    });
    const res = await request(app).post('/api/v1/samples/FSS__x/ship').set(authHeader()).send({ courier: 'DHL' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });
});

describe('早期生产样路由（DR-028）', () => {
  it('POST /early-production/:orderId/rounds → 201；未投产订单 → 409', async () => {
    const { app, state } = makeApp();
    const res = await request(app)
      .post('/api/v1/samples/early-production/ORD-F1/rounds')
      .set(authHeader())
      .send({ sampleQuantity: 3, cuttingDate: '2099-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.sample.sampleCode).toMatch(/^EPS-/);

    state.order = makeFabricOrder({ status: 'pending' });
    const blocked = await request(app)
      .post('/api/v1/samples/early-production/ORD-F1/rounds')
      .set(authHeader())
      .send({ sampleQuantity: 3, cuttingDate: '2099-01-01' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ORDER_NOT_IN_PRODUCTION');
  });
});

describe('服装双门禁路由（DR-008）', () => {
  it('完整链：create → QC → submit → confirm → seal，QC 未通过提交客户 409', async () => {
    const { app, state } = makeApp();
    const created = await request(app)
      .post('/api/v1/samples/garment/CASE-G1/rounds')
      .set(authHeader())
      .send({ purpose: '首版', version: 'V1', materialConfig: '面料A' });
    expect(created.status).toBe(201);
    const roundId = created.body.round.id;

    // 内部门禁 fail-closed
    const early = await request(app)
      .post(`/api/v1/samples/garment/${roundId}/submit-customer`)
      .set(authHeader())
      .send({ courier: 'DHL', trackingNumber: 'T', recipientName: 'R' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('QC_GATE_NOT_PASSED');

    const qc = await request(app)
      .post(`/api/v1/samples/garment/${roundId}/submit-qc`)
      .set(authHeader())
      .send({ result: 'passed' });
    expect(qc.status).toBe(200);
    expect(qc.body.round.status).toBe('qc_passed');

    const submitted = await request(app)
      .post(`/api/v1/samples/garment/${roundId}/submit-customer`)
      .set(authHeader())
      .send({ courier: 'DHL', trackingNumber: 'T', recipientName: 'R' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.round.status).toBe('submitted');

    const confirmed = await request(app)
      .post(`/api/v1/samples/garment/${roundId}/register-customer-confirmation`)
      .set(authHeader())
      .send({ result: 'approved', confirmationDate: '2099-01-10', channel: 'email' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.round.status).toBe('confirmed');

    const sealed = await request(app).post(`/api/v1/samples/garment/${roundId}/seal`).set(authHeader());
    expect(sealed.status).toBe(200);
    expect(sealed.body.round.status).toBe('sealed');
    expect(state.node.status).toBe('approved');

    const list = await request(app).get('/api/v1/samples/garment/CASE-G1/rounds').set(authHeader());
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.sealedRoundId).toBe(roundId);
  });
});

describe('守卫口径（fail-closed）', () => {
  it('写操作无 JWT → 401', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/shipment-sample')
      .send({ sampleQuantity: 2, cuttingDate: '2099-01-01' });
    expect(res.status).toBe(401);
  });

  it('无 scope JWT → 403 INSUFFICIENT_SCOPE', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/shipment-sample')
      .set(authHeader(noScopeToken))
      .send({ sampleQuantity: 2, cuttingDate: '2099-01-01' });
    expect(res.status).toBe(403);
  });

  it('requireAuth=true 时 API key 单独不可写 → 401；但可读 → 200', async () => {
    const { app } = makeApp({ requireAuth: true, apiKeys: new Set(['test-key']) });
    const write = await request(app)
      .post('/api/v1/samples/fabric/ORD-F1/shipment-sample')
      .set('X-Bambook-API-Key', 'test-key')
      .send({ sampleQuantity: 2, cuttingDate: '2099-01-01' });
    expect(write.status).toBe(401);

    const read = await request(app)
      .get('/api/v1/samples/fabric/ORD-F1/shipment-eligibility')
      .set('X-Bambook-API-Key', 'test-key');
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe(true);
  });

  it('requireAuth=true 时无任何凭证 → 401', async () => {
    const { app } = makeApp({ requireAuth: true, apiKeys: new Set(['test-key']) });
    const res = await request(app).get('/api/v1/samples/fabric/ORD-F1/shipment-eligibility');
    expect(res.status).toBe(401);
  });
});
