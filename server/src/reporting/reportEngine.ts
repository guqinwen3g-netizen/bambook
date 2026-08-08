/**
 * A5 报表引擎 — 白名单校验 + 聚合执行 + CSV 导出
 *
 * 不变量：
 *   1. 所有字段名校验 fail closed —— 未知 datasetKey / 维度 / 指标 / 过滤字段直接拒绝，
 *      客户端无法注入任意 Prisma 查询。
 *   2. 软删过滤 deletedAt: null 由引擎统一注入，调用方不可关闭。
 *   3. count 之外的所有聚合只作用于数据集声明的数值指标字段。
 *   4. 结果行数受调用方 limit 约束（预览 500 / 运行快照 5000），引擎不假设无界。
 */

import { PrismaClient } from '@prisma/client';
import { DatasetSpec, ReportFieldSpec, getDataset } from './datasets';

// ────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────

export type MetricAgg = 'sum' | 'avg' | 'min' | 'max' | 'count';
export const METRIC_AGGS: readonly MetricAgg[] = ['sum', 'avg', 'min', 'max', 'count'];

export interface MetricSpec {
  field: string; // 数值指标字段；agg=count 时可用 '*' 表示行数
  agg: MetricAgg;
}

export type FilterOp = 'eq' | 'ne' | 'in' | 'gte' | 'lte' | 'contains';
export const FILTER_OPS: readonly FilterOp[] = ['eq', 'ne', 'in', 'gte', 'lte', 'contains'];

export interface FilterSpec {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface ReportQuerySpec {
  datasetKey: string;
  dimensions: string[];
  metrics: MetricSpec[];
  filters: FilterSpec[];
}

export interface ReportQueryResult {
  columns: string[];
  /** 展示用表头标签（与 columns 同序） */
  columnLabels: string[];
  rows: Array<Record<string, string | number | null>>;
}

export type ValidateResult =
  | { ok: true; spec: ReportQuerySpec; dataset: DatasetSpec }
  | { ok: false; error: { code: string; message: string } };

const MAX_DIMENSIONS = 6;
const MAX_METRICS = 10;
const MAX_FILTERS = 12;
const MAX_STRING_VALUE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ────────────────────────────────────────────────────────────────
// 1. 白名单校验（fail closed）
// ────────────────────────────────────────────────────────────────

function fieldAllowedOps(f: ReportFieldSpec): readonly FilterOp[] {
  switch (f.type) {
    case 'number':
    case 'date':
      return ['eq', 'ne', 'gte', 'lte'];
    case 'enum':
      return ['eq', 'ne', 'in'];
    default:
      return ['eq', 'ne', 'in', 'contains'];
  }
}

function validateFilterValue(f: ReportFieldSpec, op: FilterOp, value: unknown): string | null {
  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
      return `filter ${f.key}: 'in' requires a non-empty array (≤50)`;
    }
    for (const v of value) {
      if (typeof v !== 'string' || v.length > MAX_STRING_VALUE) {
        return `filter ${f.key}: 'in' values must be strings ≤${MAX_STRING_VALUE} chars`;
      }
    }
    if (f.type === 'enum' && f.enumValues) {
      for (const v of value) {
        if (!f.enumValues.includes(v as string)) return `filter ${f.key}: value '${v}' not in enum`;
      }
    }
    return null;
  }
  switch (f.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `filter ${f.key}: requires finite number`;
      return null;
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value)) return `filter ${f.key}: requires YYYY-MM-DD`;
      return null;
    default:
      if (typeof value !== 'string' || value.length > MAX_STRING_VALUE) {
        return `filter ${f.key}: requires string ≤${MAX_STRING_VALUE} chars`;
      }
      if (f.type === 'enum' && f.enumValues && !f.enumValues.includes(value)) {
        return `filter ${f.key}: value '${value}' not in enum`;
      }
      return null;
  }
}

