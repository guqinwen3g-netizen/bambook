import { describe, expect, it, vi } from 'vitest';
import { advanceStage, PRODUCTION_STAGES, initProductionStages } from '../stageService';

vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id'),
}));

function makeTx(overrides: any = {}) {
  const defaultStage = {
    id: 'PST__O1__materials_arrived',
    orderId: 'O1',
    stageKey: 'materials_arrived',
    stageSeq: 5,
    status: 'pending',
    note: null,
    operator: null,
    signedByProduction: null,
    signedByBusiness: null,
    signedAtProduction: null,
    signedAtBusiness: null,
    doneAt: null,
  };
  const prevStages = PRODUCTION_STAGES
    .filter(s => s.seq < (overrides.stage?.stageSeq ?? 5))
    .map(s => ({ ...defaultStage, id: `PST__O1__${s.key}`, stageKey: s.key, stageSeq: s.seq, status: 'done', doneAt: BigInt(1000) }));
  return {
    order: { findFirst: vi.fn().mockResolvedValue(overrides.order ?? { id: 'O1', deletedAt: null }) },
    productionStage: {
      findUnique: vi.fn().mockResolvedValue(overrides.stage ?? defaultStage),
      findMany: vi.fn().mockResolvedValue(overrides.prevStages ?? prevStages),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...defaultStage, ...(overrides.stage ?? {}), ...data, id: where.id })),
      upsert: vi.fn().mockResolvedValue({}),
    },
    preCutChecklist: { findUnique: vi.fn().mockResolvedValue(overrides.checklist ?? null) },
    inspectionReport: { findUnique: vi.fn().mockResolvedValue(overrides.inspection ?? null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makePrisma(txOverrides: any = {}) {
  const tx = makeTx(txOverrides);
  return { prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any, tx };
}

describe('PRODUCTION_STAGES', () => {
  it('10 stages with seq 1-10', () => {
    expect(PRODUCTION_STAGES).toHaveLength(10);
    expect(PRODUCTION_STAGES.map(s => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PRODUCTION_STAGES[0].key).toBe('order_placed');
    expect(PRODUCTION_STAGES[9].key).toBe('qc_shipped');
  });
});

describe('advanceStage: sequential check', () => {
  it('rejects if previous stage not done', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'in_production', stageSeq: 4, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      prevStages: [
        { stageKey: 'order_placed', stageSeq: 1, status: 'done' },
        { stageKey: 'materials_confirmed', stageSeq: 2, status: 'done' },
        { stageKey: 'production_planned', stageSeq: 3, status: 'pending' },
      ],
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'in_production' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('STAGE_NOT_SEQUENTIAL'); }
  });
});

describe('advanceStage: pre_cut_checked gate', () => {
  it('rejects when checklist incomplete', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'pre_cut_checked', stageSeq: 6, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      checklist: { gradingConfirmed: true, consumptionConfirmed: false, patternConfirmed: true, preProductionMeeting: true },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'pre_cut_checked' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('PRECUT_CHECKLIST_INCOMPLETE'); expect(r.error.message).toContain('耗料'); }
  });
  it('passes when all 4 items true', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'pre_cut_checked', stageSeq: 6, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      checklist: { gradingConfirmed: true, consumptionConfirmed: true, patternConfirmed: true, preProductionMeeting: true },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'pre_cut_checked' });
    expect(r.ok).toBe(true);
  });
  it('rejects when no checklist', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'pre_cut_checked', stageSeq: 6, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      checklist: null,
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'pre_cut_checked' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('PRECUT_CHECKLIST_INCOMPLETE'); }
  });
});

describe('advanceStage: pp_sample dual-sign gate', () => {
  it('rejects missing production sign', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'pp_sample_approved', stageSeq: 7, status: 'pending', id: 'P', orderId: 'O1', doneAt: null, signedByProduction: null, signedByBusiness: 'biz' },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'pp_sample_approved' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('PP_SAMPLE_NOT_SIGNED'); expect(r.error.message).toContain('生产部签字'); }
  });
  it('passes when both signed', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'pp_sample_approved', stageSeq: 7, status: 'pending', id: 'P', orderId: 'O1', doneAt: null, signedByProduction: 'prod', signedByBusiness: 'biz' },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'pp_sample_approved' });
    expect(r.ok).toBe(true);
  });
});

