/**
 * C3b 考勤请假 tab — 考勤记录/月度汇总 + 请假审批
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, X } from 'lucide-react';
import { hrTokens, hrOptionLabel, type HrPersonnelOption } from './hrTokens';
import {
  hrService,
  ATTENDANCE_STATUS_OPTIONS, LEAVE_TYPE_OPTIONS, LEAVE_STATUS_OPTIONS,
  type AttendanceRecord, type AttendanceSummaryRow, type LeaveRequest, type LeaveType,
} from '../../services/hrService';
import { statusSemanticClass, type StatusSemantic } from '../rdlBusinessStatusTokens';
import CapsuleDateInput from '../ui/CapsuleDateInput';

interface AttendanceLeaveTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
}

const attendanceSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Normal': return 'active';
    case 'Overtime': return 'info';
    case 'Late':
    case 'EarlyLeave':
    case 'LateAndEarly': return 'warning';
    case 'Absent': return 'danger';
    case 'Leave': return 'info';
    default: return 'neutral';
  }
};

const leaveSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Approved': return 'active';
    case 'Pending': return 'warning';
    case 'Rejected': return 'danger';
    default: return 'neutral';
  }
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

const emptyAttendanceForm = { userId: '', date: today(), checkIn: '', checkOut: '', note: '' };
const emptyLeaveForm = { userId: '', type: 'Annual' as LeaveType, startDate: '', endDate: '', days: '', reason: '' };

const AttendanceLeaveTab: React.FC<AttendanceLeaveTabProps> = ({ isDarkMode, personnel }) => {
  const t = hrTokens(isDarkMode);
  const [subView, setSubView] = useState<'records' | 'leave'>('records');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ── 考勤 ──
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummaryRow[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [showAttForm, setShowAttForm] = useState(false);
  const [attForm, setAttForm] = useState(emptyAttendanceForm);

  // ── 请假 ──
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState('Pending');
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState(emptyLeaveForm);

  const loadAttendance = useCallback(async () => {
    setAttLoading(true);
    try {
      const [rows, sum] = await Promise.all([
        hrService.listAttendance({ month, status: statusFilter || undefined }),
        hrService.attendanceSummary(month),
      ]);
      setRecords(rows);
      setSummary(sum);
    } catch (e: any) {
      setError(e?.message || '加载考勤失败');
    } finally {
      setAttLoading(false);
    }
  }, [month, statusFilter]);

  const loadLeave = useCallback(async () => {
    setLeaveLoading(true);
    try {
      const rows = await hrService.listLeaveRequests({ status: leaveStatusFilter || undefined });
      setLeaveRequests(rows);
    } catch (e: any) {
      setError(e?.message || '加载请假单失败');
    } finally {
      setLeaveLoading(false);
    }
  }, [leaveStatusFilter]);

  useEffect(() => {
    if (subView === 'records') loadAttendance();
    else loadLeave();
  }, [subView, loadAttendance, loadLeave]);

  // 月度合计
  const monthTotals = useMemo(() => {
    const acc = { days: 0, late: 0, earlyLeave: 0, absent: 0, leave: 0, overtime: 0 };
    for (const row of summary) {
      acc.days += row.days; acc.late += row.late; acc.earlyLeave += row.earlyLeave;
      acc.absent += row.absent; acc.leave += row.leave; acc.overtime += row.overtime;
    }
    return acc;
  }, [summary]);

  const submitAttendance = async () => {
    if (!attForm.userId) { setError('请选择员工'); return; }
    if (!attForm.date) { setError('日期必填'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.upsertAttendance({
        userId: attForm.userId,
        date: attForm.date,
        checkIn: attForm.checkIn || null,
        checkOut: attForm.checkOut || null,
        note: attForm.note || null,
      });
      setAttForm(emptyAttendanceForm);
      setShowAttForm(false);
      await loadAttendance();
    } catch (e: any) {
      setError(e?.message || '登记考勤失败');
    } finally {
      setBusy(false);
    }
  };

  const submitLeave = async () => {
    if (!leaveForm.userId) { setError('请选择员工'); return; }
    if (!leaveForm.startDate || !leaveForm.endDate) { setError('起止日期必填'); return; }
    const days = Number(leaveForm.days);
    if (!Number.isFinite(days) || days <= 0) { setError('请假天数须大于 0'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.createLeaveRequest({
        userId: leaveForm.userId,
        type: leaveForm.type,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        days,
        reason: leaveForm.reason || null,
      });
      setLeaveForm(emptyLeaveForm);
      setShowLeaveForm(false);
      await loadLeave();
    } catch (e: any) {
      setError(e?.message || '提交请假单失败');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: 'Approved' | 'Rejected') => {
    const rejectReason = decision === 'Rejected' ? window.prompt('请输入拒绝原因') || '' : undefined;
    setBusy(true);
    setError('');
    try {
      await hrService.decideLeaveRequest(id, decision, rejectReason);
      await loadLeave();
    } catch (e: any) {
      setError(e?.message || '审批失败');
    } finally {
      setBusy(false);
    }
  };

  const cancelLeave = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await hrService.cancelLeaveRequest(id);
      await loadLeave();
    } catch (e: any) {
      setError(e?.message || '取消失败');
    } finally {
      setBusy(false);
    }
  };

  const subPillCls = (active: boolean) =>
    `h-8 px-4 rounded-full text-[11px] font-light tracking-wide transition-all duration-200 ${
      active
        ? 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]'
        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 子视图切换 + 工具栏 */}
      <div className="flex items-center gap-2 px-1">
        <div className={`flex items-center gap-1 rounded-full p-0.5 bg-[var(--recessed-bg)]`}>
          <button className={subPillCls(subView === 'records')} onClick={() => setSubView('records')}>考勤记录</button>
          <button className={subPillCls(subView === 'leave')} onClick={() => setSubView('leave')}>请假审批</button>
        </div>

        {subView === 'records' ? (
          <>
            <input type="month" className={`${t.inputCls} max-w-40`} value={month} onChange={e => setMonth(e.target.value)} />
            <select className="bds-select max-w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {ATTENDANCE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="ml-auto">
              <button onClick={() => setShowAttForm(v => !v)} className={t.primaryButtonCls}>
                <Plus className="w-3.5 h-3.5" /> 登记考勤
              </button>
            </div>
          </>
        ) : (
          <>
            <select className="bds-select max-w-36" value={leaveStatusFilter} onChange={e => setLeaveStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {LEAVE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="ml-auto">
              <button onClick={() => setShowLeaveForm(v => !v)} className={t.primaryButtonCls}>
                <Plus className="w-3.5 h-3.5" /> 新建请假单
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className={`mx-1 rounded-full border px-4 py-2.5 flex items-center gap-2 text-xs font-light ${statusSemanticClass('danger', isDarkMode)}`}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ── 考勤子视图 ── */}
      {subView === 'records' && (
        <>
          {/* 月度汇总条 */}
          <div className="grid grid-cols-6 gap-2 px-1">
            {[
              { label: '出勤人日', value: monthTotals.days },
              { label: '迟到', value: monthTotals.late },
              { label: '早退', value: monthTotals.earlyLeave },
              { label: '缺勤', value: monthTotals.absent },
              { label: '请假', value: monthTotals.leave },
              { label: '加班', value: monthTotals.overtime },
            ].map(s => (
              <div key={s.label} className={`${t.cardClass} px-4 py-3`}>
                <div className={t.labelCls}>{s.label}</div>
                <div className={`mt-1 text-lg font-light ${t.textPrimaryClass}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {showAttForm && (
            <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
              <div className={t.sectionTitleClass}>登记考勤（同日同人覆盖更新）</div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={t.labelCls + ' mb-1'}>员工 *</div>
                  <select className="bds-select" value={attForm.userId}
                    onChange={e => setAttForm(f => ({ ...f, userId: e.target.value }))}>
                    <option value="">请选择</option>
                    {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>日期 *</div>
                  <CapsuleDateInput className={t.inputCls} value={attForm.date}
                    onChange={(v) => setAttForm(f => ({ ...f, date: v }))} isDarkMode={isDarkMode} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>签到（HH:MM）</div>
                  <input type="time" className={t.inputCls} value={attForm.checkIn}
                    onChange={e => setAttForm(f => ({ ...f, checkIn: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>签退（HH:MM）</div>
                  <input type="time" className={t.inputCls} value={attForm.checkOut}
                    onChange={e => setAttForm(f => ({ ...f, checkOut: e.target.value }))} />
                </div>
              </div>
              <div>
                <div className={t.labelCls + ' mb-1'}>备注</div>
                <input className={t.inputCls} value={attForm.note}
                  onChange={e => setAttForm(f => ({ ...f, note: e.target.value }))} placeholder="留空则按 09:30-17:30 自动推导状态" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAttForm(false)} className={t.actionButtonCls}>取消</button>
                <button onClick={submitAttendance} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                  <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          <div className={`${t.cardClass} mx-1 flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className="grid grid-cols-[minmax(0,1fr)_96px_80px_80px_110px_80px_minmax(0,1fr)] border-b border-[var(--border-c-default)]">
              <div className={t.thCls}>员工</div>
              <div className={t.thCls}>日期</div>
              <div className={t.thCls}>签到</div>
              <div className={t.thCls}>签退</div>
              <div className={t.thCls}>状态</div>
              <div className={t.thCls}>工时</div>
              <div className={t.thCls}>备注</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {records.map(r => (
                <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_96px_80px_80px_110px_80px_minmax(0,1fr)] items-center">
                  <div className={t.tdCls}>{r.displayName || r.userId}</div>
                  <div className={t.tdCls}>{r.date}</div>
                  <div className={t.tdCls}>{r.checkIn || '-'}</div>
                  <div className={t.tdCls}>{r.checkOut || '-'}</div>
                  <div className={t.tdCls}>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(attendanceSemantic(r.status), isDarkMode)}`}>
                      {hrOptionLabel(ATTENDANCE_STATUS_OPTIONS, r.status)}
                    </span>
                  </div>
                  <div className={t.tdCls}>{r.workHours ?? '-'}</div>
                  <div className={`${t.tdCls} truncate ${t.textSecondaryClass}`}>{r.note || ''}</div>
                </div>
              ))}
              {!attLoading && records.length === 0 && (
                <div className={`py-12 text-center ${t.sectionMutedClass}`}>本月暂无考勤记录</div>
              )}
              {attLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
            </div>
          </div>
        </>
      )}

      {/* ── 请假子视图 ── */}
      {subView === 'leave' && (
        <>
          {showLeaveForm && (
            <div className={`${t.cardClass} mx-1 p-5 space-y-3`}>
              <div className={t.sectionTitleClass}>新建请假单</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className={t.labelCls + ' mb-1'}>员工 *</div>
                  <select className="bds-select" value={leaveForm.userId}
                    onChange={e => setLeaveForm(f => ({ ...f, userId: e.target.value }))}>
                    <option value="">请选择</option>
                    {personnel.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>请假类型</div>
                  <select className="bds-select" value={leaveForm.type}
                    onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value as LeaveType }))}>
                    {LEAVE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>天数 *</div>
                  <input type="number" min="0.5" step="0.5" className={t.inputCls} value={leaveForm.days}
                    onChange={e => setLeaveForm(f => ({ ...f, days: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>开始日期 *</div>
                  <CapsuleDateInput className={t.inputCls} value={leaveForm.startDate}
                    onChange={(v) => setLeaveForm(f => ({ ...f, startDate: v }))} isDarkMode={isDarkMode} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>结束日期 *</div>
                  <CapsuleDateInput className={t.inputCls} value={leaveForm.endDate}
                    onChange={(v) => setLeaveForm(f => ({ ...f, endDate: v }))} isDarkMode={isDarkMode} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>事由</div>
                  <input className={t.inputCls} value={leaveForm.reason}
                    onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowLeaveForm(false)} className={t.actionButtonCls}>取消</button>
                <button onClick={submitLeave} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                  <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '提交'}
                </button>
              </div>
            </div>
          )}

          <div className={`${t.cardClass} mx-1 flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className="grid grid-cols-[minmax(0,0.9fr)_80px_180px_64px_minmax(0,1.2fr)_96px_minmax(0,1.1fr)] border-b border-[var(--border-c-default)]">
              <div className={t.thCls}>员工</div>
              <div className={t.thCls}>类型</div>
              <div className={t.thCls}>起止日期</div>
              <div className={t.thCls}>天数</div>
              <div className={t.thCls}>事由</div>
              <div className={t.thCls}>状态</div>
              <div className={t.thCls}>操作</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {leaveRequests.map(r => (
                <div key={r.id} className="grid grid-cols-[minmax(0,0.9fr)_80px_180px_64px_minmax(0,1.2fr)_96px_minmax(0,1.1fr)] items-center">
                  <div className={t.tdCls}>{r.displayName || r.userId}</div>
                  <div className={t.tdCls}>{hrOptionLabel(LEAVE_TYPE_OPTIONS, r.type)}</div>
                  <div className={t.tdCls}>{r.startDate} ~ {r.endDate}</div>
                  <div className={t.tdCls}>{r.days}</div>
                  <div className={`${t.tdCls} truncate ${t.textSecondaryClass}`} title={r.reason || ''}>{r.reason || '-'}</div>
                  <div className={t.tdCls}>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(leaveSemantic(r.status), isDarkMode)}`}>
                      {hrOptionLabel(LEAVE_STATUS_OPTIONS, r.status)}
                    </span>
                  </div>
                  <div className={`${t.tdCls} flex items-center gap-1.5`}>
                    {r.status === 'Pending' && (
                      <>
                        <button disabled={busy} onClick={() => decide(r.id, 'Approved')} className={t.subtleButtonCls}>批准</button>
                        <button disabled={busy} onClick={() => decide(r.id, 'Rejected')} className={t.dangerButtonCls}>拒绝</button>
                      </>
                    )}
                    {(r.status === 'Pending' || r.status === 'Approved') && (
                      <button disabled={busy} onClick={() => cancelLeave(r.id)} className={t.subtleButtonCls}>取消</button>
                    )}
                    {r.status === 'Rejected' && r.rejectReason && (
                      <span className={`truncate text-[10px] ${t.textSecondaryClass}`} title={r.rejectReason}>原因：{r.rejectReason}</span>
                    )}
                  </div>
                </div>
              ))}
              {!leaveLoading && leaveRequests.length === 0 && (
                <div className={`py-12 text-center ${t.sectionMutedClass}`}>
                  {leaveStatusFilter === 'Pending' ? '暂无待审批请假单' : '暂无请假记录'}
                </div>
              )}
              {leaveLoading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AttendanceLeaveTab;
