/**
 * C3d 绩效管理 tab — 考核周期 + 评定（自评→提交→终评确认）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, X } from 'lucide-react';
import { hrTokens, hrOptionLabel, type HrPersonnelOption } from './hrTokens';
import {
  hrService, REVIEW_STATUS_OPTIONS, REVIEW_GRADE_OPTIONS,
  type PerformanceCycle, type PerformanceReview, type ReviewGrade,
} from '../../services/hrService';
import { statusSemanticClass, type StatusSemantic } from '../rdlBusinessStatusTokens';
import CapsuleDateInput from '../ui/CapsuleDateInput';

interface PerformanceTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
}

const cycleSemantic = (status: string): StatusSemantic => (status === 'Open' ? 'active' : 'neutral');

const reviewSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Confirmed': return 'active';
    case 'Submitted': return 'info';
    default: return 'warning';
  }
};

const gradeSemantic = (grade: string | null): StatusSemantic => {
  switch (grade) {
    case 'A': return 'active';
    case 'B': return 'info';
    case 'C': return 'warning';
    case 'D': return 'danger';
    default: return 'neutral';
  }
};

const emptyCycleForm = { name: '', period: '', startDate: '', endDate: '' };
const emptyReviewForm = { userId: '', selfScore: '', comment: '' };
const emptyConfirmForm = { managerScore: '', finalScore: '', grade: 'B' as ReviewGrade, comment: '' };

const PerformanceTab: React.FC<PerformanceTabProps> = ({ isDarkMode, personnel }) => {
  const t = hrTokens(isDarkMode);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [cycles, setCycles] = useState<PerformanceCycle[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [showCycleForm, setShowCycleForm] = useState(false);
  const [cycleForm, setCycleForm] = useState(emptyCycleForm);

  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState(emptyConfirmForm);

  const loadCycles = useCallback(async () => {
    setCyclesLoading(true);
    try {
      const rows = await hrService.listPerformanceCycles();
      setCycles(rows);
    } catch (e: any) {
      setError(e?.message || '加载考核周期失败');
    } finally {
      setCyclesLoading(false);
    }
  }, []);

  const loadReviews = useCallback(async (cycleId: string) => {
    setReviewsLoading(true);
    try {
      const rows = await hrService.listPerformanceReviews({ cycleId });
      setReviews(rows);
    } catch (e: any) {
      setError(e?.message || '加载评定失败');
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  useEffect(() => { loadCycles(); }, [loadCycles]);

  useEffect(() => {
    if (selectedCycleId) loadReviews(selectedCycleId);
    else setReviews([]);
  }, [selectedCycleId, loadReviews]);

  const selectedCycle = useMemo(
    () => cycles.find(c => c.id === selectedCycleId) || null,
    [cycles, selectedCycleId],
  );

  const submitCycle = async () => {
    if (!cycleForm.name.trim()) { setError('周期名称必填'); return; }
    if (!cycleForm.period.trim()) { setError('考核期间必填（如 2026-H1）'); return; }
    setBusy(true);
    setError('');
    try {
      const cycle = await hrService.createPerformanceCycle({
        name: cycleForm.name.trim(),
        period: cycleForm.period.trim(),
        startDate: cycleForm.startDate || undefined,
        endDate: cycleForm.endDate || undefined,
      });
      setCycleForm(emptyCycleForm);
      setShowCycleForm(false);
      await loadCycles();
      setSelectedCycleId(cycle.id);
    } catch (e: any) {
      setError(e?.message || '创建周期失败');
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    if (!selectedCycleId) return;
    if (!reviewForm.userId) { setError('请选择员工'); return; }
    const selfScore = reviewForm.selfScore === '' ? null : Number(reviewForm.selfScore);
    if (selfScore !== null && (!Number.isFinite(selfScore) || selfScore < 0 || selfScore > 100)) {
      setError('自评分须在 0-100');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await hrService.upsertPerformanceReview({
        cycleId: selectedCycleId,
        userId: reviewForm.userId,
        selfScore,
        comment: reviewForm.comment || null,
      });
      setReviewForm(emptyReviewForm);
      setShowReviewForm(false);
      await loadReviews(selectedCycleId);
      await loadCycles();
    } catch (e: any) {
      setError(e?.message || '保存评定失败');
    } finally {
      setBusy(false);
    }
  };

  const submitReviewAction = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await hrService.submitPerformanceReview(id);
      if (selectedCycleId) await loadReviews(selectedCycleId);
    } catch (e: any) {
      setError(e?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const openConfirm = (r: PerformanceReview) => {
    setConfirmingId(r.id);
    setConfirmForm({
      managerScore: r.managerScore != null ? String(r.managerScore) : '',
      finalScore: r.finalScore != null ? String(r.finalScore) : (r.selfScore != null ? String(r.selfScore) : ''),
      grade: r.grade || 'B',
      comment: r.comment || '',
    });
  };

  const submitConfirm = async () => {
    if (!confirmingId) return;
    const managerScore = Number(confirmForm.managerScore);
    const finalScore = Number(confirmForm.finalScore);
    if (!Number.isFinite(managerScore) || managerScore < 0 || managerScore > 100) { setError('主管评分须在 0-100'); return; }
    if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) { setError('终评分须在 0-100'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.confirmPerformanceReview(confirmingId, {
        managerScore,
        finalScore,
        grade: confirmForm.grade,
        comment: confirmForm.comment || undefined,
      });
      setConfirmingId(null);
      if (selectedCycleId) await loadReviews(selectedCycleId);
      await loadCycles();
    } catch (e: any) {
      setError(e?.message || '终评确认失败');
    } finally {
      setBusy(false);
    }
  };

  const closeCycle = async () => {
    if (!selectedCycleId) return;
    setBusy(true);
    setError('');
    try {
      await hrService.closePerformanceCycle(selectedCycleId);
      await loadCycles();
    } catch (e: any) {
      setError(e?.message || '关闭周期失败');
    } finally {
      setBusy(false);
    }
  };

  // 周期内尚无评定的员工（用于新建评定 picker）
  const unreviewed = useMemo(() => {
    const reviewed = new Set(reviews.map(r => r.userId));
    return personnel.filter(p => !reviewed.has(p.id));
  }, [reviews, personnel]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className={t.sectionMutedClass}>考核周期</span>
        <div className="ml-auto">
          <button onClick={() => setShowCycleForm(v => !v)} className={t.primaryButtonCls}>
            <Plus className="w-3.5 h-3.5" /> 新建周期
          </button>
        </div>
      </div>

      {error && (
        <div className={`mx-1 rounded-full border px-4 py-2.5 flex items-center gap-2 text-xs font-light ${statusSemanticClass('danger', isDarkMode)}`}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {showCycleForm && (
        <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
          <div className={t.sectionTitleClass}>新建考核周期</div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className={t.labelCls + ' mb-1'}>名称 *</div>
              <input className={t.inputCls} value={cycleForm.name}
                onChange={e => setCycleForm(f => ({ ...f, name: e.target.value }))} placeholder="如：2026 上半年考核" />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>期间 *</div>
              <input className={t.inputCls} value={cycleForm.period}
                onChange={e => setCycleForm(f => ({ ...f, period: e.target.value }))} placeholder="如：2026-H1" />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>开始日期</div>
              <CapsuleDateInput className={t.inputCls} value={cycleForm.startDate}
                onChange={(v) => setCycleForm(f => ({ ...f, startDate: v }))} isDarkMode={isDarkMode} />
            </div>
            <div>
              <div className={t.labelCls + ' mb-1'}>结束日期</div>
              <CapsuleDateInput className={t.inputCls} value={cycleForm.endDate}
                onChange={(v) => setCycleForm(f => ({ ...f, endDate: v }))} isDarkMode={isDarkMode} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCycleForm(false)} className={t.actionButtonCls}>取消</button>
            <button onClick={submitCycle} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
              <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '创建'}
            </button>
          </div>
        </div>
      )}

      <div className="grid flex-1 min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3 px-1">
        {/* 左：周期列表 */}
        <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {cycles.map(c => (
              <button key={c.id} onClick={() => setSelectedCycleId(c.id)}
                className={`block w-full px-4 py-3 text-left ${t.rowCls(selectedCycleId === c.id)}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-light ${t.textPrimaryClass}`}>{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(cycleSemantic(c.status), isDarkMode)}`}>
                    {c.status === 'Open' ? '开放' : '已关闭'}
                  </span>
                </div>
                <div className={`mt-1 text-[11px] font-light ${t.textSecondaryClass}`}>
                  {c.period} · 评定 {c.reviewCount} · 已确认 {c.confirmedCount}
                </div>
              </button>
            ))}
            {!cyclesLoading && cycles.length === 0 && (
              <div className={`py-12 text-center ${t.sectionMutedClass}`}>暂无考核周期，点击右上角新建</div>
            )}
            {cyclesLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
          </div>
        </div>

        {/* 右：评定列表 */}
        <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
          {selectedCycle ? (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border-c-default)] px-4 py-3">
                <span className={t.sectionTitleClass}>{selectedCycle.name}</span>
                <span className={t.sectionMutedClass}>{selectedCycle.period}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {selectedCycle.status === 'Open' && (
                    <>
                      <button onClick={() => setShowReviewForm(v => !v)} className={t.subtleButtonCls}>
                        <Plus className="w-3 h-3" /> 录入评定
                      </button>
                      <button disabled={busy} onClick={closeCycle} className={t.actionButtonCls}>关闭周期</button>
                    </>
                  )}
                </div>
              </div>

              {showReviewForm && selectedCycle.status === 'Open' && (
                <div className="space-y-3 border-b border-[var(--border-c-default)] px-4 py-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className={t.labelCls + ' mb-1'}>员工（未评定）*</div>
                      <select className="bds-select" value={reviewForm.userId}
                        onChange={e => setReviewForm(f => ({ ...f, userId: e.target.value }))}>
                        <option value="">请选择</option>
                        {unreviewed.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className={t.labelCls + ' mb-1'}>自评分（0-100）</div>
                      <input type="number" min="0" max="100" step="0.5" className={t.inputCls} value={reviewForm.selfScore}
                        onChange={e => setReviewForm(f => ({ ...f, selfScore: e.target.value }))} />
                    </div>
                    <div>
                      <div className={t.labelCls + ' mb-1'}>自评说明</div>
                      <input className={t.inputCls} value={reviewForm.comment}
                        onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowReviewForm(false)} className={t.actionButtonCls}>取消</button>
                    <button onClick={submitReview} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                      <Check className="w-3.5 h-3.5" /> 保存（草稿）
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px_72px_96px_minmax(0,1.2fr)] border-b border-[var(--border-c-default)]">
                <div className={t.thCls}>员工</div>
                <div className={t.thCls}>自评</div>
                <div className={t.thCls}>主管评</div>
                <div className={t.thCls}>终评</div>
                <div className={t.thCls}>评级</div>
                <div className={t.thCls}>状态</div>
                <div className={t.thCls}>操作</div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {reviews.map(r => (
                  <React.Fragment key={r.id}>
                    <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px_72px_96px_minmax(0,1.2fr)] items-center">
                      <div className={t.tdCls}>{r.displayName || r.userId}</div>
                      <div className={t.tdCls}>{r.selfScore ?? '-'}</div>
                      <div className={t.tdCls}>{r.managerScore ?? '-'}</div>
                      <div className={`${t.tdCls} font-normal`}>{r.finalScore ?? '-'}</div>
                      <div className={t.tdCls}>
                        {r.grade ? (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(gradeSemantic(r.grade), isDarkMode)}`}>{r.grade}</span>
                        ) : '-'}
                      </div>
                      <div className={t.tdCls}>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(reviewSemantic(r.status), isDarkMode)}`}>
                          {hrOptionLabel(REVIEW_STATUS_OPTIONS, r.status)}
                        </span>
                      </div>
                      <div className={`${t.tdCls} flex items-center gap-1.5`}>
                        {r.status === 'Draft' && selectedCycle.status === 'Open' && (
                          <button disabled={busy} onClick={() => submitReviewAction(r.id)} className={t.subtleButtonCls}>提交</button>
                        )}
                        {r.status === 'Submitted' && (
                          <button disabled={busy} onClick={() => openConfirm(r)} className={t.subtleButtonCls}>终评确认</button>
                        )}
                        {r.comment && <span className={`truncate text-[10px] ${t.textSecondaryClass}`} title={r.comment}>{r.comment}</span>}
                      </div>
                    </div>
                    {confirmingId === r.id && (
                      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-2 border-b border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-4 py-3">
                        <div>
                          <div className={t.labelCls + ' mb-1'}>主管评分 *</div>
                          <input type="number" min="0" max="100" step="0.5" className={t.inputCls} value={confirmForm.managerScore}
                            onChange={e => setConfirmForm(f => ({ ...f, managerScore: e.target.value }))} />
                        </div>
                        <div>
                          <div className={t.labelCls + ' mb-1'}>终评分 *</div>
                          <input type="number" min="0" max="100" step="0.5" className={t.inputCls} value={confirmForm.finalScore}
                            onChange={e => setConfirmForm(f => ({ ...f, finalScore: e.target.value }))} />
                        </div>
                        <div>
                          <div className={t.labelCls + ' mb-1'}>评级 *</div>
                          <select className="bds-select" value={confirmForm.grade}
                            onChange={e => setConfirmForm(f => ({ ...f, grade: e.target.value as ReviewGrade }))}>
                            {REVIEW_GRADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div className={t.labelCls + ' mb-1'}>评语</div>
                          <input className={t.inputCls} value={confirmForm.comment}
                            onChange={e => setConfirmForm(f => ({ ...f, comment: e.target.value }))} />
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setConfirmingId(null)} className={t.actionButtonCls}>取消</button>
                          <button onClick={submitConfirm} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                            <Check className="w-3.5 h-3.5" /> 确认
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
                {!reviewsLoading && reviews.length === 0 && (
                  <div className={`py-12 text-center ${t.sectionMutedClass}`}>该周期暂无评定记录</div>
                )}
                {reviewsLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
              </div>
            </>
          ) : (
            <div className={`flex-1 flex items-center justify-center ${t.sectionMutedClass}`}>从左侧选择考核周期</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PerformanceTab;
