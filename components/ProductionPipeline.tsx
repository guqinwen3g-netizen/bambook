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
  totalUnits: number;
  passedUnits: number;
  passRate: number;
  defectRate: number;
  approvedByBusiness: boolean;
  inspectedBy?: string | null;
}

interface ProductionPipelineProps {
  orderId: string;
  isDarkMode?: boolean;
}

export const ProductionPipeline: React.FC<ProductionPipelineProps> = ({ orderId, isDarkMode = false }) => {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [checklist, setChecklist] = useState<PreCutChecklist | null>(null);
  const [inspection, setInspection] = useState<InspectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = isDarkMode ? 'text-slate-100' : 'text-slate-900';
  const textSecondary = isDarkMode ? 'text-white/50' : 'text-slate-500';
  const surfaceClass = isDarkMode ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-white border-slate-200/60';

  const fetchPipeline = useCallback(async () => {
    try {
      const data = await productionService.getPipeline(orderId);
      setStages(data.stages);
      setChecklist(data.checklist);
      setInspection(data.inspection);
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
      const report = await productionService.saveInspection(orderId, { [field]: value });
      setInspection(report);
    } catch { /* ignore */ }
  };

  if (loading) {
    return <div className={cx('flex items-center gap-2 p-4 text-xs', textSecondary)}><Loader2 size={14} className="animate-spin" /> 加载生产管线...</div>;
  }

  return (
    <div className="space-y-4">
      <div className={cx('text-[10px] font-light uppercase tracking-widest', textSecondary)}>生产管线 (10 阶段门禁)</div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
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
                      'flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[10px] font-light transition-all',
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

      {/* Inspection Report */}
      {stages.some(s => s.stageKey === 'qc_shipped') && (
        <div className={cx('rounded-inset border p-4', surfaceClass)}>
          <div className={cx('mb-3 text-[10px] font-light uppercase tracking-widest', textSecondary)}>验货报告 (阈值: 合格率≥90% 不合格率≤3%)</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>总检验件数</label>
              <input
                type="number"
                value={inspection?.totalUnits ?? ''}
                onChange={e => handleInspectionSave('totalUnits', Number(e.target.value) || 0)}
                className={cx('h-8 w-full rounded-lg border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>合格件数</label>
              <input
                type="number"
                value={inspection?.passedUnits ?? ''}
                onChange={e => handleInspectionSave('passedUnits', Number(e.target.value) || 0)}
                className={cx('h-8 w-full rounded-lg border px-2 text-xs', isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200')}
              />
            </div>
          </div>
          {inspection && inspection.totalUnits > 0 && (
            <div className="mt-3 space-y-1">
              <div className={cx('flex justify-between text-[11px]', textSecondary)}>
                <span>合格率: <span className={inspection.passRate >= 0.9 ? 'text-emerald-500 font-normal' : 'text-red-500 font-normal'}>{(inspection.passRate * 100).toFixed(1)}%</span></span>
                <span>不合格率: <span className={inspection.defectRate <= 0.03 ? 'text-emerald-500 font-normal' : 'text-red-500 font-normal'}>{(inspection.defectRate * 100).toFixed(1)}%</span></span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={inspection.approvedByBusiness}
                  onChange={e => handleInspectionSave('approvedByBusiness', e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-500"
                />
                <span className={cx('text-xs font-light', textPrimary)}>业务部批准发货</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
