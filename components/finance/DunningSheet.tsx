/**
 * DunningSheet — REQ2-08 催款函 BottomSheet（DR-050-③ 一键发起挂账龄行）
 *
 * 四区（设计真源：docs/design/04-模块设计/05-财务与结算/催款函套件.md §6）：
 *   1. 函预览 — 中/英双 tab（账龄明细注入：发票号/金额/到期日/逾期天数/分段 + 五桶汇总）
 *      P0-2 分级：四档语气（提醒/催款/严催/法务准备）chips 切换预览，缺省 = 生效分级
 *   2. 打印 — printHtmlDocument 中英合版（新窗口 → 打印/另存 PDF）
 *   3. 登记 — 渠道 chips + 结果 chips + 备注 + 跟进人 → POST /dunning（快照留痕 + P0-2 stage 分级快照）
 *   4. 历史 — 该客户催款记录时间线（渠道/结果/金额/日期/分级）
 *
 * 全链 ≤5min 锚点：账龄行/分级看板点「催款」（1 击）→ 函即时生成 → 登记（1 击）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Printer, Send } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { bdsToast } from '../ui/bdsToast';
import { printHtmlDocument, escapeHtml } from '../tools/printDocument';
import { RdlPill, RdlSurface } from '../ui/RDLPrimitives';
import {
  DUNNING_STAGE_LABELS,
  type DunningLetter,
  type DunningChannel,
  type DunningResultStatus,
  type DunningRecord,
  type DunningStage,
} from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const CHANNEL_OPTIONS: Array<{ value: DunningChannel; label: string }> = [
  { value: 'email', label: '邮件' },
  { value: 'phone', label: '电话' },
  { value: 'visit', label: '拜访' },
  { value: 'other', label: '其他' },
];

const RESULT_OPTIONS: Array<{ value: DunningResultStatus; label: string }> = [
  { value: 'sent', label: '已送达' },
  { value: 'promised', label: '承诺付款' },
  { value: 'paid', label: '已付款' },
  { value: 'disputed', label: '有争议' },
  { value: 'no_response', label: '未回应' },
];

/** P0-2 分级函预览档位（四档语气；缺省 = 上下文生效分级） */
const LETTER_STAGE_OPTIONS: Array<DunningStage> = ['reminder', 'firm', 'urgent', 'legal'];

const CHANNEL_LABELS: Record<string, string> = Object.fromEntries(CHANNEL_OPTIONS.map(c => [c.value, c.label]));
const RESULT_LABELS: Record<string, string> = Object.fromEntries(RESULT_OPTIONS.map(r => [r.value, r.label]));

