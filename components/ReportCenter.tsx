/**
 * 报表中心 ReportCenter（阶段 A5 报表引擎前端）
 *
 * 功能：
 *   1. 设计器 Designer — 数据集选择 → 维度/指标/过滤配置 → 临时预览（≤500 行）→ 保存为报表定义
 *   2. 我的报表 Saved — 定义列表：启停开关 / 定时周期 / 立即运行 / 编辑（载入设计器）/ 删除
 *   3. 运行历史 Runs — 运行记录：状态 / 触发方式 / 行数 / 耗时，展开查看快照结果，导出 CSV
 *
 * 设计原则：
 *   - 所有字段元数据来自服务端数据集注册表（/datasets），前端不硬编码字段清单
 *   - 聚合口径以后端为准，前端不做任何数值计算（仅展示）
 *   - RDL flat 设计：statusSemanticClass 语义色 + 大圆角 + 无阴影
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Play,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  X,
  Download,
  ChevronDown,
  ChevronRight,
  Save,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import { statusSemanticClass, StatusSemantic } from './rdlBusinessStatusTokens';
import {
  reportService,
  ReportDatasetSpec,
  ReportDefinition,
  ReportFieldSpec,
  ReportFilterOp,
  ReportFilterSpec,
  ReportMetricAgg,
  ReportMetricSpec,
  ReportPreviewResult,
  ReportRun,
  ReportSchedule,
} from '../services/reportService';

// ==================== 常量 ====================

type ModuleTab = 'designer' | 'saved' | 'runs';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'designer', label: '报表设计器 Designer', icon: BarChart3 },
  { id: 'saved', label: '我的报表 Saved', icon: Save },
  { id: 'runs', label: '运行历史 Runs', icon: Play },
];

const AGG_LABELS: Record<ReportMetricAgg, string> = {
  sum: '合计',
  avg: '均值',
  min: '最小',
  max: '最大',
  count: '计数',
};

const OP_LABELS: Record<ReportFilterOp, string> = {
  eq: '等于',
  ne: '不等于',
  in: '属于(逗号分隔)',
  gte: '≥',
  lte: '≤',
  contains: '包含',
};

const SCHEDULE_LABELS: Record<ReportSchedule, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

const RUN_STATUS_LABELS: Record<ReportRun['status'], string> = {
  Running: '运行中',
  Success: '成功',
  Failed: '失败',
};

const RUN_STATUS_SEMANTIC: Record<ReportRun['status'], StatusSemantic> = {
  Running: 'info',
  Success: 'success',
  Failed: 'danger',
};

const TRIGGER_LABELS: Record<ReportRun['trigger'], string> = {
  manual: '手动',
  schedule: '定时',
};

/** 与引擎 fieldAllowedOps 一致（客户端仅做引导，服务端 fail closed 兜底） */
function opsForField(f: ReportFieldSpec): ReportFilterOp[] {
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

function formatTs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatCell(v: string | number | null): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  }
  return v || '—';
}

