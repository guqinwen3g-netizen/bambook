/**
 * C3a 员工档案 tab — 档案列表 + 档案编辑 + 生命周期异动
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, UserCircle2, X } from 'lucide-react';
import {
  hrTokens, hrFormatDate, hrOptionLabel,
  type HrPersonnelOption,
} from './hrTokens';
import {
  hrService,
  EMPLOYMENT_STATUS_OPTIONS, EMPLOYMENT_EVENT_OPTIONS, CONTRACT_TYPE_OPTIONS,
  type EmployeeProfile, type EmploymentEvent, type EmploymentEventType,
} from '../../services/hrService';
import { statusSemanticClass, type StatusSemantic } from '../rdlBusinessStatusTokens';

interface DeptOption { id: string; name: string; }
interface PositionOption { id: string; title: string; }

interface EmployeeProfilesTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
  departments: DeptOption[];
  positions: PositionOption[];
}

const emptyProfileForm = {
  userId: '', positionId: '', hireDate: '', regularDate: '', contractType: '', contractEnd: '',
  phone: '', emergencyContact: '', workLocation: '', notes: '',
};

const emptyEventForm = {
  type: 'Regularize' as EmploymentEventType, effectiveDate: '', reason: '',
  toDeptId: '', toPositionId: '',
};

const statusSemantic = (status: string): StatusSemantic => {
  switch (status) {
    case 'Regular': return 'active';
    case 'Probation': return 'info';
    case 'Suspended': return 'warning';
    case 'Resigned':
    case 'Terminated': return 'neutral';
    default: return 'neutral';
  }
};

const eventSemantic = (type: string): StatusSemantic => {
  switch (type) {
    case 'Onboard':
    case 'Regularize':
    case 'Promote':
    case 'Resume': return 'active';
    case 'Transfer': return 'info';
    case 'Suspend': return 'warning';
    case 'Resign':
    case 'Terminate': return 'danger';
    default: return 'neutral';
  }
};

const EmployeeProfilesTab: React.FC<EmployeeProfilesTabProps> = ({ isDarkMode, personnel, departments, positions }) => {
  const t = hrTokens(isDarkMode);

  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);

  const [events, setEvents] = useState<EmploymentEvent[]>([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await hrService.listEmployees({
        status: statusFilter || undefined,
        q: searchTerm.trim() || undefined,
      });
      setEmployees(rows);
      if (selectedUserId && !rows.some(r => r.userId === selectedUserId)) {
        setSelectedUserId(null);
        setShowProfileForm(false);
      }
    } catch (e: any) {
      setError(e?.message || '加载员工档案失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm, selectedUserId]);

  useEffect(() => { load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEvents = useCallback(async (userId: string) => {
    try {
      const rows = await hrService.listEmploymentEvents({ userId });
      setEvents(rows);
    } catch {
      setEvents([]);
    }
  }, []);

  const selected = useMemo(
    () => employees.find(e => e.userId === selectedUserId) || null,
    [employees, selectedUserId],
  );

  // 未建档人员（可新建档案）
  const unprofiled = useMemo(() => {
    const profiled = new Set(employees.map(e => e.userId));
    return personnel.filter(p => !profiled.has(p.id));
  }, [employees, personnel]);

  const openProfile = (p: EmployeeProfile) => {
    setSelectedUserId(p.userId);
    setProfileForm({
      userId: p.userId,
      positionId: p.positionId || '',
      hireDate: p.hireDate || '',
      regularDate: p.regularDate || '',
      contractType: p.contractType || '',
      contractEnd: p.contractEnd || '',
      phone: p.phone || '',
      emergencyContact: p.emergencyContact || '',
      workLocation: p.workLocation || '',
      notes: p.notes || '',
    });
    setShowProfileForm(true);
    setShowEventForm(false);
    loadEvents(p.userId);
  };

  const openNewProfile = () => {
    setSelectedUserId(null);
    setProfileForm({ ...emptyProfileForm, hireDate: new Date().toISOString().slice(0, 10) });
    setShowProfileForm(true);
    setShowEventForm(false);
    setEvents([]);
  };

  const submitProfile = async () => {
    if (!profileForm.userId) { setError('请选择员工'); return; }
    if (!profileForm.hireDate) { setError('入职日期必填'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.upsertEmployee({
        userId: profileForm.userId,
        positionId: profileForm.positionId || null,
        hireDate: profileForm.hireDate,
        regularDate: profileForm.regularDate || null,
        contractType: profileForm.contractType || null,
        contractEnd: profileForm.contractEnd || null,
        phone: profileForm.phone || null,
        emergencyContact: profileForm.emergencyContact || null,
        workLocation: profileForm.workLocation || null,
        notes: profileForm.notes || null,
      });
      await load();
      setSelectedUserId(profileForm.userId);
      loadEvents(profileForm.userId);
    } catch (e: any) {
      setError(e?.message || '保存档案失败');
    } finally {
      setBusy(false);
    }
  };

  const submitEvent = async () => {
    if (!selectedUserId) return;
    if (!eventForm.effectiveDate) { setError('生效日期必填'); return; }
    setBusy(true);
    setError('');
    try {
      await hrService.recordEmploymentEvent({
        userId: selectedUserId,
        type: eventForm.type,
        effectiveDate: eventForm.effectiveDate,
        reason: eventForm.reason || null,
        ...(eventForm.type === 'Transfer' || eventForm.type === 'Promote'
          ? { toDeptId: eventForm.toDeptId || null, toPositionId: eventForm.toPositionId || null }
          : {}),
      });
      setEventForm(emptyEventForm);
      setShowEventForm(false);
      await load();
      loadEvents(selectedUserId);
    } catch (e: any) {
      setError(e?.message || '登记异动失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-1">
        <input
          className={`${t.inputCls} max-w-56`}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="搜索姓名 / 工号 / 邮箱"
        />
        <select className={`${t.inputCls} max-w-36`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          {EMPLOYMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={load} className={t.actionButtonCls}>查询</button>
        <span className={t.sectionMutedClass}>共 {employees.length} 人</span>
        <div className="ml-auto">
          <button onClick={openNewProfile} className={t.primaryButtonCls} disabled={unprofiled.length === 0}>
            <Plus className="w-3.5 h-3.5" /> 新建档案
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

      <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
        {/* 左：档案列表 */}
        <div className={`${t.cardClass} flex min-h-0 flex-col overflow-hidden`}>
          <div className="grid grid-cols-[88px_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_88px] border-b border-white/[0.06]">
            <div className={t.thCls}>工号</div>
            <div className={t.thCls}>姓名</div>
            <div className={t.thCls}>部门 / 职位</div>
            <div className={t.thCls}>入职日期</div>
            <div className={t.thCls}>状态</div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {employees.map(p => (
              <button key={p.userId} onClick={() => openProfile(p)}
                className={`grid w-full grid-cols-[88px_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_88px] items-center ${t.rowCls(selectedUserId === p.userId)}`}>
                <div className={`${t.tdCls} font-mono text-[11px]`}>{p.employeeNo}</div>
                <div className={`${t.tdCls} truncate`}>{p.displayName || '-'}</div>
                <div className={`${t.tdCls} truncate ${t.textSecondaryClass}`}>
                  {[p.department, p.position].filter(Boolean).join(' / ') || '-'}
                </div>
                <div className={t.tdCls}>{hrFormatDate(p.hireDate)}</div>
                <div className={t.tdCls}>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(statusSemantic(p.employmentStatus), isDarkMode)}`}>
                    {hrOptionLabel(EMPLOYMENT_STATUS_OPTIONS, p.employmentStatus)}
                  </span>
                </div>
              </button>
            ))}
            {!loading && employees.length === 0 && (
              <div className={`py-12 text-center ${t.sectionMutedClass}`}>
                <UserCircle2 className="w-7 h-7 mx-auto mb-2 opacity-30" />
                {searchTerm || statusFilter ? '无匹配员工' : '暂无员工档案，点击右上角「新建档案」'}
              </div>
            )}
            {loading && <div className={`py-12 text-center ${t.sectionMutedClass}`}>加载中…</div>}
          </div>
        </div>

        {/* 右：档案编辑 + 异动 */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
          {showProfileForm ? (
            <div className={`${t.cardClass} p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <div className={t.sectionTitleClass}>{selected ? `档案 · ${selected.displayName || selected.employeeNo}` : '新建档案'}</div>
                {selected && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(statusSemantic(selected.employmentStatus), isDarkMode)}`}>
                    {hrOptionLabel(EMPLOYMENT_STATUS_OPTIONS, selected.employmentStatus)}
                  </span>
                )}
              </div>

              {!selected && (
                <div>
                  <div className={t.labelCls + ' mb-1'}>选择员工（未建档）</div>
                  <select className={t.inputCls} value={profileForm.userId}
                    onChange={e => setProfileForm(f => ({ ...f, userId: e.target.value }))}>
                    <option value="">请选择</option>
                    {unprofiled.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={t.labelCls + ' mb-1'}>职位</div>
                  <select className={t.inputCls} value={profileForm.positionId}
                    onChange={e => setProfileForm(f => ({ ...f, positionId: e.target.value }))}>
                    <option value="">未指定</option>
                    {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>合同类型</div>
                  <select className={t.inputCls} value={profileForm.contractType}
                    onChange={e => setProfileForm(f => ({ ...f, contractType: e.target.value }))}>
                    <option value="">未指定</option>
                    {CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>入职日期 *</div>
                  <input type="date" className={t.inputCls} value={profileForm.hireDate}
                    onChange={e => setProfileForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>转正日期</div>
                  <input type="date" className={t.inputCls} value={profileForm.regularDate}
                    onChange={e => setProfileForm(f => ({ ...f, regularDate: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>合同到期日</div>
                  <input type="date" className={t.inputCls} value={profileForm.contractEnd}
                    onChange={e => setProfileForm(f => ({ ...f, contractEnd: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>联系电话</div>
                  <input className={t.inputCls} value={profileForm.phone}
                    onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>紧急联系人</div>
                  <input className={t.inputCls} value={profileForm.emergencyContact}
                    onChange={e => setProfileForm(f => ({ ...f, emergencyContact: e.target.value }))} />
                </div>
                <div>
                  <div className={t.labelCls + ' mb-1'}>工作地点</div>
                  <input className={t.inputCls} value={profileForm.workLocation}
                    onChange={e => setProfileForm(f => ({ ...f, workLocation: e.target.value }))} />
                </div>
              </div>
              <div>
                <div className={t.labelCls + ' mb-1'}>备注</div>
                <input className={t.inputCls} value={profileForm.notes}
                  onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {selected && (
                <div className={t.sectionMutedClass}>
                  在职状态变更须通过下方「登记异动」完成（转正 / 调岗 / 晋升 / 停复职 / 离职）。
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={submitProfile} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                  <Check className="w-3.5 h-3.5" /> {busy ? '提交中…' : '保存档案'}
                </button>
              </div>
            </div>
          ) : (
            <div className={`${t.cardClass} p-8 text-center ${t.sectionMutedClass}`}>
              从左侧选择员工查看 / 编辑档案
            </div>
          )}

          {/* 异动记录 */}
          {selected && (
            <div className={`${t.cardClass} p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <div className={t.sectionTitleClass}>异动记录</div>
                <button onClick={() => setShowEventForm(v => !v)} className={t.subtleButtonCls}>
                  <Plus className="w-3 h-3" /> 登记异动
                </button>
              </div>

              {showEventForm && (
                <div className="space-y-3 rounded-compact border border-white/[0.06] p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className={t.labelCls + ' mb-1'}>异动类型</div>
                      <select className={t.inputCls} value={eventForm.type}
                        onChange={e => setEventForm(f => ({ ...f, type: e.target.value as EmploymentEventType }))}>
                        {EMPLOYMENT_EVENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className={t.labelCls + ' mb-1'}>生效日期 *</div>
                      <input type="date" className={t.inputCls} value={eventForm.effectiveDate}
                        onChange={e => setEventForm(f => ({ ...f, effectiveDate: e.target.value }))} />
                    </div>
                  </div>
                  {(eventForm.type === 'Transfer' || eventForm.type === 'Promote') && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className={t.labelCls + ' mb-1'}>调入部门</div>
                        <select className={t.inputCls} value={eventForm.toDeptId}
                          onChange={e => setEventForm(f => ({ ...f, toDeptId: e.target.value }))}>
                          <option value="">不变更</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className={t.labelCls + ' mb-1'}>新任职位</div>
                        <select className={t.inputCls} value={eventForm.toPositionId}
                          onChange={e => setEventForm(f => ({ ...f, toPositionId: e.target.value }))}>
                          <option value="">不变更</option>
                          {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  <div>
                    <div className={t.labelCls + ' mb-1'}>原因 / 备注</div>
                    <input className={t.inputCls} value={eventForm.reason}
                      onChange={e => setEventForm(f => ({ ...f, reason: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowEventForm(false)} className={t.actionButtonCls}>取消</button>
                    <button onClick={submitEvent} disabled={busy} className={`${t.primaryButtonCls} disabled:opacity-40 disabled:pointer-events-none`}>
                      <Check className="w-3.5 h-3.5" /> 提交
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                {events.map(ev => (
                  <div key={ev.id} className="flex items-center gap-3 rounded-compact border border-white/[0.05] px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-light ${statusSemanticClass(eventSemantic(ev.type), isDarkMode)}`}>
                      {hrOptionLabel(EMPLOYMENT_EVENT_OPTIONS, ev.type)}
                    </span>
                    <span className={`text-xs font-light ${t.textPrimaryClass}`}>{hrFormatDate(ev.effectiveDate)}</span>
                    <span className={`flex-1 truncate text-[11px] font-light ${t.textSecondaryClass}`}>{ev.reason || ''}</span>
                  </div>
                ))}
                {events.length === 0 && <div className={t.sectionMutedClass}>暂无异动记录</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeProfilesTab;
