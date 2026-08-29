/**
 * 轨道 A 估算面板（PRD 8.1/8.6）— 共享组件
 *
 * 用途：PricingManager 定价计算器 tab + QuotationManager 报价编辑器双轨面板。
 * 口径：
 *   - 派生值（成本合计/估算区间/美元换算）一律以后端 calculateTrackA 返回为准
 *   - 逐项可调：拆解行失焦重算，手工改过的行标记 adjusted + manual
 *   - 估算仅内部使用（PRD 8.4），不对客户展示
 */

import React, { useEffect, useState } from 'react';
import { Calculator, Loader2, RefreshCw } from 'lucide-react';
import { apiService } from '../../services/apiService';
import {
  TrackACategory,
  TrackACostLine,
  TrackADataQuality,
  TrackAInput,
  TrackAResult,
  TrackASource,
} from '../../types';
import { statusSemanticClass, StatusSemantic } from '../rdlBusinessStatusTokens';
import { bdsToast } from '../ui/bdsToast';

const TRACKA_SOURCE_LABELS: Record<TrackASource, string> = {
  price_history: '价格历史',
  industry_benchmark: '行业基准',
  manual: '手工',
};

const TRACKA_QUALITY_LABELS: Record<TrackADataQuality, string> = {
  full_history: '数据充分 ±8%',
  partial: '部分基准 ±12%',
  benchmark_only: '行业基准 ±15%（无历史校准）',
};

const TRACKA_QUALITY_SEMANTIC: Record<TrackADataQuality, StatusSemantic> = {
  full_history: 'success',
  partial: 'warning',
  benchmark_only: 'neutral',
};

const inputClass = "bds-input w-full";
const actionButtonClass = "bds-btn bds-btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs";

function parseNum(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}

export interface TrackAPanelProps {
  /** 估算中位（USD）变化时回传，供报价编辑器偏差校验使用；无汇率/无结果时回传 null */
  onMedianUsdChange?: (medianUsd: number | null, unit?: 'PC' | 'M') => void;
  /** 有效输入变化时回传，供父组件收集 Track A 输入用于 applyTrackPricing */
  onInputsChange?: (input: TrackAInput | null) => void;
  /** R678-⑤：数据质量徽章走 statusSemanticClass（white/slate 双套），需要真实主题——缺省会被当浅色 */
  isDarkMode?: boolean;
}