/** 过滤值 UI 字符串 → 引擎值（number 转数值，in 拆数组） */
function parseFilterValue(field: ReportFieldSpec, op: ReportFilterOp, raw: string): unknown {
  if (op === 'in') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

interface DesignerState {
  editingId: string | null;
  name: string;
  description: string;
  datasetKey: string;
  dimensions: string[];
  metrics: ReportMetricSpec[];
  filters: Array<{ field: string; op: ReportFilterOp; value: string }>;
  schedule: '' | ReportSchedule;
}

const EMPTY_DESIGNER: DesignerState = {
  editingId: null,
  name: '',
  description: '',
  datasetKey: '',
  dimensions: [],
  metrics: [],
  filters: [],
  schedule: '',
};

// ==================== 主组件 ====================

interface ReportCenterProps {
  isDarkMode?: boolean;
}

export default function ReportCenter({ isDarkMode = false }: ReportCenterProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('designer');
  const [datasets, setDatasets] = useState<ReportDatasetSpec[]>([]);
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [designer, setDesigner] = useState<DesignerState>(EMPTY_DESIGNER);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── 主题样式（与 CustomsManager 同一 token 口径） ──
  const cardClass = isDarkMode
    ? 'rounded-card border border-white/[0.055] bg-white/[0.018]'
    : 'rounded-card border border-white/45 bg-white/24';
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;
  const textSecondary = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const tabBtnCls = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-light inline-flex items-center gap-1.5 transition-colors ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-white'
        : isDarkMode
        ? 'bg-white/5 text-slate-400 hover:bg-white/10'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;
  const chipCls = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-light transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-white'
        : isDarkMode
        ? 'bg-white/5 text-slate-400 hover:bg-white/10'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  // ── 数据加载 ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ds, defs, rs] = await Promise.all([
        reportService.listDatasets(),
        reportService.listDefinitions(),
        reportService.listRuns(undefined, 100),
      ]);
      setDatasets(ds);
      setDefinitions(defs);
      setRuns(rs);
      setDesigner(prev => (prev.datasetKey || ds.length === 0 ? prev : { ...prev, datasetKey: ds[0].key }));
    } catch (e: any) {
      setError(`加载失败：${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const dataset = useMemo(
    () => datasets.find(d => d.key === designer.datasetKey),
    [datasets, designer.datasetKey],
  );

  // ── 设计器操作 ──
  const handleEditDefinition = useCallback((def: ReportDefinition) => {
    setDesigner({
      editingId: def.id,
      name: def.name,
      description: def.description ?? '',
      datasetKey: def.datasetKey,
      dimensions: [...def.dimensions],
      metrics: def.metrics.map(m => ({ ...m })),
      filters: (def.filters ?? []).map(f => ({
        field: f.field,
        op: f.op,
        value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? ''),
      })),
      schedule: def.schedule ?? '',
    });
    setActiveTab('designer');
  }, []);

  const handleDeleteDefinition = useCallback(async (def: ReportDefinition) => {
    if (!window.confirm(`确认删除报表「${def.name}」？历史运行记录将保留。`)) return;
    setActionLoading(`del_${def.id}`);
    try {
      await reportService.deleteDefinition(def.id);
      setDefinitions(prev => prev.filter(d => d.id !== def.id));
    } catch (e: any) {
      setError(`删除失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleToggleEnabled = useCallback(async (def: ReportDefinition) => {
    setActionLoading(`toggle_${def.id}`);
    try {
      const updated = await reportService.updateDefinition(def.id, { enabled: !def.enabled });
      setDefinitions(prev => prev.map(d => (d.id === def.id ? updated : d)));
    } catch (e: any) {
      setError(`更新失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleRunDefinition = useCallback(async (def: ReportDefinition) => {
    setActionLoading(`run_${def.id}`);
    setError(null);
    try {
      await reportService.runDefinition(def.id);
      const [defs, rs] = await Promise.all([
        reportService.listDefinitions(),
        reportService.listRuns(undefined, 100),
      ]);
      setDefinitions(defs);
      setRuns(rs);
    } catch (e: any) {
      setError(`运行失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PageHeader
        title="报表中心"
        subtitle="Report Center"
        contextLabel="Analytics"
        isDarkMode={isDarkMode}
        actions={
          <button
            onClick={fetchAll}
            className="h-8 px-4 rounded-full border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={13} /><span>刷新</span>
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col px-7 pb-6 pt-2">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* Tab 导航 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {MODULE_TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} className={tabBtnCls(activeTab === t.id)}>
                  <Icon size={12} /><span>{t.label}</span>
                  {t.id === 'saved' && definitions.length > 0 && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'saved' ? 'bg-white/20' : isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`}>{definitions.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 错误横幅 */}
          {error && (
            <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 opacity-60 hover:opacity-100"><X size={13} /></button>
            </div>
          )}

          {loading ? (
            <div className={`flex items-center justify-center gap-2 py-16 text-sm ${textSecondary}`}>
              <Loader2 size={16} className="animate-spin" />加载报表元数据…
            </div>
          ) : (
            <>
              {activeTab === 'designer' && (
                <DesignerPanel
                  isDarkMode={isDarkMode}
                  datasets={datasets}
                  dataset={dataset}
                  designer={designer}
                  setDesigner={setDesigner}
                  cardClass={cardClass}
                  fieldClass={fieldClass}
                  labelClass={labelClass}
                  chipCls={chipCls}
                  textSecondary={textSecondary}
                  onSaved={(def, isNew) => {
                    setDefinitions(prev => (isNew ? [def, ...prev] : prev.map(d => (d.id === def.id ? def : d))));
                    setDesigner(prev => ({ ...EMPTY_DESIGNER, datasetKey: prev.datasetKey }));
                  }}
                  onError={setError}
                />
              )}
              {activeTab === 'saved' && (
                <SavedPanel
                  isDarkMode={isDarkMode}
                  definitions={definitions}
                  datasets={datasets}
                  cardClass={cardClass}
                  textSecondary={textSecondary}
                  actionLoading={actionLoading}
                  onEdit={handleEditDefinition}
                  onDelete={handleDeleteDefinition}
                  onToggleEnabled={handleToggleEnabled}
                  onRun={handleRunDefinition}
                  onNewReport={() => { setDesigner(prev => ({ ...EMPTY_DESIGNER, datasetKey: prev.datasetKey || datasets[0]?.key || '' })); setActiveTab('designer'); }}
                />
              )}
              {activeTab === 'runs' && (
                <RunsPanel
                  isDarkMode={isDarkMode}
                  runs={runs}
                  definitions={definitions}
                  cardClass={cardClass}
                  fieldClass={fieldClass}
                  textSecondary={textSecondary}
                  onRefresh={async (definitionId) => {
                    setRuns(await reportService.listRuns(definitionId || undefined, 100));
                  }}
                  onError={setError}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 设计器 Panel ====================

interface DesignerPanelProps {
  isDarkMode: boolean;
  datasets: ReportDatasetSpec[];
  dataset?: ReportDatasetSpec;
  designer: DesignerState;
  setDesigner: React.Dispatch<React.SetStateAction<DesignerState>>;
  cardClass: string;
  fieldClass: string;
  labelClass: string;
  chipCls: (active: boolean) => string;
  textSecondary: string;
  onSaved: (def: ReportDefinition, isNew: boolean) => void;
  onError: (msg: string | null) => void;
}

function DesignerPanel(props: DesignerPanelProps) {
  const { isDarkMode, datasets, dataset, designer, setDesigner, cardClass, fieldClass, labelClass, chipCls, textSecondary, onSaved, onError } = props;
  const [preview, setPreview] = useState<ReportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildQueryInput = useCallback(() => ({
    datasetKey: designer.datasetKey,
    dimensions: designer.dimensions,
    metrics: designer.metrics,
    filters: designer.filters
      .filter(f => f.field && f.value.trim() !== '')
      .map(f => {
        const spec = dataset?.filterFields.find(ff => ff.key === f.field);
        return {
          field: f.field,
          op: f.op,
          value: spec ? parseFilterValue(spec, f.op, f.value) : f.value,
        } as ReportFilterSpec;
      }),
  }), [designer, dataset]);

  const handlePreview = useCallback(async () => {
    if (designer.metrics.length === 0) {
      onError('请至少添加一个指标');
      return;
    }
    setPreviewLoading(true);
    onError(null);
    try {
      const result = await reportService.preview(buildQueryInput());
      setPreview(result);
    } catch (e: any) {
      onError(`预览失败：${e?.message || e}`);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [buildQueryInput, designer.metrics.length, onError]);

  const handleSave = useCallback(async () => {
    if (!designer.name.trim()) {
      onError('请填写报表名称');
      return;
    }
    if (designer.metrics.length === 0) {
      onError('请至少添加一个指标');
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const input = {
        name: designer.name.trim(),
        description: designer.description.trim() || undefined,
        ...buildQueryInput(),
        schedule: designer.schedule || null,
      };
      const isNew = !designer.editingId;
      const saved = designer.editingId
        ? await reportService.updateDefinition(designer.editingId, input)
        : await reportService.createDefinition(input);
      onSaved(saved, isNew);
      setPreview(null);
    } catch (e: any) {
      onError(`保存失败：${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [designer, buildQueryInput, onSaved, onError]);

  const toggleDimension = (key: string) => {
    setDesigner(prev => ({
      ...prev,
      dimensions: prev.dimensions.includes(key)
        ? prev.dimensions.filter(d => d !== key)
        : [...prev.dimensions, key],
    }));
  };

  const addMetric = () => {
    if (!dataset || dataset.metrics.length === 0) return;
    setDesigner(prev => ({ ...prev, metrics: [...prev.metrics, { field: dataset.metrics[0].key, agg: 'sum' }] }));
  };

  const addFilter = () => {
    if (!dataset || dataset.filterFields.length === 0) return;
    const first = dataset.filterFields[0];
    setDesigner(prev => ({ ...prev, filters: [...prev.filters, { field: first.key, op: opsForField(first)[0], value: '' }] }));
  };

  return (
    <div className="space-y-4">
      {/* 数据集 + 名称 */}
      <div className={`${cardClass} p-4`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>数据集 *</label>
            <select
              value={designer.datasetKey}
              onChange={e => setDesigner(prev => ({ ...prev, datasetKey: e.target.value, dimensions: [], metrics: [], filters: [] }))}
              className={fieldClass}
              disabled={Boolean(designer.editingId)}
            >
              {datasets.map(d => <option key={d.key} value={d.key}>{d.label}{d.description ? ` · ${d.description}` : ''}</option>)}
            </select>
            {designer.editingId && (
              <div className={`mt-1 text-[10px] ${textSecondary}`}>编辑模式下数据集不可变更（维度口径已固化）</div>
            )}
          </div>
          <div>
            <label className={labelClass}>报表名称（保存时必填）</label>
            <input
              type="text"
              value={designer.name}
              onChange={e => setDesigner(prev => ({ ...prev, name: e.target.value }))}
              placeholder="如：月度应收汇总"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>定时调度</label>
            <select
              value={designer.schedule}
              onChange={e => setDesigner(prev => ({ ...prev, schedule: e.target.value as DesignerState['schedule'] }))}
              className={fieldClass}
            >
              <option value="">仅手动运行</option>
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>
        </div>
      </div>

      {/* 维度 */}
      {dataset && (
        <div className={`${cardClass} p-4`}>
          <div className={`text-xs mb-2 ${textSecondary}`}>分组维度（点击切换，≤6 个）</div>
          <div className="flex flex-wrap gap-1.5">
            {dataset.dimensions.map(d => (
              <button key={d.key} onClick={() => toggleDimension(d.key)} className={chipCls(designer.dimensions.includes(d.key))}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 指标 */}
      {dataset && (
        <div className={`${cardClass} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-xs ${textSecondary}`}>聚合指标 *</div>
            <button onClick={addMetric} className={`text-[11px] inline-flex items-center gap-1 ${isDarkMode ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Plus size={12} />添加指标
            </button>
          </div>
          <div className="space-y-2">
            {designer.metrics.map((m, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={m.field}
                  onChange={e => setDesigner(prev => ({
                    ...prev,
                    metrics: prev.metrics.map((x, i) => (i === idx ? { ...x, field: e.target.value } : x)),
                  }))}
                  className={`${fieldClass} flex-1`}
                >
                  {dataset.metrics.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  {m.agg === 'count' && <option value="*">行数 (*)</option>}
                </select>
                <select
                  value={m.agg}
                  onChange={e => {
                    const agg = e.target.value as ReportMetricAgg;
                    setDesigner(prev => ({
                      ...prev,
                      metrics: prev.metrics.map((x, i) => {
                        if (i !== idx) return x;
                        // count 允许选 '*';其他 agg 不允许
                        const field = agg === 'count' ? x.field : (x.field === '*' ? dataset.metrics[0].key : x.field);
                        return { ...x, agg, field };
                      }),
                    }));
                  }}
                  className={`${fieldClass} w-28`}
                >
                  {(Object.keys(AGG_LABELS) as ReportMetricAgg[]).map(a => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
                </select>
                <button
                  onClick={() => setDesigner(prev => ({ ...prev, metrics: prev.metrics.filter((_, i) => i !== idx) }))}
                  className={`p-1.5 rounded-control ${isDarkMode ? 'hover:bg-white/10 text-slate-500' : 'hover:bg-slate-100 text-slate-400'}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {designer.metrics.length === 0 && (
              <div className={`text-[11px] ${textSecondary}`}>尚未添加指标 — 点击「添加指标」选择要聚合的数值字段</div>
            )}
          </div>
        </div>
      )}

      {/* 过滤器 */}
      {dataset && (
        <div className={`${cardClass} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-xs ${textSecondary}`}>过滤条件（可选，≤12 个）</div>
            <button onClick={addFilter} className={`text-[11px] inline-flex items-center gap-1 ${isDarkMode ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Plus size={12} />添加条件
            </button>
          </div>
          <div className="space-y-2">
            {designer.filters.map((f, idx) => {
              const spec = dataset.filterFields.find(ff => ff.key === f.field);
              const ops = spec ? opsForField(spec) : [];
              return (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={f.field}
                    onChange={e => {
                      const next = dataset.filterFields.find(ff => ff.key === e.target.value);
                      setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx && next ? { field: next.key, op: opsForField(next)[0], value: '' } : x)),
                      }));
                    }}
                    className={`${fieldClass} flex-1`}
                  >
                    {dataset.filterFields.map(ff => <option key={ff.key} value={ff.key}>{ff.label}</option>)}
                  </select>
                  <select
                    value={f.op}
                    onChange={e => setDesigner(prev => ({
                      ...prev,
                      filters: prev.filters.map((x, i) => (i === idx ? { ...x, op: e.target.value as ReportFilterOp } : x)),
                    }))}
                    className={`${fieldClass} w-32`}
                  >
                    {ops.map(op => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
                  </select>
                  {spec?.type === 'enum' && spec.enumValues && f.op !== 'in' ? (
                    <select
                      value={f.value}
                      onChange={e => setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)),
                      }))}
                      className={`${fieldClass} flex-1`}
                    >
                      <option value="">请选择</option>
                      {spec.enumValues.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input
                      type={spec?.type === 'date' ? 'date' : spec?.type === 'number' ? 'number' : 'text'}
                      value={f.value}
                      onChange={e => setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)),
                      }))}
                      placeholder={f.op === 'in' ? '值1, 值2, …' : '过滤值'}
                      className={`${fieldClass} flex-1`}
                    />
                  )}
                  <button
                    onClick={() => setDesigner(prev => ({ ...prev, filters: prev.filters.filter((_, i) => i !== idx) }))}
                    className={`p-1.5 rounded-control ${isDarkMode ? 'hover:bg-white/10 text-slate-500' : 'hover:bg-slate-100 text-slate-400'}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {designer.filters.length === 0 && (
              <div className={`text-[11px] ${textSecondary}`}>无过滤条件 — 默认统计全部未删除记录</div>
            )}
          </div>
        </div>
      )}

      {/* 操作栏 */}
      {dataset && (
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={previewLoading || designer.metrics.length === 0}
            className="h-9 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] disabled:opacity-50 text-white text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            {previewLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            预览
          </button>
          <button
            onClick={handleSave}
            disabled={saving || designer.metrics.length === 0 || !designer.name.trim()}
            className="h-9 px-4 rounded-full border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {designer.editingId ? '保存修改' : '保存为报表'}
          </button>
          {designer.editingId && (
            <button
              onClick={() => { setDesigner({ ...EMPTY_DESIGNER, datasetKey: designer.datasetKey }); setPreview(null); }}
              className={`h-9 px-4 rounded-full text-xs font-light transition-colors ${isDarkMode ? 'text-slate-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              取消编辑
            </button>
          )}
        </div>
      )}

      {/* 预览结果 */}
      {preview && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className={`px-4 py-2.5 border-b text-xs flex items-center justify-between ${isDarkMode ? 'border-white/5 text-slate-400' : 'border-slate-100 text-slate-500'}`}>
            <span>预览结果 · {preview.rows.length} 行{preview.truncated ? '（已截断至 500 行，完整结果请保存后运行）' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}>
                  {preview.columnLabels.map((c, i) => (
                    <th key={i} className={`px-3 py-2 text-left font-light whitespace-nowrap ${textSecondary}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr key={ri} className={isDarkMode ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                    {preview.columns.map((c, ci) => (
                      <td key={ci} className={`px-3 py-1.5 whitespace-nowrap tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={preview.columns.length} className={`px-3 py-8 text-center ${textSecondary}`}>当前条件下无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 我的报表 Panel ====================

interface SavedPanelProps {
  isDarkMode: boolean;
  definitions: ReportDefinition[];
  datasets: ReportDatasetSpec[];
  cardClass: string;
  textSecondary: string;
  actionLoading: string | null;
  onEdit: (def: ReportDefinition) => void;
  onDelete: (def: ReportDefinition) => void;
  onToggleEnabled: (def: ReportDefinition) => void;
  onRun: (def: ReportDefinition) => void;
  onNewReport: () => void;
}

function SavedPanel(props: SavedPanelProps) {
  const { isDarkMode, definitions, datasets, cardClass, textSecondary, actionLoading, onEdit, onDelete, onToggleEnabled, onRun, onNewReport } = props;

  if (definitions.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-16 gap-3 ${textSecondary}`}>
        <BarChart3 size={28} className="opacity-40" />
        <p className="text-sm">暂无保存的报表</p>
        <button
          onClick={onNewReport}
          className="h-8 px-4 rounded-full bg-[var(--os-vnext-brand-blue)] hover:bg-[var(--os-vnext-brand-blue-strong)] text-white text-xs font-light flex items-center gap-1.5 transition-colors"
        >
          <Plus size={13} />去设计器创建
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {definitions.map(def => {
        const ds = datasets.find(d => d.key === def.datasetKey);
        const busy = actionLoading === `run_${def.id}` || actionLoading === `toggle_${def.id}` || actionLoading === `del_${def.id}`;
        return (
          <div key={def.id} className={`${cardClass} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${isDarkMode ? 'text-white/86' : 'text-slate-900'}`}>{def.name}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] shrink-0 ${statusSemanticClass(def.enabled ? 'success' : 'neutral', isDarkMode)}`}>
                    {def.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                <div className={`mt-1 text-[11px] ${textSecondary}`}>
                  {ds?.label ?? def.datasetKey}
                  {' · '}{def.dimensions.length} 维度 / {def.metrics.length} 指标
                  {def.schedule ? ` · ${SCHEDULE_LABELS[def.schedule]}调度` : ' · 手动'}
                </div>
                <div className={`mt-0.5 text-[10px] ${textSecondary}`}>
                  上次运行：{formatTs(def.lastRunAt)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onRun(def)}
                  disabled={busy || !def.enabled}
                  title="立即运行"
                  className={`p-1.5 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'} disabled:opacity-40`}
                >
                  {actionLoading === `run_${def.id}` ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                </button>
                <button
                  onClick={() => onEdit(def)}
                  title="编辑"
                  className={`p-1.5 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onToggleEnabled(def)}
                  disabled={busy}
                  title={def.enabled ? '停用' : '启用'}
                  className={`px-2 py-1 rounded-control text-[10px] transition-colors ${statusSemanticClass(def.enabled ? 'warning' : 'success', isDarkMode)}`}
                >
                  {def.enabled ? '停用' : '启用'}
                </button>
                <button
                  onClick={() => onDelete(def)}
                  disabled={busy}
                  title="删除"
                  className={`p-1.5 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-500 hover:text-red-300' : 'hover:bg-slate-100 text-slate-400 hover:text-red-500'}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 运行历史 Panel ====================

interface RunsPanelProps {
  isDarkMode: boolean;
  runs: ReportRun[];
  definitions: ReportDefinition[];
  cardClass: string;
  fieldClass: string;
  textSecondary: string;
  onRefresh: (definitionId: string) => Promise<void>;
  onError: (msg: string | null) => void;
}

function RunsPanel({ isDarkMode, runs, definitions, cardClass, fieldClass, textSecondary, onRefresh, onError }: RunsPanelProps) {
  const [filterDefId, setFilterDefId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleToggleExpand = useCallback(async (run: ReportRun) => {
    if (expandedId === run.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(run.id);
    setDetailLoading(true);
    try {
      setDetail(await reportService.getRun(run.id));
    } catch (e: any) {
      onError(`加载运行详情失败：${e?.message || e}`);
      setExpandedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expandedId, onError]);

  const visibleRuns = filterDefId ? runs.filter(r => r.definitionId === filterDefId) : runs;

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <select
          value={filterDefId}
          onChange={e => { setFilterDefId(e.target.value); onRefresh(e.target.value); }}
          className={`${fieldClass} max-w-[220px] py-1.5`}
        >
          <option value="">全部报表</option>
          {definitions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button
          onClick={() => onRefresh(filterDefId)}
          className="h-8 px-3 rounded-control text-xs font-light flex items-center gap-1.5 transition-colors border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <RefreshCw size={12} />刷新
        </button>
      </div>

      {visibleRuns.length === 0 ? (
        <div className={`flex flex-col items-center justify-center py-16 gap-2 ${textSecondary}`}>
          <Play size={24} className="opacity-40" />
          <p className="text-sm">暂无运行记录 — 在「我的报表」触发或等待定时调度</p>
        </div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}></th>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}>报表</th>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}>状态</th>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}>触发</th>
                <th className={`px-3 py-2 text-right font-light ${textSecondary}`}>行数</th>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}>开始时间</th>
                <th className={`px-3 py-2 text-left font-light ${textSecondary}`}>耗时</th>
                <th className={`px-3 py-2 text-right font-light ${textSecondary}`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRuns.map(run => {
                const expanded = expandedId === run.id;
                const duration = run.finishedAt && run.startedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` : '—';
                return (
                  <React.Fragment key={run.id}>
                    <tr className={isDarkMode ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                      <td className="px-3 py-2">
                        <button onClick={() => handleToggleExpand(run)} className={`${textSecondary} hover:opacity-80`}>
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      </td>
                      <td className={`px-3 py-2 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{run.definitionName}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass(RUN_STATUS_SEMANTIC[run.status] ?? 'neutral', isDarkMode)}`}>
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </span>
                      </td>
                      <td className={`px-3 py-2 ${textSecondary}`}>{TRIGGER_LABELS[run.trigger] ?? run.trigger}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{run.rowCount ?? '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${textSecondary}`}>{formatTs(run.startedAt)}</td>
                      <td className={`px-3 py-2 tabular-nums ${textSecondary}`}>{duration}</td>
                      <td className="px-3 py-2 text-right">
                        {run.status === 'Success' && (
                          <a
                            href={reportService.exportCsvUrl(run.id)}
                            download
                            title="导出 CSV"
                            className={`inline-flex p-1.5 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
                          >
                            <Download size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className={isDarkMode ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                        <td colSpan={8} className="px-4 py-3">
                          {detailLoading ? (
                            <div className={`flex items-center gap-2 py-3 text-xs ${textSecondary}`}>
                              <Loader2 size={12} className="animate-spin" />加载结果快照…
                            </div>
                          ) : detail?.status === 'Failed' ? (
                            <div className={`p-2 rounded-inset text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
                              运行失败：{detail.error || '未知错误'}
                            </div>
                          ) : detail && Array.isArray(detail.rows) && Array.isArray(detail.columns) ? (
                            <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className={isDarkMode ? 'bg-white/[0.03]' : 'bg-slate-50'}>
                                    {(detail.columnLabels ?? detail.columns).map((c, i) => (
                                      <th key={i} className={`px-2 py-1.5 text-left font-light whitespace-nowrap ${textSecondary}`}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.rows.map((row, ri) => (
                                    <tr key={ri} className={isDarkMode ? 'border-t border-white/[0.04]' : 'border-t border-slate-100'}>
                                      {detail.columns!.map((c, ci) => (
                                        <td key={ci} className={`px-2 py-1 whitespace-nowrap tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                                          {formatCell(row[c])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                  {detail.rows.length === 0 && (
                                    <tr><td colSpan={detail.columns.length} className={`px-2 py-6 text-center ${textSecondary}`}>本次运行无数据</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className={`py-3 text-xs ${textSecondary}`}>运行中，尚无结果</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
