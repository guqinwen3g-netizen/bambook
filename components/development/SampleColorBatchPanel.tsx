/**
 * SampleColorBatchPanel — REQ2-01 打色批次面板（色差管理体系）
 *
 * 设计真源：docs/design/04-模块设计/03-订单与生产/Development-开发/色差管理体系.md §6
 *
 * 两态复用：
 *   - stage='lab_dip'：挂开发案详情（打色阶段，缸号级批色记录）
 *   - stage='bulk'：挂订单详情（大货缸差记录）
 *
 * 核心交互：
 *   - 登记（A5 ≤2min：缸号 + 主评级 5 档点选必填；疵点原因 chips 多选）
 *   - 客户判定（通过[设为封样基准] / 拒绝 / 重打）——疵点自动入供应商质量分（后端联动）
 *   - 导出色差证据链（缸号×批次×批色×封样基准，3 击 ≤3min SLA）
 *
 * 设计：flat 无阴影、BDS 语义类、评级徽章 success/info/warning/danger 变体。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Palette, Plus, Printer, RotateCcw, Star, Trash2, XCircle, CheckCircle2 } from 'lucide-react';
import {
  sampleService,
  COLOR_BATCH_DEFECT_CAUSES,
  COLOR_BATCH_DEFECT_LABELS,
  COLOR_BATCH_STATUS_LABELS,
  COLOR_RATING_LABELS,
  type SampleColorBatchRow,
  type ColorBatchDefectCause,
  type ColorBatchEvidence,
} from '../../services/sampleService';
import BottomSheet from '../ui/BottomSheet';
import { bdsConfirm } from '../ui/BdsDialog';
import { bdsToast } from '../ui/bdsToast';
import { printHtmlDocument, escapeHtml } from '../tools/printDocument';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** 评级 → bds-badge 变体（5/4 绿蓝；3 黄；1-2 红） */
function ratingBadgeClass(rating: number): string {
  if (rating >= 5) return 'bds-badge sm success';
  if (rating === 4) return 'bds-badge sm info';
  if (rating === 3) return 'bds-badge sm warning';
  return 'bds-badge sm danger';
}

/** 5 档评级点选控件（大目标区域，A5 快速登记） */
const RatingPicker: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <div className="flex gap-1.5">
    {[5, 4, 3, 2, 1].map(n => (
      <button
        key={n}
        type="button"
        onClick={() => onChange(n)}
        className={cx(
          'flex h-9 w-12 flex-col items-center justify-center rounded-field border text-xs font-light transition-colors',
          value === n
            ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
            : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
        )}
        title={COLOR_RATING_LABELS[n]}
      >
        <span className="tabular-nums">{n}</span>
        <span className="text-[9px] leading-none">{COLOR_RATING_LABELS[n]}</span>
      </button>
    ))}
  </div>
);

interface SampleColorBatchPanelProps {
  stage: 'lab_dip' | 'bulk';
  /** lab_dip 必填：开发案 ID */
  developmentCaseId?: string;
  /** bulk 必填：订单 ID */
  orderId?: string;
  /** bulk 态展示订单号（取证标题用） */
  orderLabel?: string;
  isDarkMode?: boolean;
}

