import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, ChevronRight } from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { productionService } from '../services/productionService';

const cx = (...args: any[]) => args.filter(Boolean).join(' ');

const STAGE_LABELS: Record<string, string> = {
  order_placed: '业务下单',
  materials_confirmed: '面辅料确认',
  production_planned: '生产计划',
  in_production: '货期管理',
  materials_arrived: '面辅料到厂',
  pre_cut_checked: '裁剪前检查',
  pp_sample_approved: '产前样确认',
  manufacturing: '生产过程',
  final_review: '成品确认',
  qc_shipped: '验货发货',
};

interface PipelineStage {
  id: string;
  stageKey: string;
  stageSeq: number;
  status: string;
  note?: string | null;
  operator?: string | null;
  doneAt?: number | null;
  signedByProduction?: string | null;
  signedByBusiness?: string | null;
  signedAtProduction?: number | null;
  signedAtBusiness?: number | null;
}

interface PreCutChecklist {
  orderId: string;
  gradingConfirmed: boolean;
  consumptionConfirmed: boolean;
  patternConfirmed: boolean;
  preProductionMeeting: boolean;
  meetingNote?: string | null;
}

interface InspectionReport {
  orderId: string;
  inspectionType?: string | null; // midline | final（缺省 final）
  totalUnits: number;
  passedUnits: number;
  passRate: number;
  defectRate: number;
  approvedByBusiness: boolean;
  inspectedBy?: string | null;
  inspectionDate?: string | null;
  inspectorOrg?: string | null;
  aqlLevel?: string | null;
  lotSize?: number | null;
  sampleSize?: number | null;
  criticalDefects?: number | null;
  majorDefects?: number | null;
  minorDefects?: number | null;
  defectSummary?: string | null;
  result?: string | null; // pass | conditional | fail
}

interface ProductionPipelineProps {
  orderId: string;
  isDarkMode?: boolean;
}