function formatMoney(n: number, currency: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${sym}${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTs(ts: string | number): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return String(ts ?? '');
  const d = new Date(n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export interface DunningSheetProps {
  open: boolean;
  onClose: () => void;
  /** 账龄行上下文（选中即上下文，无需二次选择） */
  customerRelationId: string | null;
  customerName: string;
  currency: string;
  /** P0-2 分级档位上下文（分级看板行打开时传入；缺省 = 后端合成生效分级） */
  stage?: DunningStage;
  asOf?: string;
  endpoint?: string;
}

export default function DunningSheet({
  open,
  onClose,
  customerRelationId,
  customerName,
  currency,
  stage,
  asOf,
  endpoint,
}: DunningSheetProps) {
  const [letter, setLetter] = useState<DunningLetter | null>(null);
  const [loading, setLoading] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);
  const [langTab, setLangTab] = useState<'zh' | 'en'>('zh');
  /** P0-2：当前预览/登记的分级档位（chips 切换重取函；登记随 stage 快照） */
  const [letterStage, setLetterStage] = useState<DunningStage | null>(stage ?? null);

  const [history, setHistory] = useState<DunningRecord[] | null>(null);

  const [channel, setChannel] = useState<DunningChannel>('email');
  const [result, setResult] = useState<DunningResultStatus>('sent');
  const [note, setNote] = useState('');
  const [operator, setOperator] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLetterError(null);
    setLetter(null);
    setHistory(null);
    setLetterStage(stage ?? null);
    try {
      const [letterData, historyData] = await Promise.all([
        apiService.buildDunningLetter({
          customerRelationId: customerRelationId ?? undefined,
          customerName,
          currency,
          asOf,
          ...(stage ? { stage } : {}),
        }, endpoint),
        apiService.listDunningHistory({
          customerRelationId: customerRelationId ?? undefined,
          customerName,
          limit: 50,
        }, endpoint).catch(() => [] as DunningRecord[]),
      ]);
      setLetter(letterData);
      setLetterStage(letterData.stage ?? stage ?? null);
      setHistory(historyData);
    } catch (e: any) {
      setLetterError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [customerRelationId, customerName, currency, stage, asOf, endpoint]);

  useEffect(() => {
    if (open) loadAll();
  }, [open, loadAll]);

  /** P0-2：切档预览（重取该档语气函；登记将随当前档位快照） */
  const switchStage = useCallback(async (next: DunningStage) => {
    if (loading || next === letterStage) return;
    setLoading(true);
    setLetterError(null);
    try {
      const letterData = await apiService.buildDunningLetter({
        customerRelationId: customerRelationId ?? undefined,
        customerName,
        currency,
        asOf,
        stage: next,
      }, endpoint);
      setLetter(letterData);
      setLetterStage(next);
    } catch (e: any) {
      setLetterError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [loading, letterStage, customerRelationId, customerName, currency, asOf, endpoint]);

  const handlePrint = () => {
    if (!letter) return;
    const s = letter.summary;
    const zhBody = escapeHtml(letter.zh.body);
    const enBody = escapeHtml(letter.en.body);
    const htmlBody = `
      <div class="doc-header">
        <div class="doc-title-block">
          <h1>付款提醒 / Payment Reminder</h1>
          <div class="subtitle">Dunning Letter — ${escapeHtml(s.customerName)} · ${escapeHtml(s.currency)}</div>
        </div>
        <div class="doc-meta">
          <div class="doc-no">${escapeHtml(formatMoney(s.totalOverdue, s.currency))}</div>
          <div>截至 As of ${escapeHtml(s.asOf)}</div>
          <div>${s.invoiceCount} 张发票 / invoices</div>
        </div>
      </div>
      <div class="doc-section">
        <div class="doc-section-title">中文催款函</div>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.7;">${zhBody}</pre>
      </div>
      <div class="doc-section">
        <div class="doc-section-title">English Payment Reminder</div>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.7;">${enBody}</pre>
      </div>`;
    printHtmlDocument({ title: `催款函-${s.customerName}-${s.currency}`, htmlBody });
  };

  const handleSubmit = async () => {
    if (!letter) return;
    const s = letter.summary;
    setSubmitting(true);
    try {
      await apiService.recordDunning({
        customerRelationId: customerRelationId ?? undefined,
        customerName: s.customerName || customerName,
        currency: s.currency,
        totalOverdue: s.totalOverdue,
        invoiceCount: s.invoiceCount,
        agingBuckets: s.buckets,
        channel,
        result,
        ...(letterStage ? { stage: letterStage } : {}), // P0-2：分级快照
        note: note.trim() || undefined,
        operator: operator.trim() || undefined,
      }, endpoint);
      bdsToast.success('催款记录已登记');
      setNote('');
      setOperator('');
      // 刷新历史（登记后第一时间可见）
      try {
        const items = await apiService.listDunningHistory({
          customerRelationId: customerRelationId ?? undefined,
          customerName: s.customerName || customerName,
          limit: 50,
        }, endpoint);
        setHistory(items);
      } catch {
        // 历史刷新失败不阻断主流程
      }
    } catch (e: any) {
      bdsToast.danger(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-default)]';

  const current = langTab === 'zh' ? letter?.zh : letter?.en;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[var(--mask-bg)] backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-[24px] border-t border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] sm:max-w-2xl sm:rounded-card sm:border">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between px-6 pb-3 pt-5">
          <div>
            <h3 className={cx('text-base font-light tracking-tight', textPrimary)}>催款函 · {customerName}</h3>
            <div className={cx('mt-1 text-[11px] font-light', textSecondary)}>
              {currency} 逾期账款
              {letter ? ` · ${formatMoney(letter.summary.totalOverdue, letter.summary.currency)} · ${letter.summary.invoiceCount} 张发票 · 截至 ${letter.summary.asOf}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className={cx('rounded-full p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--recessed-bg-hover)]')}
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-8">
          {loading && (
            <div className={cx('flex items-center justify-center gap-2 py-12 text-xs font-light', textSecondary)}>
              <Loader2 size={16} className="animate-spin" /> 正在生成催款函（当前逾期发票明细）…
            </div>
          )}

          {letterError && (
            <RdlSurface tone="panel" padding="compact" className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--danger-text)]" />
              <div className="text-xs font-light leading-relaxed">
                <div className="text-[var(--danger-text)]">函生成失败</div>
                <div className={cx('mt-0.5', textSecondary)}>{letterError}</div>
              </div>
            </RdlSurface>
          )}

          {!loading && !letterError && letter && (
            <>
              {/* ① 函预览 + 打印（P0-2 分级档位 chips 切档预览） */}
              <RdlSurface tone="panel" padding="compact" className="flex flex-col">
                <div className="flex items-center justify-between border-b px-3 pb-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <RdlPill type="button" active={langTab === 'zh'} onClick={() => setLangTab('zh')} className="min-h-7 px-2.5 text-[11px]">中文函</RdlPill>
                    <RdlPill type="button" active={langTab === 'en'} onClick={() => setLangTab('en')} className="min-h-7 px-2.5 text-[11px]">English</RdlPill>
                  </div>
                  <button
                    onClick={handlePrint}
                    className={cx('flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-[11px] font-light transition-colors hover:bg-[var(--recessed-bg-hover)]', textSecondary)}
                  >
                    <Printer size={14} /> 打印 / PDF（中英合版）
                  </button>
                </div>
                {/* P0-2 分级档位：四档语气切换（登记随当前档位快照） */}
                <div className={cx('flex flex-wrap items-center gap-1.5 border-b px-3 pb-2 pt-2', divider)}>
                  <span className={cx('text-[10px] font-light tracking-[0.14em]', textSecondary)}>催款分级</span>
                  {LETTER_STAGE_OPTIONS.map(s => (
                    <RdlPill
                      key={s}
                      type="button"
                      active={letterStage === s}
                      onClick={() => switchStage(s)}
                      disabled={loading}
                      className="min-h-7 px-2.5 text-[11px]"
                    >
                      {DUNNING_STAGE_LABELS[s]}
                    </RdlPill>
                  ))}
                  <span className={cx('ml-auto text-[10px] font-light', textFaint)}>
                    {letterStage ? `当前按「${DUNNING_STAGE_LABELS[letterStage]}」档生成` : '按生效分级生成'}
                  </span>
                </div>
                <div className="px-3 pb-2 pt-2">
                  <div className={cx('text-[11px] font-light', textSecondary)}>主题 Subject</div>
                  <div className={cx('mt-0.5 text-xs font-light', textPrimary)}>{current?.subject}</div>
                  <div className={cx('mt-2 whitespace-pre-wrap text-xs font-light leading-relaxed', textPrimary)}>{current?.body}</div>
                </div>
              </RdlSurface>

              {/* ② 登记催款记录 */}
              <RdlSurface tone="panel" padding="compact" className="flex flex-col">
                <div className={cx('border-b px-3 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
                  登记催款记录（快照留痕：{formatMoney(letter.summary.totalOverdue, letter.summary.currency)} · {letter.summary.invoiceCount} 张）
                </div>
                <div className="space-y-3 px-3 pb-3 pt-2.5">
                  <div>
                    <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>渠道</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {CHANNEL_OPTIONS.map(c => (
                        <RdlPill key={c.value} type="button" active={channel === c.value} onClick={() => setChannel(c.value)} className="min-h-7 px-2.5 text-[11px]">{c.label}</RdlPill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>结果</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {RESULT_OPTIONS.map(r => (
                        <RdlPill key={r.value} type="button" active={result === r.value} onClick={() => setResult(r.value)} className="min-h-7 px-2.5 text-[11px]">{r.label}</RdlPill>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>跟进人（可选）</div>
                      <input
                        value={operator}
                        onChange={e => setOperator(e.target.value)}
                        placeholder="姓名"
                        className={cx('h-8 w-full rounded-control border-0 bg-[var(--recessed-bg-strong)] px-2.5 text-xs font-light outline-none placeholder:text-[var(--text-quaternary)]', textPrimary)}
                      />
                    </div>
                    <div>
                      <div className={cx('mb-1.5 text-[10px] font-light tracking-[0.14em]', textSecondary)}>备注（可选）</div>
                      <input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="沟通要点"
                        className={cx('h-8 w-full rounded-control border-0 bg-[var(--recessed-bg-strong)] px-2.5 text-xs font-light outline-none placeholder:text-[var(--text-quaternary)]', textPrimary)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className={cx('flex items-center gap-1.5 rounded-control px-3.5 py-2 text-xs font-light transition-opacity disabled:opacity-50', 'bg-[var(--accent-tint)] text-[var(--accent-text)]')}
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 登记记录
                    </button>
                  </div>
                </div>
              </RdlSurface>

              {/* ③ 催款历史 */}
              <RdlSurface tone="panel" padding="compact" className="flex flex-col">
                <div className={cx('border-b px-3 pb-2 pt-1 text-[10px] font-light tracking-[0.14em]', textSecondary)}>
                  催款历史
                </div>
                <div className="space-y-1 px-3 pb-3 pt-2">
                  {history == null && (
                    <div className={cx('py-3 text-center text-xs font-light', textFaint)}>加载中…</div>
                  )}
                  {history != null && history.length === 0 && (
                    <div className={cx('py-3 text-center text-xs font-light', textFaint)}>暂无催款记录</div>
                  )}
                  {history != null && history.map(rec => (
                    <div key={rec.id} className={cx('flex items-center justify-between rounded-control px-2.5 py-2', 'bg-[var(--recessed-bg-strong)]')}>
                      <div className="min-w-0">
                        <div className={cx('flex flex-wrap items-center gap-1.5 text-xs font-light', textPrimary)}>
                          <span>{CHANNEL_LABELS[rec.channel] ?? rec.channel} · {RESULT_LABELS[rec.result] ?? rec.result}</span>
                          {rec.stage && <span className="bds-badge sm neutral">{DUNNING_STAGE_LABELS[rec.stage] ?? rec.stage}</span>}
                          <span className={cx('tabular-nums', textSecondary)}>{formatMoney(Number(rec.totalOverdue), rec.currency)}</span>
                        </div>
                        <div className={cx('mt-0.5 truncate text-[10px] font-light', textFaint)}>
                          {formatTs(rec.createdAt)} · {rec.invoiceCount} 张{rec.operator ? ` · ${rec.operator}` : ''}{rec.note ? ` · ${rec.note}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </RdlSurface>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
