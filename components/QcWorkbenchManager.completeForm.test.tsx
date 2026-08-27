/**
 * D7 QC 完成任务录验货数据（QcWorkbenchManager · CompleteAssignmentForm）
 *
 * 验收口径：
 *   - 完成任务弹窗含验货数据表单：合格率（总数/合格数自动算）/ 三类疵点 / AQL
 *   - buildBulkReportPayload：校验规则（总数>0、0≤合格数≤总数、疵点>=0 整数）+ 归一
 *   - 提交契约：POST /v1/qc/assignments/:id/complete { reportId, report }
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBulkReportPayload, EMPTY_BULK_REPORT_FORM } from './QcWorkbenchManager';

const source = readFileSync(new URL('./QcWorkbenchManager.tsx', import.meta.url), 'utf8');

const VALID_FORM = {
  ...EMPTY_BULK_REPORT_FORM,
  result: 'pass' as const,
  inspectionDate: '2026-08-28',
  totalUnits: '500',
  passedUnits: '490',
  aqlLevel: '2.5/4.0 II',
  criticalDefects: '0',
  majorDefects: '2',
  minorDefects: '8',
  defectSummary: '跳线x2',
};

describe('D7 · buildBulkReportPayload 校验与归一', () => {
  it('合法表单 → 归一为后端 BulkReportInput（数量整数化，空可选字段省略）', () => {
    const r = buildBulkReportPayload(VALID_FORM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report).toEqual({
      result: 'pass',
      inspectionDate: '2026-08-28',
      totalUnits: 500,
      passedUnits: 490,
      aqlLevel: '2.5/4.0 II',
      criticalDefects: 0,
      majorDefects: 2,
      minorDefects: 8,
      defectSummary: '跳线x2',
    });
    // 批量/抽样未填 → 不出现在载荷中
    expect('lotSize' in r.report).toBe(false);
    expect('sampleSize' in r.report).toBe(false);
  });

  it('检验总数缺失/非正 → 拦截', () => {
    expect(buildBulkReportPayload({ ...VALID_FORM, totalUnits: '' }).ok).toBe(false);
    expect(buildBulkReportPayload({ ...VALID_FORM, totalUnits: '0' }).ok).toBe(false);
    expect(buildBulkReportPayload({ ...VALID_FORM, totalUnits: '10.5' }).ok).toBe(false);
  });

  it('合格数越界（>总数 或 <0）→ 拦截（合格率口径防呆）', () => {
    expect(buildBulkReportPayload({ ...VALID_FORM, passedUnits: '501' }).ok).toBe(false);
    expect(buildBulkReportPayload({ ...VALID_FORM, passedUnits: '-1' }).ok).toBe(false);
  });

  it('疵点必须 >=0 整数；批量/抽样填了必须 >=0 整数', () => {
    expect(buildBulkReportPayload({ ...VALID_FORM, criticalDefects: '-1' }).ok).toBe(false);
    expect(buildBulkReportPayload({ ...VALID_FORM, majorDefects: '1.5' }).ok).toBe(false);
    expect(buildBulkReportPayload({ ...VALID_FORM, lotSize: '-5' }).ok).toBe(false);
    const withLot = buildBulkReportPayload({ ...VALID_FORM, lotSize: '500', sampleSize: '32' });
    expect(withLot.ok).toBe(true);
    if (withLot.ok) {
      expect(withLot.report.lotSize).toBe(500);
      expect(withLot.report.sampleSize).toBe(32);
    }
  });
});

describe('D7 · 完成任务表单验货数据（源码契约）', () => {
  it('表单含合格率/三类疵点/AQL 字段，合格率自动计算只读展示', () => {
    expect(source).toContain('检验总数 *');
    expect(source).toContain('合格数 *');
    expect(source).toContain('合格率（自动）');
    expect(source).toContain('致命疵点');
    expect(source).toContain('严重疵点');
    expect(source).toContain('轻微疵点');
    expect(source).toContain('AQL 等级');
    expect(source).toContain('`${((passedNum / totalNum) * 100).toFixed(1)}%`');
  });

  it('提交契约：POST /v1/qc/assignments/:id/complete 携带 report；录入 ⇄ 关联既有报告二选一', () => {
    expect(source).toContain('`/v1/qc/assignments/${encodeURIComponent(id)}/complete`');
    expect(source).toContain('body: JSON.stringify({ reportId: payload.reportId ?? null, ...(payload.report ? { report: payload.report } : {}) })');
    expect(source).toContain('录入验货数据，随完成生成大货验货报告');
    expect(source).toContain("onSave({ report: built.report });");
    expect(source).toContain("onSave({ reportId: reportId.trim() || undefined });");
  });
});