export const ProductionPipeline: React.FC<ProductionPipelineProps> = ({ orderId, isDarkMode = false }) => {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [checklist, setChecklist] = useState<PreCutChecklist | null>(null);
  const [inspections, setInspections] = useState<InspectionReport[]>([]);
  const [inspType, setInspType] = useState<'final' | 'midline'>('final');
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = isDarkMode ? 'text-slate-100' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-white/50' : 'text-slate-500';
  const surfaceClass = isDarkMode ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-white border-slate-200/60';

  const inspection = inspections.find(i => (i.inspectionType ?? 'final') === inspType) ?? null;

  const fetchPipeline = useCallback(async () => {
    try {
      const data = await productionService.getPipeline(orderId);
      setStages(data.stages);
      setChecklist(data.checklist);
      setInspections(data.inspections && data.inspections.length > 0 ? data.inspections : (data.inspection ? [data.inspection] : []));
    } catch { /* ignore */ }
    setLoading(false);
  }, [orderId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  const handleAdvance = async (stageKey: string) => {
    setAdvancing(stageKey);
    setError(null);
    try {
      const stage = await productionService.advanceStage(orderId, stageKey);
      setStages(prev => prev.map(s => s.stageKey === stageKey ? stage : s));
    } catch (e: any) {
      setError(e?.message || '阶段推进失败');
    }
    setAdvancing(null);
  };

  const handleChecklistToggle = async (field: keyof PreCutChecklist) => {
    if (!checklist) return;
    const updated = { ...checklist, [field]: !checklist[field] };
    setChecklist(updated);
    try {
      await productionService.saveChecklist(orderId, { [field]: updated[field] });
    } catch { /* ignore */ }
  };

  const handleInspectionSave = async (field: string, value: any) => {
    try {
      const report = await productionService.saveInspection(orderId, { inspectionType: inspType, [field]: value });
      setInspections(prev => {
        const idx = prev.findIndex(i => (i.inspectionType ?? 'final') === (report.inspectionType ?? 'final'));
        if (idx >= 0) return prev.map((i, n) => (n === idx ? report : i));
        return [...prev, report];
      });
    } catch { /* ignore */ }
  };

  if (loading) {
    return <div className={cx('flex items-center gap-2 p-4 text-xs', textSecondary)}><Loader2 size={14} className="animate-spin" /> 加载生产管线...</div>;
  }

  return (
    <div className="space-y-4">
      <div className={cx('text-[10px] font-light uppercase tracking-widest', textSecondary)}>生产管线 (10 阶段门禁)</div>

      {error && (
        <div className="flex items-center gap-2 rounded-control bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* 10-stage progress */}
      <div className={cx('rounded-inset border p-4', surfaceClass)}>
        <div className="space-y-1.5">
          {stages.map((stage, idx) => {
            const isDone = stage.status === 'done';
            const isCurrent = !isDone && stages.slice(0, idx).every(s => s.status === 'done');
            const canAdvance = isCurrent;
            return (
              <div key={stage.id} className="flex items-center gap-3">
                <div className="shrink-0">
                  {isDone ? (
                    <CheckCircle2 size={16} className={isDarkMode ? 'text-emerald-400' : 'text-emerald-500'} />
                  ) : isCurrent ? (
                    <Circle size={16} className={isDarkMode ? 'text-blue-400' : 'text-blue-500'} />
                  ) : (
                    <Circle size={16} className={isDarkMode ? 'text-white/15' : 'text-slate-300'} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={cx(
                    'text-xs font-light',
                    isDone ? textPrimary : isCurrent ? textPrimary : textSecondary,
                  )}>
                    {stage.stageSeq}. {STAGE_LABELS[stage.stageKey] || stage.stageKey}
                  </span>
                  {stage.doneAt && (
                    <span className={cx('ml-2 text-[10px]', textSecondary)}>
                      {new Date(stage.doneAt).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </div>
                {canAdvance && (
                  <button
                    onClick={() => handleAdvance(stage.stageKey)}
                    disabled={advancing === stage.stageKey}
                    className={cx(
                      'flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[10px] font-light transition-all',
                      isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 hover:bg-slate-50',
                      advancing === stage.stageKey && 'opacity-50',
                    )}
                  >
                    {advancing === stage.stageKey ? <Loader2 size={10} className="animate-spin" /> : <ChevronRight size={10} />}
                    推进
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* PP Sample Dual Sign */}
      {stages.some(s => s.stageKey === 'pp_sample_approved') && (() => {
        const ppStage = stages.find(s => s.stageKey === 'pp_sample_approved');
        if (!ppStage) return null;
        return (
          <div className={cx('rounded-inset border p-4', surfaceClass)}>
            <div className={cx('mb-3 text-[10px] font-light uppercase tracking-widest', textSecondary)}>产前样双签确认</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={async () => {
                  try {
                    const updated = await productionService.signStage(orderId, 'pp_sample_approved', 'production');
                    setStages(prev => prev.map(s => s.id === updated.id ? updated : s));
                  } catch (e: any) { setError(e?.message || '签字失败'); }
                }}
                className={cx(
                  'flex h-8 items-center justify-center gap-1.5 rounded-full border text-[10px] font-light transition-all',
                  ppStage.signedByProduction
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                {ppStage.signedByProduction ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                生产部 {ppStage.signedByProduction ? '已签' : '签字'}
              </button>
              <button
                onClick={async () => {
                  try {
                    const updated = await productionService.signStage(orderId, 'pp_sample_approved', 'business');
                    setStages(prev => prev.map(s => s.id === updated.id ? updated : s));
                  } catch (e: any) { setError(e?.message || '签字失败'); }
                }}
                className={cx(
                  'flex h-8 items-center justify-center gap-1.5 rounded-full border text-[10px] font-light transition-all',
                  ppStage.signedByBusiness
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                {ppStage.signedByBusiness ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                业务部 {ppStage.signedByBusiness ? '已签' : '签字'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* PreCut Checklist */}
      {stages.some(s => s.stageKey === 'pre_cut_checked') && (
        <div className={cx('rounded-inset border p-4', surfaceClass)}>
          <div className={cx('mb-3 text-[10px] font-light uppercase tracking-widest', textSecondary)}>裁剪前检查 (四项门禁)</div>
          <div className="space-y-2">
            {([
              ['gradingConfirmed', '推码确认'],
              ['consumptionConfirmed', '耗料确认'],
              ['patternConfirmed', '样板确认'],
              ['preProductionMeeting', '产前会议'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checklist?.[field] ?? false}
                  onChange={() => handleChecklistToggle(field)}
                  className="w-4 h-4 rounded accent-emerald-500"
                />
                <span className={cx('text-xs font-light', textPrimary)}>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Inspection Report — Phase B4：中期/终期双报告 + AQL/三级疵点 */}
      {stages.some(s => s.stageKey === 'qc_shipped') && (
        <div className={cx('rounded-inset border p-4', surfaceClass)}>
          <div className="mb-3 flex items-center justify-between">
            <div className={cx('text-[10px] font-light uppercase tracking-widest', textSecondary)}>
              验货报告{inspType === 'final' ? ' (门禁: 合格率≥90% 不合格率≤3% 致命疵点=0)' : ''}
            </div>
            <div className="flex items-center gap-1">
              {(['final', 'midline'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInspType(t)}
                  className={cx(
                    'h-6 rounded-control border px-2.5 text-[10px] font-light transition-colors',
                    inspType === t
                      ? isDarkMode ? 'border-white/20 bg-white/10 text-white/85' : 'border-slate-400/50 bg-slate-100 text-slate-700'
                      : isDarkMode ? 'border-white/[0.08] text-white/40 hover:text-white/65' : 'border-slate-200 text-slate-400 hover:text-slate-600',
                  )}
                >
                  {t === 'final' ? '终期验货' : '中期验货'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货日期</label>
              <input
                type="date"
                value={inspection?.inspectionDate ?? ''}
                onChange={e => handleInspectionSave('inspectionDate', e.target.value)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货方</label>
              <input
                type="text"
                placeholder="自有 QC / SGS / BV / 客户验货员"
                value={inspection?.inspectorOrg ?? ''}
                onChange={e => handleInspectionSave('inspectorOrg', e.target.value)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>AQL 标准</label>
              <input
                type="text"
                placeholder="如 2.5/4.0 II"
                value={inspection?.aqlLevel ?? ''}
                onChange={e => handleInspectionSave('aqlLevel', e.target.value)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货结论</label>
              <select
                value={inspection?.result ?? ''}
                onChange={e => handleInspectionSave('result', e.target.value || null)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              >
                <option value="">未判定</option>
                <option value="pass">合格 Pass</option>
                <option value="conditional">有条件合格 Conditional</option>
                <option value="fail">不合格 Fail</option>
              </select>
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>批量 / 抽样数</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="批量"
                  value={inspection?.lotSize ?? ''}
                  onChange={e => handleInspectionSave('lotSize', e.target.value ? Number(e.target.value) : null)}
                  className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
                />
                <input
                  type="number"
                  placeholder="抽样"
                  value={inspection?.sampleSize ?? ''}
                  onChange={e => handleInspectionSave('sampleSize', e.target.value ? Number(e.target.value) : null)}
                  className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
                />
              </div>
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>疵点 致命/主要/次要</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="致命"
                  value={inspection?.criticalDefects ?? ''}
                  onChange={e => handleInspectionSave('criticalDefects', Number(e.target.value) || 0)}
                  className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
                />
                <input
                  type="number"
                  placeholder="主要"
                  value={inspection?.majorDefects ?? ''}
                  onChange={e => handleInspectionSave('majorDefects', Number(e.target.value) || 0)}
                  className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
                />
                <input
                  type="number"
                  placeholder="次要"
                  value={inspection?.minorDefects ?? ''}
                  onChange={e => handleInspectionSave('minorDefects', Number(e.target.value) || 0)}
                  className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
                />
              </div>
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>总检验件数</label>
              <input
                type="number"
                value={inspection?.totalUnits ?? ''}
                onChange={e => handleInspectionSave('totalUnits', Number(e.target.value) || 0)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>合格件数</label>
              <input
                type="number"
                value={inspection?.passedUnits ?? ''}
                onChange={e => handleInspectionSave('passedUnits', Number(e.target.value) || 0)}
                className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={cx('mb-1 block text-[10px]', textSecondary)}>疵点描述</label>
            <input
              type="text"
              placeholder="如 跳线x3 污渍x2 尺寸超差x1"
              value={inspection?.defectSummary ?? ''}
              onChange={e => handleInspectionSave('defectSummary', e.target.value)}
              className={cx('h-8 w-full rounded-control border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
            />
          </div>

          {inspection && inspection.totalUnits > 0 && (
            <div className="mt-3 space-y-1">
              <div className={cx('flex justify-between text-[11px]', textSecondary)}>
                <span>合格率: <span className={inspection.passRate >= 0.9 ? 'text-emerald-500 font-normal' : 'text-red-500 font-normal'}>{(inspection.passRate * 100).toFixed(1)}%</span></span>
                <span>不合格率: <span className={inspection.defectRate <= 0.03 ? 'text-emerald-500 font-normal' : 'text-red-500 font-normal'}>{(inspection.defectRate * 100).toFixed(1)}%</span></span>
                {(inspection.criticalDefects ?? 0) > 0 && (
                  <span className="text-red-500 font-normal">致命疵点 {inspection.criticalDefects}（零容忍）</span>
                )}
              </div>
              {inspType === 'final' && (
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={inspection.approvedByBusiness}
                    onChange={e => handleInspectionSave('approvedByBusiness', e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                  <span className={cx('text-xs font-light', textPrimary)}>业务部批准发货</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