export function TrackAPanel({ onMedianUsdChange, onInputsChange, isDarkMode }: TrackAPanelProps) {
  const [category, setCategory] = useState<TrackACategory>('garment');
  // 成衣输入
  const [fabricCode, setFabricCode] = useState('');
  const [fabricPriceCny, setFabricPriceCny] = useState('');
  const [fabricConsumptionM, setFabricConsumptionM] = useState('');
  const [fabricLossRate, setFabricLossRate] = useState('');
  const [trimmingCostCny, setTrimmingCostCny] = useState('');
  const [cmtCostCny, setCmtCostCny] = useState('');
  const [complexity, setComplexity] = useState<'simple' | 'standard' | 'complex'>('standard');
  const [packagingCostCny, setPackagingCostCny] = useState('');
  // 面料输入
  const [yarnCode, setYarnCode] = useState('');
  const [yarnPriceCnyPerKg, setYarnPriceCnyPerKg] = useState('');
  const [weightGsm, setWeightGsm] = useState('');
  const [widthM, setWidthM] = useState('');
  const [weavingCostCny, setWeavingCostCny] = useState('');
  const [weaveType, setWeaveType] = useState<'plain' | 'twill' | 'jacquard'>('twill');
  const [dyeingCostCny, setDyeingCostCny] = useState('');
  // 通用
  const [profitBenchmark, setProfitBenchmark] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');

  const [result, setResult] = useState<TrackAResult | null>(null);
  const [editedLines, setEditedLines] = useState<TrackACostLine[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const resetResult = () => { setResult(null); setEditedLines(null); };

  useEffect(() => {
    onMedianUsdChange?.(result?.priceMedianUsd ?? null, result?.unit);
  }, [result, onMedianUsdChange]);

  // 输入变化时回传，供父组件收集 Track A 输入
  useEffect(() => {
    onInputsChange?.(buildInput());
  }, [category, exchangeRate, profitBenchmark, fabricCode, fabricPriceCny,
    fabricConsumptionM, fabricLossRate, trimmingCostCny, cmtCostCny,
    packagingCostCny, complexity, yarnCode, yarnPriceCnyPerKg, weightGsm,
    widthM, weavingCostCny, weaveType, dyeingCostCny, editedLines, onInputsChange]);

  const handleFetchLatestFx = async () => {
    try {
      const rates = await apiService.getLatestFxRates();
      const usd = rates.find((r) => r.currency === 'USD');
      if (usd) setExchangeRate(String(usd.rate));
      else bdsToast.danger('未找到 USD 最新汇率');
    } catch (e) {
      console.error('[TrackAPanel] getLatestFxRates failed', e);
      bdsToast.danger('获取最新汇率失败');
    }
  };

  const buildInput = (): TrackAInput => {
    const fx = parseNum(exchangeRate);
    const pb = parseNum(profitBenchmark);
    // 逐项覆盖模式：用户改过拆解行后以 lines 为真源重算（PRD 8.6）
    if (editedLines) {
      return {
        category,
        lines: editedLines,
        ...(fx !== null ? { exchangeRate: fx } : {}),
        ...(pb !== null ? { profitBenchmark: pb } : {}),
      };
    }
    const input: TrackAInput = { category };
    if (fx !== null) input.exchangeRate = fx;
    if (pb !== null) input.profitBenchmark = pb;
    if (category === 'garment') {
      if (fabricCode.trim()) input.fabricCode = fabricCode.trim();
      const mappings: Array<[string, keyof TrackAInput]> = [
        [fabricPriceCny, 'fabricPriceCny'],
        [fabricConsumptionM, 'fabricConsumptionM'],
        [fabricLossRate, 'fabricLossRate'],
        [trimmingCostCny, 'trimmingCostCny'],
        [cmtCostCny, 'cmtCostCny'],
        [packagingCostCny, 'packagingCostCny'],
      ];
      for (const [raw, key] of mappings) {
        const n = parseNum(raw);
        if (n !== null) (input as any)[key] = n;
      }
      input.complexity = complexity;
    } else {
      if (yarnCode.trim()) input.yarnCode = yarnCode.trim();
      const mappings: Array<[string, keyof TrackAInput]> = [
        [yarnPriceCnyPerKg, 'yarnPriceCnyPerKg'],
        [weightGsm, 'weightGsm'],
        [widthM, 'widthM'],
        [weavingCostCny, 'weavingCostCny'],
        [dyeingCostCny, 'dyeingCostCny'],
      ];
      for (const [raw, key] of mappings) {
        const n = parseNum(raw);
        if (n !== null) (input as any)[key] = n;
      }
      input.weaveType = weaveType;
    }
    return input;
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const r = await apiService.previewTrackA(buildInput());
      setResult(r);
      setEditedLines(null); // 新估算以服务端拆解为基线
    } catch (e) {
      console.error('[TrackAPanel] previewTrackA failed', e);
      bdsToast.danger(`估算失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };

  /** 拆解行编辑（失焦重算）：手工改过的行标记 adjusted + manual（PRD 8.6） */
  const handleLineCommit = async (key: string, raw: string) => {
    if (!result) return;
    const n = parseNum(raw);
    if (n === null || n < 0) return;
    const next = result.lines.map((l) =>
      l.key === key ? { ...l, amountCny: n, source: 'manual' as TrackASource, adjusted: true } : l,
    );
    setEditedLines(next);
    setPreviewing(true);
    try {
      const fx = parseNum(exchangeRate);
      const pb = parseNum(profitBenchmark);
      const r = await apiService.previewTrackA({
        category,
        lines: next,
        ...(fx !== null ? { exchangeRate: fx } : {}),
        ...(pb !== null ? { profitBenchmark: pb } : {}),
      });
      setResult(r);
      setEditedLines(null); // 重算完成，result.lines 已含 adjusted 行
    } catch (e) {
      console.error('[TrackAPanel] line recalc failed', e);
      // R678-⑧：失焦重算失败原先仅 console.error 静默 → toast 提示（editedLines 保留，用户可再次失焦重试）
      bdsToast.danger(`重算失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="bg-surface-elevated rounded-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-light text-text-primary">轨道 A 估算（系统推荐 · 仅内部）</h3>
        <div className="flex items-center gap-1">
          {(['garment', 'fabric'] as TrackACategory[]).map((c) => (
            <button
              key={c}
              onClick={() => { setCategory(c); resetResult(); }}
              className={`px-3 py-1 text-xs rounded-control transition-colors ${
                category === c
                  ? 'bg-surface-primary text-text-primary ring-1 ring-border-action'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {c === 'garment' ? '成衣' : '面料'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {category === 'garment' ? (
          <>
            <Field label="面料编号（可命中价格历史）">
              <input className={inputClass} value={fabricCode} onChange={(e) => { setFabricCode(e.target.value); resetResult(); }} placeholder="如 FB-1001" />
            </Field>
            <Field label="面料单价（¥/米，缺省基准）">
              <input className={inputClass} value={fabricPriceCny} onChange={(e) => { setFabricPriceCny(e.target.value); resetResult(); }} placeholder="如 55" inputMode="decimal" />
            </Field>
            <Field label="单件用量（米，缺省 1.5）">
              <input className={inputClass} value={fabricConsumptionM} onChange={(e) => { setFabricConsumptionM(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="损耗率（%，缺省 3）">
              <input className={inputClass} value={fabricLossRate} onChange={(e) => { setFabricLossRate(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="辅料（¥/件，缺省基准）">
              <input className={inputClass} value={trimmingCostCny} onChange={(e) => { setTrimmingCostCny(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="CMT 加工费（¥/件，缺省按复杂度）">
              <input className={inputClass} value={cmtCostCny} onChange={(e) => { setCmtCostCny(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="工艺复杂度">
              <select className="bds-select" value={complexity} onChange={(e) => { setComplexity(e.target.value as typeof complexity); resetResult(); }}>
                <option value="simple">简单 ×0.85</option>
                <option value="standard">标准 ×1.0</option>
                <option value="complex">复杂 ×1.3</option>
              </select>
            </Field>
            <Field label="包装（¥/件，缺省基准）">
              <input className={inputClass} value={packagingCostCny} onChange={(e) => { setPackagingCostCny(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
          </>
        ) : (
          <>
            <Field label="纱线编号（可命中价格历史）">
              <input className={inputClass} value={yarnCode} onChange={(e) => { setYarnCode(e.target.value); resetResult(); }} placeholder="如 W100-32NM" />
            </Field>
            <Field label="纱线价（¥/kg，缺省基准）">
              <input className={inputClass} value={yarnPriceCnyPerKg} onChange={(e) => { setYarnPriceCnyPerKg(e.target.value); resetResult(); }} placeholder="如 180" inputMode="decimal" />
            </Field>
            <Field label="克重（g/m²，缺省 280）">
              <input className={inputClass} value={weightGsm} onChange={(e) => { setWeightGsm(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="幅宽（m，缺省 1.5）">
              <input className={inputClass} value={widthM} onChange={(e) => { setWidthM(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="织造费（¥/米，缺省按织法）">
              <input className={inputClass} value={weavingCostCny} onChange={(e) => { setWeavingCostCny(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
            <Field label="织法">
              <select className="bds-select" value={weaveType} onChange={(e) => { setWeaveType(e.target.value as typeof weaveType); resetResult(); }}>
                <option value="plain">平纹 ×1.0</option>
                <option value="twill">斜纹 ×1.15</option>
                <option value="jacquard">提花 ×1.4</option>
              </select>
            </Field>
            <Field label="染整费（¥/米，缺省基准）">
              <input className={inputClass} value={dyeingCostCny} onChange={(e) => { setDyeingCostCny(e.target.value); resetResult(); }} inputMode="decimal" />
            </Field>
          </>
        )}
        <Field label="利润基准（%，缺省品类基准）">
          <input className={inputClass} value={profitBenchmark} onChange={(e) => { setProfitBenchmark(e.target.value); resetResult(); }} placeholder={category === 'garment' ? '如 25' : '如 15'} inputMode="decimal" />
        </Field>
        <Field label="汇率（CNY/USD，出 $ 区间）">
          <div className="flex gap-2">
            <input className={inputClass} value={exchangeRate} onChange={(e) => { setExchangeRate(e.target.value); resetResult(); }} placeholder="如 7.10" inputMode="decimal" />
            <button onClick={handleFetchLatestFx} className={actionButtonClass} title="带入最新 USD 汇率">
              <RefreshCw className="w-3.5 h-3.5" />
              最新
            </button>
          </div>
        </Field>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handlePreview}
          disabled={previewing}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors disabled:opacity-50"
        >
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
          估算
        </button>
        {result && (
          <span className={`px-2 py-0.5 text-xs rounded-control ${statusSemanticClass(TRACKA_QUALITY_SEMANTIC[result.dataQuality], isDarkMode)}`}>
            {TRACKA_QUALITY_LABELS[result.dataQuality]}
          </span>
        )}
      </div>

      {/* 估算结果：成本拆解（逐项可调）+ 估算售价区间 */}
      {result && (
        <div className="mt-4 space-y-3">
          <div className="bg-surface-primary rounded-inset p-3">
            <p className="text-xs text-text-tertiary mb-2">成本拆解（¥/{result.unit === 'PC' ? '件' : '米'} · 改后失焦重算）</p>
            <div className="space-y-1.5">
              {result.lines.map((line) => (
                <div key={line.key} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-text-secondary">{line.label}</span>
                  <input
                    key={`${line.key}-${line.amountCny}`}
                    defaultValue={line.amountCny != null ? String(line.amountCny) : ''}
                    onBlur={(e) => {
                      // R678-⑧：非数字/负数输入原先静默丢弃 → 明确 toast（空值=未修改，不打扰）
                      const raw = e.target.value;
                      const n = parseNum(raw);
                      if (n === null || n < 0) {
                        if (raw.trim() !== '') bdsToast.warning('请输入有效数字（≥0），本次修改未生效');
                        return;
                      }
                      if (n !== line.amountCny) {
                        void handleLineCommit(line.key, raw);
                      }
                    }}
                    className="flex-1 min-w-0 bg-surface-elevated text-text-primary text-xs rounded-control px-2 py-1 border border-border-subtle outline-none focus:border-border-action"
                    inputMode="decimal"
                  />
                  <span className="w-16 shrink-0 text-right text-[10px] text-text-tertiary">
                    {TRACKA_SOURCE_LABELS[line.source]}{line.adjusted ? '·已调整' : ''}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-border-subtle">
                <span className="text-xs text-text-secondary">成本合计（中位）</span>
                <span className="text-sm font-light text-text-primary">¥{formatMoney(result.costTotalCny)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-primary rounded-inset p-3">
              <p className="text-xs text-text-tertiary">估算下限</p>
              <p className="text-base font-light text-text-primary">¥{formatMoney(result.priceLowCny)}</p>
              {result.priceLowUsd !== null && <p className="text-xs text-text-tertiary mt-0.5">${formatMoney(result.priceLowUsd)}</p>}
            </div>
            <div className="bg-surface-primary rounded-inset p-3 border border-border-action">
              <p className="text-xs text-text-tertiary">估算中位（含利润 {result.profitBenchmark}%）</p>
              <p className="text-base font-light text-text-primary">¥{formatMoney(result.priceMedianCny)}</p>
              {result.priceMedianUsd !== null && <p className="text-xs text-text-tertiary mt-0.5">${formatMoney(result.priceMedianUsd)}</p>}
            </div>
            <div className="bg-surface-primary rounded-inset p-3">
              <p className="text-xs text-text-tertiary">估算上限</p>
              <p className="text-base font-light text-text-primary">¥{formatMoney(result.priceHighCny)}</p>
              {result.priceHighUsd !== null && <p className="text-xs text-text-tertiary mt-0.5">${formatMoney(result.priceHighUsd)}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackAPanel;