export function validateReportQuery(input: unknown): ValidateResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'query must be an object' } };
  }
  const body = input as Record<string, unknown>;

  // dataset
  const datasetKey = typeof body.datasetKey === 'string' ? body.datasetKey.trim() : '';
  const dataset = datasetKey ? getDataset(datasetKey) : undefined;
  if (!dataset) {
    return { ok: false, error: { code: 'UNKNOWN_DATASET', message: `unknown datasetKey: ${datasetKey || '(empty)'}` } };
  }

  // dimensions
  const rawDims = body.dimensions ?? [];
  if (!Array.isArray(rawDims) || rawDims.length > MAX_DIMENSIONS) {
    return { ok: false, error: { code: 'INVALID_DIMENSIONS', message: `dimensions must be an array (≤${MAX_DIMENSIONS})` } };
  }
  const dimKeys = new Set(dataset.dimensions.map(f => f.key));
  const dimensions: string[] = [];
  for (const d of rawDims) {
    if (typeof d !== 'string' || !dimKeys.has(d)) {
      return { ok: false, error: { code: 'UNKNOWN_DIMENSION', message: `dimension not allowed: ${String(d)}` } };
    }
    if (!dimensions.includes(d)) dimensions.push(d);
  }

  // metrics
  const rawMetrics = body.metrics;
  if (!Array.isArray(rawMetrics) || rawMetrics.length === 0 || rawMetrics.length > MAX_METRICS) {
    return { ok: false, error: { code: 'INVALID_METRICS', message: `metrics must be a non-empty array (≤${MAX_METRICS})` } };
  }
  const metricKeys = new Set(dataset.metrics.map(f => f.key));
  const metrics: MetricSpec[] = [];
  for (const m of rawMetrics) {
    if (!m || typeof m !== 'object') {
      return { ok: false, error: { code: 'INVALID_METRIC', message: 'metric must be { field, agg }' } };
    }
    const { field, agg } = m as Record<string, unknown>;
    if (typeof agg !== 'string' || !METRIC_AGGS.includes(agg as MetricAgg)) {
      return { ok: false, error: { code: 'INVALID_AGG', message: `agg not allowed: ${String(agg)}` } };
    }
    if (typeof field !== 'string' || (field !== '*' && !metricKeys.has(field))) {
      return { ok: false, error: { code: 'UNKNOWN_METRIC', message: `metric field not allowed: ${String(field)}` } };
    }
    if (agg !== 'count' && field === '*') {
      return { ok: false, error: { code: 'INVALID_METRIC', message: "'*' only valid with agg=count" } };
    }
    metrics.push({ field, agg: agg as MetricAgg });
  }

  // filters
  const rawFilters = body.filters ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > MAX_FILTERS) {
    return { ok: false, error: { code: 'INVALID_FILTERS', message: `filters must be an array (≤${MAX_FILTERS})` } };
  }
  const filterMap = new Map(dataset.filterFields.map(f => [f.key, f]));
  const filters: FilterSpec[] = [];
  for (const f of rawFilters) {
    if (!f || typeof f !== 'object') {
      return { ok: false, error: { code: 'INVALID_FILTER', message: 'filter must be { field, op, value }' } };
    }
    const { field, op, value } = f as Record<string, unknown>;
    const spec = typeof field === 'string' ? filterMap.get(field) : undefined;
    if (!spec) {
      return { ok: false, error: { code: 'UNKNOWN_FILTER_FIELD', message: `filter field not allowed: ${String(field)}` } };
    }
    if (typeof op !== 'string' || !FILTER_OPS.includes(op as FilterOp)) {
      return { ok: false, error: { code: 'INVALID_FILTER_OP', message: `filter op not allowed: ${String(op)}` } };
    }
    if (!fieldAllowedOps(spec).includes(op as FilterOp)) {
      return { ok: false, error: { code: 'INVALID_FILTER_OP', message: `op '${op}' not allowed for ${spec.type} field ${spec.key}` } };
    }
    const valueError = validateFilterValue(spec, op as FilterOp, value);
    if (valueError) {
      return { ok: false, error: { code: 'INVALID_FILTER_VALUE', message: valueError } };
    }
    filters.push({ field: spec.key, op: op as FilterOp, value });
  }

  return { ok: true, spec: { datasetKey: dataset.key, dimensions, metrics, filters }, dataset };
}

// ────────────────────────────────────────────────────────────────
// 2. 聚合执行
// ────────────────────────────────────────────────────────────────

export function metricColumn(m: MetricSpec): string {
  return `${m.agg}(${m.field})`;
}

function buildWhere(filters: FilterSpec[]): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null };
  for (const f of filters) {
    let cond: unknown;
    switch (f.op) {
      case 'eq': cond = { equals: f.value }; break;
      case 'ne': cond = { not: f.value }; break;
      case 'in': cond = { in: f.value }; break;
      case 'gte': cond = { gte: f.value }; break;
      case 'lte': cond = { lte: f.value }; break;
      case 'contains': cond = { contains: f.value }; break;
    }
    // 同字段多条件合并（如日期区间 gte+lte）
    if (where[f.field] && typeof where[f.field] === 'object' && cond && typeof cond === 'object') {
      where[f.field] = { ...(where[f.field] as object), ...(cond as object) };
    } else {
      where[f.field] = cond;
    }
  }
  return where;
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function extractMetricValue(row: any, m: MetricSpec): number | null {
  if (m.agg === 'count') {
    const c = row?._count;
    if (m.field === '*') return toNumberOrNull(typeof c === 'number' ? c : c?._all);
    return toNumberOrNull(c?.[m.field]);
  }
  return toNumberOrNull(row?.[`_${m.agg}`]?.[m.field]);
}

