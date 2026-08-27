/**
 * D8 验货放行口径统一（qcService ↔ stageService 同一判定真源）
 *
 * 验收口径：
 *   - 放行 = 生产门禁更严格口径：结论非 fail + 致命疵点=0（AQL 0 零容忍）
 *     + 合格率≥90% + 不合格率≤3% + 业务部批准
 *   - QC 出运资格（面料 checkShipmentEligibility / 服装 checkGarmentShipmentEligibility）
 *     与 stageService.advanceStage「qc_shipped」共用 assessInspectionRelease，
 *     不再使用 result='pass' 宽松口径
 *   - 不满足时 conditions.bulkQc.failureReasons 给出与生产门禁一致的中文缺口
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../audit/routeAudit', () => ({
  writeRouteAuditLog: vi.fn().mockResolvedValue('audit_test_id'),
}));
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createQcService } from '../qcService';
import { assessInspectionRelease } from '../../production/stageService';

// ────────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────────

const QUALIFIED_REPORT = {
  id: 'INR__O1',
  orderId: 'O1',
  inspectionType: 'final',
  result: 'pass',
  totalUnits: 100,
  passedUnits: 98,
  criticalDefects: 0,
  approvedByBusiness: true,
  inspectedBy: 'QC-1',
  inspectionDate: '2026-08-20',
};

function fabricOrder(overrides: any = {}) {
  return {
    id: 'O1', type: 'Fabric', businessLine: 'fabric', deletedAt: null,
    fabricSampleSentDate: null, fabricSampleConfirmedDate: null,
    ...overrides,
  };
}

function garmentOrder(overrides: any = {}) {
  return { id: 'G1', type: 'Garment', businessLine: 'garment', deletedAt: null, ...overrides };
}

function makePrisma({ order, report = null, ssSamples = [] }: any) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(order ?? null) },
    inspectionReport: { findUnique: vi.fn().mockResolvedValue(report ?? null) },
    fabricShipmentSample: { findMany: vi.fn().mockResolvedValue(ssSamples) },
  } as any;
}

const SS_APPROVED = [{ id: 'FSS-1', sampleCode: 'SS-001', customerStatus: 'approved', createdAt: BigInt(1), deletedAt: null }];

// ────────────────────────────────────────────────────────────────
// assessInspectionRelease 统一判定函数
// ────────────────────────────────────────────────────────────────

describe('D8 · assessInspectionRelease 统一放行判定', () => {
  it('全部达标 → qualified=true，failures 为空', () => {
    const r = assessInspectionRelease(QUALIFIED_REPORT);
    expect(r.qualified).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('null 报告 → fail-closed（报告未建立）', () => {
    const r = assessInspectionRelease(null);
    expect(r.qualified).toBe(false);
    expect(r.failures[0].message).toContain('未建立');
  });

  it('结论 fail / 致命疵点>0 / 合格率<90% / 不合格率>3% / 未业务批准 各自拦截', () => {
    expect(assessInspectionRelease({ ...QUALIFIED_REPORT, result: 'fail' }).failures.map(f => f.message).join())
      .toContain('不合格');
    expect(assessInspectionRelease({ ...QUALIFIED_REPORT, criticalDefects: 1 }).failures.map(f => f.message).join())
      .toContain('致命疵点');
    expect(assessInspectionRelease({ ...QUALIFIED_REPORT, passedUnits: 85 }).failures.map(f => f.message).join())
      .toContain('合格率');
    // 96/100 → 不合格率 4%（合格率 96% ≥ 90% 但 defectRate 超 3%）
    expect(assessInspectionRelease({ ...QUALIFIED_REPORT, passedUnits: 96 }).failures.map(f => f.message).join())
      .toContain('不合格率');
    const unapproved = assessInspectionRelease({ ...QUALIFIED_REPORT, approvedByBusiness: false });
    expect(unapproved.qualified).toBe(false);
    expect(unapproved.failures[0].code).toBe('BUSINESS_APPROVAL_REQUIRED');
  });

  it('数量字段缺省按 0 归一（fail-closed）；conditional 结论在数字达标+批准时放行（与生产门禁一致）', () => {
    expect(assessInspectionRelease({ result: 'pass', approvedByBusiness: true }).qualified).toBe(false);
    expect(assessInspectionRelease({ ...QUALIFIED_REPORT, result: 'conditional' }).qualified).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 面料链：checkShipmentEligibility bulkQc 统一口径
// ────────────────────────────────────────────────────────────────

describe('D8 · 面料出运资格 bulkQc 统一口径', () => {
  it('报告达标 + S/S 确认 → eligible=true', async () => {
    const svc = createQcService(makePrisma({ order: fabricOrder(), report: QUALIFIED_REPORT, ssSamples: SS_APPROVED }));
    const r = await svc.checkShipmentEligibility('O1');
    expect(r.conditions.bulkQc.satisfied).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.missingGates).toEqual([]);
  });

  it('result=pass 但合格率 85% → 不满足，failureReasons 指出合格率缺口', async () => {
    const svc = createQcService(makePrisma({
      order: fabricOrder(),
      report: { ...QUALIFIED_REPORT, passedUnits: 85 },
      ssSamples: SS_APPROVED,
    }));
    const r = await svc.checkShipmentEligibility('O1');
    expect(r.conditions.bulkQc.satisfied).toBe(false);
    expect((r.conditions.bulkQc as any).failureReasons.join()).toContain('合格率');
    expect(r.eligible).toBe(false);
    expect(r.missingGates).toEqual(['BULK_QC_NOT_PASSED']);
  });

  it('result=pass 但致命疵点 1 → 不满足（AQL 0 零容忍）', async () => {
    const svc = createQcService(makePrisma({
      order: fabricOrder(),
      report: { ...QUALIFIED_REPORT, criticalDefects: 1 },
      ssSamples: SS_APPROVED,
    }));
    const r = await svc.checkShipmentEligibility('O1');
    expect(r.conditions.bulkQc.satisfied).toBe(false);
    expect((r.conditions.bulkQc as any).failureReasons.join()).toContain('致命疵点');
  });

  it('result=pass 且数字达标但业务未批准 → 不满足（业务批准是放行必要条件）', async () => {
    const svc = createQcService(makePrisma({
      order: fabricOrder(),
      report: { ...QUALIFIED_REPORT, approvedByBusiness: false },
      ssSamples: SS_APPROVED,
    }));
    const r = await svc.checkShipmentEligibility('O1');
    expect(r.conditions.bulkQc.satisfied).toBe(false);
    expect((r.conditions.bulkQc as any).failureReasons.join()).toContain('业务部批准');
  });
});

// ────────────────────────────────────────────────────────────────
// 服装链：checkGarmentShipmentEligibility 同一口径
// ────────────────────────────────────────────────────────────────

describe('D8 · 服装出运资格同一口径', () => {
  it('Final QC 达标 → eligible=true', async () => {
    const svc = createQcService(makePrisma({
      order: garmentOrder(),
      report: { ...QUALIFIED_REPORT, id: 'INR__G1', orderId: 'G1' },
    }));
    const r = await svc.checkGarmentShipmentEligibility('G1');
    expect(r.bulkQc.satisfied).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.missingGates).toEqual([]);
  });

  it('旧宽松口径已关闭：仅 result=pass（无数量/无业务批准）→ 不具备资格', async () => {
    const svc = createQcService(makePrisma({
      order: garmentOrder(),
      report: { id: 'INR__G1', orderId: 'G1', inspectionType: 'final', result: 'pass' },
    }));
    const r = await svc.checkGarmentShipmentEligibility('G1');
    expect(r.bulkQc.satisfied).toBe(false);
    expect(r.eligible).toBe(false);
    expect(r.missingGates).toEqual(['BULK_QC_NOT_PASSED']);
    expect((r.bulkQc as any).failureReasons.length).toBeGreaterThan(0);
  });
});
