import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createGarmentSampleGateService } from '../garmentSampleGateService';

vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id'),
}));

function makeGarmentCase(overrides: any = {}) {
  return {
    id: 'CASE-G1',
    code: 'DEV-G-1',
    name: 'Garment case',
    type: 'garment',
    stage: 'developing',
    attachments: {},
    createdAt: BigInt(1000),
    updatedAt: BigInt(1000),
    deletedAt: null,
    ...overrides,
  };
}

function makePpNode(overrides: any = {}) {
  return {
    id: 'SN__CASE-G1__pp',
    developmentCaseId: 'CASE-G1',
    level: 'pp',
    round: 1,
    status: 'sent',
    feedback: null,
    notes: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: BigInt(1000),
    updatedAt: BigInt(1000),
    deletedAt: null,
    ...overrides,
  };
}

function makePrisma(opts: { devCase?: any; node?: any; reportIds?: string[] } = {}) {
  const state = {
    devCase: opts.devCase === undefined ? makeGarmentCase() : opts.devCase,
    node: opts.node === undefined ? makePpNode() : opts.node,
    reportIds: opts.reportIds ?? [],
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
  const inspectionReport: any = {
    findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
      state.reportIds.includes(where.id) ? { id: where.id } : null,
    ),
  };
  const tx: any = { developmentCase, sampleNode, inspectionReport };
  const prisma: any = {
    developmentCase,
    sampleNode,
    inspectionReport,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, state };
}

const ACTOR = 'u_sales_1';
const QC_ACTOR = 'u_qc_1';

function roundInput(overrides: any = {}) {
  return { purpose: '首版产前样', version: 'V1', materialConfig: '面料A + 工艺单v1', ...overrides };
}
const SHIP = { courier: 'DHL', trackingNumber: 'DHL-1', recipientName: 'ABC QA' };
const CONFIRM_OK = { result: 'approved', confirmationDate: '2099-01-10', channel: 'email' };

/** 把样品轮驱动到指定状态（辅助函数，走真实服务调用链） */
async function driveRound(svc: any, stage: 'created' | 'qc_passed' | 'submitted' | 'confirmed' | 'sealed') {
  const created = await svc.createRound({ caseId: 'CASE-G1', input: roundInput(), actorId: ACTOR });
  expect(created.ok).toBe(true);
  const roundId = created.data.round.id;
  if (stage === 'created') return roundId;
  const qc = await svc.submitQcConclusion({ roundId, input: { result: 'passed', qcNote: '做工 OK' }, actorId: QC_ACTOR });
  expect(qc.ok).toBe(true);
  if (stage === 'qc_passed') return roundId;
  const sub = await svc.submitToCustomer({ roundId, input: SHIP, actorId: ACTOR });
  expect(sub.ok).toBe(true);
  if (stage === 'submitted') return roundId;
  const conf = await svc.registerCustomerConfirmation({ roundId, input: CONFIRM_OK, actorId: ACTOR });
  expect(conf.ok).toBe(true);
  if (stage === 'confirmed') return roundId;
  const seal = await svc.sealRound({ roundId, actorId: ACTOR });
  expect(seal.ok).toBe(true);
  return roundId;
}

describe('createRound（DR-008 每轮记录：目的/版本/材料工艺配置）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功创建首轮：round=1 + status=in_progress + qcStatus=none', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const r = await svc.createRound({ caseId: 'CASE-G1', input: roundInput(), actorId: ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.round).toBe(1);
      expect(r.data.round.status).toBe('in_progress');
      expect(r.data.round.qcStatus).toBe('none');
      expect(r.data.round.purpose).toBe('首版产前样');
      expect(r.data.round.version).toBe('V1');
      expect(r.data.round.materialConfig).toContain('面料A');
      expect(r.data.round.createdBy).toBe(ACTOR);
    }
  });

  it('purpose/version/materialConfig 任一缺失 → INVALID_INPUT', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    for (const input of [
      { version: 'V1', materialConfig: 'x' },
      { purpose: 'p', materialConfig: 'x' },
      { purpose: 'p', version: 'V1' },
    ]) {
      const r = await svc.createRound({ caseId: 'CASE-G1', input: input as any, actorId: ACTOR });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
  });

  it('非服装开发单 → NOT_GARMENT_CASE（DR-008/DR-029 强制边界）', async () => {
    const { prisma } = makePrisma({ devCase: makeGarmentCase({ type: 'fabric' }) });
    const svc = createGarmentSampleGateService({ prisma });
    const r = await svc.createRound({ caseId: 'CASE-G1', input: roundInput(), actorId: ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_GARMENT_CASE');
  });

  it('不限轮数：可循环创建，round 递增', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const r1 = await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V1' }), actorId: ACTOR });
    const r2 = await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V2' }), actorId: ACTOR });
    const r3 = await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V3' }), actorId: ACTOR });
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (r3.ok) expect(r3.data.round.round).toBe(3);
  });
});

