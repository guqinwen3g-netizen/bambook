/**
 * 报价计算器
 * 面料/成衣外贸报价：原料 + 工费 + 费用 → FOB/CIF 含利润报价
 * 纯前端计算，支持多币种换算与利润率/ markup 两种模式
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Calculator,
  TrendingUp,
  RefreshCw,
  Info,
  Copy,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { marketService } from '../../services/marketService';
import { statusSemanticText } from '../rdlBusinessStatusTokens';

// ==================== 常量 ====================
const CURRENCY_OPTIONS = ['USD', 'CNY', 'EUR'] as const;
type Currency = (typeof CURRENCY_OPTIONS)[number];

const COST_FIELD_LABELS = {
  fabricCost: '面料成本 (YD/KG)',
  accessoriesCost: '辅料成本',
  processingCost: '加工费',
  overheadCost: '管理/其他费用',
  freightCost: '内陆运费',
  insuranceCost: '保险费',
} as const;

type CostFieldKey = keyof typeof COST_FIELD_LABELS;

interface CostRow {
  key: CostFieldKey;
  value: string;
}

// ==================== 组件 ====================
interface QuoteCalculatorProps {
  isDarkMode: boolean;
}

const QuoteCalculator: React.FC<QuoteCalculatorProps> = ({ isDarkMode }) => {
  const [costRows, setCostRows] = useState<CostRow[]>([
    { key: 'fabricCost', value: '' },
    { key: 'processingCost', value: '' },
    { key: 'overheadCost', value: '' },
  ]);
  const [quantity, setQuantity] = useState<string>('1000');
  const [unit, setUnit] = useState<string>('YD');
  const [profitMode, setProfitMode] = useState<'margin' | 'markup'>('margin');
  const [profitRate, setProfitRate] = useState<string>('15');
  const [targetCurrency, setTargetCurrency] = useState<Currency>('USD');
  const [sourceCurrency, setSourceCurrency] = useState<Currency>('CNY');
  const [freightCost, setFreightCost] = useState<string>('');
  const [insuranceCost, setInsuranceCost] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const usdCnyRate = marketService.getUsdCnyRate() || 7.2;

  // 汇率矩阵（基于 USD:CNY 基准换算）
  const rateMatrix = useMemo(() => {
    const usdToCny = usdCnyRate;
    const eurToUsd = 1.08; // 预估欧元对美元，外贸常用近似
    const matrix: Record<Currency, Record<Currency, number>> = {
      USD: { USD: 1, CNY: usdToCny, EUR: 1 / eurToUsd },
      CNY: { USD: 1 / usdToCny, CNY: 1, EUR: 1 / (usdToCny * eurToUsd) },
      EUR: { USD: eurToUsd, CNY: eurToUsd * usdToCny, EUR: 1 },
    };
    return matrix;
  }, [usdCnyRate]);

  const parseNum = (s: string): number => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // 核心计算逻辑
  const calc = useMemo(() => {
    const costPerUnitInSource = costRows.reduce((sum, r) => sum + parseNum(r.value), 0);
    const qty = parseNum(quantity);
    const totalCostInSource = costPerUnitInSource * qty;

    const rate = rateMatrix[sourceCurrency][targetCurrency];
    const costPerUnitInTarget = costPerUnitInSource * rate;
    const totalCostInTarget = totalCostInSource * rate;

    // 利润计算
    const profitPct = parseNum(profitRate) / 100;
    let fobPerUnit: number;
    if (profitMode === 'margin') {
      // 利润率 = 利润 / 售价 → 售价 = 成本 / (1 - 利润率)
      fobPerUnit = profitPct < 1 ? costPerUnitInTarget / (1 - profitPct) : 0;
    } else {
      // 加成率 = 利润 / 成本 → 售价 = 成本 * (1 + 加成率)
      fobPerUnit = costPerUnitInTarget * (1 + profitPct);
    }
    const fobTotal = fobPerUnit * qty;
    const profitPerUnit = fobPerUnit - costPerUnitInTarget;
    const totalProfit = profitPerUnit * qty;
    const actualMargin = fobPerUnit > 0 ? (profitPerUnit / fobPerUnit) * 100 : 0;

    // CIF = FOB + 运费 + 保险
    const freightPerUnit = (parseNum(freightCost) * rate) / Math.max(qty, 1);
    const insurancePerUnit = (parseNum(insuranceCost) * rate) / Math.max(qty, 1);
    const cifPerUnit = fobPerUnit + freightPerUnit + insurancePerUnit;
    const cifTotal = cifPerUnit * qty;

    return {
      costPerUnitInTarget,
      totalCostInTarget,
      fobPerUnit,
      fobTotal,
      profitPerUnit,
      totalProfit,
      actualMargin,
      cifPerUnit,
      cifTotal,
      freightPerUnit,
      insurancePerUnit,
      rate,
    };
  }, [costRows, quantity, profitMode, profitRate, sourceCurrency, targetCurrency, rateMatrix, freightCost, insuranceCost]);

  const formatNumber = (n: number, decimals = 4) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const handleCopy = useCallback((value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }, []);

  const handleReset = () => {
    setCostRows([
      { key: 'fabricCost', value: '' },
      { key: 'processingCost', value: '' },
      { key: 'overheadCost', value: '' },
    ]);
    setQuantity('1000');
    setProfitRate('15');
    setProfitMode('margin');
    setFreightCost('');
    setInsuranceCost('');
  };

  const updateCostRow = (index: number, value: string) => {
    setCostRows(prev => prev.map((r, i) => (i === index ? { ...r, value } : r)));
  };

  const addCostRow = () => {
    const usedKeys = new Set(costRows.map(r => r.key));
    const nextKey = (Object.keys(COST_FIELD_LABELS) as CostFieldKey[]).find(k => !usedKeys.has(k));
    if (nextKey) {
      setCostRows([...costRows, { key: nextKey, value: '' }]);
    }
  };

  const removeCostRow = (index: number) => {
    setCostRows(prev => prev.filter((_, i) => i !== index));
  };

  const CopyButton: React.FC<{ value: string; field: string; size?: number }> = ({ value, field, size = 14 }) => (
    <button
      onClick={() => handleCopy(value, field)}
      className={`p-1 rounded transition-all duration-200 ${
        copiedField === field
          ? statusSemanticText('success', isDarkMode)
          : isDarkMode
            ? 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
            : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
      }`}
      title="复制"
    >
      {copiedField === field ? <CheckCircle2 size={size} /> : <Copy size={size} />}
    </button>
  );

  // 主题样式
  const panelClass = isDarkMode ? 'bg-white/5 border border-white/10' : 'bg-white/80 border border-slate-200';
  const fieldClass = `w-full px-3 py-2 rounded-control text-sm transition-colors focus:outline-none focus:border-[var(--os-vnext-brand-blue)] ${
    isDarkMode ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-500' : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelClass = `block text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;
  const sectionTitleClass = `text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="relative z-30 flex-shrink-0 flex items-end justify-between pb-1">
        <div>
          <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            报价计算器
          </h2>
          <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            成本测算 · 利润分析 · FOB/CIF 报价 · 多币种换算
          </p>
        </div>
        <button
          onClick={handleReset}
          className={`p-2 rounded-control transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
          title="重置"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="space-y-3 pb-4">
          {/* ── 成本输入区 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>成本明细（每单位）</h3>
            <div className="space-y-2">
              {costRows.map((row, index) => (
                <div key={`${row.key}-${index}`} className="flex items-center gap-2">
                  <div className="flex-1">
                    <select
                      value={row.key}
                      onChange={(e) => {
                        const newKey = e.target.value as CostFieldKey;
                        setCostRows(prev => prev.map((r, i) => (i === index ? { ...r, key: newKey } : r)));
                      }}
                      className={`${fieldClass} py-1.5`}
                    >
                      {(Object.keys(COST_FIELD_LABELS) as CostFieldKey[]).map(k => (
                        <option key={k} value={k}>{COST_FIELD_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-32">
                    <input
                      type="number"
                      step="0.01"
                      value={row.value}
                      onChange={(e) => updateCostRow(index, e.target.value)}
                      placeholder="0.00"
                      className={fieldClass}
                    />
                  </div>
                  <div className={`w-12 text-xs text-center ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{sourceCurrency}</div>
                  <button
                    onClick={() => removeCostRow(index)}
                    className={`p-1 rounded text-xs ${isDarkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}
                    title="移除"
                  >
                    ×
                  </button>
                </div>
              ))}
              {costRows.length < 6 && (
                <button
                  onClick={addCostRow}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    isDarkMode ? 'text-[var(--os-vnext-brand-blue)] hover:bg-white/5' : 'text-[var(--os-vnext-brand-blue)] hover:bg-slate-100/60'
                  }`}
                >
                  + 添加成本项
                </button>
              )}
            </div>

            {/* 数量与单位 */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className={labelClass}>数量</label>
                <input
                  type="number"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>单位</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className={fieldClass}
                >
                  <option value="YD">YD (码)</option>
                  <option value="M">M (米)</option>
                  <option value="KG">KG (千克)</option>
                  <option value="PC">PC (件)</option>
                  <option value="SET">SET (套)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── 利润与币种 ── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>利润与报价币种</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>成本币种</label>
                <select
                  value={sourceCurrency}
                  onChange={(e) => setSourceCurrency(e.target.value as Currency)}
                  className={fieldClass}
                >
                  {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>报价币种</label>
                <select
                  value={targetCurrency}
                  onChange={(e) => setTargetCurrency(e.target.value as Currency)}
                  className={fieldClass}
                >
                  {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* 汇率显示 */}
            {sourceCurrency !== targetCurrency && (
              <div className={`mt-3 px-3 py-2 rounded-inset text-xs flex items-center gap-2 ${
                isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-50 text-slate-500'
              }`}>
                <Info size={12} />
                <span>参考汇率 1 {sourceCurrency} = {formatNumber(calc.rate, 4)} {targetCurrency}</span>
                <span className={`ml-auto ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                  (USD/CNY {usdCnyRate.toFixed(4)})
                </span>
              </div>
            )}

            {/* 利润模式 */}
            <div className="mt-3">
              <label className={labelClass}>利润计算模式</label>
              <div className="flex gap-2 mb-2">
                {(['margin', 'markup'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setProfitMode(mode)}
                    className={`flex-1 py-2 rounded-full text-sm transition-colors ${
                      profitMode === mode
                        ? 'bg-[var(--os-vnext-brand-blue)] text-white'
                        : isDarkMode
                          ? 'bg-white/5 text-slate-400 hover:bg-white/10'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {mode === 'margin' ? '利润率 (按售价)' : '加成率 (按成本)'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={profitRate}
                  onChange={(e) => setProfitRate(e.target.value)}
                  className={`${fieldClass} flex-1`}
                />
                <span className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>%</span>
              </div>
            </div>
          </div>

          {/* ── 运费保险（CIF）── */}
          <div className={`p-4 rounded-card ${panelClass}`}>
            <h3 className={sectionTitleClass}>运费与保险（用于 CIF）</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>海运/空运费 ({sourceCurrency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={freightCost}
                  onChange={(e) => setFreightCost(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>保险费 ({sourceCurrency})</label>
                <input
                  type="number"
                  step="0.01"
                  value={insuranceCost}
                  onChange={(e) => setInsuranceCost(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>
            </div>
          </div>

          {/* ── 计算结果 ── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-5 rounded-card ${
              isDarkMode
                ? 'bg-gradient-to-br from-[var(--os-vnext-brand-blue)]/10 to-transparent border border-[var(--os-vnext-brand-blue)]/20'
                : 'bg-gradient-to-br from-slate-50 to-white border border-slate-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <Calculator size={16} className="text-[var(--os-vnext-brand-blue)]" />
              <h3 className={`text-sm font-light ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>报价结果</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* FOB 单价 */}
              <div className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  FOB 单价
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-xl font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(calc.fobPerUnit, 4)}
                  </span>
                  <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                  <CopyButton value={calc.fobPerUnit.toFixed(4)} field="fobUnit" />
                </div>
                <div className={`text-[9px] mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>/ {unit}</div>
              </div>

              {/* FOB 总价 */}
              <div className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  FOB 总价
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-xl font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(calc.fobTotal, 2)}
                  </span>
                  <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                  <CopyButton value={calc.fobTotal.toFixed(2)} field="fobTotal" />
                </div>
              </div>

              {/* 成本单价 */}
              <div className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  单位成本
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-lg font-light tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    {formatNumber(calc.costPerUnitInTarget, 4)}
                  </span>
                  <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                </div>
              </div>

              {/* 实际利润率 */}
              <div className={`p-3 rounded-inset ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  实际利润率
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-lg font-light tabular-nums ${calc.actualMargin > 0 ? statusSemanticText('success', isDarkMode) : statusSemanticText('danger', isDarkMode)}`}>
                    {formatNumber(calc.actualMargin, 2)}%
                  </span>
                </div>
              </div>
            </div>

            {/* 利润行 */}
            <div className={`mt-3 pt-3 border-t flex items-center justify-between ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className={statusSemanticText('success', isDarkMode)} />
                <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>总利润</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-lg font-light tabular-nums ${statusSemanticText('success', isDarkMode)}`}>
                  {formatNumber(calc.totalProfit, 2)}
                </span>
                <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                <CopyButton value={calc.totalProfit.toFixed(2)} field="profit" />
              </div>
            </div>

            {/* CIF 报价（如有运费保险） */}
            {(parseNum(freightCost) > 0 || parseNum(insuranceCost) > 0) && (
              <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      CIF 单价
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-lg font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {formatNumber(calc.cifPerUnit, 4)}
                      </span>
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                      <CopyButton value={calc.cifPerUnit.toFixed(4)} field="cifUnit" />
                    </div>
                  </div>
                  <div>
                    <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      CIF 总价
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-lg font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {formatNumber(calc.cifTotal, 2)}
                      </span>
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{targetCurrency}</span>
                      <CopyButton value={calc.cifTotal.toFixed(2)} field="cifTotal" />
                    </div>
                  </div>
                </div>
                <div className={`mt-2 text-[10px] flex items-center gap-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <ArrowRight size={10} />
                  <span>含运费 {formatNumber(calc.freightPerUnit, 4)} + 保险 {formatNumber(calc.insurancePerUnit, 4)} {targetCurrency}/{unit}</span>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default QuoteCalculator;
