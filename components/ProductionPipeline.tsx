import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import ToggleSwitch from './ui/ToggleSwitch';
import CapsuleDateInput from './ui/CapsuleDateInput';
import CustomSelect from './ui/CustomSelect';
import SidePanelContainer from './ui/SidePanelContainer';
import OrderSectionHeader from './order/OrderSectionHeader';
import { createOrderUiSpec } from './order/orderUiSpec';
import { statusSemanticClass, statusSemanticText } from './rdlBusinessStatusTokens';
import { formatYmd } from '../lib/dateFormat';
import { productionService } from '../services/productionService';
import type { OutsourcingProgress } from '../services/productionService';
import { hasPermission } from '../services/authService';
import { bdsToast } from './ui/bdsToast';

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

// 阶段 D / D5：外协工序与状态标签（真源 mes OutsourcingOrder，此处只读）
const PROCESS_TYPE_LABELS: Record<string, string> = {
  Sewing: '缝制', Cutting: '裁剪', Washing: '水洗', Printing: '印花',
  Embroidery: '绣花', Dyeing: '染色', Other: '其他',
};

const OUTSOURCING_STATUS_LABELS: Record<string, string> = {
  Draft: '草稿', Sent: '已发出', Confirmed: '已确认',
  InProduction: '生产中', Received: '已到货', Cancelled: '已取消',
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
  const [outsourcing, setOutsourcing] = useState<OutsourcingProgress[]>([]);
  const [inspType, setInspType] = useState<'final' | 'midline'>('final');
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 初始加载失败专用态：断网/500 时显式提示 + 重试，不再静默吞错落空白面板
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 统一规范真源（orderUiSpec）：玻璃面板 + inset 子区块，与详情页所有面板同构 ──
  const spec = createOrderUiSpec(isDarkMode);
  // R6：推进/双签/检查/验货均为写操作（后端 production:write scope 门）——
  // 无权限：按钮隐藏；表单控件（ToggleSwitch/验货录入）disabled 保只读视图
  const canWrite = hasPermission('production:write');
  const textPrimary = spec.textPrimary;
  const textSecondary = spec.textMuted;
  const surfaceClass = spec.insetSurface;
  const fieldCls = spec.field;
  const noSpinnerCls = spec.fieldNoSpinner;
  // 状态色唯一来源：RDL 语义 token（success/danger 中性 opacity）；当前态锚点用 accent 品牌蓝
  const successText = statusSemanticText('success', isDarkMode);
  const dangerText = statusSemanticText('danger', isDarkMode);
  const accentText = 'text-[var(--os-vnext-brand-blue)]';
  const signedChipCls = statusSemanticClass('success', isDarkMode);

  const inspection = inspections.find(i => (i.inspectionType ?? 'final') === inspType) ?? null;

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await productionService.getPipeline(orderId);
      setStages(data.stages);
      setChecklist(data.checklist);
      setInspections(data.inspections && data.inspections.length > 0 ? data.inspections : (data.inspection ? [data.inspection] : []));
      setOutsourcing(data.outsourcing ?? []);
    } catch (e: any) {
      setLoadError(e?.message || '网络或服务异常');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  const handleAdvance = async (stageKey: string) => {
    setAdvancing(stageKey);
    setError(null);
    try {
      const stage = await productionService.advanceStage(orderId, stageKey);
      setStages(prev => prev.map(s => s.stageKey === stageKey ? stage : s));
      bdsToast.success(`已推进到「${STAGE_LABELS[stageKey] || stageKey}」`);
    } catch (e: any) {
      setError(e?.message || '阶段推进失败');
    }
    setAdvancing(null);
  };

  const handleChecklistToggle = async (field: keyof PreCutChecklist) => {
    // 后端仅返回已存在的 checklist 行；新订单为 null。以全 false 基底乐观更新，
    // 让后端 upsert 建行，否则新订单的四项门禁开关永远失效（无法初始化）。
    const base: PreCutChecklist = checklist ?? {
      orderId,
      gradingConfirmed: false,
      consumptionConfirmed: false,
      patternConfirmed: false,
      preProductionMeeting: false,
    };
    const updated = { ...base, [field]: !base[field] };
    setChecklist(updated);
    try {
      const saved = await productionService.saveChecklist(orderId, { [field]: updated[field] });
      setChecklist(saved);
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

  const doneCount = stages.filter(s => s.status === 'done').length;

  if (loading) {
    return (
      <SidePanelContainer
        materialRole="raisedCard"
        edgeFadeItem
        spotlight
        isDarkMode={isDarkMode}
        className={spec.panelClass}
        contentClassName={spec.panelContentClass}
      >
        <div className={cx('flex items-center gap-2', spec.emptyText)}>
          <Loader2 size={14} className="animate-spin" /> 加载生产管线...
        </div>
      </SidePanelContainer>
    );
  }

  return (
    <SidePanelContainer
      materialRole="raisedCard"
      edgeFadeItem
      spotlight
      isDarkMode={isDarkMode}
      className={spec.panelClass}
      contentClassName={spec.panelContentClass}
    >
      <OrderSectionHeader
        iconKey="pipeline"
        kicker="Production Pipeline"
        title="生产管线"
        meta={stages.length > 0 ? `${doneCount}/${stages.length} 阶段已完成` : undefined}
        isDarkMode={isDarkMode}
      />

      {error && (
        <div className={cx('mb-3', spec.bannerDanger)}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loadError && (
        <div className={cx('mb-3', spec.bannerDanger)} role="alert">
          <AlertCircle size={14} />
          <span className="flex-1 min-w-0">加载生产管线失败：{loadError}</span>
          <button
            onClick={fetchPipeline}
            disabled={loading}
            className={cx(spec.btnBase, spec.btnGhost, 'ml-auto shrink-0')}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            重试
          </button>
        </div>
      )}

      {/* 初始加载失败且无数据时不再渲染下方空白分区（避免误导为"无数据"） */}
      {!(loadError && stages.length === 0) && (
      <div className="flex flex-col gap-3.5">
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
                    <CheckCircle2 size={16} className={successText} />
                  ) : isCurrent ? (
                    <Circle size={16} className={accentText} />
                  ) : (
                    <Circle size={16} className={spec.textFaint} />
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
                      {formatYmd(stage.doneAt)}
                    </span>
                  )}
                </div>
                {canWrite && canAdvance && (
                  <button
                    onClick={() => handleAdvance(stage.stageKey)}
                    disabled={advancing === stage.stageKey}
                    className={cx(
                      spec.btnBase,
                      spec.btnGhost,
                      advancing === stage.stageKey && 'opacity-50',
                    )}
                  >
                    {advancing === stage.stageKey ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                    推进
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 阶段 D / D5：外协加工进度（只读，真源 OutsourcingOrder；管理入口在 MES 可选模块） */}
      <div className={cx('rounded-inset border p-4', surfaceClass)}>
        <div className={cx('mb-3', spec.subGroupTitle)}>外协加工进度</div>
        {outsourcing.length === 0 ? (
          <p className={spec.emptyText}>无外协加工</p>
        ) : (
          <div className="space-y-2">
            {outsourcing.map(o => {
              const accepted = o.qualityAcceptedQty ?? 0;
              const rejected = o.qualityRejectedQty ?? 0;
              const inspected = accepted + rejected > 0;
              return (
                <div key={o.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className={cx('text-xs font-light truncate', textPrimary)}>
                      {o.orderNumber} · {o.supplierName || '未指定加工厂'} · {PROCESS_TYPE_LABELS[o.processType] || o.processType}
                    </span>
                    <div className={cx('mt-0.5 text-[10px] font-light', textSecondary)}>
                      {o.quantity} {o.unit}
                      {inspected && ` · 验收 合格${accepted} / 不合格${rejected}`}
                      {o.actualDeliveryDate
                        ? ` · 实到 ${o.actualDeliveryDate}`
                        : o.plannedDeliveryDate ? ` · 计划 ${o.plannedDeliveryDate}` : ''}
                    </div>
                  </div>
                  <span className={cx(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-light',
                    o.status === 'Received'
                      ? statusSemanticClass('success', isDarkMode)
                      : o.status === 'Cancelled'
                        ? statusSemanticClass('neutral', isDarkMode)
                        : statusSemanticClass('active', isDarkMode),
                  )}>
                    {OUTSOURCING_STATUS_LABELS[o.status] || o.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PP Sample Dual Sign */}
      {stages.some(s => s.stageKey === 'pp_sample_approved') && (() => {
        const ppStage = stages.find(s => s.stageKey === 'pp_sample_approved');
        if (!ppStage) return null;
        return (
          <div className={cx('rounded-inset border p-4', surfaceClass)}>
            <div className={cx('mb-3', spec.subGroupTitle)}>产前样双签确认</div>
            {canWrite ? (
            <div className="grid grid-cols-2 gap-3 justify-items-center">
              <button
                onClick={async () => {
                  try {
                    const updated = await productionService.signStage(orderId, 'pp_sample_approved', 'production');
                    setStages(prev => prev.map(s => s.id === updated.id ? updated : s));
                    bdsToast.success('生产部签字完成');
                  } catch (e: any) { setError(e?.message || '签字失败'); }
                }}
                className={cx(
                  spec.btnBase,
                  ppStage.signedByProduction ? signedChipCls : spec.btnGhost,
                )}
              >
                {ppStage.signedByProduction ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                生产部 {ppStage.signedByProduction ? '已签' : '签字'}
              </button>
              <button
                onClick={async () => {
                  try {
                    const updated = await productionService.signStage(orderId, 'pp_sample_approved', 'business');
                    setStages(prev => prev.map(s => s.id === updated.id ? updated : s));
                    bdsToast.success('业务部签字完成');
                  } catch (e: any) { setError(e?.message || '签字失败'); }
                }}
                className={cx(
                  spec.btnBase,
                  ppStage.signedByBusiness ? signedChipCls : spec.btnGhost,
                )}
              >
                {ppStage.signedByBusiness ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                业务部 {ppStage.signedByBusiness ? '已签' : '签字'}
              </button>
            </div>
            ) : (
            /* R6：无 production:write — 双签入口隐藏，签署状态降级为只读徽标 */
            <div className="grid grid-cols-2 gap-3 justify-items-center">
              <span className={cx(spec.btnBase, ppStage.signedByProduction ? signedChipCls : spec.btnGhost, 'pointer-events-none')}>
                {ppStage.signedByProduction ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                生产部 {ppStage.signedByProduction ? '已签' : '未签'}
              </span>
              <span className={cx(spec.btnBase, ppStage.signedByBusiness ? signedChipCls : spec.btnGhost, 'pointer-events-none')}>
                {ppStage.signedByBusiness ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                业务部 {ppStage.signedByBusiness ? '已签' : '未签'}
              </span>
            </div>
            )}
          </div>
        );
      })()}

      {/* PreCut Checklist */}
      {stages.some(s => s.stageKey === 'pre_cut_checked') && (
        <div className={cx('rounded-inset border p-4', surfaceClass)}>
          <div className={cx('mb-3', spec.subGroupTitle)}>裁剪前检查 (四项门禁)</div>
          <div className="space-y-2">
            {([
              ['gradingConfirmed', '推码确认'],
              ['consumptionConfirmed', '耗料确认'],
              ['patternConfirmed', '样板确认'],
              ['preProductionMeeting', '产前会议'],
            ] as const).map(([field, label]) => {
              const on = checklist?.[field] ?? false;
              return (
                <div
                  key={field}
                  className={spec.toggleShell}
                >
                  <ToggleSwitch
                    checked={on}
                    isDarkMode={isDarkMode}
                    ariaLabel={label}
                    disabled={!canWrite}
                    onChange={() => handleChecklistToggle(field)}
                  />
                  <span className={cx('text-xs font-light', textPrimary)}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inspection Report — Phase B4：中期/终期双报告 + AQL/三级疵点 */}
      {stages.some(s => s.stageKey === 'qc_shipped') && (
        <div className={cx('rounded-inset border p-4', surfaceClass)}>
          <div className="mb-3 flex items-center justify-between">
            <div className={spec.subGroupTitle}>
              验货报告{inspType === 'final' ? ' (门禁: 合格率≥90% 不合格率≤3% 致命疵点=0)' : ''}
            </div>
            <div className="flex items-center gap-1">
              {(['final', 'midline'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInspType(t)}
                  className={cx(
                    spec.btnBase,
                    inspType === t ? spec.btnActive : spec.btnGhost,
                  )}
                >
                  {t === 'final' ? '终期验货' : '中期验货'}
                </button>
              ))}
            </div>
          </div>

          {/* R6：验货报告录入区整体 fieldset 门禁（无 production:write 全部控件 disabled，保只读视图） */}
          <fieldset disabled={!canWrite} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货日期</label>
              <CapsuleDateInput
                value={inspection?.inspectionDate ?? ''}
                className={cx(fieldCls, noSpinnerCls)}
                onChange={(v) => handleInspectionSave('inspectionDate', v)}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货方</label>
              <input
                type="text"
                placeholder="自有 QC / SGS / BV / 客户验货员"
                value={inspection?.inspectorOrg ?? ''}
                onChange={e => handleInspectionSave('inspectorOrg', e.target.value)}
                className={cx(fieldCls, noSpinnerCls)}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>AQL 标准</label>
              <input
                type="text"
                placeholder="如 2.5/4.0 II"
                value={inspection?.aqlLevel ?? ''}
                onChange={e => handleInspectionSave('aqlLevel', e.target.value)}
                className={cx(fieldCls, noSpinnerCls)}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>验货结论</label>
              <CustomSelect
                surface="form"
                disabled={!canWrite}
                value={inspection?.result ?? ''}
                onChange={v => handleInspectionSave('result', v || null)}
                options={[
                  { value: '', label: '未判定' },
                  { value: 'pass', label: '合格 Pass' },
                  { value: 'conditional', label: '有条件合格 Conditional' },
                  { value: 'fail', label: '不合格 Fail' },
                ]}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>批量 / 抽样数</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="批量"
                  value={inspection?.lotSize ?? ''}
                  onChange={e => handleInspectionSave('lotSize', e.target.value ? Number(e.target.value) : null)}
                  className={cx(fieldCls, noSpinnerCls)}
                />
                <input
                  type="number"
                  placeholder="抽样"
                  value={inspection?.sampleSize ?? ''}
                  onChange={e => handleInspectionSave('sampleSize', e.target.value ? Number(e.target.value) : null)}
                  className={cx(fieldCls, noSpinnerCls)}
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
                  className={cx(fieldCls, noSpinnerCls)}
                />
                <input
                  type="number"
                  placeholder="主要"
                  value={inspection?.majorDefects ?? ''}
                  onChange={e => handleInspectionSave('majorDefects', Number(e.target.value) || 0)}
                  className={cx(fieldCls, noSpinnerCls)}
                />
                <input
                  type="number"
                  placeholder="次要"
                  value={inspection?.minorDefects ?? ''}
                  onChange={e => handleInspectionSave('minorDefects', Number(e.target.value) || 0)}
                  className={cx(fieldCls, noSpinnerCls)}
                />
              </div>
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>总检验件数</label>
              <input
                type="number"
                value={inspection?.totalUnits ?? ''}
                onChange={e => handleInspectionSave('totalUnits', Number(e.target.value) || 0)}
                className={cx(fieldCls, noSpinnerCls)}
              />
            </div>
            <div>
              <label className={cx('mb-1 block text-[10px]', textSecondary)}>合格件数</label>
              <input
                type="number"
                value={inspection?.passedUnits ?? ''}
                onChange={e => handleInspectionSave('passedUnits', Number(e.target.value) || 0)}
                className={cx(fieldCls, noSpinnerCls)}
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
              className={cx(fieldCls, noSpinnerCls)}
            />
          </div>

          {inspection && inspection.totalUnits > 0 && (
            <div className="mt-3 space-y-1">
              <div className={cx('flex justify-between text-xs', textSecondary)}>
                <span>合格率: <span className={`${inspection.passRate >= 0.9 ? successText : dangerText} font-normal`}>{(inspection.passRate * 100).toFixed(1)}%</span></span>
                <span>不合格率: <span className={`${inspection.defectRate <= 0.03 ? successText : dangerText} font-normal`}>{(inspection.defectRate * 100).toFixed(1)}%</span></span>
                {(inspection.criticalDefects ?? 0) > 0 && (
                  <span className={`${dangerText} font-normal`}>致命疵点 {inspection.criticalDefects}（零容忍）</span>
                )}
              </div>
              {inspType === 'final' && (
                <div className="mt-2">
                  <div className={spec.toggleShell}>
                    <ToggleSwitch
                      checked={inspection.approvedByBusiness}
                      isDarkMode={isDarkMode}
                      ariaLabel="业务部批准发货"
                      disabled={!canWrite}
                      onChange={(next) => handleInspectionSave('approvedByBusiness', next)}
                    />
                    <span className={textPrimary}>业务部批准发货</span>
                  </div>
                </div>
              )}
            </div>
          )}
          </fieldset>
        </div>
      )}
      </div>
      )}
    </SidePanelContainer>
  );
};
