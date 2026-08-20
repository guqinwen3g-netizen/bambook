/**
 * FreightImpactPanel — REQ2-14 海运费变动利润重估面板（利润表 tab 内嵌）
 *
 * 设计真源：docs/design/04-模块设计/05-财务与结算/海运费变动利润重估.md
 * DR-054：① 重估复用利润聚合真源（multiplier 仅计算层）② 受影响=活跃订单×有运费基数
 *         ③ 只读预览不落库（真实重估走运单更新+利润表重生成）
 *
 * X-04 锚点：倍率一击 → 全量受影响订单利润前后对比一屏可见。
 */

import React, { useCallback, useState } from 'react';
import { Loader2, Ship } from 'lucide-react';
import { apiService } from '../../services/apiService';
import type { FreightImpactResult, FreightImpactItem } from '../../types';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const PRESET_MULTIPLIERS = [1.5, 2, 3];

const ADVICE_META: Record<FreightImpactItem['advice'], { label: string; badge: string; hint: string }> = {
  renegotiate: { label: '利润转负 · 建议协商调价', badge: 'bds-badge sm danger', hint: '已签合同按现价执行将亏损，建议与客户协商调价或成本分担' },
  warn: { label: '利润率大跌 · 评估对策', badge: 'bds-badge sm warning', hint: '毛利率跌幅超 10 个百分点，评估加价、改条款或成本转移' },
  ok: { label: '可承受', badge: 'bds-badge sm', hint: '运费变动后利润率仍在可承受区间' },
};

function fmtCny(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}¥${Math.abs(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export function FreightImpactPanel() {
  const [multiplierInput, setMultiplierInput] = useState('3');
  const [result, setResult] = useState<FreightImpactResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (m: number) => {
    setLoading(true);
    try {
      setResult(await apiService.reestimateFreightImpact(m));
    } catch (e: any) {
      bdsToast.danger(`重估失败：${e?.message || e}`);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePreset = (m: number) => {
    setMultiplierInput(String(m));
    run(m);
  };

  const handleSubmit = () => {
    const m = Number(multiplierInput);
    if (!Number.isFinite(m) || m <= 0 || m > 100) {
      bdsToast.warning('倍率须为 (0, 100] 区间数值（如 3 = 运费涨 3 倍）。');
      return;
    }
    run(m);
  };

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';

  return (
    <div className="bds-card">
      <div className="flex items-center gap-2 mb-3">
        <Ship size={14} strokeWidth={1.5} className={textFaint} />
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>海运费变动重估 Freight Impact</h3>
      </div>
      <div className="text-[10px] mb-3 font-light" style={{ color: 'var(--text-quaternary)' }}>
        模拟运费倍率对活跃订单利润的影响（只读预览不落库；真实变动须更新运单费用后重新生成利润表）
      </div>

      {/* 倍率 chips + 自定义输入 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {PRESET_MULTIPLIERS.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => handlePreset(m)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-xs font-light transition-colors',
              result?.summary.multiplier === m
                ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
                : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
            )}
          >
            ×{m}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            type="number" min={0.1} step={0.1} max={100}
            value={multiplierInput}
            onChange={e => setMultiplierInput(e.target.value)}
            className="bds-input sm w-20"
            aria-label="运费倍率"
          />
          <button type="button" onClick={handleSubmit} disabled={loading} className="bds-btn bds-btn-secondary">
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            重估
          </button>
        </div>
      </div>

      {/* 结果 */}
      {loading && (
        <div className={cx('flex items-center justify-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" /> 扫描活跃订单运费基数并重估…
        </div>
      )}
      {!loading && result && result.items.length === 0 && (
        <div className={cx('py-6 text-center text-xs font-light', textFaint)}>
          无受影响订单——当前活跃订单均无运费基数（无活跃运单费用记录）
        </div>
      )}
      {!loading && result && result.items.length > 0 && (
        <>
          {/* summary 头 */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-inset px-3 py-2 bds-inset">
            <span className={cx('text-xs font-light', textSecondary)}>
              受影响 <span className={cx('tabular-nums', textPrimary)}>{result.summary.affectedOrders}</span> 单
            </span>
            <span className={cx('text-xs font-light tabular-nums', textSecondary)}>
              利润合计 {fmtCny(result.summary.baselineProfitTotal)} → <span className={textPrimary}>{fmtCny(result.summary.reestimatedProfitTotal)}</span>
            </span>
            <span className={cx('text-xs font-light tabular-nums', result.summary.deltaProfitTotal < 0 ? 'text-[var(--danger-text)]' : textSecondary)}>
              Δ {fmtCny(result.summary.deltaProfitTotal)}
            </span>
            {result.summary.renegotiateOrders > 0 && (
              <span className="bds-badge sm danger">转负 {result.summary.renegotiateOrders} 单</span>
            )}
            {result.summary.warnOrders > 0 && (
              <span className="bds-badge sm warning">大跌 {result.summary.warnOrders} 单</span>
            )}
          </div>

          {/* 受影响清单（X-04 一屏可见） */}
          <div className="space-y-1.5">
            {result.items.map(it => {
              const meta = ADVICE_META[it.advice];
              return (
                <div key={it.orderId} className="rounded-inset px-3 py-2.5 bds-inset">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={cx('bds-mono text-xs tabular-nums', textPrimary)}>{it.poNumber}</span>
                    <span className={cx('truncate text-xs font-light', textSecondary)}>{it.customer ?? '—'}</span>
                    <span className={meta.badge} title={meta.hint}>{meta.label}</span>
                    <span className={cx('ml-auto text-[11px] font-light tabular-nums', textSecondary)}>
                      毛利率 {fmtPct(it.baseline.grossMargin)} → {fmtPct(it.reestimated.grossMargin)}
                      {it.deltaMargin != null && (
                        <span className={it.deltaMargin < 0 ? 'text-[var(--danger-text)]' : ''}>（{it.deltaMargin > 0 ? '+' : ''}{it.deltaMargin.toFixed(1)}pt）</span>
                      )}
                    </span>
                  </div>
                  <div className={cx('mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] font-light tabular-nums', textSecondary)}>
                    <span>利润 {fmtCny(it.baseline.grossProfit)} → <span className={it.reestimated.grossProfit < 0 ? 'text-[var(--danger-text)]' : textPrimary}>{fmtCny(it.reestimated.grossProfit)}</span></span>
                    <span>运费 {fmtCny(it.baseline.freightCost)} → {fmtCny(it.reestimated.freightCost)}</span>
                    <span className={it.deltaProfit < 0 ? 'text-[var(--danger-text)]' : ''}>Δ {fmtCny(it.deltaProfit)}</span>
                    {it.baseline.source === 'computed' && (
                      <span className={textFaint} title="无已生成利润表，基准为现场计算">基准未落库</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!loading && !result && (
        <div className={cx('py-6 text-center text-xs font-light', textFaint)}>
          选择倍率或输入自定义值——立即查看受影响订单的利润变化与调价建议
        </div>
      )}
    </div>
  );
}

export default FreightImpactPanel;