function dimensionLabel(dataset: DatasetSpec, key: string): string {
  return dataset.dimensions.find(f => f.key === key)?.label ?? key;
}

function metricLabel(dataset: DatasetSpec, m: MetricSpec): string {
  if (m.field === '*') return '行数';
  const label = dataset.metrics.find(f => f.key === m.field)?.label ?? m.field;
  const aggLabel: Record<MetricAgg, string> = { sum: '合计', avg: '均值', min: '最小', max: '最大', count: '计数' };
  return `${label}(${aggLabel[m.agg]})`;
}

/**
 * 执行报表查询。调用方必须先通过 validateReportQuery。
 * @param limit 结果行数上限（由调用方按场景约束：预览 500 / 运行快照 5000）
 */
export async function executeReportQuery(
  prisma: PrismaClient,
  dataset: DatasetSpec,
  spec: ReportQuerySpec,
  limit: number,
): Promise<ReportQueryResult> {
  const delegate = (prisma as any)[dataset.prismaModel];
  if (!delegate) {
    throw new Error(`dataset model not available on prisma client: ${dataset.prismaModel}`);
  }
  const where = buildWhere(spec.filters);
  const columns = [...spec.dimensions, ...spec.metrics.map(metricColumn)];
  const columnLabels = [
    ...spec.dimensions.map(d => dimensionLabel(dataset, d)),
    ...spec.metrics.map(m => metricLabel(dataset, m)),
  ];

  // 无维度 → 全表聚合单行（groupBy 的 by 不允许为空数组，走 aggregate）
  if (spec.dimensions.length === 0) {
    const args: Record<string, unknown> = { where };
    for (const m of spec.metrics) {
      if (m.agg === 'count') {
        args._count = m.field === '*' ? { _all: true } : { ...(args._count as object), [m.field]: true };
      } else {
        const key = `_${m.agg}`;
        args[key] = { ...((args[key] as object) ?? {}), [m.field]: true };
      }
    }
    const agg = await delegate.aggregate(args);
    const row: Record<string, string | number | null> = {};
    for (const m of spec.metrics) row[metricColumn(m)] = extractMetricValue(agg, m);
    return { columns, columnLabels, rows: [row] };
  }

  const groupArgs: Record<string, unknown> = {
    by: spec.dimensions,
    where,
    orderBy: spec.dimensions.map(d => ({ [d]: 'asc' })),
    take: limit,
  };
  for (const m of spec.metrics) {
    if (m.agg === 'count') {
      groupArgs._count = m.field === '*' ? { _all: true } : { ...((groupArgs._count as object) ?? {}), [m.field]: true };
    } else {
      const key = `_${m.agg}`;
      groupArgs[key] = { ...((groupArgs[key] as object) ?? {}), [m.field]: true };
    }
  }
  const results: any[] = await delegate.groupBy(groupArgs);

  const rows = results.map(r => {
    const row: Record<string, string | number | null> = {};
    for (const d of spec.dimensions) {
      const v = r[d];
      row[d] = v === null || v === undefined ? null : String(v);
    }
    for (const m of spec.metrics) row[metricColumn(m)] = extractMetricValue(r, m);
    return row;
  });
  return { columns, columnLabels, rows };
}

// ────────────────────────────────────────────────────────────────
// 3. CSV 导出（重放运行快照，不重查）
// ────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(columnLabels: string[], columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columnLabels.map(csvCell).join(',');
  const body = rows.map(r => columns.map(c => csvCell(r[c])).join(','));
  // BOM 让 Excel 正确识别 UTF-8 中文
  return `﻿${[header, ...body].join('\n')}`;
}

// ────────────────────────────────────────────────────────────────
// 4. 调度周期键（幂等键组成：definitionId:periodKey）
// ────────────────────────────────────────────────────────────────

export type ReportSchedule = 'daily' | 'weekly' | 'monthly';
export const REPORT_SCHEDULES: readonly ReportSchedule[] = ['daily', 'weekly', 'monthly'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO 8601 周 + 周所属年（周四所在年；年界同周必须同键，保证调度幂等） */
export function isoWeekAndYear(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 本周周四
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

export function periodKeyFor(schedule: ReportSchedule, now: Date): string {
  switch (schedule) {
    case 'daily':
      return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    case 'weekly': {
      const { year, week } = isoWeekAndYear(now);
      return `${year}-W${pad2(week)}`;
    }
    case 'monthly':
      return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }
}