describe('submitQcConclusion（DR-029 内部 QC 评审）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passed → status=qc_passed + qcReviewedBy 留痕', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'created');
    const r = await svc.submitQcConclusion({ roundId, input: { result: 'passed', qcNote: '做工 OK' }, actorId: QC_ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('qc_passed');
      expect(r.data.round.qcStatus).toBe('passed');
      expect(r.data.round.qcReviewedBy).toBe(QC_ACTOR);
      expect(r.data.round.qcNote).toBe('做工 OK');
    }
  });

  it('failed → 回到 in_progress（工厂重做后可重新送 QC）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'created');
    const r = await svc.submitQcConclusion({ roundId, input: { result: 'failed', qcNote: '跳线' }, actorId: QC_ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('in_progress');
      expect(r.data.round.qcStatus).toBe('failed');
    }
  });

  it('引用不存在的 InspectionReport → QC_REPORT_NOT_FOUND（QC 域只读引用）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'created');
    const r = await svc.submitQcConclusion({
      roundId,
      input: { result: 'passed', qcInspectionReportId: 'IR-missing' },
      actorId: QC_ACTOR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('QC_REPORT_NOT_FOUND');
  });

  it('已提交客户后不可再登记 QC → INVALID_TRANSITION', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'submitted');
    const r = await svc.submitQcConclusion({ roundId, input: { result: 'passed' }, actorId: QC_ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('submitToCustomer（DR-008 内部门禁 fail-closed）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('QC 未通过 → QC_GATE_NOT_PASSED 409（禁止提交客户）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'created');
    const r = await svc.submitToCustomer({ roundId, input: SHIP, actorId: ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('QC_GATE_NOT_PASSED');
      expect(r.error.status).toBe(409);
    }
  });

  it('QC failed 后仍不可提交（fail-closed 不被 failed 状态绕过）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'created');
    await svc.submitQcConclusion({ roundId, input: { result: 'failed' }, actorId: QC_ACTOR });
    const r = await svc.submitToCustomer({ roundId, input: SHIP, actorId: ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('QC_GATE_NOT_PASSED');
  });

  it('QC 通过 → 提交成功：status=submitted + DR-039 寄送字段齐全', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'qc_passed');
    const r = await svc.submitToCustomer({ roundId, input: { ...SHIP, sentDate: '2099-01-05', documents: [{ type: 'sample_card' }] }, actorId: ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('submitted');
      expect(r.data.round.submittedBy).toBe(ACTOR);
      expect(r.data.round.shipment.courier).toBe('DHL');
      expect(r.data.round.shipment.trackingNumber).toBe('DHL-1');
      expect(r.data.round.shipment.recipientName).toBe('ABC QA');
      expect(r.data.round.shipment.sentDate).toBe('2099-01-05');
      expect(r.data.round.shipment.documents).toHaveLength(1);
    }
  });

  it('DR-039 必填：缺 courier/trackingNumber/recipientName → INVALID_INPUT', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'qc_passed');
    for (const input of [
      { trackingNumber: 'T', recipientName: 'R' },
      { courier: 'DHL', recipientName: 'R' },
      { courier: 'DHL', trackingNumber: 'T' },
    ]) {
      const r = await svc.submitToCustomer({ roundId, input: input as any, actorId: ACTOR });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('registerCustomerConfirmation（客户确认登记，不加主管审批）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未提交客户 → INVALID_TRANSITION', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'qc_passed');
    const r = await svc.registerCustomerConfirmation({ roundId, input: CONFIRM_OK, actorId: ACTOR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('approved → status=confirmed + 渠道/日期/证据/修改项留痕', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'submitted');
    const r = await svc.registerCustomerConfirmation({
      roundId,
      input: { ...CONFIRM_OK, note: '版型 OK', modifications: [], evidence: [{ type: 'email' }] },
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('confirmed');
      expect(r.data.round.customerStatus).toBe('approved');
      expect(r.data.round.confirmation.channel).toBe('email');
      expect(r.data.round.confirmation.registeredBy).toBe(ACTOR);
      expect(r.data.round.confirmation.evidence).toHaveLength(1);
    }
  });

  it('rejected → 该轮终止（status=rejected）；改动须开新轮重走 QC（DR-029 闭环）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'submitted');
    const r = await svc.registerCustomerConfirmation({
      roundId,
      input: { result: 'rejected', confirmationDate: '2099-01-10', channel: 'email', modifications: ['袖肥 +1cm'] },
      actorId: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('rejected');
      expect(r.data.round.modifications).toEqual(['袖肥 +1cm']);
    }
  });
});

describe('sealRound（DR-008 封样不可变 + 收口投影）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未 confirmed → SEAL_REQUIRES_CONFIRMED 409（双门禁缺一不可）', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    for (const stage of ['created', 'qc_passed', 'submitted'] as const) {
      const roundId = await driveRound(svc, stage);
      const r = await svc.sealRound({ roundId, actorId: ACTOR });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('SEAL_REQUIRES_CONFIRMED');
    }
  });

  it('confirmed → sealed：sealedBy/At 留痕 + sealedRoundId 更新 + pp 样衣节点投影 approved', async () => {
    const { prisma, state } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const roundId = await driveRound(svc, 'confirmed');
    const r = await svc.sealRound({ roundId, actorId: ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.round.status).toBe('sealed');
      expect(r.data.round.sealedBy).toBe(ACTOR);
      expect(r.data.round.sealedAt).toBeTruthy();
    }
    // 收口投影：pp 节点被推进 approved（生产放行/开裁前置消费点）
    expect(state.node.status).toBe('approved');
    expect(state.node.approvedBy).toBe(ACTOR);
    expect(prisma.sampleNode.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    );
    const gate = state.devCase.attachments.garmentSampleGate;
    expect(gate.sealedRoundId).toBe(roundId);
  });

  it('新一轮封存时旧封存轮次转 superseded（历史基准保留不可变）', async () => {
    const { prisma, state } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const first = await driveRound(svc, 'sealed');

    // 客户要求改动 → 开新轮 → 完整双门禁 → 封存
    const created = await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V2', purpose: '袖肥修改' }), actorId: ACTOR });
    const secondId = created.data.round.id;
    await svc.submitQcConclusion({ roundId: secondId, input: { result: 'passed' }, actorId: QC_ACTOR });
    await svc.submitToCustomer({ roundId: secondId, input: SHIP, actorId: ACTOR });
    await svc.registerCustomerConfirmation({ roundId: secondId, input: CONFIRM_OK, actorId: ACTOR });
    const r = await svc.sealRound({ roundId: secondId, actorId: ACTOR });
    expect(r.ok).toBe(true);

    const rounds = state.devCase.attachments.garmentSampleGate.rounds;
    const r1 = rounds.find((x: any) => x.id === first);
    const r2 = rounds.find((x: any) => x.id === secondId);
    expect(r1.status).toBe('superseded');
    expect(r2.status).toBe('sealed');
    expect(state.devCase.attachments.garmentSampleGate.sealedRoundId).toBe(secondId);
  });

  it('sealed/superseded 轮次内容不可再改 → SEALED_IMMUTABLE 409', async () => {
    const { prisma, state } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const sealedId = await driveRound(svc, 'sealed');

    const r1 = await svc.submitQcConclusion({ roundId: sealedId, input: { result: 'failed' }, actorId: QC_ACTOR });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('SEALED_IMMUTABLE');

    const r2 = await svc.submitToCustomer({ roundId: sealedId, input: SHIP, actorId: ACTOR });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('SEALED_IMMUTABLE');

    const r3 = await svc.registerCustomerConfirmation({ roundId: sealedId, input: CONFIRM_OK, actorId: ACTOR });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error.code).toBe('SEALED_IMMUTABLE');

    // superseded 同样不可变
    const created = await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V2' }), actorId: ACTOR });
    const secondId = created.data.round.id;
    await svc.submitQcConclusion({ roundId: secondId, input: { result: 'passed' }, actorId: QC_ACTOR });
    await svc.submitToCustomer({ roundId: secondId, input: SHIP, actorId: ACTOR });
    await svc.registerCustomerConfirmation({ roundId: secondId, input: CONFIRM_OK, actorId: ACTOR });
    await svc.sealRound({ roundId: secondId, actorId: ACTOR });
    const r4 = await svc.submitQcConclusion({ roundId: sealedId, input: { result: 'passed' }, actorId: QC_ACTOR });
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.error.code).toBe('SEALED_IMMUTABLE');
    expect(state.devCase.attachments.garmentSampleGate.rounds.find((x: any) => x.id === sealedId).status).toBe('superseded');
  });
});

describe('listRounds', () => {
  it('返回全部轮次 + 当前封存基准', async () => {
    const { prisma } = makePrisma();
    const svc = createGarmentSampleGateService({ prisma });
    const sealedId = await driveRound(svc, 'sealed');
    await svc.createRound({ caseId: 'CASE-G1', input: roundInput({ version: 'V2' }), actorId: ACTOR });
    const r = await svc.listRounds({ caseId: 'CASE-G1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items).toHaveLength(2);
      expect(r.data.sealedRoundId).toBe(sealedId);
    }
  });

  it('开发单不存在 → NOT_FOUND', async () => {
    const { prisma } = makePrisma({ devCase: null });
    const svc = createGarmentSampleGateService({ prisma });
    const r = await svc.listRounds({ caseId: 'CASE-X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});
