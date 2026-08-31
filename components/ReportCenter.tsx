/**
 * 报表中心 ReportCenter（阶段 A5 报表引擎前端）
 * 阶段 IA 定位（PRD 24.2）：明细与台账入口——自助数据集查询/定义/运行/导出。
 * 与 全景看板（全局概览，现状冻结）、经营驾驶舱（经营预警）定位分化，互不渗透。
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
  CornerDownRight,
  ExternalLink,
  Save,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import CustomSelect from './ui/CustomSelect';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsConfirm } from './ui/BdsDialog';
import { statusSemanticClass, StatusSemantic } from './rdlBusinessStatusTokens';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';
import { View } from '../types';
import {
  reportService,
  ReportDatasetSpec,
  ReportDefinition,
  ReportDrillResult,
  ReportFieldSpec,
  ReportFilterOp,
  ReportFilterSpec,
  ReportMetricAgg,
  ReportMetricSpec,
  ReportPreviewResult,
  ReportRun,
  ReportSchedule,
} from '../services/reportService';
import { requestFinanceReportTab } from './finance/FinanceReportsPanel';

// ==================== 常量 ====================

type ModuleTab = 'designer' | 'saved' | 'runs';

const MODULE_TABS: Array<{ id: ModuleTab; label: string; icon: LucideIcon }> = [
  { id: 'designer', label: '报表设计器 Designer', icon: BarChart3 },
  { id: 'saved', label: '我的报表 Saved', icon: Save },
  { id: 'runs', label: '运行历史 Runs', icon: Play },
];

/** R3：运行历史每页条数（offset 追加加载，列表显服务端 total） */
const RUNS_PAGE_SIZE = 100;

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

// ==================== A5d 下钻 ====================

/** 下钻请求：报表查询规格 + 被点击聚合行的维度组约束 */
interface DrillRequest {
  input: {
    datasetKey: string;
    dimensions: string[];
    metrics: ReportMetricSpec[];
    filters: ReportFilterSpec[];
  };
  group: Record<string, string | null>;
}

/** 从聚合结果行提取维度组约束（维度列缺失/undefined 归一为 null，与服务端 groupBy 空值组口径一致） */
function groupFromRow(dimensions: string[], row: Record<string, string | number | null>): Record<string, string | null> {
  const group: Record<string, string | null> = {};
  for (const d of dimensions) {
    const v = row[d];
    group[d] = v === null || v === undefined ? null : String(v);
  }
  return group;
}

/** 数据集 → 所属模块导航目标（tab 为模块内落点；模块不支持 tab 定位时仅跳转视图） */
const DATASET_NAV_TARGETS: Record<string, { view: View; tab?: string }> = {
  orders: { view: View.Orders },
  invoices: { view: View.Invoices, tab: 'invoices' },
  paymentVouchers: { view: View.PaymentVouchers, tab: 'vouchers' },
  shipments: { view: View.Shipments },
  vatInvoices: { view: View.Invoices, tab: 'vatInvoices' },
  outwardRemittances: { view: View.PaymentVouchers, tab: 'vouchers' },
  taxRefunds: { view: View.Customs, tab: 'taxRefunds' },
};

// ==================== 主组件 ====================

interface ReportCenterProps {
  isDarkMode?: boolean;
  /** A5d 下钻联动：跳转实体所属模块（view + 可选模块内 tab） */
  onNavigate?: (view: View, tab?: string) => void;
}

