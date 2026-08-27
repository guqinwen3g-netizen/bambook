import { describe, expect, it, vi, beforeEach } from 'vitest';
import { advanceStage, PRODUCTION_STAGES, initProductionStages, getProductionBoard, setStageBlocked } from '../stageService';

vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id'),
}));

// PRD 7.1 终期验货 fail 通知 mock
const notificationMocks = vi.hoisted(() => ({
  broadcastNotification: vi.fn().mockResolvedValue({ count: 1 }),
}));
vi.mock('../../notifications/notificationService', () => ({
  createNotificationService: () => ({
    broadcastNotification: notificationMocks.broadcastNotification,
  }),
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

describe('setStageBlocked: C18 看板阻塞标记', () => {
  const pendingStage = {
    id: 'PST__O1__in_production', orderId: 'O1', stageKey: 'in_production', stageSeq: 4,
    status: 'pending', note: null, operator: null, doneAt: null,
  };

  it('pending 阶段标记阻塞 → status=blocked + 审计留痕', async () => {
    const { prisma, tx } = makePrisma({ stage: pendingStage });
    const r = await setStageBlocked({ prisma, orderId: 'O1', stageKey: 'in_production', blocked: true, operator: 'MER-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.stage.status).toBe('blocked');
    expect(tx.productionStage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'blocked', operator: 'MER-1' }),
    }));
  });

  it('blocked 阶段解除 → 回到 pending', async () => {
    const { prisma } = makePrisma({ stage: { ...pendingStage, status: 'blocked' } });
    const r = await setStageBlocked({ prisma, orderId: 'O1', stageKey: 'in_production', blocked: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.stage.status).toBe('pending');
  });

  it('幂等：已 blocked 重复标记 / 非 blocked 重复解除 → 不写库', async () => {
    const { prisma, tx } = makePrisma({ stage: { ...pendingStage, status: 'blocked' } });
    const r = await setStageBlocked({ prisma, orderId: 'O1', stageKey: 'in_production', blocked: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.stage.status).toBe('blocked');
    expect(tx.productionStage.update).not.toHaveBeenCalled();
  });

  it('done 阶段不可标记/解除 → STAGE_NOT_BLOCKABLE', async () => {
    const { prisma } = makePrisma({ stage: { ...pendingStage, status: 'done', doneAt: BigInt(1000) } });
    const r = await setStageBlocked({ prisma, orderId: 'O1', stageKey: 'in_production', blocked: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('STAGE_NOT_BLOCKABLE');
  });

  it('订单不存在 → ORDER_NOT_FOUND；非法 stageKey → INVALID_STAGE', async () => {
    // makeTx 对 order 有 ?? 兜底，not-found 场景需自定义 tx
    const tx = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      productionStage: {
        findUnique: vi.fn().mockResolvedValue(pendingStage),
        update: vi.fn(),
      },
    };
    const prismaGone = { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any;
    const notFound = await setStageBlocked({ prisma: prismaGone, orderId: 'O-X', stageKey: 'in_production', blocked: true });
    expect(notFound.ok).toBe(false);
    if (notFound.ok) return;
    expect(notFound.error.code).toBe('ORDER_NOT_FOUND');
    expect(tx.productionStage.update).not.toHaveBeenCalled();

    const { prisma } = makePrisma({ stage: pendingStage });
    const bad = await setStageBlocked({ prisma, orderId: 'O1', stageKey: 'nope' as any, blocked: true });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe('INVALID_STAGE');
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
    const prisma = { ...orderFound, inspectionReport: { upsert: upsertMock, findUnique: vi.fn().mockResolvedValue(null) } } as any;
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
    const prisma = { ...orderFound, inspectionReport: { upsert: upsertMock, findUnique: vi.fn().mockResolvedValue(null) } } as any;
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

  // PRD 7.1「终期验货 fail」：非 fail → fail 迁移瞬间广播 critical 通知
  describe('inspection fail notification', () => {
    beforeEach(() => notificationMocks.broadcastNotification.mockClear());

    const orderWithMeta = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'O1', millRelationId: null, poNumber: 'PO-001', customer: 'Acme Corp', product: 'Cotton Jersey',
        }),
      },
    };

    function makeFailPrisma(previousResult: string | null) {
      const upsertMock = vi.fn().mockImplementation(async ({ create }: any) => ({
        ...create,
        result: 'fail',
        criticalDefects: 2,
        majorDefects: 5,
        minorDefects: 10,
        defectSummary: 'stain, hole',
      }));
      return {
        ...orderWithMeta,
        inspectionReport: {
          findUnique: vi.fn().mockResolvedValue(
            previousResult ? { result: previousResult } : null,
          ),
          upsert: upsertMock,
        },
      } as any;
    }

    it('final fail（新建）→ broadcastNotification inspection_fail critical', async () => {
      const prisma = makeFailPrisma(null); // 无旧报告 → previous=null → 新 fail
      const { saveInspectionReport } = await import('../stageService');
      await saveInspectionReport(prisma, 'O1', {
        result: 'fail', totalUnits: 100, passedUnits: 80,
        criticalDefects: 2, majorDefects: 5, minorDefects: 10, defectSummary: 'stain, hole',
      });
      expect(notificationMocks.broadcastNotification).toHaveBeenCalledTimes(1);
      const payload = notificationMocks.broadcastNotification.mock.calls[0][0];
      expect(payload.type).toBe('inspection_fail');
      expect(payload.level).toBe('critical');
      expect(payload.title).toContain('PO-001');
      expect(payload.title).toContain('终期验货不通过');
      expect(payload.body).toContain('致命疵点 2');
      expect(payload.link).toBe('/production?orderId=O1');
      expect(payload.metadata.entityType).toBe('InspectionReport');
      expect(payload.metadata.orderId).toBe('O1');
    });

    it('final fail（pass→fail 迁移）→ 通知触发', async () => {
      const prisma = makeFailPrisma('pass');
      const { saveInspectionReport } = await import('../stageService');
      await saveInspectionReport(prisma, 'O1', {
        result: 'fail', totalUnits: 100, passedUnits: 80, criticalDefects: 1, majorDefects: 3, minorDefects: 5,
      });
      expect(notificationMocks.broadcastNotification).toHaveBeenCalledTimes(1);
    });

    it('final fail（fail→fail 重复保存）→ 幂等不通知', async () => {
      const prisma = makeFailPrisma('fail');
      const { saveInspectionReport } = await import('../stageService');
      await saveInspectionReport(prisma, 'O1', {
        result: 'fail', totalUnits: 100, passedUnits: 80, criticalDefects: 1, majorDefects: 3, minorDefects: 5,
      });
      expect(notificationMocks.broadcastNotification).not.toHaveBeenCalled();
    });

    it('midline fail → 不触发通知（仅 final 触发）', async () => {
      const upsertMock = vi.fn().mockImplementation(async ({ create }: any) => ({
        ...create, result: 'fail',
      }));
      const prisma = {
        ...orderWithMeta,
        inspectionReport: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: upsertMock,
        },
      } as any;
      const { saveInspectionReport } = await import('../stageService');
      await saveInspectionReport(prisma, 'O1', {
        inspectionType: 'midline', result: 'fail', totalUnits: 50, passedUnits: 40,
      });
      expect(notificationMocks.broadcastNotification).not.toHaveBeenCalled();
    });

    it('final pass → 不触发通知', async () => {
      const upsertMock = vi.fn().mockImplementation(async ({ create }: any) => ({
        ...create, result: 'pass',
      }));
      const prisma = {
        ...orderWithMeta,
        inspectionReport: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: upsertMock,
        },
      } as any;
      const { saveInspectionReport } = await import('../stageService');
      await saveInspectionReport(prisma, 'O1', { result: 'pass', totalUnits: 100, passedUnits: 98 });
      expect(notificationMocks.broadcastNotification).not.toHaveBeenCalled();
    });
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

describe('getProductionBoard（PRD 19.8 泳道看板聚合）', () => {
  function makeBoardPrisma(orders: any[], stages: any[]) {
    return {
      order: { findMany: vi.fn().mockResolvedValue(orders) },
      productionStage: { findMany: vi.fn().mockResolvedValue(stages) },
    } as any;
  }

  const baseOrder = {
    id: 'O1', poNumber: 'PO-1', customer: 'Client A', quantity: 800,
    status: 'Production', dueDate: '2026-09-01', businessLine: 'garment',
    merchandiser: 'Alice', millName: 'Mill A',
  };

  it('排除已交付/已取消/软删订单（在手口径）', async () => {
    const prisma = makeBoardPrisma([baseOrder], []);
    await getProductionBoard(prisma);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, status: { notIn: ['Delivered', 'Cancelled'] } },
    }));
  });

  it('推导当前阶段为第一个非 done 阶段；统计 blocked', async () => {
    const stages = [
      { orderId: 'O1', stageKey: 'order_placed', stageSeq: 1, status: 'done' },
      { orderId: 'O1', stageKey: 'materials_confirmed', stageSeq: 2, status: 'done' },
      { orderId: 'O1', stageKey: 'production_planned', stageSeq: 3, status: 'blocked' },
      { orderId: 'O1', stageKey: 'in_production', stageSeq: 4, status: 'pending' },
    ];
    const prisma = makeBoardPrisma([baseOrder], stages);
    const { items } = await getProductionBoard(prisma);
    expect(items).toHaveLength(1);
    expect(items[0].currentStageKey).toBe('production_planned');
    expect(items[0].blockedCount).toBe(1);
    expect(items[0].stages).toHaveLength(4);
    expect(items[0].order.poNumber).toBe('PO-1');
  });

  it('全部阶段完成时 currentStageKey 为 null', async () => {
    const stages = PRODUCTION_STAGES.map(s => ({ orderId: 'O1', stageKey: s.key, stageSeq: s.seq, status: 'done' }));
    const prisma = makeBoardPrisma([baseOrder], stages);
    const { items } = await getProductionBoard(prisma);
    expect(items[0].currentStageKey).toBeNull();
    expect(items[0].blockedCount).toBe(0);
  });

  it('无阶段记录的订单返回空 stages 与 null 当前阶段', async () => {
    const prisma = makeBoardPrisma([baseOrder], []);
    const { items } = await getProductionBoard(prisma);
    expect(items[0].stages).toEqual([]);
    expect(items[0].currentStageKey).toBeNull();
  });

  it('多订单按 id 正确归组阶段', async () => {
    const orders = [baseOrder, { ...baseOrder, id: 'O2', poNumber: 'PO-2' }];
    const stages = [
      { orderId: 'O2', stageKey: 'order_placed', stageSeq: 1, status: 'in_progress' },
      { orderId: 'O1', stageKey: 'order_placed', stageSeq: 1, status: 'done' },
      { orderId: 'O1', stageKey: 'materials_confirmed', stageSeq: 2, status: 'in_progress' },
    ];
    const prisma = makeBoardPrisma(orders, stages);
    const { items } = await getProductionBoard(prisma);
    const o1 = items.find(i => i.order.id === 'O1')!;
    const o2 = items.find(i => i.order.id === 'O2')!;
    expect(o1.stages).toHaveLength(2);
    expect(o1.currentStageKey).toBe('materials_confirmed');
    expect(o2.stages).toHaveLength(1);
    expect(o2.currentStageKey).toBe('order_placed');
  });
});
