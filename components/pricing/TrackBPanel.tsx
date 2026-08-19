/**
 * 轨道 B 退税美元定价面板（PRD 8.2/8.6）— 共享组件
 *
 * 用途：PricingManager 定价计算器 tab + QuotationManager 报价编辑器双轨面板。
 * 口径：
 *   - 派生值（netUsdCost / profitAmount / commissionAmount / finalUnitPrice）一律以后端
 *     track-b-preview 返回为准，前端不做本地计算
 *   - HS Code 最长前缀命中退税率、最新汇率一键带入
 *   - 佣金：无 / E5 / E10 / 佣金规则快照（佣金仅管理层+财务可见的权限约束由页面层控制）
 *   - onResultChange / onInputsChange 供父级做双轨偏差校验与保存定价记录
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Loader2, RefreshCw, Search } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { CommissionRule, TrackBResult } from '../../types';
import { bdsToast } from '../ui/bdsToast';

const inputClass = "w-full bg-surface-primary text-text-primary text-sm rounded-control px-3 py-2 border border-border-subtle outline-none focus:border-border-action";
const actionButtonClass = "flex items-center gap-1 px-2.5 py-1 text-xs rounded-control bg-surface-elevated text-text-secondary hover:text-text-primary hover:ring-1 hover:ring-border-action transition-all disabled:opacity-50";

function parseNum(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-text-tertiary mb-1">{label}</label>
      {children}
    </div>
  );
}

/** 轨道 B 当前有效输入（试算/保存共用口径） */
export interface TrackBValidInputs {
  purchaseCostCny: number;
  refundRate: number;
  exchangeRate: number;
  profitMargin: number;
  commissionRate: number;
  commissionRuleId: string | null;
  hsCode: string; // trim 后，可能为空串
}

export interface TrackBPanelProps {
  title?: string;
  /** 试算结果变化（含输入变更导致的清空） */
  onResultChange?: (result: TrackBResult | null) => void;
  /** 有效输入变化（保存定价记录 / 偏差校验用） */
  onInputsChange?: (inputs: TrackBValidInputs | null) => void;
  /** 额外输入字段（渲染于输入栅格末尾，如数量 / 备注） */
  children?: React.ReactNode;
  /** 额外操作按钮（渲染于「试算预览」右侧，如保存定价记录） */
  actions?: React.ReactNode;
}

