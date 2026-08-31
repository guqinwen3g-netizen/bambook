/**
 * FactoryDelayPanel — REQ2-10 工厂延迟链路影响面板（供应商工厂详情内嵌）
 *
 * 设计真源：docs/design/04-模块设计/06-资源与支撑/Suppliers-供应商/工厂延迟链路影响计算.md
 * DR-052：① 延迟登记是事实记录（改期走既有变更审批）② 缓冲侵蚀三级分级 + 逐级沟通建议
 *         ③ 登记即联动工厂交期分下调（幂等）
 *
 * 核心交互：
 *   - 登记延迟 BottomSheet（天数 + 原因 chips + 备注）→ 天数输入即时预检（不落库）
 *   - 影响面板：critical（红）/ warning（黄）/ info（灰）分组订单行 + 逐级沟通建议
 *   - 历史延迟记录（天数/原因/影响计数/登记人/日期）
 *
 * 3 击锚点：供应商管理 → 工厂详情 → 延迟影响（登记后清单即时呈现）
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, TimerReset } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { hasPermission } from '../../services/authService';
import type { DelayImpactResult, DelayImpactItem, DelayReason, FactoryDelayRecord } from '../../types';
import BottomSheet from '../ui/BottomSheet';
import { bdsToast } from '../ui/bdsToast';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const REASON_OPTIONS: Array<{ value: DelayReason; label: string }> = [
  { value: 'capacity', label: '产能不足' },
  { value: 'material', label: '原料短缺' },
  { value: 'quality_rework', label: '质量返工' },
  { value: 'weather', label: '天气/不可抗力' },
  { value: 'other', label: '其他' },
];
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASON_OPTIONS.map(o => [o.value, o.label]));

const LEVEL_META: Record<string, { label: string; badge: string }> = {
  critical: { label: '突破交期 · 急', badge: 'bds-badge sm danger' },
  warning: { label: '突破交期 · 有缓冲', badge: 'bds-badge sm warning' },
  info: { label: '未突破交期', badge: 'bds-badge sm' },
};

function fmtDate(ts: number | string): string {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

interface FactoryDelayPanelProps {
  /** 工厂 Relation ID */
  relationId: string;
  /** 工厂名（快照） */
  supplierName: string;
  isDarkMode?: boolean;
}

