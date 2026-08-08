/**
 * C3c 薪资管理 tab — 工资单批次（Draft→Confirmed→Paid）+ 员工薪资结构
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, X } from 'lucide-react';
import { hrTokens, hrFormatDate, hrFormatMoney, hrOptionLabel, type HrPersonnelOption } from './hrTokens';
import {
  hrService, PAYROLL_STATUS_OPTIONS,
  type PayrollRun, type PayrollRunDetail, type PayrollItem, type SalaryStructure,
} from '../../services/hrService';
import { statusSemanticClass, type StatusSemantic } from '../rdlBusinessStatusTokens';

interface PayrollTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
}

const runSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Paid': return 'active';
    case 'Confirmed': return 'info';
    default: return 'warning';
  }
};

const emptyRunForm = { period: new Date().toISOString().slice(0, 7), note: '' };
const emptySalaryForm = { userId: '', baseSalary: '', positionAllowance: '', effectiveFrom: new Date().toISOString().slice(0, 10), note: '' };

const PayrollTab: React.FC<PayrollTabProps> = ({ isDarkMode, personnel }) => {
  const t = hrTokens(isDarkMode);
  const [subView, setSubView] = useState<'runs' | 'salary'>('runs');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ── 工资单 ──
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<PayrollRunDetail | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [runForm, setRunForm] = useState(emptyRunForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({ overtimePay: '', commission: '', bonus: '', deduction: '', note: '' });

  // ── 薪资结构 ──
  const [salaryUserId, setSalaryUserId] = useState('');
  const [salaryHistory, setSalaryHistory] = useState<SalaryStructure[]>([]);
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [salaryForm, setSalaryForm] = useState(emptySalaryForm);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const rows = await hrService.listPayrollRuns();
      setRuns(rows);
    } catch (e: any) {
      setError(e?.message || '加载工资单失败');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const detail = await hrService.getPayrollRun(runId);
      setRunDetail(detail);
    } catch (e: any) {
      setError(e?.message || '加载工资单明细失败');
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  useEffect(() => {
    if (selectedRunId) loadRunDetail(selectedRunId);
    else setRunDetail(null);
  }, [selectedRunId, loadRunDetail]);

  const loadSalaryHistory = useCallback(async (userId: string) => {
    if (!userId) { setSalaryHistory([]); return; }
    try {
      const rows = await hrService.getSalaryHistory(userId);
      setSalaryHistory(rows);
    } catch (e: any) {
      setError(e?.message || '加载薪资结构失败');
    }
  }, []);

  useEffect(() => { loadSalaryHistory(salaryUserId); }, [salaryUserId, loadSalaryHistory]);

  const nameOf = useMemo(() => new Map(personnel.map(p => [p.id, p.displayName])), [personnel]);

  const submitRun = async () => {
    if (!/^\d{4}-\d{2}$/.test(runForm.period)) { setError('期间须为 YYYY-MM'); return; }
    setBusy(true);
    setError('');
    try {
      const run = await hrService.createPayrollRun(runForm.period, runForm.note || undefined);
      setRunForm(emptyRunForm);
      setShowRunForm(false);
      await loadRuns();
      setSelectedRunId(run.id);
    } catch (e: any) {
      setError(e?.message || '创建工资单失败');
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<unknown>, failMsg: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await loadRuns();
      if (selectedRunId) await loadRunDetail(selectedRunId);
    } catch (e: any) {
      setError(e?.message || failMsg);
    } finally {
      setBusy(false);
    }
  };

  const openEditItem = (item: PayrollItem) => {
    setEditingItemId(item.id);
    setItemForm({
      overtimePay: String(item.overtimePay || ''),
      commission: String(item.commission || ''),
      bonus: String(item.bonus || ''),
      deduction: String(item.deduction || ''),
      note: item.note || '',
    });
  };

  const submitItem = async () => {
    if (!editingItemId) return;
    setBusy(true);
    setError('');
    try {
      await hrService.updatePayrollItem(editingItemId, {
        overtimePay: Number(itemForm.overtimePay) || 0,
        commission: Number(itemForm.commission) || 0,
        bonus: Number(itemForm.bonus) || 0,
        deduction: Number(itemForm.deduction) || 0,
        note: itemForm.note || null,
      });
      setEditingItemId(null);
      if (selectedRunId) {
        await loadRunDetail(selectedRunId);
        await loadRuns();
      }
    } catch (e: any) {
      setError(e?.message || '更新明细失败');
    } finally {
      setBusy(false);
    }
  };

  const submitSalary = async () => {
    if (!salaryForm.userId) { setError('请选择员工'); return; }
    const baseSalary = Number(salaryForm.baseSalary);
    if (!Number.isFinite(baseSalary) || baseSalary < 0) { setError('基本工资须为非负数字'); return; }
    if (!salaryForm.effectiveFrom) { setError('生效日期必填'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.setSalaryStructure({
        userId: salaryForm.userId,
        baseSalary,
        positionAllowance: Number(salaryForm.positionAllowance) || 0,
        effectiveFrom: salaryForm.effectiveFrom,
        note: salaryForm.note || null,
      });
      setSalaryForm({ ...emptySalaryForm, userId: salaryForm.userId });
      setShowSalaryForm(false);
      await loadSalaryHistory(salaryForm.userId);
    } catch (e: any) {
      setError(e?.message || '保存薪资结构失败');
    } finally {
      setBusy(false);
    }
  };

  const subPillCls = (active: boolean) =>
    `h-8 px-4 rounded-full text-[11px] font-light tracking-wide transition-all duration-200 ${
      active
        ? isDarkMode ? 'bg-white/[0.09] text-white' : 'bg-white/70 text-slate-900'
        : isDarkMode ? 'text-white/50 hover:text-white/80' : 'text-slate-500 hover:text-slate-800'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <div className={`flex items-center gap-1 rounded-full p-0.5 ${isDarkMode ? 'bg-white/[0.04]' : 'bg-white/30'}`}>
          <button className={subPillCls(subView === 'runs')} onClick={() => setSubView('runs')}>工资单</button>
          <button className={subPillCls(subView === 'salary')} onClick={() => setSubView('salary')}>薪资结构</button>
        </div>
        <div className="ml-auto">
          {subView === 'runs' ? (
            <button onClick={() => setShowRunForm(v => !v)} className={t.primaryButtonCls}>
              <Plus className="w-3.5 h-3.5" /> 新建工资单
            </button>
          ) : (
            <button onClick={() => { if (!salaryUserId) { setError('请先选择员工'); return; } setSalaryForm(f => ({ ...f, userId: salaryUserId })); setShowSalaryForm(v => !v); }} className={t.primaryButtonCls}>
              <Plus className="w-3.5 h-3.5" /> 调整薪资
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className={`mx-1 rounded-full border px-4 py-2.5 flex items-center gap-2 text-xs font-light ${statusSemanticClass('danger', isDarkMode)}`}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ── 工资单子视图 ── */}
      {subView === 'runs' && (
        <>
          {showRunForm && (
            <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
              <div className={t.sectionTitleClass}>新建工资单（每月一批，幂等）</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className={t.labelCls + ' mb-1'}>期间（YYYY-MM）*</div>
                  <input type="month" className={t.inputCls} value={runForm.period}
                    onChange={e => setRunForm(f => ({ ...f, period: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <div className={t.labelCls + ' mb-1'}>备注</div>
                  <input className={t.inputCls} value={runForm.note}
                    onChange={e => setRunForm(f => ({ ...f, note: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowRunForm(false)} className={t.actionButtonCls}>取消</button>
                <button onClick={submitRun} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                  <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '创建'}
                </button>
              </div>
            </div>
          )}

          <div className="grid flex-1 min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3 px-1">
            {/* 左：批次列表 */}
            <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {runs.map(r => (
                  <button key={r.id} onClick={() => setSelectedRunId(r.id)}
                    className={`block w-full px-4 py-3 text-left ${t.rowCls(selectedRunId === r.id)}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-light ${t.textPrimaryClass}`}>{r.period}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(runSemantic(r.status), isDarkMode)}`}>
                        {hrOptionLabel(PAYROLL_STATUS_OPTIONS, r.status)}
                      </span>
                    </div>
                    <div className={`mt-1 text-[11px] font-light ${t.textSecondaryClass}`}>
                      {r.headcount} 人 · {hrFormatMoney(r.totalNet)}
                    </div>
                  </button>
                ))}
                {!runsLoading && runs.length === 0 && (
                  <div className={`py-12 text-center ${t.sectionMutedClass}`}>暂无工资单，点击右上角新建</div>
                )}
                {runsLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
              </div>
            </div>

            {/* 右：批次明细 */}
            <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
              {runDetail ? (
                <>
                  <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                    <span className={t.sectionTitleClass}>{runDetail.period} 工资单</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(runSemantic(runDetail.status), isDarkMode)}`}>
                      {hrOptionLabel(PAYROLL_STATUS_OPTIONS, runDetail.status)}
                    </span>
                    <span className={t.sectionMutedClass}>
                      {runDetail.headcount} 人 · 合计 {hrFormatMoney(runDetail.totalNet)}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      {runDetail.status === 'Draft' && (
                        <>
                          <button disabled={busy} onClick={() => runAction(() => hrService.generatePayrollItems(runDetail.id), '生成明细失败')} className={t.subtleButtonCls}>生成明细</button>
                          <button disabled={busy} onClick={() => runAction(() => hrService.confirmPayrollRun(runDetail.id), '确认失败')} className={t.primaryButtonCls}>确认</button>
                        </>
                      )}
                      {runDetail.status === 'Confirmed' && (
                        <button disabled={busy} onClick={() => runAction(() => hrService.markPayrollPaid(runDetail.id), '发放登记失败')} className={t.primaryButtonCls}>标记发放</button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_90px_80px_80px_80px_80px_80px_100px_72px] border-b border-white/[0.06]">
                    <div className={t.thCls}>员工</div>
                    <div className={t.thCls}>基本</div>
                    <div className={t.thCls}>津贴</div>
                    <div className={t.thCls}>加班</div>
                    <div className={t.thCls}>佣金</div>
                    <div className={t.thCls}>奖金</div>
                    <div className={t.thCls}>扣款</div>
                    <div className={t.thCls}>实发</div>
                    <div className={t.thCls}></div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {runDetail.items.map(item => (
                      <React.Fragment key={item.id}>
                        <div className="grid grid-cols-[minmax(0,1fr)_90px_80px_80px_80px_80px_80px_100px_72px] items-center">
                          <div className={t.tdCls}>
                            {item.displayName || nameOf.get(item.userId) || item.userId}
                            <span className={`ml-1.5 font-mono text-[10px] ${t.textSecondaryClass}`}>{item.employeeNo || ''}</span>
                          </div>
                          <div className={t.tdCls}>{item.base.toFixed(2)}</div>
                          <div className={t.tdCls}>{item.allowance.toFixed(2)}</div>
                          <div className={t.tdCls}>{item.overtimePay.toFixed(2)}</div>
                          <div className={t.tdCls}>{item.commission.toFixed(2)}</div>
                          <div className={t.tdCls}>{item.bonus.toFixed(2)}</div>
                          <div className={t.tdCls}>{item.deduction.toFixed(2)}</div>
                          <div className={`${t.tdCls} font-normal`}>{item.net.toFixed(2)}</div>
                          <div className={t.tdCls}>
                            {runDetail.status === 'Draft' && (
                              <button onClick={() => openEditItem(item)} className={t.subtleButtonCls}>调整</button>
                            )}
                          </div>
                        </div>
                        {editingItemId === item.id && (
                          <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_auto] items-end gap-2 border-b border-white/[0.05] bg-white/[0.015] px-4 py-3">
                            <div>
                              <div className={t.labelCls + ' mb-1'}>加班费</div>
                              <input type="number" step="0.01" className={t.inputCls} value={itemForm.overtimePay}
                                onChange={e => setItemForm(f => ({ ...f, overtimePay: e.target.value }))} />
                            </div>
                            <div>
                              <div className={t.labelCls + ' mb-1'}>佣金</div>
                              <input type="number" step="0.01" className={t.inputCls} value={itemForm.commission}
                                onChange={e => setItemForm(f => ({ ...f, commission: e.target.value }))} />
                            </div>
                            <div>
                              <div className={t.labelCls + ' mb-1'}>奖金</div>
                              <input type="number" step="0.01" className={t.inputCls} value={itemForm.bonus}
                                onChange={e => setItemForm(f => ({ ...f, bonus: e.target.value }))} />
                            </div>
                            <div>
                              <div className={t.labelCls + ' mb-1'}>扣款</div>
                              <input type="number" step="0.01" className={t.inputCls} value={itemForm.deduction}
                                onChange={e => setItemForm(f => ({ ...f, deduction: e.target.value }))} />
                            </div>
                            <div>
                              <div className={t.labelCls + ' mb-1'}>备注</div>
                              <input className={t.inputCls} value={itemForm.note}
                                onChange={e => setItemForm(f => ({ ...f, note: e.target.value }))} />
                            </div>
                            <div className="flex gap-1.5">
                              <button onClick={() => setEditingItemId(null)} className={t.actionButtonCls}>取消</button>
                              <button onClick={submitItem} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                                <Check className="w-3.5 h-3.5" /> 保存
                              </button>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                    {runDetail.items.length === 0 && (
                      <div className={`py-12 text-center ${t.sectionMutedClass}`}>
                        暂无明细 — 点击「生成明细」按当前薪资结构自动填充
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className={`flex-1 flex items-center justify-center ${t.sectionMutedClass}`}>从左侧选择工资单批次</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── 薪资结构子视图 ── */}
      {subView === 'salary' && (
        <>
          <div className="flex items-center gap-2 px-1">
            <select className={`${t.inputCls} max-w-56`} value={salaryUserId} onChange={e => setSalaryUserId(e.target.value)}>
              <option value="">选择员工查看薪资历史</option>
              {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </div>

          {showSalaryForm && (
            <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
              <div className={t.sectionTitleClass}>调整薪资 · {nameOf.get(salaryForm.userId) || ''}</div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={t.labelCls + ' mb-1'}>基本工资（CNY）*</div>
                  <input type="number" min="0" step="0.01" className={t.inputCls} value={salaryForm.baseSalary}
                    onChange={e => setSalaryForm(f => ({ ...f, baseSalary: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>岗位津贴</div>
                  <input type="number" min="0" step="0.01" className={t.inputCls} value={salaryForm.positionAllowance}
                    onChange={e => setSalaryForm(f => ({ ...f, positionAllowance: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>生效日期 *</div>
                  <input type="date" className={t.inputCls} value={salaryForm.effectiveFrom}
                    onChange={e => setSalaryForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>备注</div>
                  <input className={t.inputCls} value={salaryForm.note}
                    onChange={e => setSalaryForm(f => ({ ...f, note: e.target.value }))} placeholder="调薪原因" />
                </div>
              </div>
              <div className={t.sectionMutedClass}>保存后原薪资结构自动封版（生效区间留痕），新结构自生效日起生效。</div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSalaryForm(false)} className={t.actionButtonCls}>取消</button>
                <button onClick={submitSalary} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                  <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          <div className={`${t.cardClass} mx-1 flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className="grid grid-cols-[110px_110px_120px_120px_minmax(0,1fr)] border-b border-white/[0.06]">
              <div className={t.thCls}>基本工资</div>
              <div className={t.thCls}>岗位津贴</div>
              <div className={t.thCls}>生效起</div>
              <div className={t.thCls}>生效止</div>
              <div className={t.thCls}>备注</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {salaryHistory.map(s => (
                <div key={s.id} className="grid grid-cols-[110px_110px_120px_120px_minmax(0,1fr)] items-center">
                  <div className={t.tdCls}>{s.baseSalary.toFixed(2)}</div>
                  <div className={t.tdCls}>{s.positionAllowance.toFixed(2)}</div>
                  <div className={t.tdCls}>{hrFormatDate(s.effectiveFrom)}</div>
                  <div className={t.tdCls}>
                    {s.effectiveTo ? hrFormatDate(s.effectiveTo) : (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass('active', isDarkMode)}`}>当前生效</span>
                    )}
                  </div>
                  <div className={`${t.tdCls} truncate ${t.textSecondaryClass}`}>{s.note || '-'}</div>
                </div>
              ))}
              {salaryUserId && salaryHistory.length === 0 && (
                <div className={`py-12 text-center ${t.sectionMutedClass}`}>该员工暂无薪资结构，点击右上角「调整薪资」建立</div>
              )}
              {!salaryUserId && (
                <div className={`py-12 text-center ${t.sectionMutedClass}`}>请先选择员工</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PayrollTab;