export function TrackBPanel({ title, onResultChange, onInputsChange, children, actions }: TrackBPanelProps) {
  const [purchaseCostCny, setPurchaseCostCny] = useState('');
  const [hsCode, setHsCode] = useState('');
  const [refundRate, setRefundRate] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [profitMargin, setProfitMargin] = useState('');
  const [commissionRate, setCommissionRate] = useState('0');
  const [commissionRuleId, setCommissionRuleId] = useState<string | null>(null);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);

  const [preview, setPreview] = useState<TrackBResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [lookupHint, setLookupHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rules = await apiService.listCommissionRules();
        if (!cancelled) setCommissionRules(rules);
      } catch (e) {
        console.error('[TrackBPanel] listCommissionRules failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 佣金选择：'' = 无佣金；'E5'/'E10' = 手工口径；rule.id = 规则快照
  const handleCommissionSelect = (value: string) => {
    setPreview(null);
    if (value === '') {
      setCommissionRuleId(null);
      setCommissionRate('0');
    } else if (value === 'E5' || value === 'E10') {
      setCommissionRuleId(null);
      setCommissionRate(value === 'E5' ? '5' : '10');
    } else {
      const rule = commissionRules.find((r) => r.id === value);
      if (!rule) return;
      setCommissionRuleId(rule.id);
      setCommissionRate(String(rule.rate));
    }
  };

  const validInput = useMemo<TrackBValidInputs | null>(() => {
    const cost = parseNum(purchaseCostCny);
    const refund = parseNum(refundRate);
    const fx = parseNum(exchangeRate);
    const margin = parseNum(profitMargin);
    if (cost === null || cost <= 0) return null;
    if (refund === null || refund < 0) return null;
    if (fx === null || fx <= 0) return null;
    if (margin === null) return null;
    return {
      purchaseCostCny: cost,
      refundRate: refund,
      exchangeRate: fx,
      profitMargin: margin,
      commissionRate: parseNum(commissionRate) ?? 0,
      commissionRuleId,
      hsCode: hsCode.trim(),
    };
  }, [purchaseCostCny, refundRate, exchangeRate, profitMargin, commissionRate, commissionRuleId, hsCode]);

  useEffect(() => { onInputsChange?.(validInput); }, [validInput, onInputsChange]);
  useEffect(() => { onResultChange?.(preview); }, [preview, onResultChange]);

  const handleLookupRate = async () => {
    const code = hsCode.trim();
    if (!code) {
      bdsToast.warning('请输入 HS Code');
      return;
    }
    setLookupHint(null);
    try {
      const hit = await apiService.lookupTaxRefundRate(code);
      if (hit) {
        setRefundRate(String(hit.rate));
        setLookupHint(`命中 HS ${hit.hsCode}，退税率 ${hit.rate}%`);
      } else {
        setLookupHint('未命中退税率，请手工录入');
      }
    } catch (e) {
      console.error('[TrackBPanel] lookupTaxRefundRate failed', e);
      setLookupHint('查询失败，请手工录入');
    }
  };

  const handleFetchLatestFx = async () => {
    try {
      const rates = await apiService.getLatestFxRates();
      const usd = rates.find((r) => r.currency === 'USD');
      if (usd) setExchangeRate(String(usd.rate));
      else bdsToast.danger('未找到 USD 最新汇率');
    } catch (e) {
      console.error('[TrackBPanel] getLatestFxRates failed', e);
      bdsToast.danger('获取最新汇率失败');
    }
  };

  const handlePreview = async () => {
    if (!validInput) {
      bdsToast.warning('请完整填写采购成本 / 退税率 / 汇率 / 利润率');
      return;
    }
    setPreviewing(true);
    try {
      const result = await apiService.previewTrackB({
        purchaseCostCny: validInput.purchaseCostCny,
        refundRate: validInput.refundRate,
        exchangeRate: validInput.exchangeRate,
        profitMargin: validInput.profitMargin,
        commissionRate: validInput.commissionRate,
      });
      setPreview(result);
    } catch (e) {
      console.error('[TrackBPanel] previewTrackB failed', e);
      bdsToast.danger(`试算失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="bg-surface-elevated rounded-card p-5">
      <h3 className="text-sm font-light text-text-primary mb-4">{title ?? '轨道 B 试算（退税美元定价）'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="采购成本（CNY 单价）">
          <input className={inputClass} value={purchaseCostCny} onChange={(e) => { setPurchaseCostCny(e.target.value); setPreview(null); }} placeholder="如 32.50" inputMode="decimal" />
        </Field>
        <Field label="HS Code（可查退税率）">
          <div className="flex gap-2">
            <input className={inputClass} value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="如 5407520000" />
            <button onClick={handleLookupRate} className={actionButtonClass} title="按最长前缀命中退税率">
              <Search className="w-3.5 h-3.5" />
              查税率
            </button>
          </div>
        </Field>
        <Field label="退税率（%）">
          <input className={inputClass} value={refundRate} onChange={(e) => { setRefundRate(e.target.value); setPreview(null); }} placeholder="如 13" inputMode="decimal" />
        </Field>
        <Field label="汇率（CNY/USD）">
          <div className="flex gap-2">
            <input className={inputClass} value={exchangeRate} onChange={(e) => { setExchangeRate(e.target.value); setPreview(null); }} placeholder="如 7.10" inputMode="decimal" />
            <button onClick={handleFetchLatestFx} className={actionButtonClass} title="带入最新 USD 汇率">
              <RefreshCw className="w-3.5 h-3.5" />
              最新
            </button>
          </div>
        </Field>
        <Field label="利润率（%）">
          <input className={inputClass} value={profitMargin} onChange={(e) => { setProfitMargin(e.target.value); setPreview(null); }} placeholder="如 15" inputMode="decimal" />
        </Field>
        <Field label="佣金（无 / E5 / E10 / 规则快照）">
          <select
            className="bds-select"
            value={commissionRuleId ?? (commissionRate === '5' ? 'E5' : commissionRate === '10' ? 'E10' : '')}
            onChange={(e) => handleCommissionSelect(e.target.value)}
          >
            <option value="">无佣金（0%）</option>
            <option value="E5">E5（5%）</option>
            <option value="E10">E10（10%）</option>
            {commissionRules.map((r) => (
              <option key={r.id} value={r.id}>
                规则：{r.name}（{r.rate}%{r.intermediaryName ? ` · ${r.intermediaryName}` : ' · 默认'}）
              </option>
            ))}
          </select>
        </Field>
        {children}
      </div>
      {lookupHint && <p className="text-xs text-text-tertiary mb-3">{lookupHint}</p>}

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handlePreview}
          disabled={previewing || !validInput}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-control bg-surface-primary text-text-primary border border-border-action hover:bg-surface-secondary transition-colors disabled:opacity-50"
        >
          {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
          试算预览
        </button>
        {actions}
      </div>

      {/* 试算结果（服务端重算值，每步中间值透明展示） */}
      {preview && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-surface-primary rounded-inset p-3">
            <p className="text-xs text-text-tertiary">退税后美元成本</p>
            <p className="text-lg font-light text-text-primary">${preview.netUsdCost.toFixed(4)}</p>
          </div>
          <div className="bg-surface-primary rounded-inset p-3">
            <p className="text-xs text-text-tertiary">利润额</p>
            <p className="text-lg font-light text-text-primary">${preview.profitAmount.toFixed(4)}</p>
          </div>
          <div className="bg-surface-primary rounded-inset p-3">
            <p className="text-xs text-text-tertiary">佣金额</p>
            <p className="text-lg font-light text-text-primary">${preview.commissionAmount.toFixed(4)}</p>
          </div>
          <div className="bg-surface-primary rounded-inset p-3 border border-border-action">
            <p className="text-xs text-text-tertiary">终价美元单价</p>
            <p className="text-lg font-light text-text-primary">${preview.finalUnitPrice.toFixed(4)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackBPanel;
