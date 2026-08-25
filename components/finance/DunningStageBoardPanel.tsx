/**
 * DunningStageBoardPanel — P0-2 催款分级看板（账龄分析 Tab 内嵌，应收侧）
 *
 * 设计真源：docs/design/10-评审与决策/2026-08-25-中度与严重缺失功能开发优先级规划.md P0-2
 * 服务契约：GET /v1/finance/dunning/stages + POST /v1/finance/dunning/stages/manual
 *
 * 分级状态机（与后端镜像）：
 *   auto   = 账龄五桶自动定级（d90plus→legal / d61_90→urgent / d31_60→firm / d1_30→reminder）
 *            watchdog 每日 09:45 扫描升级 + 风险预警通知责任人
 *   manual = 人工钉住（升级=提前严催；降级=客户已承诺还款；留痕 routeAudit）
 *   合成规则：manual 钉住期间 auto 只能向上穿透（aging 证据压过人工降级）
 *
 * 看板：按生效分级四列（提醒/催款/严催/法务准备），行 = 客户×币种；
 * P0-1 尾款喂入：末批逾期未结清（未开票）也生成看板行（保底提醒档）。
 *
 * 设计：flat 无阴影、RDL 原语（与 DunningSheet 同视觉家族）、tabular-nums 数字对齐。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, ShieldAlert } from 'lucide-react';
import { apiService } from '../../services/apiService';
import BottomSheet from '../ui/BottomSheet';
import { bdsToast } from '../ui/bdsToast';
import { RdlPill, RdlSurface } from '../ui/RDLPrimitives';
import { DUNNING_STAGE_LABELS, DUNNING_STAGE_AGING_DESC, type DunningStage, type DunningStageBoardRow } from '../../types';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** 看板列（生效分级四档；none 行不上板——无逾期即无催款动作） */
const STAGE_COLUMNS: Array<{ stage: DunningStage; tone: string }> = [
  { stage: 'reminder', tone: 'neutral' },
  { stage: 'firm', tone: 'warning' },
  { stage: 'urgent', tone: 'danger' },
  { stage: 'legal', tone: 'danger' },
];

/** 分级调整表单目标档位（含解除钉住） */
const STAGE_TARGETS: Array<{ value: DunningStage; label: string }> = [
  { value: 'reminder', label: '提醒' },
  { value: 'firm', label: '催款' },
  { value: 'urgent', label: '严催' },
  { value: 'legal', label: '法务准备' },
  { value: 'none', label: '解除钉住' },
];

