import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  RefreshCw,
  ArrowRight,
  Calculator,
  Info,
  Zap,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { marketService } from '../../services/marketService';
import { statusSemanticClass, statusSemanticText, statusSemanticBg, statusSemanticGradient } from '../rdlBusinessStatusTokens';

const TAX_DIVISOR = 1.13; // 1 + 13% VAT
const REBATE_RATE = 0.13; // 13% export rebate rate (textile/garment)

interface ExchangeRateToolProps {
  isDarkMode: boolean;
}

const ExchangeRateTool: React.FC<ExchangeRateToolProps> = ({ isDarkMode }) => {
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [currentRate, setCurrentRate] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchRate = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await marketService.refreshCommodities();
      const rate = marketService.getUsdCnyRate();
      setCurrentRate(rate);
      setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e) {
      console.warn('Failed to fetch exchange rate:', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRate();
    const interval = setInterval(fetchRate, 60000);
    return () => clearInterval(interval);
  }, [fetchRate]);

  // 退税核算汇率 = 实时汇率 × 1.13 / (1.13 − 退税率)（独立于采购价）
  const internalRate = currentRate > 0 ? currentRate * TAX_DIVISOR / (TAX_DIVISOR - REBATE_RATE) : 0;

  // 采购价换算（需要输入）
  const price = parseFloat(purchasePrice);
  const hasValidPrice = price > 0 && currentRate > 0;
  const taxRefund = hasValidPrice ? price / TAX_DIVISOR * 0.13 : 0;
  const costPriceCny = hasValidPrice ? price - taxRefund : 0;
  const usdCost = hasValidPrice ? price / internalRate : 0;

  const formatNumber = (num: number, decimals: number = 2): string => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const handleCopy = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="relative z-30 flex-shrink-0">
        <h2 className={`text-xl font-normal tracking-tight leading-snug ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
          外贸汇率工具
        </h2>
        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          退税换算 · 实时汇率 · 快速算成本
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3">
        <div className="space-y-3 pb-4">

          {/* ── Dual Rate Banner ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* Real-time Rate */}
            <div className={`
              relative overflow-hidden p-4 rounded-xl
              ${isDarkMode
                ? 'bg-gradient-to-br from-[var(--os-vnext-brand-blue)]/10 to-transparent border border-[var(--os-vnext-brand-blue)]/20'
                : 'bg-gradient-to-br from-slate-50 to-transparent border border-slate-200'}
            `}>
              <div className={`text-[9px] font-light uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                实时汇率
              </div>
              <div className={`text-xl font-light tabular-nums tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {currentRate > 0 ? currentRate.toFixed(4) : '--'}
              </div>
              <div className={`text-[9px] mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                USD/CNY
              </div>
              {/* Live pulse */}
              <div className="absolute top-3 right-3">
                <span className="flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusSemanticBg('active', isDarkMode)}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${statusSemanticBg('active', isDarkMode)}`} />
                </span>
              </div>
            </div>

            {/* Trade Rate */}
            <div className={`
              relative overflow-hidden p-4 rounded-xl
              bg-gradient-to-br ${statusSemanticGradient('rebate', isDarkMode)}
            `}>
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={10} className={statusSemanticText('rebate', isDarkMode)} />
                <span className={`text-[9px] font-light uppercase tracking-wider ${statusSemanticText('rebate', isDarkMode)}`}>
                  退税核算汇率
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-xl font-light tabular-nums tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                  {internalRate > 0 ? internalRate.toFixed(4) : '--'}
                </span>
                {internalRate > 0 && (
                  <CopyButton value={internalRate.toFixed(4)} field="internalRate" size={12} />
                )}
              </div>
              <div className={`text-[9px] mt-1 ${statusSemanticText('rebate', isDarkMode)}`}>
                实时汇率 × 1.13 ÷ (1.13−0.13)
              </div>
            </div>
          </div>

          {/* Refresh row */}
          <div className="flex items-center justify-between">
            <span className={`text-[9px] tabular-nums ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
              {lastUpdated ? `更新于 ${lastUpdated}` : '等待数据...'}
            </span>
            <button
              onClick={fetchRate}
              disabled={isRefreshing}
              className={`
                flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-light
                transition-all duration-300
                ${isDarkMode
                  ? 'hover:bg-white/5 text-slate-400 hover:text-[var(--os-vnext-brand-blue)]'
                  : 'hover:bg-slate-100/60 text-slate-400 hover:text-[var(--os-vnext-brand-blue)]'}
                disabled:opacity-50
              `}
            >
              <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>

          {/* ── Trade Rate Explanation ── */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className={`
              p-4 rounded-xl
              ${statusSemanticClass('rebate', isDarkMode)}
            `}>
            <div className="flex items-start gap-2.5">
              <Info size={14} className={`mt-0.5 flex-shrink-0 ${statusSemanticText('rebate', isDarkMode)}`} />
              <div className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                <p>
                  <span className={`font-light ${statusSemanticText('rebate', isDarkMode)}`}>退税核算汇率</span> = 实时汇率 × 1.13 ÷ (1.13 − 退税率)
                </p>
                <p className="mt-1.5">
                  业务员速算：采购价 ÷ 退税核算汇率 = <span className="font-light">美元成本</span>
                </p>
                {internalRate > 0 && (
                  <p className="mt-1 font-mono text-[11px]">
                    例：¥100,000 ÷ {internalRate.toFixed(4)} = ${(100000 / internalRate).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── Purchase Price Input ── */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
            <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              采购价转美元成本
            </h3>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-light ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                ¥
              </span>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="输入人民币采购价"
                min="0"
                step="0.01"
                className={`
                  w-full pl-8 pr-4 py-3 rounded-xl text-lg font-light tabular-nums
                  ${isDarkMode
                    ? 'bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:border-[var(--os-vnext-brand-blue)]/50'
                    : 'bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[var(--os-vnext-brand-blue)]'}
                  focus:outline-none transition-colors
                `}
              />
            </div>
          </div>

          {/* ── Calculation Result ── */}
          {hasValidPrice && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-3"
            >
              {/* Step-by-step */}
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
                <h3 className={`text-xs font-light uppercase tracking-wider mb-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <Calculator size={12} className="inline mr-1.5" />
                  计算过程
                </h3>

                <div className="space-y-3">
                  {/* Step 1: Tax Refund */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/[0.03] border border-white/5' : 'bg-slate-50 border border-slate-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-[10px] font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          退税额
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          采购价 ÷ 1.13 × 0.13
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-lg font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          ¥{formatNumber(taxRefund)}
                        </span>
                        <CopyButton value={taxRefund.toFixed(2)} field="taxRefund" />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <ArrowRight size={14} className={`rotate-90 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
                  </div>

                  {/* Step 2: Cost Price (CNY) */}
                  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/[0.03] border border-white/5' : 'bg-slate-50 border border-slate-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-[10px] font-light uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          成本价（扣退税后）
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          采购价 − 退税额
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-lg font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          ¥{formatNumber(costPriceCny)}
                        </span>
                        <CopyButton value={costPriceCny.toFixed(2)} field="costPrice" />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <ArrowRight size={14} className={`rotate-90 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
                  </div>

                  {/* Step 3: USD Cost */}
                  <div className={`
                    p-4 rounded-lg
                    ${isDarkMode
                      ? 'bg-[var(--os-vnext-brand-blue)]/10 border border-[var(--os-vnext-brand-blue)]/20'
                      : 'bg-slate-100/60 border border-slate-200'}
                  `}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-[10px] font-light uppercase tracking-wider ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)]' : 'text-[var(--os-vnext-brand-blue)]'}`}>
                          美元成本
                        </div>
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-[var(--os-vnext-brand-blue)]/60' : 'text-slate-400'}`}>
                          采购价 ÷ 退税核算汇率({internalRate.toFixed(4)})
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-2xl font-light tabular-nums ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          <span className="text-sm opacity-40">$</span>{formatNumber(usdCost)}
                        </span>
                        <CopyButton value={usdCost.toFixed(2)} field="usdCost" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Reference */}
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/80'}`}>
                <h3 className={`text-xs font-light uppercase tracking-wider mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  汇总
                </h3>
                <div className="space-y-2">
                  {[
                    { label: '采购价', value: `¥${formatNumber(price)}`, color: '' },
                    { label: '退税额', value: `¥${formatNumber(taxRefund)}`, color: '' },
                    { label: '成本价', value: `¥${formatNumber(costPriceCny)}`, color: '' },
                    { label: '美元成本', value: `$${formatNumber(usdCost)}`, color: 'text-[var(--os-vnext-brand-blue)]' },
                    { label: '退税核算汇率', value: internalRate.toFixed(4), color: statusSemanticText('rebate', isDarkMode) },
                    { label: '实时汇率', value: currentRate.toFixed(4), color: '' },
                  ].map((row) => (
                    <div key={row.label} className={`flex items-center justify-between py-1.5 border-b last:border-0 ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        {row.label}
                      </span>
                      <span className={`text-sm font-light tabular-nums ${row.color || (isDarkMode ? 'text-white' : 'text-slate-900')}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Empty State */}
          {!hasValidPrice && currentRate > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`
                flex flex-col items-center justify-center py-8
                ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}
              `}
            >
              <Calculator size={36} strokeWidth={0.5} className="mb-3 opacity-30" />
              <p className="text-sm">输入采购价计算美元成本</p>
              <p className="text-xs mt-1 opacity-60">退税核算汇率已就绪：{internalRate.toFixed(4)}</p>
            </motion.div>
          )}

          {/* Rate Unavailable */}
          {currentRate === 0 && !isRefreshing && (
            <div className={`
              flex flex-col items-center justify-center py-8
              ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}
            `}>
              <TrendingUp size={36} strokeWidth={0.5} className="mb-3 opacity-30" />
              <p className="text-sm">正在获取实时汇率</p>
              <button
                onClick={fetchRate}
                className="mt-2 text-xs text-[var(--os-vnext-brand-blue)] hover:underline"
              >
                手动刷新
              </button>
            </div>
          )}

          {/* Formula Explanation */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/[0.02]' : 'bg-slate-50/50'}`}>
            <h3 className={`text-[10px] font-light uppercase tracking-wider mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              计算公式说明
            </h3>
            <div className={`text-xs leading-relaxed space-y-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <p>1. <span className="font-light">退税额</span> = 采购价 ÷ 1.13 × 0.13</p>
              <p>2. <span className="font-light">成本价</span> = 采购价 − 退税额</p>
              <p>3. <span className="font-light">美元成本</span> = 采购价 ÷ 退税核算汇率</p>
              <p className="pt-1 border-t border-dashed border-current/20">
                <span className={`font-light ${statusSemanticText('rebate', isDarkMode)}`}>退税核算汇率</span> = 实时汇率 × 1.13 ÷ (1.13 − 退税率) = {internalRate > 0 ? internalRate.toFixed(4) : '--'}
              </p>
              <p className="opacity-60">
                * 增值税率 13%，出口退税率 13%（纺织品/服装）
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExchangeRateTool;
