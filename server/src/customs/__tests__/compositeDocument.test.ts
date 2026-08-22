/**
 * B3 组合文档测试 — 多对一数据聚合（合并 PL / 合并 IR 汇总）。
 *
 * 覆盖：
 *   1. assembleMergedDocumentSet：≥2 校验 / 装配失败 fail-closed / lines 合并重编行号 /
 *      totals 跨运单重算 / parties 首个非空 / missing 去重
 *   2. loadMergedInspectionSummary：≥2 校验 / 报告不存在 fail-closed / 跨报告合计统计 / 结论分布
 *   3. renderMergedPackingListBody / renderMergedInspectionSummaryBody 渲染关键内容
 *   4. isCompositeDocKind / registry 注册
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ── Mock 装配器（组合聚合的单运单/单报告真源）──
const { assembleMock, inspectionLoadMock } = vi.hoisted(() => ({
  assembleMock: vi.fn(),
  inspectionLoadMock: vi.fn(),
}));

vi.mock('../../shipping/documentSetService', () => ({
  assembleDocumentSetData: (...args: any[]) => assembleMock(...args),
}));

vi.mock('../../templates/docTemplates/inspectionReport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../templates/docTemplates/inspectionReport')>();
  return { ...actual, loadInspectionReportDocData: (...args: any[]) => inspectionLoadMock(...args) };
});

vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  assembleMergedDocumentSet,
  loadMergedInspectionSummary,
  assembleCompositeDocument,
  isCompositeDocKind,
} from '../compositeDocumentService';
import { renderMergedPackingListBody } from '../../templates/docTemplates/mergedPackingList';
import { renderMergedInspectionSummaryBody } from '../../templates/docTemplates/mergedInspectionSummary';
import { SERVER_DOC_TEMPLATES } from '../../templates/docTemplates/registry';

const EXPORTER = {
  nameEn: 'BAMBOOK TRADING CO., LTD.',
  addressEn: 'Shanghai, China',
};

function makeDocSet(shipmentNumber: string, overrides: Record<string, any> = {}) {
  return {
    ok: true,
    data: {
      shipment: {
        id: `SHP_${shipmentNumber}`, shipmentNumber, status: 'Shipped',
        vesselOrFlight: 'MSC ANNA', voyageNumber: '023W',
        portOfLoading: 'SHANGHAI', portOfDischarge: 'HAMBURG',
        containerNumber: 'MSCU1234567', sealNumber: 'S1234',
        totalPackages: 100, grossWeight: 1000, netWeight: 900, volume: 2.5,
        ...overrides.shipment,
      },
      order: { id: `ord_${shipmentNumber}`, poNumber: `PO-${shipmentNumber}`, customer: 'ACME', currency: 'USD' },
      customs: null,
      parties: {
        customer: { name: 'ACME GmbH' },
        consignee: { name: 'ACME GmbH', address: 'Hamburg, Germany' },
        carrier: { name: 'MSC' },
      },
      lines: [
        { lineNumber: 1, description: `Goods from ${shipmentNumber}`, quantity: 500, unit: 'PCS', cartons: 50, grossWeight: 500, netWeight: 450, volume: 1.25, amount: 5000 },
        { lineNumber: 2, description: `Extra from ${shipmentNumber}`, quantity: 100, unit: 'PCS', cartons: 50, grossWeight: 500, netWeight: 450, volume: 1.25, amount: 1000 },
      ],
      totals: { quantity: 600, amount: 6000, cartons: 100, grossWeight: 1000, netWeight: 900, volume: 2.5, currency: 'USD' },
      missing: overrides.missing ?? ['缺少毛重'],
      extras: {},
      ...overrides,
    },
  };
}

describe('assembleMergedDocumentSet', () => {
  it('≥2 校验：单运单 → 拒绝', async () => {
    await expect(assembleMergedDocumentSet({} as PrismaClient, ['SHP_1'])).rejects.toThrow('至少需要 2 个运单');
  });

  it('装配失败 fail-closed：任一运单失败整体失败', async () => {
    assembleMock.mockImplementation(async (prisma: any, id: string) => {
      if (id === 'SHP_BAD') return { ok: false, error: { code: 'SHIPMENT_NOT_FOUND', message: '运单不存在' } };
      return makeDocSet('OK');
    });
    await expect(assembleMergedDocumentSet({} as PrismaClient, ['SHP_OK', 'SHP_BAD']))
      .rejects.toThrow('装配失败');
  });

  it('两运单合并：lines 拼接 + shipmentIndex 标注 + totals 跨运单重算 + missing 去重', async () => {
    assembleMock.mockImplementation(async (_p: any, id: string) => makeDocSet(id));
    const merged = await assembleMergedDocumentSet({} as PrismaClient, ['SHP_A', 'SHP_B']);

    expect(merged.shipments).toHaveLength(2);
    expect(merged.shipments[0].shipmentNumber).toBe('SHP_A');
    expect(merged.lines).toHaveLength(4); // 2 运单 × 2 行
    expect(merged.lines[0].shipmentIndex).toBe(1);
    expect(merged.lines[2].shipmentIndex).toBe(2);
    // totals = 600×2 = 1200（行级求和跨运单）
    expect(merged.totals.quantity).toBe(1200);
    expect(merged.totals.amount).toBe(12000);
    expect(merged.totals.grossWeight).toBe(2000);
    expect(merged.totals.currency).toBe('USD');
    // parties 首个非空 + missing 去重
    expect(merged.parties.consignee?.name).toBe('ACME GmbH');
    expect(merged.missing).toEqual(['缺少毛重']);
  });
});

function makeInspectionData(reportId: string, result: string, overrides: Record<string, any> = {}) {
  return {
    report: {
      id: reportId, inspectionType: 'final', inspectionDate: '2026-08-20',
      inspectorOrg: 'SGS', aqlLevel: 'AQL 2.5', lotSize: 5000, sampleSize: 200,
      totalUnits: 200, passedUnits: 196, criticalDefects: 0, majorDefects: 1, minorDefects: 3,
      defectSummary: null, result, inspectedBy: 'QC Zhang', notes: null,
      qcSignedAt: '2026-08-21', businessSignedAt: null,
      ...overrides,
    },
    order: { poNumber: `PO-${reportId}`, customer: 'ACME', product: 'Shirt', quantity: 5000, dueDate: '2026-09-30' },
    locationName: 'Nantong QC Station',
  };
}

describe('loadMergedInspectionSummary', () => {
  it('≥2 校验：单报告 → 拒绝', async () => {
    await expect(loadMergedInspectionSummary({} as PrismaClient, ['INR__1'])).rejects.toThrow('至少需要 2 份报告');
  });

  it('报告不存在 fail-closed', async () => {
    inspectionLoadMock.mockResolvedValue(null);
    await expect(loadMergedInspectionSummary({} as PrismaClient, ['INR__1', 'INR__missing']))
      .rejects.toThrow('不存在');
  });

  it('三报告汇总：合计统计 + 结论分布 + fail 优先判定数据齐备', async () => {
    inspectionLoadMock.mockImplementation(async (_p: any, id: string) =>
      id === 'INR__fail'
        ? makeInspectionData(id, 'fail', { criticalDefects: 2, totalUnits: 200, passedUnits: 180 })
        : makeInspectionData(id, 'pass'),
    );
    const merged = await loadMergedInspectionSummary({} as PrismaClient, ['INR__1', 'INR__2', 'INR__fail']);

    expect(merged.reports).toHaveLength(3);
    expect(merged.summary.count).toBe(3);
    expect(merged.summary.totalUnits).toBe(600);    // 200×3
    expect(merged.summary.passedUnits).toBe(572);   // 196+196+180
    expect(merged.summary.failedUnits).toBe(28);
    expect(merged.summary.criticalDefects).toBe(2); // 0+0+2
    expect(merged.summary.majorDefects).toBe(3);    // 1×3
    expect(merged.summary.passCount).toBe(2);
    expect(merged.summary.failCount).toBe(1);
  });
});

describe('assembleCompositeDocument（统一入口）', () => {
  it('未知 kind → 拒绝；MERGED_PL/MERGED_IR 分发正确', async () => {
    await expect(assembleCompositeDocument({} as PrismaClient, { kind: 'NOPE' as any, sourceIds: ['a', 'b'] }))
      .rejects.toThrow('未知组合文档类型');

    assembleMock.mockImplementation(async (_p: any, id: string) => makeDocSet(id));
    const r1 = await assembleCompositeDocument({} as PrismaClient, { kind: 'MERGED_PL', sourceIds: ['SHP_A', 'SHP_B'] });
    expect(r1.kind).toBe('MERGED_PL');

    inspectionLoadMock.mockImplementation(async (_p: any, id: string) => makeInspectionData(id, 'pass'));
    const r2 = await assembleCompositeDocument({} as PrismaClient, { kind: 'MERGED_IR', sourceIds: ['INR__1', 'INR__2'] });
    expect(r2.kind).toBe('MERGED_IR');
  });

  it('isCompositeDocKind / registry 注册（MERGED_PL/MERGED_IR 已入注册表）', () => {
    expect(isCompositeDocKind('MERGED_PL')).toBe(true);
    expect(isCompositeDocKind('MERGED_IR')).toBe(true);
    expect(isCompositeDocKind('PL')).toBe(false);
    expect(SERVER_DOC_TEMPLATES.MERGED_PL.title).toContain('合并装箱单');
    expect(SERVER_DOC_TEMPLATES.MERGED_IR.title).toContain('合并验货汇总');
  });
});

describe('组合模板渲染', () => {
  it('合并装箱单：Consolidated 标识 + 运单一览 + 来源运单列 + 合计', () => {
    const data = {
      shipments: [
        { id: 'SHP_A', shipmentNumber: 'SHP-A', status: 'Shipped', vesselOrFlight: 'MSC ANNA', voyageNumber: null, portOfLoading: 'SHANGHAI', portOfDischarge: 'HAMBURG', containerNumber: null, sealNumber: null, totalPackages: 100, grossWeight: 1000, netWeight: 900, volume: 2.5 },
        { id: 'SHP_B', shipmentNumber: 'SHP-B', status: 'Shipped', vesselOrFlight: 'EVER GIVEN', voyageNumber: null, portOfLoading: 'NINGBO', portOfDischarge: 'ROTTERDAM', containerNumber: null, sealNumber: null, totalPackages: 80, grossWeight: 800, netWeight: 700, volume: 2.0 },
      ],
      orders: [
        { id: 'ord_A', poNumber: 'PO-A', customer: 'ACME' },
        { id: 'ord_B', poNumber: 'PO-B', customer: 'ACME' },
      ],
      parties: { customer: { name: 'ACME GmbH' }, consignee: { name: 'ACME GmbH', address: 'Hamburg' }, carrier: { name: 'MSC' } },
      lines: [
        { lineNumber: 1, shipmentIndex: 1, description: 'Shirts A', quantity: 500, unit: 'PCS', cartons: 50, grossWeight: 500, netWeight: 450, volume: 1.25 },
        { lineNumber: 1, shipmentIndex: 2, description: 'Shirts B', quantity: 300, unit: 'PCS', cartons: 30, grossWeight: 400, netWeight: 350, volume: 1.0 },
      ],
      totals: { quantity: 800, amount: null, cartons: 80, grossWeight: 900, netWeight: 800, volume: 2.25, currency: 'USD' },
      missing: ['缺少毛重'],
    };
    const html = renderMergedPackingListBody(data as any, EXPORTER);
    expect(html).toContain('PACKING LIST');
    expect(html).toContain('Consolidated · 2 Shipments 合并');
    expect(html).toContain('SHP-A');
    expect(html).toContain('SHP-B');
    expect(html).toContain('Shipments 运单一览（2）');
    expect(html).toContain('来源运单');
    expect(html).toContain('TOTAL 合计（2 运单）');
    expect(html).toContain('800');
    expect(html).toContain('缺少毛重');
  });

  it('合并验货汇总：整体结论（含 fail 优先）+ 跨报告合计 + 每报告一节', () => {
    const data = {
      reports: [makeInspectionData('INR__1', 'pass'), makeInspectionData('INR__2', 'fail', { criticalDefects: 2 })],
      summary: {
        count: 2, totalUnits: 400, passedUnits: 376, failedUnits: 24,
        criticalDefects: 2, majorDefects: 2, minorDefects: 6,
        passCount: 1, conditionalCount: 0, failCount: 1,
      },
    };
    const html = renderMergedInspectionSummaryBody(data as any, EXPORTER);
    expect(html).toContain('INSPECTION SUMMARY');
    expect(html).toContain('2 Reports 合并');
    expect(html).toContain('FAIL 不合格'); // failCount>0 → 整体 FAIL
    expect(html).toContain('跨报告合计');
    expect(html).toContain('Report 1');
    expect(html).toContain('Report 2');
    expect(html).toContain('PASS');
    expect(html).toContain('Signed 2026-08-21');
    expect(html).toContain('Pending');
  });
});