function formatAmount(n: number, currency: string): string {
  const sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${sym}${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface DunningStageBoardPanelProps {
  endpoint?: string;
  /** 打开催款函（带分级上下文：函按该档位语气生成） */
  onDun: (row: { customerRelationId: string | null; customerName: string; currency: string; stage: DunningStage }) => void;
  /** 外部刷新信号（催款登记/账龄刷新后自增） */
  refreshKey?: number;
}

export default function DunningStageBoardPanel({ endpoint, onDun, refreshKey = 0 }: DunningStageBoardPanelProps) {
  const [rows, setRows] = useState<DunningStageBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 分级调整表单
  const [adjustFor, setAdjustFor] = useState<DunningStageBoardRow | null>(null);
  const [targetStage, setTargetStage] = useState<DunningStage>('firm');
  const [reason, setReason] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';
  const divider = 'border-[var(--border-c-default)]';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const board = await apiService.getDunningStageBoard(undefined, endpoint);
      setRows(board.rows ?? []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const openAdjust = (row: DunningStageBoardRow) => {
    setAdjustFor(row);
    setTargetStage(row.stage === 'none' ? 'reminder' : row.stage);
    setReason('');
    setOwnerName(row.ownerName ?? '');
  };

  const submitAdjust = useCallback(async () => {
    if (!adjustFor || submitting) return;
    if (!reason.trim()) {
      bdsToast.warning('分级调整必须填写原因（留痕：审计日志）。');
      return;
    }
    setSubmitting(true);
    try {
      await apiService.setDunningStageManual({
        customerRelationId: adjustFor.customerRelationId,
        customerName: adjustFor.customerName,
        currency: adjustFor.currency,
        stage: targetStage,
        reason: reason.trim(),
        ownerName: ownerName.trim() || null,
      }, endpoint);
      bdsToast.success(targetStage === 'none'
        ? `已解除 ${adjustFor.customerName} 的人工钉住（回到账龄自动定级）。`
        : `${adjustFor.customerName} 已钉住「${DUNNING_STAGE_LABELS[targetStage]}」档（留痕审计）。`);
      setAdjustFor(null);
      await load();
    } catch (e: any) {
      bdsToast.danger(`分级调整失败：${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  }, [adjustFor, targetStage, reason, ownerName, submitting, endpoint, load]);

  // 看板只展示催款中（stage ≠ none）的行
  const boardRows = rows.filter(r => r.stage !== 'none');
  const byStage = (stage: DunningStage) => boardRows.filter(r => r.stage === stage);

  return (
    <RdlSurface tone="panel" padding="compact" className="flex flex-col">
      {/* 看板头 */}
      <div className={cx('flex flex-wrap items-center gap-2 border-b px-4 pb-2 pt-2', divider)}>
        <ShieldAlert size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>催款分级</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>DUNNING STAGES</span>
        <span className={cx('ml-auto text-[10px] font-light', textFaint)}>
          账龄自动定级 + 人工钉住 · 每日 09:45 watchdog 自动升级并预警责任人
        </span>
      </div>

      {/* 内容区 */}
      {loading && (
        <div className={cx('flex items-center gap-2 py-8 text-xs font-light', textFaint)}>
          <Loader2 size={14} className="animate-spin" />加载催款分级看板…
        </div>
      )}
      {!loading && error && (
        <div className={cx('py-6 text-center text-xs font-light', textFaint)}>
          分级看板加载失败：{error}
        </div>
      )}
      {!loading && !error && boardRows.length === 0 && (
        <div className={cx('py-8 text-center text-xs font-light', textFaint)}>
          暂无催款中客户 · 逾期账款出现后按账龄自动进入「提醒」档
        </div>
      )}
      {!loading && !error && boardRows.length > 0 && (
        <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
          {STAGE_COLUMNS.map(({ stage, tone }) => {
            const stageRows = byStage(stage);
            return (
              <div key={stage} className={cx('flex min-w-0 flex-col rounded-control border p-2', divider)}>
                {/* 列头：档位 + 账龄口径 + 行数 */}
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className={cx('bds-badge sm', tone)}>{DUNNING_STAGE_LABELS[stage]}</span>
                  <span className={cx('text-[10px] font-light', textFaint)}>
                    {stageRows.length} 户 · {DUNNING_STAGE_AGING_DESC[stage]}
                  </span>
                </div>
                <div className="min-w-0 space-y-1.5">
                  {stageRows.length === 0 && (
                    <div className={cx('py-4 text-center text-[11px] font-light', textFaint)}>—</div>
                  )}
                  {stageRows.map(row => (
                    <div key={row.scopeKey} className={cx('rounded-control bg-[var(--recessed-bg-strong)] px-2.5 py-2')}>
                      <div className="flex items-center gap-1.5">
                        <span className={cx('truncate text-xs font-light', textPrimary)}>{row.customerName}</span>
                        <span className={cx('shrink-0 text-[10px] font-light', textFaint)}>{row.currency}</span>
                        {row.stageSource === 'manual' && <span className="bds-badge sm neutral shrink-0">钉住</span>}
                      </div>
                      <div className={cx('mt-0.5 flex items-baseline gap-2 text-[10px] font-light tabular-nums', textSecondary)}>
                        <span className={textPrimary}>
                          {formatAmount(row.totalOverdue + (row.finalPaymentOutstanding ?? 0), row.currency)}
                        </span>
                        {row.finalPaymentOverdue && <span className="text-[var(--danger-text)]">含逾期尾款 {formatAmount(row.finalPaymentOutstanding, row.currency)}</span>}
                        {row.stageDays != null && <span className={cx('ml-auto shrink-0', textFaint)}>本级 {row.stageDays} 天</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onDun({
                            customerRelationId: row.customerRelationId,
                            customerName: row.customerName,
                            currency: row.currency,
                            stage: row.stage,
                          })}
                          className={cx('flex items-center gap-1 rounded-control px-2 py-1 text-[11px] font-light transition-colors hover:bg-[var(--recessed-bg-hover)]', textSecondary)}
                          aria-label={`对 ${row.customerName} 发起 ${DUNNING_STAGE_LABELS[row.stage]}档催款`}
                        >
                          <Mail size={13} strokeWidth={1.5} /> 催款
                        </button>
                        <button
                          type="button"
                          onClick={() => openAdjust(row)}
                          className={cx('flex items-center gap-1 rounded-control px-2 py-1 text-[11px] font-light transition-colors hover:bg-[var(--recessed-bg-hover)]', textSecondary)}
                          aria-label={`调整 ${row.customerName} 的催款分级`}
                        >
                          分级调整
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 分级调整 BottomSheet（升降级/解除钉住，留痕审计） */}
      <BottomSheet isOpen={adjustFor !== null} onClose={() => setAdjustFor(null)} title={`分级调整 · ${adjustFor?.customerName ?? ''} ${adjustFor?.currency ?? ''}`}>
        <div className="space-y-4 px-6 py-5">
          <div className={cx('rounded-field border p-3 text-[11px] font-light leading-relaxed', divider, textSecondary)}>
            当前生效分级「{adjustFor ? DUNNING_STAGE_LABELS[adjustFor.stage] : '—'}」
            {adjustFor?.stageSource === 'manual' ? '（人工钉住）' : '（账龄自动）'}
            ，账龄自动定级「{adjustFor ? DUNNING_STAGE_LABELS[adjustFor.autoStage] : '—'}」。
            人工钉住期间账龄恶化会自动向上穿透（aging 证据压过人工降级）。
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>目标档位 *</label>
            <div className="flex flex-wrap gap-1.5">
              {STAGE_TARGETS.map(t => (
                <RdlPill
                  key={t.value}
                  type="button"
                  active={targetStage === t.value}
                  onClick={() => setTargetStage(t.value)}
                  className="min-h-7 px-2.5 text-[11px]"
                >
                  {t.label}
                </RdlPill>
              ))}
            </div>
            <p className={cx('mt-1.5 text-[10px] font-light', textFaint)}>
              {targetStage === 'none'
                ? '解除钉住：生效分级回退账龄自动定级（还款结清后自动回落）'
                : `钉住「${DUNNING_STAGE_LABELS[targetStage]}」档：分级函/看板按此档执行，直到解除或账龄穿透`}
            </p>
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>原因 *</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={targetStage === 'none' ? '如：客户已提供还款计划' : '如：客户长期失联，提前进入正式催款'}
              className="bds-input sm w-full"
            />
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>责任人（可选；升级预警通知对象）</label>
            <input
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              placeholder="如：赵美玲"
              className="bds-input sm w-44"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAdjustFor(null)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" disabled={submitting} onClick={submitAdjust} className="bds-btn bds-btn-primary">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} strokeWidth={1.5} />}
              确认调整（留痕审计）
            </button>
          </div>
        </div>
      </BottomSheet>
    </RdlSurface>
  );
}