export function SampleColorBatchPanel({ stage, developmentCaseId, orderId, orderLabel }: SampleColorBatchPanelProps) {
  const [batches, setBatches] = useState<SampleColorBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // 登记表单（A5 必填：缸号 + 主评级）
  const [formDyeLotNo, setFormDyeLotNo] = useState('');
  const [formRating, setFormRating] = useState(4);
  const [formDefects, setFormDefects] = useState<ColorBatchDefectCause[]>([]);
  const [formBatchNo, setFormBatchNo] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const scopeParams = stage === 'lab_dip' ? { developmentCaseId } : { orderId };

  const load = useCallback(async () => {
    if (stage === 'lab_dip' && !developmentCaseId) return;
    if (stage === 'bulk' && !orderId) return;
    setLoading(true);
    setError(null);
    try {
      setBatches(await sampleService.listColorBatches(scopeParams));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [stage, developmentCaseId, orderId]);

  useEffect(() => { load(); }, [load]);

  const toggleDefect = (c: ColorBatchDefectCause) =>
    setFormDefects(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));

  const submitCreate = useCallback(async () => {
    if (acting) return;
    const dyeLotNo = formDyeLotNo.trim();
    if (!dyeLotNo) { bdsToast.warning('缸号必填（染厂染色缸次编号）。'); return; }
    setActing('create');
    try {
      const r = await sampleService.createColorBatch({
        stage,
        developmentCaseId: stage === 'lab_dip' ? developmentCaseId : undefined,
        orderId: stage === 'bulk' ? orderId : undefined,
        dyeLotNo,
        colorRating: formRating,
        defectCauses: formDefects,
        batchNo: formBatchNo.trim() || undefined,
        notes: formNotes.trim() || undefined,
      });
      bdsToast.success(`打色批次 ${r.batch?.batchCode ?? ''} 已登记。`);
      setShowCreate(false);
      setFormDyeLotNo(''); setFormRating(4); setFormDefects([]); setFormBatchNo(''); setFormNotes('');
      await load();
    } catch (e: any) {
      bdsToast.danger(`登记失败：${e?.message || e}`);
    } finally {
      setActing(null);
    }
  }, [acting, stage, developmentCaseId, orderId, formDyeLotNo, formRating, formDefects, formBatchNo, formNotes, load]);

  /** 客户判定（通过可设封样基准；疵点自动入供应商质量分——后端联动） */
  const submitFeedback = useCallback(async (batch: SampleColorBatchRow, status: 'approved' | 'rejected' | 'needs_recast', asSealed = false) => {
    if (acting) return;
    const statusText = { approved: '客户通过', rejected: '客户拒绝', needs_recast: '要求重打' }[status];
    const confirmMsg = status === 'approved' && asSealed
      ? `标记缸号 ${batch.dyeLotNo} 客户通过并设为封样基准？（原基准自动让位；疵点原因自动计入 ${batch.supplierName ?? '供应商'} 质量分）`
      : `标记缸号 ${batch.dyeLotNo} 为「${statusText}」？（评级 ${batch.colorRating} 级将自动计入 ${batch.supplierName ?? '供应商'} 质量分）`;
    if (!(await bdsConfirm({ title: '客户批色判定', body: confirmMsg }))) return;
    setActing(batch.id);
    try {
      const r = await sampleService.recordColorBatchFeedback(batch.id, { status, asSealed });
      if (status !== 'approved' || !asSealed) {
        bdsToast.success(r.qualityScoreLinked ? '判定已登记，疵点已计入供应商质量分。' : '判定已登记。');
      } else {
        bdsToast.success('已设为封样基准。');
      }
      await load();
    } catch (e: any) {
      bdsToast.danger(`判定失败：${e?.message || e}`);
    } finally {
      setActing(null);
    }
  }, [acting, load]);

  const removeBatch = useCallback(async (batch: SampleColorBatchRow) => {
    if (acting) return;
    if (!(await bdsConfirm({ title: '删除打色批次', body: `删除缸号 ${batch.dyeLotNo}（${batch.batchCode}）？已发生的质量分记录不回滚。` }))) return;
    setActing(batch.id);
    try {
      await sampleService.deleteColorBatch(batch.id);
      bdsToast.success('已删除。');
      await load();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    } finally {
      setActing(null);
    }
  }, [acting, load]);

  /** 导出色差证据链（3 分钟 SLA：聚合 → 打印窗） */
  const exportEvidence = useCallback(async () => {
    if (acting) return;
    setActing('export');
    try {
      const ev: ColorBatchEvidence = await sampleService.getColorBatchEvidence(scopeParams as any);
      const scopeTitle = stage === 'lab_dip'
        ? `${ev.scope.caseCode ?? ''} ${ev.scope.caseName ?? ''}`.trim()
        : `${ev.scope.poNumber ?? orderId ?? ''} ${orderLabel ?? ''}`.trim();
      const rowsHtml = ev.batches.map(b => `
        <tr>
          <td>${escapeHtml(b.dyeLotNo)}</td>
          <td>${escapeHtml(b.batchNo ?? '—')}</td>
          <td>${b.colorRating}（${escapeHtml(COLOR_RATING_LABELS[b.colorRating] ?? '')}）</td>
          <td>${b.sideDiff ?? '—'} / ${b.endDiff ?? '—'}</td>
          <td>${b.defectCauses.length ? b.defectCauses.map(c => escapeHtml(COLOR_BATCH_DEFECT_LABELS[c] ?? c)).join('、') : '—'}</td>
          <td>${escapeHtml(COLOR_BATCH_STATUS_LABELS[b.customerStatus] ?? b.customerStatus)}${b.approvedAsSealed ? ' ★封样基准' : ''}</td>
          <td>${escapeHtml(b.supplierName ?? '—')}</td>
        </tr>`).join('');
      const causeSummary = Object.entries(ev.summary.defectCauseCount)
        .map(([c, n]) => `${escapeHtml(COLOR_BATCH_DEFECT_LABELS[c as ColorBatchDefectCause] ?? c)}×${n}`).join('　') || '无';
      printHtmlDocument({
        title: '色差证据链 Color Batch Evidence',
        htmlBody: `
          <div class="doc-section">
            <div class="doc-section-title">取证范围 · ${escapeHtml(scopeTitle)}${ev.scope.customerName ? ' · ' + escapeHtml(ev.scope.customerName) : ''}</div>
            <div class="doc-meta">导出时间 ${new Date().toLocaleString('zh-CN', { hour12: false })} ｜ 批次 ${ev.summary.total} ｜ 通过 ${ev.summary.approved} ｜ 拒绝 ${ev.summary.rejected} ｜ 重打 ${ev.summary.needsRecast} ｜ 待判定 ${ev.summary.pending}</div>
          </div>
          <div class="doc-section">
            <div class="doc-section-title">封样基准（客户批准的比对基准）</div>
            <div>${ev.sealedBasis ? `缸号 ${escapeHtml(ev.sealedBasis.dyeLotNo)} ｜ 评级 ${ev.sealedBasis.colorRating} 级 ｜ ${escapeHtml(ev.sealedBasis.batchCode)} ｜ 批准日 ${escapeHtml(ev.sealedBasis.customerFeedbackDate ?? '—')}` : '尚无封样基准（无客户通过的缸号）'}</div>
          </div>
          <div class="doc-section">
            <div class="doc-section-title">缸号明细</div>
            <table class="doc-table" style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead><tr style="border-bottom:2px solid #1a202c;text-align:left;">
                <th style="padding:6px 8px;">缸号</th><th style="padding:6px 8px;">批次</th><th style="padding:6px 8px;">主评级</th>
                <th style="padding:6px 8px;">左右/前后</th><th style="padding:6px 8px;">疵点原因</th>
                <th style="padding:6px 8px;">客户判定</th><th style="padding:6px 8px;">染厂</th>
              </tr></thead>
              <tbody>${rowsHtml || '<tr><td colspan="7" style="padding:12px 8px;color:#718096;">无批次记录</td></tr>'}</tbody>
            </table>
          </div>
          <div class="doc-section">
            <div class="doc-section-title">疵点原因统计</div>
            <div>${causeSummary}</div>
          </div>`,
      });
    } catch (e: any) {
      bdsToast.danger(`取证失败：${e?.message || e}`);
    } finally {
      setActing(null);
    }
  }, [acting, stage, scopeParams, orderId, orderLabel]);

  const textPrimary = 'text-[var(--text-primary)]';
  const textSecondary = 'text-[var(--text-tertiary)]';
  const textFaint = 'text-[var(--text-quaternary)]';

  return (
    <div className="rounded-inset border border-[var(--border-c-default)] bg-[var(--recessed-bg)] p-4">
      {/* 面板头 */}
      <div className="flex items-center gap-2">
        <Palette size={14} strokeWidth={1.5} className={textFaint} />
        <span className={cx('text-xs font-light', textPrimary)}>{stage === 'lab_dip' ? '打色批次' : '缸差记录'}</span>
        <span className={cx('text-[10px] font-light tracking-[0.14em]', textFaint)}>COLOR BATCHES</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={exportEvidence} disabled={acting !== null} className="bds-btn bds-btn-ghost">
            <Printer size={14} strokeWidth={1.5} />导出证据链
          </button>
          <button type="button" onClick={() => setShowCreate(true)} className="bds-btn bds-btn-secondary">
            <Plus size={14} strokeWidth={1.5} />登记{stage === 'lab_dip' ? '打色' : '缸差'}
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-3 space-y-1.5">
        {loading && <div className={cx('flex items-center justify-center gap-2 py-6 text-xs font-light', textFaint)}><Loader2 size={14} className="animate-spin" />加载中…</div>}
        {!loading && error && <div className={cx('py-4 text-center text-xs font-light', textFaint)}>{error}</div>}
        {!loading && !error && batches.length === 0 && (
          <div className={cx('py-6 text-center text-xs font-light', textFaint)}>暂无{stage === 'lab_dip' ? '打色记录——登记各缸批色情况' : '缸差记录'}。</div>
        )}
        {!loading && batches.map(b => (
          <div key={b.id} className="rounded-control border border-[var(--border-c-subtle)] bg-[var(--bg-raised)] px-3 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={cx('font-light tabular-nums', textPrimary)}>缸 {b.dyeLotNo}</span>
              {b.batchNo && <span className={cx('text-[11px]', textSecondary)}>{b.batchNo}</span>}
              {b.roundNo != null && stage === 'lab_dip' && <span className={cx('text-[10px]', textFaint)}>第 {b.roundNo} 轮</span>}
              <span className={ratingBadgeClass(b.colorRating)}>{b.colorRating} 级 · {COLOR_RATING_LABELS[b.colorRating]}</span>
              {b.defectCauses.map(c => (
                <span key={c} className="bds-badge sm warning">{COLOR_BATCH_DEFECT_LABELS[c]}</span>
              ))}
              {b.approvedAsSealed && (
                <span className="bds-badge sm success"><Star size={10} strokeWidth={1.5} className="inline" /> 封样基准</span>
              )}
              <span className={cx('ml-auto text-[11px] font-light', textSecondary)}>
                {COLOR_BATCH_STATUS_LABELS[b.customerStatus]}{b.supplierName ? ` · ${b.supplierName}` : ''}
              </span>
            </div>
            {b.customerFeedbackNote && (
              <div className={cx('mt-1 truncate text-[11px] font-light', textSecondary)}>客户意见：{b.customerFeedbackNote}</div>
            )}
            {/* 判定操作区（pending / needs_recast 可判定；终态只读） */}
            {(b.customerStatus === 'pending' || b.customerStatus === 'needs_recast') && (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" disabled={acting === b.id} onClick={() => submitFeedback(b, 'approved', true)}
                  className="bds-btn bds-btn-ghost">
                  <CheckCircle2 size={13} strokeWidth={1.5} />通过并设基准
                </button>
                <button type="button" disabled={acting === b.id} onClick={() => submitFeedback(b, 'needs_recast')}
                  className="bds-btn bds-btn-ghost">
                  <RotateCcw size={13} strokeWidth={1.5} />要求重打
                </button>
                <button type="button" disabled={acting === b.id} onClick={() => submitFeedback(b, 'rejected')}
                  className="bds-btn bds-btn-ghost">
                  <XCircle size={13} strokeWidth={1.5} />拒绝
                </button>
                <button type="button" disabled={acting === b.id} onClick={() => removeBatch(b)}
                  className="bds-btn bds-btn-ghost bds-btn-icon ml-auto" title="删除">
                  <Trash2 size={13} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 登记弹窗（A5 ≤2min：缸号 + 评级必填） */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={stage === 'lab_dip' ? '登记打色批次' : '登记缸差记录'}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>缸号 *</label>
            <input
              value={formDyeLotNo}
              onChange={e => setFormDyeLotNo(e.target.value)}
              placeholder="如：缸A-101（染厂染色缸次编号）"
              autoFocus
              className="bds-input sm w-full"
            />
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>色差评级（4-5 级制）*</label>
            <RatingPicker value={formRating} onChange={setFormRating} />
          </div>
          <div>
            <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>疵点原因（多选，计入供应商质量分）</label>
            <div className="flex gap-1.5">
              {COLOR_BATCH_DEFECT_CAUSES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleDefect(c)}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs font-light transition-colors',
                    formDefects.includes(c)
                      ? 'border-[var(--accent-tint)] bg-[var(--accent-tint-light)] text-[var(--text-primary)]'
                      : 'border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--hover-darken)]',
                  )}
                >
                  {COLOR_BATCH_DEFECT_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>批次号（选填）</label>
              <input value={formBatchNo} onChange={e => setFormBatchNo(e.target.value)} placeholder="如：B1" className="bds-input sm w-full" />
            </div>
            <div>
              <label className={cx('mb-1.5 block text-[10px] tracking-[0.14em]', textSecondary)}>备注（选填）</label>
              <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="色光手感等" className="bds-input sm w-full" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="bds-btn bds-btn-ghost">取消</button>
            <button type="button" onClick={submitCreate} disabled={acting === 'create'} className="bds-btn bds-btn-primary">
              {acting === 'create' && <Loader2 size={14} className="animate-spin" />}登记
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