export function FactoryDelayPanel({ relationId, supplierName }: FactoryDelayPanelProps) {
  // R6：登记延迟走 POST /delays（suppliers:write scope 门），无权限隐藏入口
  const canWrite = hasPermission('suppliers:write');
  const [records, setRecords] = useState<FactoryDelayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [formDays, setFormDays] = useState('');
  const [formReason, setFormReason] = useState<DelayReason>('capacity');
  const [formNote, setFormNote] = useState('');
  const [preview, setPreview] = useState<DelayImpactResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await apiService.listFactoryDelays({ supplierRelationId: relationId, limit: 50 }));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [relationId]);

  useEffect(() => { load(); }, [load]);

  /** 天数输入 → 即时预检（300ms 防抖，不落库） */
  const handleDaysChange = useCallback((v: string) => {
    setFormDays(v);
    setPreview(null);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const days = Number(v);
    if (!v.trim() || !Number.isInteger(days) || days < 1) return;
    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        setPreview(await apiService.previewFactoryDelay(relationId, days));
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
  }, [relationId]);

  const submit = useCallback(async () => {
    const days = Number(formDays);
    if (!Number.isInteger(days) || days < 1) { bdsToast.warning('延迟天数须为正整数。'); return; }
    setSubmitting(true);
    try {
      const r = await apiService.registerFactoryDelay({
        supplierRelationId: relationId, supplierName, delayDays: days,
        reason: formReason, reasonNote: formNote.trim() || undefined,
      });
      bdsToast.success(`延迟登记 ${r.record.recordNumber} 完成${r.qualityScoreLinked ? '，工厂交期分已联动下调' : ''}。`);
      setShowCreate(false);
      setFormDays(''); setFormReason('capacity'); setFormNote(''); setPreview(null);
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  }, [formDays, formReason, formNote, relationId, supplierName, load]);

  /** 影响订单行（预检与登记共用渲染） */
  const renderImpactItems = (impact: DelayImpactResult) => {
    const groups: Array<{ level: string; items: DelayImpactItem[] }> = [
      { level: 'critical', items: impact.items.filter(x => x.level === 'critical') },
      { level: 'warning', items: impact.items.filter(x => x.level === 'warning') },
      { level: 'info', items: impact.items.filter(x => x.level === 'info') },
    ];
    return (
      <div className="space-y-2.5">
        {groups.filter(g => g.items.length > 0).map(g => (
          <div key={g.level}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={LEVEL_META[g.level].badge}>{LEVEL_META[g.level].label} · {g.items.length} 单</span>
              {impact.advice?.[g.level] && (
                <span className={cx('truncate text-[10px] font-light', textFaint)} title={impact.advice[g.level]}>{impact.advice[g.level]}</span>
              )}
            </div>
            <div className="space-y-1">
              {g.items.map(it => (
                <div key={it.orderId} className={cx('flex flex-wrap items-center gap-2 rounded-control px-2.5 py-1.5 text-xs font-light', 'bg-[var(--recessed-bg)]')}>
                  <span className={cx('tabular-nums', textPrimary)}>{it.poNumber}</span>
                  <span className={cx('truncate', textSecondary)}>{it.customer ?? '—'} · {it.product ?? '—'}</span>
                  {it.quantity != null && <span className={cx('tabular-nums', textFaint)}>{it.quantity.toLocaleString()} {it.unit ?? ''}</span>}
                  <span className={cx('ml-auto tabular-nums', textSecondary)}>
                    交期 {it.dueDate ?? '—'} → 新完成 {it.newCompletionDate ?? '—'}
                    {it.bufferDays != null && (it.bufferDays < 0
                      ? <span className="text-[var(--danger-text)]"> 突破 {-it.bufferDays} 天</span>
                      : <span> 剩余缓冲 {it.bufferDays} 天</span>)}
                    {it.planDateMissing && <span className={cx('ml-1', textFaint)}>（无生产计划，按交期保守判定）</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mt-4 rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <TimerReset size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>延迟影响</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>DELAY IMPACT</span>
        <div className="ml-auto">
          {canWrite && (
            <button type="button" onClick={() => setShowCreate(true)} className="bds-btn bds-btn-secondary">
              <Plus size={14} strokeWidth={1.5} />登记延迟
            </button>
          )}
        </div>
      </div>

      {/* 历史记录 */}
      <div className="mt-3 space-y-1.5">
        {loading && <div className={cx('flex items-center justify-center gap-2 py-6 text-xs font-light', textFaint)}><Loader2 size={14} className="animate-spin" />加载中…</div>}
        {!loading && error && <div className={cx('py-4 text-center text-xs font-light', textFaint)}>{error}</div>}
        {!loading && !error && records.length === 0 && (
          <div className={cx('py-6 text-center text-xs font-light', textFaint)}>暂无延迟登记——工厂告知延迟时登记，自动计算受影响订单与沟通建议。</div>
        )}
        {!loading && records.map(r => (
          <div key={r.id} className="rounded-control border border-[var(--border-c-subtle)] bg-[var(--bg-raised)] px-3 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={cx('font-light tabular-nums', textPrimary)}>延迟 {r.delayDays} 天</span>
              {r.reason && <span className="bds-badge sm warning">{REASON_LABEL[r.reason] ?? r.reason}</span>}
              {r.impactSummary && (
                <span className={cx('text-xs tabular-nums', textSecondary)}>
                  受影响 {r.impactSummary.total} 单
                  {r.impactSummary.critical > 0 && <span className="text-[var(--danger-text)]"> · 急 {r.impactSummary.critical}</span>}
                  {r.impactSummary.warning > 0 && ` · 缓冲 ${r.impactSummary.warning}`}
                </span>
              )}
              <span className={cx('ml-auto text-[10px] font-light tabular-nums', textFaint)}>
                {r.recordNumber} · {r.registeredBy ?? '—'} · {fmtDate(r.createdAt)}
              </span>
            </div>
            {r.reasonNote && <div className={cx('mt-1 truncate text-xs font-light', textSecondary)}>{r.reasonNote}</div>}
          </div>
        ))}
      </div>

      {/* 登记弹窗：天数 + 原因 → 即时预检 → 提交 */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={`登记工厂延迟 · ${supplierName}`}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>延迟天数 *</label>
            <input
              type="number" min={1}
              value={formDays}
              onChange={e => handleDaysChange(e.target.value)}
              placeholder="如：30（工厂告知的顺延天数）"
              autoFocus
              className="bds-input sm w-full"
            />
            <div className={cx('mt-1 text-[10px] font-light', textFaint)}>
              登记仅记录事实并计算影响；订单交期变更仍须走订单变更审批。
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>原因分类</label>
            <div className="flex flex-wrap gap-1.5">
              {REASON_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setFormReason(o.value)}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs font-light transition-colors',
                    formReason === o.value
                      ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
                      : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注（选填）</label>
            <input value={formNote} onChange={e => setFormNote(e.target.value)} placeholder="如：织机故障，预计 9 月 15 日恢复" className="bds-input sm w-full" />
          </div>

          {/* 即时预检面板（验收锚点：登记前即见受影响清单） */}
          <div>
            <div className={cx('mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.14em]', textSecondary)}>
              受影响预检（不落库）
              {previewLoading && <Loader2 size={14} className="animate-spin" />}
            </div>
            {!previewLoading && !preview && (
              <div className={cx('px-1 text-xs font-light', textFaint)}>输入天数后自动计算该工厂活跃订单的交期影响</div>
            )}
            {!previewLoading && preview && preview.items.length === 0 && (
              <div className={cx('px-1 text-xs font-light', textFaint)}>该工厂当前无活跃订单，延迟无直接影响</div>
            )}
            {!previewLoading && preview && preview.items.length > 0 && renderImpactItems(preview)}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" onClick={submit} disabled={submitting} className="bds-btn bds-btn-primary">
              {submitting && <Loader2 size={14} className="animate-spin" />}登记延迟
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default FactoryDelayPanel;