export default function ReportCenter({ isDarkMode = false, onNavigate }: ReportCenterProps) {
  const [activeTab, setActiveTab] = useState<ModuleTab>('designer');
  const [datasets, setDatasets] = useState<ReportDatasetSpec[]>([]);
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  // R3：运行历史分页（服务端 total + 「加载更多」offset 追加）
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoadingMore, setRunsLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [designer, setDesigner] = useState<DesignerState>(EMPTY_DESIGNER);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillRequest | null>(null);

  // ── 主题样式（与 CustomsManager 同一 token 口径） ──
  const cardClass = 'rounded-card border border-[var(--border-c-subtle)] bg-[var(--hover-darken)]';
  const fieldClass = 'w-full px-3 py-2 rounded-control text-sm outline-none border transition-colors focus:border-[var(--os-vnext-brand-blue)] bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]';
  const labelClass = 'block text-xs mb-1 text-[var(--text-tertiary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const tabBtnCls = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-light inline-flex items-center gap-1.5 transition-colors ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-[var(--on-accent)]'
        : 'bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)]'
    }`;
  const chipCls = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-light transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--os-vnext-brand-blue)] text-[var(--on-accent)]'
        : 'bg-[var(--recessed-bg)] text-[var(--text-secondary)] hover:bg-[var(--active-darken)]'
    }`;

  // ── 数据加载 ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ds, defs, rs] = await Promise.all([
        reportService.listDatasets(),
        reportService.listDefinitions(),
        reportService.listRuns(undefined, { limit: RUNS_PAGE_SIZE }),
      ]);
      setDatasets(ds);
      setDefinitions(defs);
      setRuns(rs.runs);
      setRunsTotal(rs.total);
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
    if (!(await bdsConfirm({ title: '确认删除', body: `确认删除报表「${def.name}」？历史运行记录将保留。`, danger: true }))) return;
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
        reportService.listRuns(undefined, { limit: RUNS_PAGE_SIZE }),
      ]);
      setDefinitions(defs);
      setRuns(rs.runs);
      setRunsTotal(rs.total);
    } catch (e: any) {
      setError(`运行失败：${e?.message || e}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  // ── A5d 下钻：聚合行 → 组成员实体明细抽屉 ──
  const handleDrill = useCallback((input: DrillRequest['input'], row: Record<string, string | number | null>) => {
    setDrill({ input, group: groupFromRow(input.dimensions, row) });
  }, []);

  const drillDataset = useMemo(
    () => (drill ? datasets.find(d => d.key === drill.input.datasetKey) : undefined),
    [drill, datasets],
  );

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
            className="h-8 px-4 rounded-full border border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)] text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={16} strokeWidth={1.75} /><span>刷新</span>
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col px-7 pb-6 pt-2">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1">
          {/* 专题报表入口（引擎外服务端聚合投影，非数据集引擎自动发现；引擎后续注册同名数据集时自动隐藏） */}
          {!datasets.some(d => d.key === 'consolidatedProfit') && (
            <div className={`${cardClass} p-4 mb-4 flex items-center gap-4`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--text-primary)]">合并利润 · Consolidated Profit</div>
                <div className={`mt-1 text-[11px] ${textSecondary}`}>
                  公司合并视图（DR-005）：抵销内部面料采购/销售，仅计客户外部收入 + 真实面料成本；支持合并视图 / 部门视角双口径与日期范围过滤
                </div>
                <div className={`mt-0.5 text-[10px] ${textSecondary}`}>
                  服务端只读聚合投影（/v1/finance/reports/consolidated-profit），不经报表引擎数据集
                </div>
              </div>
              <button
                onClick={() => {
                  requestFinanceReportTab('consolidated');
                  onNavigate?.(View.PaymentVouchers, 'reports');
                }}
                className="bds-btn bds-btn-primary sm shrink-0"
              >
                <ExternalLink size={16} strokeWidth={1.75} />打开报表
              </button>
            </div>
          )}

          {/* Tab 导航 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {MODULE_TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} className={tabBtnCls(activeTab === t.id)}>
                  <Icon size={16} strokeWidth={1.75} /><span>{t.label}</span>
                  {t.id === 'saved' && definitions.length > 0 && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'saved' ? 'bg-[var(--hover-darken)]' : 'bg-[var(--recessed-bg-strong)]'}`}>{definitions.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 错误横幅 */}
          {error && (
            <div className={`p-3 rounded-inset border flex items-center gap-2 mb-3 text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 opacity-60 hover:opacity-100"><X size={16} strokeWidth={1.75} /></button>
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
                  onDrill={handleDrill}
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
                  runsTotal={runsTotal}
                  runsLoadingMore={runsLoadingMore}
                  definitions={definitions}
                  cardClass={cardClass}
                  fieldClass={fieldClass}
                  textSecondary={textSecondary}
                  onDrill={handleDrill}
                  onRefresh={async (definitionId) => {
                    const rs = await reportService.listRuns(definitionId || undefined, { limit: RUNS_PAGE_SIZE });
                    setRuns(rs.runs);
                    setRunsTotal(rs.total);
                  }}
                  onLoadMore={async (definitionId) => {
                    setRunsLoadingMore(true);
                    try {
                      const rs = await reportService.listRuns(definitionId || undefined, { limit: RUNS_PAGE_SIZE, offset: runs.length });
                      setRuns(prev => [...prev, ...rs.runs]);
                      setRunsTotal(rs.total);
                    } catch (e: any) {
                      setError(`加载更多失败：${e?.message || e}`);
                    } finally {
                      setRunsLoadingMore(false);
                    }
                  }}
                  onError={setError}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* A5d 下钻抽屉 */}
      {drill && drillDataset && (
        <DrillDrawer
          isDarkMode={isDarkMode}
          dataset={drillDataset}
          input={drill.input}
          group={drill.group}
          onClose={() => setDrill(null)}
          onNavigate={onNavigate}
        />
      )}
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
  onDrill: (input: DrillRequest['input'], row: Record<string, string | number | null>) => void;
  onSaved: (def: ReportDefinition, isNew: boolean) => void;
  onError: (msg: string | null) => void;
}

function DesignerPanel(props: DesignerPanelProps) {
  const { isDarkMode, datasets, dataset, designer, setDesigner, cardClass, fieldClass, labelClass, chipCls, textSecondary, onDrill, onSaved, onError } = props;
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
            <CustomSelect
              surface="form"
              ariaLabel="数据集"
              value={designer.datasetKey}
              onChange={v => setDesigner(prev => ({ ...prev, datasetKey: v, dimensions: [], metrics: [], filters: [] }))}
              disabled={Boolean(designer.editingId)}
              options={datasets.map(d => ({ value: d.key, label: `${d.label}${d.description ? ` · ${d.description}` : ''}` }))}
            />
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
            <CustomSelect
              surface="form"
              ariaLabel="定时调度"
              value={designer.schedule}
              onChange={v => setDesigner(prev => ({ ...prev, schedule: v as DesignerState['schedule'] }))}
              options={[
                { value: '', label: '仅手动运行' },
                { value: 'daily', label: '每日' },
                { value: 'weekly', label: '每周' },
                { value: 'monthly', label: '每月' },
              ]}
            />
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
            <button onClick={addMetric} className="text-[11px] inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Plus size={16} strokeWidth={1.75} />添加指标
            </button>
          </div>
          <div className="space-y-2">
            {designer.metrics.map((m, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <CustomSelect
                  className="flex-1 min-w-0"
                  surface="form"
                  size="compact"
                  ariaLabel="指标字段"
                  value={m.field}
                  onChange={v => setDesigner(prev => ({
                    ...prev,
                    metrics: prev.metrics.map((x, i) => (i === idx ? { ...x, field: v } : x)),
                  }))}
                  options={[
                    ...dataset.metrics.map(f => ({ value: f.key, label: f.label })),
                    ...(m.agg === 'count' ? [{ value: '*', label: '行数 (*)' }] : []),
                  ]}
                />
                <CustomSelect
                  className="w-28 shrink-0"
                  surface="form"
                  size="compact"
                  ariaLabel="聚合方式"
                  value={m.agg}
                  onChange={v => {
                    const agg = v as ReportMetricAgg;
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
                  options={(Object.keys(AGG_LABELS) as ReportMetricAgg[]).map(a => ({ value: a, label: AGG_LABELS[a] }))}
                />
                <button
                  onClick={() => setDesigner(prev => ({ ...prev, metrics: prev.metrics.filter((_, i) => i !== idx) }))}
                  className="p-1.5 rounded-control hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)]"
                >
                  <X size={14} strokeWidth={1.75} />
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
            <button onClick={addFilter} className="text-[11px] inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Plus size={16} strokeWidth={1.75} />添加条件
            </button>
          </div>
          <div className="space-y-2">
            {designer.filters.map((f, idx) => {
              const spec = dataset.filterFields.find(ff => ff.key === f.field);
              const ops = spec ? opsForField(spec) : [];
              return (
                <div key={idx} className="flex items-center gap-2">
                  <CustomSelect
                    className="flex-1 min-w-0"
                    surface="form"
                    size="compact"
                    ariaLabel="筛选字段"
                    value={f.field}
                    onChange={v => {
                      const next = dataset.filterFields.find(ff => ff.key === v);
                      setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx && next ? { field: next.key, op: opsForField(next)[0], value: '' } : x)),
                      }));
                    }}
                    options={dataset.filterFields.map(ff => ({ value: ff.key, label: ff.label }))}
                  />
                  <CustomSelect
                    className="w-32 shrink-0"
                    surface="form"
                    size="compact"
                    ariaLabel="筛选操作符"
                    value={f.op}
                    onChange={v => setDesigner(prev => ({
                      ...prev,
                      filters: prev.filters.map((x, i) => (i === idx ? { ...x, op: v as ReportFilterOp } : x)),
                    }))}
                    options={ops.map(op => ({ value: op, label: OP_LABELS[op] }))}
                  />
                  {spec?.type === 'enum' && spec.enumValues && f.op !== 'in' ? (
                    <CustomSelect
                      className="flex-1 min-w-0"
                      surface="form"
                      size="compact"
                      ariaLabel="筛选值"
                      value={f.value}
                      onChange={v => setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx ? { ...x, value: v } : x)),
                      }))}
                      options={[
                        { value: '', label: '请选择' },
                        ...spec.enumValues.map(ev => ({ value: ev, label: ev })),
                      ]}
                    />
                  ) : spec?.type === 'date' ? (
                    <CapsuleDateInput
                      value={f.value}
                      onChange={v => setDesigner(prev => ({
                        ...prev,
                        filters: prev.filters.map((x, i) => (i === idx ? { ...x, value: v } : x)),
                      }))}
                      className="bds-input flex-1"
                    />
                  ) : (
                    <input
                      type={spec?.type === 'number' ? 'number' : 'text'}
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
                    className="p-1.5 rounded-control hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)]"
                  >
                    <X size={14} strokeWidth={1.75} />
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
            className="bds-btn bds-btn-primary sm"
          >
            {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} strokeWidth={1.75} />}
            预览
          </button>
          <button
            onClick={handleSave}
            disabled={saving || designer.metrics.length === 0 || !designer.name.trim()}
            className="h-9 px-4 rounded-full border border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)] disabled:opacity-50 text-xs font-light flex items-center gap-1.5 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={1.75} />}
            {designer.editingId ? '保存修改' : '保存为报表'}
          </button>
          {designer.editingId && (
            <button
              onClick={() => { setDesigner({ ...EMPTY_DESIGNER, datasetKey: designer.datasetKey }); setPreview(null); }}
              className="h-9 px-4 rounded-full text-xs font-light transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]"
            >
              取消编辑
            </button>
          )}
        </div>
      )}

      {/* 预览结果 */}
      {preview && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="px-4 py-2.5 border-b text-xs flex items-center justify-between border-[var(--border-c-subtle)] text-[var(--text-tertiary)]">
            <span>预览结果 · {preview.rows.length} 行{preview.truncated ? '（已截断至 500 行，完整结果请保存后运行）' : ''}</span>
            {designer.dimensions.length > 0 && preview.rows.length > 0 && (
              <span className={`text-[10px] ${textSecondary}`}>点击行内「下钻」查看组成员实体</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--hover-darken)]">
                  {preview.columnLabels.map((c, i) => (
                    <th key={i} className={`px-3 py-2 text-left font-light whitespace-nowrap ${textSecondary}`}>{c}</th>
                  ))}
                  {designer.dimensions.length > 0 && (
                    <th className={`px-3 py-2 text-right font-light ${textSecondary}`}>下钻</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr key={ri} className="border-t border-[var(--border-c-subtle)]">
                    {preview.columns.map((c, ci) => (
                      <td key={ci} className="px-3 py-1.5 whitespace-nowrap tabular-nums text-[var(--text-primary)]">
                        {formatCell(row[c])}
                      </td>
                    ))}
                    {designer.dimensions.length > 0 && (
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => onDrill(buildQueryInput(), row)}
                          title="下钻查看组成员实体"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <CornerDownRight size={14} strokeWidth={1.75} />明细
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={preview.columns.length + (designer.dimensions.length > 0 ? 1 : 0)} className={`px-3 py-8 text-center ${textSecondary}`}>当前条件下无数据</td></tr>
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
        <BarChart3 size={24} strokeWidth={1.25} className="opacity-40" />
        <p className="text-sm">暂无保存的报表</p>
        <button
          onClick={onNewReport}
          className="bds-btn bds-btn-primary sm"
        >
          <Plus size={16} strokeWidth={1.75} />去设计器创建
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
                  <span className="text-sm truncate text-[var(--text-primary)]">{def.name}</span>
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
                  className="p-1.5 rounded-control transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)] disabled:opacity-40"
                >
                  {actionLoading === `run_${def.id}` ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} strokeWidth={1.75} />}
                </button>
                <button
                  onClick={() => onEdit(def)}
                  title="编辑"
                  className="p-1.5 rounded-control transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)]"
                >
                  <Pencil size={14} strokeWidth={1.75} />
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
                  className="p-1.5 rounded-control transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--danger-text)]"
                >
                  <Trash2 size={14} strokeWidth={1.75} />
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
  /** R3：服务端运行记录总数（加载更多判定） */
  runsTotal: number;
  runsLoadingMore: boolean;
  definitions: ReportDefinition[];
  cardClass: string;
  fieldClass: string;
  textSecondary: string;
  onDrill: (input: DrillRequest['input'], row: Record<string, string | number | null>) => void;
  onRefresh: (definitionId: string) => Promise<void>;
  /** R3：加载更多（offset = 已加载条数，追加合并） */
  onLoadMore: (definitionId: string) => Promise<void>;
  onError: (msg: string | null) => void;
}

function RunsPanel({ isDarkMode, runs, runsTotal, runsLoadingMore, definitions, cardClass, fieldClass, textSecondary, onDrill, onRefresh, onLoadMore, onError }: RunsPanelProps) {
  const [filterDefId, setFilterDefId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const handleExportRun = useCallback(async (run: ReportRun) => {
    if (exportingId) return;
    setExportingId(run.id);
    try {
      await reportService.downloadRunCsv(run.id);
    } catch (e: any) {
      onError(`导出失败：${e?.message || e}`);
    } finally {
      setExportingId(null);
    }
  }, [exportingId, onError]);

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
        <CustomSelect
          className="w-56 shrink-0"
          size="compact"
          ariaLabel="筛选报表"
          value={filterDefId}
          onChange={v => { setFilterDefId(v); onRefresh(v); }}
          options={[
            { value: '', label: '全部报表' },
            ...definitions.map(d => ({ value: d.id, label: d.name })),
          ]}
        />
        <button
          onClick={() => onRefresh(filterDefId)}
          className="h-8 px-3 rounded-control text-xs font-light flex items-center gap-1.5 transition-colors border border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)]"
        >
          <RefreshCw size={14} strokeWidth={1.75} />刷新
        </button>
      </div>

      {visibleRuns.length === 0 ? (
        <div className={`flex flex-col items-center justify-center py-16 gap-2 ${textSecondary}`}>
          <Play size={24} strokeWidth={1.25} className="opacity-40" />
          <p className="text-sm">暂无运行记录 — 在「我的报表」触发或等待定时调度</p>
        </div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--hover-darken)]">
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
                    <tr className="border-t border-[var(--border-c-subtle)]">
                      <td className="px-3 py-2">
                        <button onClick={() => handleToggleExpand(run)} className={`${textSecondary} hover:opacity-80`}>
                          {expanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-primary)]">{run.definitionName}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusSemanticClass(RUN_STATUS_SEMANTIC[run.status] ?? 'neutral', isDarkMode)}`}>
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </span>
                      </td>
                      <td className={`px-3 py-2 ${textSecondary}`}>{TRIGGER_LABELS[run.trigger] ?? run.trigger}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--text-primary)]">{run.rowCount ?? '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${textSecondary}`}>{formatTs(run.startedAt)}</td>
                      <td className={`px-3 py-2 tabular-nums ${textSecondary}`}>{duration}</td>
                      <td className="px-3 py-2 text-right">
                        {run.status === 'Success' && (
                          <button
                            type="button"
                            onClick={() => handleExportRun(run)}
                            disabled={exportingId !== null}
                            title="导出 CSV"
                            className="inline-flex p-1.5 rounded-control transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)] disabled:opacity-50"
                          >
                            {exportingId === run.id
                              ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
                              : <Download size={14} strokeWidth={1.75} />}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-[var(--border-c-subtle)]">
                        <td colSpan={8} className="px-4 py-3">
                          {detailLoading ? (
                            <div className={`flex items-center gap-2 py-3 text-xs ${textSecondary}`}>
                              <Loader2 size={14} className="animate-spin" />加载结果快照…
                            </div>
                          ) : detail?.status === 'Failed' ? (
                            <div className={`p-2 rounded-inset text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
                              运行失败：{detail.error || '未知错误'}
                            </div>
                          ) : detail && Array.isArray(detail.rows) && Array.isArray(detail.columns) ? (
                            (() => {
                              const runDef = definitions.find(d => d.id === detail.definitionId);
                              const drillable = Boolean(runDef && runDef.dimensions.length > 0);
                              return (
                                <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                                  {drillable && detail.rows.length > 0 && (
                                    <div className={`px-1 pb-1 text-[10px] ${textSecondary}`}>快照为历史结果；点击行内「下钻」按当前实时数据查询组成员实体</div>
                                  )}
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="bg-[var(--hover-darken)]">
                                        {(detail.columnLabels ?? detail.columns).map((c, i) => (
                                          <th key={i} className={`px-2 py-1.5 text-left font-light whitespace-nowrap ${textSecondary}`}>{c}</th>
                                        ))}
                                        {drillable && (
                                          <th className={`px-2 py-1.5 text-right font-light ${textSecondary}`}>下钻</th>
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.rows.map((row, ri) => (
                                        <tr key={ri} className="border-t border-[var(--border-c-subtle)]">
                                          {detail.columns!.map((c, ci) => (
                                            <td key={ci} className="px-2 py-1 whitespace-nowrap tabular-nums text-[var(--text-primary)]">
                                              {formatCell(row[c])}
                                            </td>
                                          ))}
                                          {drillable && runDef && (
                                            <td className="px-2 py-1 text-right">
                                              <button
                                                onClick={() => onDrill(
                                                  { datasetKey: runDef.datasetKey, dimensions: runDef.dimensions, metrics: runDef.metrics, filters: runDef.filters ?? [] },
                                                  row,
                                                )}
                                                title="下钻查看组成员实体（实时）"
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)] hover:text-[var(--text-primary)]"
                                              >
                                                <CornerDownRight size={14} strokeWidth={1.75} />明细
                                              </button>
                                            </td>
                                          )}
                                        </tr>
                                      ))}
                                      {detail.rows.length === 0 && (
                                        <tr><td colSpan={detail.columns.length + (drillable ? 1 : 0)} className={`px-2 py-6 text-center ${textSecondary}`}>本次运行无数据</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()
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

      {/* R3：加载更多（已加载 < 服务端 total 时显示，offset 追加） */}
      {runs.length > 0 && runs.length < runsTotal && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void onLoadMore(filterDefId)}
            disabled={runsLoadingMore}
            className="h-8 px-4 rounded-control text-xs font-light flex items-center gap-1.5 transition-colors border border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)] disabled:opacity-50"
          >
            {runsLoadingMore && <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />}
            加载更多（已显示 {runs.length} / 共 {runsTotal} 条）
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== A5d 下钻抽屉 ====================

interface DrillDrawerProps {
  isDarkMode: boolean;
  dataset: ReportDatasetSpec;
  input: DrillRequest['input'];
  group: Record<string, string | null>;
  onClose: () => void;
  onNavigate?: (view: View, tab?: string) => void;
}

/**
 * 下钻抽屉：聚合组 → 组成员实体明细（实时查询，不落库）
 * 联动链：报表聚合行 → 组成员实体 → RelatedEntitiesPanel 图谱 → 所属模块
 */
function DrillDrawer({ isDarkMode, dataset, input, group, onClose, onNavigate }: DrillDrawerProps) {
  const [result, setResult] = useState<ReportDrillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // input/group 由父组件在下钻打开时一次性构造，抽屉生命周期内不变
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reportService
      .drill({ ...input, group })
      .then(r => { if (!cancelled) setResult(r); })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textSecondary = 'text-[var(--text-tertiary)]';
  const navTarget = DATASET_NAV_TARGETS[dataset.key];
  const groupEntries = input.dimensions.map(d => ({
    label: dataset.dimensions.find(f => f.key === d)?.label ?? d,
    value: group[d],
  }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--mask-bg)] backdrop-blur-sm backdrop-saturate-[var(--mask-saturate)]" onClick={onClose}>
      <div
        className="bds-frosted h-full w-[760px] max-w-[92vw] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部：标题 + 组约束 + 关闭 */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border-c-subtle)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-light truncate text-[var(--text-primary)]">
              下钻明细 · {dataset.label}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-control transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)]">
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {groupEntries.length === 0 && (
                              <span className={`text-[11px] ${textSecondary}`}>总计行 · 全部未删除记录</span>
            )}
            {groupEntries.map(g => (
              <span
                key={g.label}
                className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--recessed-bg)] text-[var(--text-secondary)]"
              >
                {g.label}：{g.value ?? '（空）'}
              </span>
            ))}
            {result && (
              <span className={`ml-auto text-[10px] shrink-0 ${textSecondary}`}>
                共 {result.total} 条{result.total > result.rows.length ? `，仅显示前 ${result.rows.length} 条` : ''} · 实时数据
              </span>
            )}
          </div>
        </div>

        {/* 主体：成员明细 + 选中实体联动 */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {loading ? (
            <div className={`flex items-center justify-center gap-2 py-16 text-sm ${textSecondary}`}>
              <Loader2 size={16} className="animate-spin" />查询组成员…
            </div>
          ) : error ? (
            <div className={`p-3 rounded-inset border text-xs ${statusSemanticClass('danger', isDarkMode)}`}>
              下钻查询失败：{error}
            </div>
          ) : result && result.rows.length === 0 ? (
            <div className={`py-16 text-center text-sm ${textSecondary}`}>该组当前无成员记录（数据可能在快照后已变更）</div>
          ) : result ? (
            <>
              {/* 成员明细表 */}
              <div className="rounded-card border overflow-hidden border-[var(--border-c-subtle)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[var(--hover-darken)]">
                        {result.columnLabels.map((c, i) => (
                          <th key={i} className={`px-2.5 py-2 text-left font-light whitespace-nowrap ${textSecondary}`}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => {
                        const rowId = String(row[result.idField] ?? '');
                        const selected = rowId && rowId === selectedId;
                        return (
                          <tr
                            key={rowId || ri}
                            onClick={() => setSelectedId(selected ? null : rowId)}
                            className={`cursor-pointer transition-colors ${
                              selected
                                ? 'bg-[var(--recessed-bg)]'
                                : 'border-t border-[var(--border-c-subtle)] hover:bg-[var(--hover-darken)]'
                            }`}
                          >
                            {result.columns.map((c, ci) => (
                              <td key={ci} className="px-2.5 py-1.5 whitespace-nowrap tabular-nums text-[var(--text-primary)]">
                                {formatCell(row[c])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 选中实体：图谱联动 + 模块导航 */}
              {selectedId && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] ${textSecondary}`}>已选中实体</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--recessed-bg)] text-[var(--text-secondary)]">{selectedId}</span>
                    {onNavigate && navTarget && (
                      <button
                        onClick={() => { onNavigate(navTarget.view, navTarget.tab); onClose(); }}
                        className="bds-btn bds-btn-primary sm ml-auto"
                      >
                        <ExternalLink size={14} strokeWidth={1.75} />打开所在模块
                      </button>
                    )}
                  </div>
                  <RelatedEntitiesPanel
                    type={result.entityType}
                    id={selectedId}
                    isDarkMode={isDarkMode}
                    limit={50}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