describe('advanceStage: qc_shipped threshold gate', () => {
  it('rejects passRate < 90%', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 85, approvedByBusiness: true },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INSPECTION_NOT_QUALIFIED'); }
  });
  it('rejects defectRate > 3%', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 96, approvedByBusiness: true },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INSPECTION_NOT_QUALIFIED'); }
  });
  it('rejects without business approval', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 98, approvedByBusiness: false },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('BUSINESS_APPROVAL_REQUIRED'); }
  });
  it('passes with 98% pass + 2% defect + approved', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 98, approvedByBusiness: true },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(true);
  });
  it('rejects when no inspection report', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: null,
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INSPECTION_NOT_QUALIFIED'); }
  });
  // Phase B4：验货结论与致命疵点纳入门禁
  it('rejects when final inspection result is fail', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 98, approvedByBusiness: true, result: 'fail' },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INSPECTION_NOT_QUALIFIED'); expect(r.error.message).toContain('不合格'); }
  });
  it('rejects when critical defects > 0（AQL 0 零容忍）', async () => {
    const { prisma } = makePrisma({
      stage: { stageKey: 'qc_shipped', stageSeq: 10, status: 'pending', id: 'P', orderId: 'O1', doneAt: null },
      inspection: { totalUnits: 100, passedUnits: 99, approvedByBusiness: true, result: 'pass', criticalDefects: 1 },
    });
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'qc_shipped' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INSPECTION_NOT_QUALIFIED'); expect(r.error.message).toContain('致命疵点'); }
  });
});

describe('saveInspectionReport: Phase B4 多类型 + QC 字段', () => {
  const orderFound = { order: { findFirst: vi.fn().mockResolvedValue({ id: 'O1', millRelationId: null, poNumber: null }) } };

  it('中期与终期报告按 (orderId, inspectionType) 分别 upsert', async () => {
    const upsertMock = vi.fn().mockImplementation(async ({ create }: any) => ({
      ...create,
      passRate: 0,
      defectRate: 0,
    }));
    const prisma = { ...orderFound, inspectionReport: { upsert: upsertMock } } as any;
    const { saveInspectionReport } = await import('../stageService');

    await saveInspectionReport(prisma, 'O1', { inspectionType: 'midline', totalUnits: 50, passedUnits: 48, aqlLevel: '2.5/4.0 II' });
    await saveInspectionReport(prisma, 'O1', { totalUnits: 100, passedUnits: 98 });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const first = upsertMock.mock.calls[0][0];
    const second = upsertMock.mock.calls[1][0];
    expect(first.where.orderId_inspectionType).toEqual({ orderId: 'O1', inspectionType: 'midline' });
    expect(first.create.id).toBe('INR__O1__midline');
    expect(first.create.aqlLevel).toBe('2.5/4.0 II');
    // 缺省类型按 final 处理，沿用历史 id 格式
    expect(second.where.orderId_inspectionType).toEqual({ orderId: 'O1', inspectionType: 'final' });
    expect(second.create.id).toBe('INR__O1');
  });

  it('非法验货结论抛出 INVALID_RESULT', async () => {
    const prisma = { inspectionReport: { upsert: vi.fn() } } as any;
    const { saveInspectionReport } = await import('../stageService');
    await expect(saveInspectionReport(prisma, 'O1', { result: 'unknown' })).rejects.toMatchObject({ code: 'INVALID_RESULT' });
  });

  it('未知 inspectionType 归一为 final', async () => {
    const upsertMock = vi.fn().mockImplementation(async ({ create }: any) => create);
    const prisma = { ...orderFound, inspectionReport: { upsert: upsertMock } } as any;
    const { saveInspectionReport } = await import('../stageService');
    await saveInspectionReport(prisma, 'O1', { inspectionType: 'weird' });
    expect(upsertMock.mock.calls[0][0].create.inspectionType).toBe('final');
  });

  // P3c：历史检验报告录入必须挂靠有效订单
  it('订单不存在或已软删 → ORDER_NOT_FOUND，且不落库', async () => {
    const upsertMock = vi.fn();
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      inspectionReport: { upsert: upsertMock },
    } as any;
    const { saveInspectionReport } = await import('../stageService');
    await expect(saveInspectionReport(prisma, 'O_GONE', { totalUnits: 10 })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('advanceStage: invalid input', () => {
  it('rejects invalid stageKey', async () => {
    const { prisma } = makePrisma();
    // 边界类型已强制 StageKey 联合，此处通过 as any 模拟绕过编译检查的非法输入，
    // 验证 advanceStage 内部 INVALID_STAGE 防御逻辑（parseStageKey 边界已拦截合法请求方）。
    const r = await advanceStage({ prisma, orderId: 'O1', stageKey: 'invalid' as any });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('INVALID_STAGE'); }
  });
});

describe('initProductionStages', () => {
  it('creates 10 upserts, stage 1 done, rest pending', async () => {
    const upsertMock = vi.fn().mockResolvedValue({});
    const prisma = { productionStage: { upsert: upsertMock } } as any;
    await initProductionStages(prisma, 'O1');
    expect(upsertMock).toHaveBeenCalledTimes(10);
    expect(upsertMock.mock.calls[0][0].create.status).toBe('done');
    expect(upsertMock.mock.calls[0][0].create.stageKey).toBe('order_placed');
    expect(upsertMock.mock.calls[1][0].create.status).toBe('pending');
  });
});
