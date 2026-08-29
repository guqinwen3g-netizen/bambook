/**
 * DR-042 v2.1 小组管理 tab（唯一管理真源，2026-08-19 从 AdminPanel 归位迁入人事管理）。
 *
 * 权责划分（§8.5）：AdminPanel = 软件层治理（账号/角色/工具权限/平台规则）；
 * HRManager = 组织人事治理（部门/小组/项目/任务）。小组属组织人事概念，归此处。
 * 后端 /api/hr/teams* 零改动（本就挂 hr 域），纯前端归位。
 *
 * 功能：组列表 + 新建 + 编辑（v2.1 补齐：改名/换组长/换关联部门）+
 *       组详情（成员管理 + 数据共享授权 + 解散）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react';
import { hrTokens, hrErrorMessage, type HrPersonnelOption } from './hrTokens';
import { apiService } from '../../services/apiService';
import { hasPermission } from '../../services/authService';
import { bdsToast } from '../ui/bdsToast';
import { bdsConfirm, bdsPrompt } from '../ui/BdsDialog';
import { buildDepartmentOptions } from '../../lib/departmentTree';

interface DeptOption { id: string; name: string; parentId?: string | null }

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  leaderId: string | null;
  departmentId: string | null;
  department: string | null;
  status: string;
  memberCount: number;
  members?: Array<{ id?: string; userId: string; role?: string; leftAt?: string | null }>;
}

interface GrantRow {
  id: string;
  entityType: string;
  entityId: string;
  permission: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
}

interface TeamOverview {
  team: { id: string; name: string; description: string | null; leaderId: string | null };
  activeGrants: number;
  relations: Array<{ id: string; name: string; stage: string | null; tier: string | null }>;
  orders: Array<{ id: string; poNumber: string | null; status: string; quoteAmount: any; currency: string | null }>;
  orderStats: { total: number; totalAmount: number; byStatus: Record<string, { count: number; amount: number }> };
}

interface TeamManagementTabProps {
  isDarkMode: boolean;
  personnel: HrPersonnelOption[];
  departments: DeptOption[];
}

const emptyTeamForm = { name: '', description: '', leaderId: '', departmentId: '' };

const TeamManagementTab: React.FC<TeamManagementTabProps> = ({ isDarkMode, personnel, departments }) => {
  const t = hrTokens(isDarkMode);

  // R678-③ 写操作按 hr:write 门控显隐（与后端写门同口径），无权限时只读
  const canWrite = hasPermission('hr:write');

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamForm, setTeamForm] = useState(emptyTeamForm);

  const [detailTeamId, setDetailTeamId] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [memberUserId, setMemberUserId] = useState('');
  const [grantRelationId, setGrantRelationId] = useState('');
  const [grantPermission, setGrantPermission] = useState<'read' | 'read+followup'>('read+followup');
  // 共享选择器数据源：当前用户 scope 内可见的客户档案（授权资格由服务端双重门禁把关）
  const [relationOptions, setRelationOptions] = useState<Array<{ id: string; name: string; code: string | null; stage: string | null }>>([]);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await apiService.hrGet<{ teams?: TeamRow[] }>('teams');
      setTeams(d.teams || []);
    } catch (e: any) {
      setError(hrErrorMessage(e, '加载小组列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const loadGrants = useCallback(async (teamId: string) => {
    setGrantsLoading(true);
    try {
      const d = await apiService.hrGet<{ grants?: GrantRow[] }>(`teams/${teamId}/grants`);
      setGrants(d.grants || []);
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '授权列表加载失败'));
    } finally {
      setGrantsLoading(false);
    }
  }, []);

  // v2.1 §8.6 视角聚焦（组经营切片）：组生效授权 → 关联客户/订单/统计
  const loadOverview = useCallback(async (teamId: string) => {
    try {
      const d = await apiService.hrGet<{ overview?: TeamOverview }>(`teams/${teamId}/overview`);
      setOverview(d.overview || null);
    } catch (e: any) {
      // R678-⑥ 概况加载失败不再静默——错误条提示，组管理主流程不阻断
      setOverview(null);
      bdsToast.danger(hrErrorMessage(e, '组经营概况加载失败'));
    }
  }, []);

  // 共享选择器的客户列表（当前用户 scope 内；共享动作本身的资格由服务端双重门禁把关）
  const loadRelationOptions = useCallback(async () => {
    try {
      const rows = await apiService.listRelationsV2();
      setRelationOptions(rows);
    } catch {
      setRelationOptions([]); // 列表加载失败不阻断组管理主流程
    }
  }, []);

  const detailTeam = teams.find(x => x.id === detailTeamId) || null;

  const openCreate = () => {
    setEditingTeamId(null);
    setTeamForm(emptyTeamForm);
    setShowForm(true);
  };

  const openEdit = (team: TeamRow) => {
    setEditingTeamId(team.id);
    setTeamForm({
      name: team.name,
      description: team.description || '',
      leaderId: team.leaderId || '',
      departmentId: team.departmentId || '',
    });
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!teamForm.name.trim() || busyId) return;
    setBusyId('team-form');
    setError('');
    try {
      const payload = {
        name: teamForm.name.trim(),
        description: teamForm.description.trim() || null,
        leaderId: teamForm.leaderId || null,
        departmentId: teamForm.departmentId || null,
      };
      if (editingTeamId) {
        await apiService.hrSend(`teams/${editingTeamId}`, payload, 'PATCH');
        bdsToast.success('小组已更新');
      } else {
        await apiService.hrSend('teams', payload);
        bdsToast.success('小组已创建');
      }
      setShowForm(false);
      setEditingTeamId(null);
      setTeamForm(emptyTeamForm);
      await loadTeams();
    } catch (e: any) {
      setError(hrErrorMessage(e, editingTeamId ? '更新小组失败' : '创建小组失败'));
    } finally {
      setBusyId(null);
    }
  };

  const dissolveTeam = async (team: TeamRow) => {
    if (!(await bdsConfirm({
      title: '确认解散',
      body: `确认解散「${team.name}」？全部共享授权将立即失效，组员将失去共享数据可见性（DR-042 §9.2）。`,
      danger: true,
    }))) return;
    setBusyId(`dissolve-${team.id}`);
    try {
      await apiService.hrSend(`teams/${team.id}/dissolve`, {});
      bdsToast.success('小组已解散，全部授权已回收');
      setDetailTeamId(null);
      setGrants([]);
      await loadTeams();
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '解散失败'));
    } finally {
      setBusyId(null);
    }
  };

  const addMember = async (team: TeamRow) => {
    if (!memberUserId || busyId) return;
    setBusyId('add-member');
    try {
      await apiService.hrSend(`teams/${team.id}/members`, { userId: memberUserId });
      setMemberUserId('');
      bdsToast.success('成员已加入');
      await loadTeams();
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '添加成员失败'));
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (team: TeamRow, userId: string) => {
    if (busyId) return;
    const memberName = personnel.find(u => u.id === userId)?.displayName || userId;
    if (!(await bdsConfirm({
      title: '移除成员',
      body: `确认将「${memberName}」移出「${team.name}」？移出后其将失去该组共享数据的可见性。`,
      confirmText: '移出',
    }))) return;
    setBusyId(`rm-member-${userId}`);
    try {
      await apiService.hrSend(`teams/${team.id}/members/${userId}`, {}, 'DELETE');
      bdsToast.success('成员已移出');
      await loadTeams();
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '移除成员失败'));
    } finally {
      setBusyId(null);
    }
  };

  const grantShare = async (team: TeamRow) => {
    const relId = grantRelationId.trim();
    if (!relId || busyId) return;
    setBusyId('add-grant');
    try {
      await apiService.shareRelationToTeams(relId, [team.id], grantPermission);
      setGrantRelationId('');
      bdsToast.success('已共享客户档案到小组');
      await Promise.all([loadGrants(team.id), loadOverview(team.id)]);
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '共享失败（仅对客户档案有写权限者可共享，DR-042 §6.1）'));
    } finally {
      setBusyId(null);
    }
  };

  const revokeShare = async (team: TeamRow, grant: GrantRow) => {
    const reason = await bdsPrompt({ title: '撤销共享授权', placeholder: '撤销原因（审计留痕必填）', confirmText: '撤销授权', danger: true });
    if (!reason?.trim()) return;
    setBusyId(`revoke-${grant.id}`);
    try {
      await apiService.unshareRelationFromTeam(grant.entityId, team.id, reason.trim());
      bdsToast.success('授权已撤销');
      await Promise.all([loadGrants(team.id), loadOverview(team.id)]);
    } catch (e: any) {
      bdsToast.danger(hrErrorMessage(e, '撤销失败'));
    } finally {
      setBusyId(null);
    }
  };

  const deptOptions = buildDepartmentOptions(departments);
  const activeGrants = grants.filter(g => !g.revokedAt);

  // ── 组详情视图 ──
  if (detailTeam) {
    const members = (detailTeam.members || []).filter(m => !m.leftAt);
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={t.sectionTitleClass}>{detailTeam.name}</p>
            <p className={`mt-1 text-[11px] font-light ${t.textSecondaryClass} truncate`}>
              {detailTeam.description || '无描述'} · 组长 {personnel.find(u => u.id === detailTeam.leaderId)?.displayName || '空缺（组照常运作，T-06）'}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setDetailTeamId(null); setGrants([]); setOverview(null); }} className={t.actionButtonCls}>
              <X size={14} strokeWidth={1.5} />返回列表
            </button>
            {canWrite && (
              <>
                <button type="button" onClick={() => openEdit(detailTeam)} className={t.actionButtonCls}>
                  <Pencil size={14} />编辑
                </button>
                <button type="button" onClick={() => dissolveTeam(detailTeam)} disabled={busyId === `dissolve-${detailTeam.id}`}
                  className={`${t.dangerButtonCls} disabled:opacity-50`}>
                  <Trash2 size={14} />解散
                </button>
              </>
            )}
          </div>
        </div>

        {/* 经营切片（v2.1 §8.6 视角聚焦：组关联客户/订单/统计） */}
        {overview && (
          <div className={t.cardClass + ' p-5 space-y-3'}>
            <div className="flex items-center justify-between">
              <h4 className={t.sectionTitleClass}>组经营概况</h4>
              <button type="button" onClick={() => loadOverview(detailTeam.id)} className={t.subtleButtonCls}>
                <RefreshCw size={14} />刷新
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-compact px-3 py-2 border border-[var(--border-c-default)]">
                <div className={t.labelCls}>关联客户</div>
                <div className={`text-lg font-light ${t.textPrimaryClass}`}>{overview.relations.length}</div>
              </div>
              <div className="rounded-compact px-3 py-2 border border-[var(--border-c-default)]">
                <div className={t.labelCls}>关联订单（近50）</div>
                <div className={`text-lg font-light ${t.textPrimaryClass}`}>{overview.orderStats.total}</div>
              </div>
              <div className="rounded-compact px-3 py-2 border border-[var(--border-c-default)]">
                <div className={t.labelCls}>订单金额合计</div>
                <div className={`text-lg font-light ${t.textPrimaryClass}`}>{overview.orderStats.totalAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="rounded-compact px-3 py-2 border border-[var(--border-c-default)]">
                <div className={t.labelCls}>生效授权</div>
                <div className={`text-lg font-light ${t.textPrimaryClass}`}>{overview.activeGrants}</div>
              </div>
            </div>
            {Object.keys(overview.orderStats.byStatus).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(overview.orderStats.byStatus).map(([status, v]) => (
                  <span key={status} className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">
                    {status} · {v.count} 单 / {v.amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                  </span>
                ))}
              </div>
            )}
            {overview.relations.length > 0 && (
              <div className="space-y-1">
                <div className={t.labelCls}>关联客户（{overview.relations.length}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {overview.relations.map(r => (
                    <span key={r.id} className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]">
                      {r.name}{r.stage ? ` · ${r.stage}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 成员管理 */}
        <div className={t.cardClass + ' p-5 space-y-3'}>
          <div className="flex items-center justify-between">
            <h4 className={t.sectionTitleClass}>成员（{members.length}）</h4>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">跨部门协作单元 · 一人可进多组</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map(m => (
              <span key={m.id || m.userId} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--accent-text)]">
                {personnel.find(u => u.id === m.userId)?.displayName || m.userId}{m.role === 'leader' && ' · 组长'}
                {canWrite && (
                  <button type="button" onClick={() => removeMember(detailTeam, m.userId)} disabled={busyId === `rm-member-${m.userId}`}
                    className="opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30" title="移除出组">
                    <X size={14} />
                  </button>
                )}
              </span>
            ))}
            {members.length === 0 && <span className={`text-[11px] font-light ${t.textSecondaryClass}`}>暂无成员（B-04：空组授权无害空转）</span>}
          </div>
          {canWrite && (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className={t.labelCls}>添加成员</label>
                <select className={t.selectCls + ' mt-1'} value={memberUserId} onChange={e => setMemberUserId(e.target.value)}>
                  <option value="">选择用户</option>
                  {personnel.filter(u => !members.some(m => m.userId === u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.displayName}</option>
                  ))}
                </select>
              </div>
              <button type="button" disabled={!memberUserId || busyId === 'add-member'} onClick={() => addMember(detailTeam)}
                className={t.primaryButtonCls + ' disabled:opacity-50'}>
                <UserPlus size={14} />加入
              </button>
            </div>
          )}
        </div>

        {/* 授权管理 */}
        <div className={t.cardClass + ' p-5 space-y-3'}>
          <div className="flex items-center justify-between">
            <h4 className={t.sectionTitleClass}>数据共享授权（生效 {activeGrants.length}）</h4>
            <button type="button" onClick={() => loadGrants(detailTeam.id)} disabled={grantsLoading}
              className={t.subtleButtonCls + ' disabled:opacity-50'}>
              <RefreshCw size={14} />刷新
            </button>
          </div>
          {canWrite && (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className={t.labelCls}>选择客户（我可见范围内）</label>
                <select className={t.selectCls + ' mt-1'} value={grantRelationId} onChange={e => setGrantRelationId(e.target.value)}>
                  <option value="">{relationOptions.length === 0 ? '暂无可共享的客户' : '选择要共享的客户档案'}</option>
                  {relationOptions
                    .filter(r => !activeGrants.some(g => g.entityId === r.id))
                    .map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.code ? `（${r.code}）` : ''}{r.stage ? ` · ${r.stage}` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className={t.labelCls}>档位</label>
                <select className={t.selectCls + ' mt-1'} value={grantPermission} onChange={e => setGrantPermission(e.target.value as 'read' | 'read+followup')}>
                  <option value="read+followup">可查看 + 可跟进</option>
                  <option value="read">仅查看</option>
                </select>
              </div>
              <button type="button" disabled={!grantRelationId.trim() || busyId === 'add-grant'} onClick={() => grantShare(detailTeam)}
                className={t.primaryButtonCls + ' disabled:opacity-50'}>
                <Check size={14} />共享
              </button>
            </div>
          )}
          <div className="space-y-1.5">
            {grants.length === 0 && <span className={`text-[11px] font-light ${t.textSecondaryClass}`}>暂无授权记录</span>}
            {grants.map(g => (
              <div key={g.id} className="rounded-compact px-3 py-2 flex items-center justify-between gap-3 border border-[var(--border-c-default)]">
                <div className="min-w-0 flex items-center gap-2 text-[11px] font-light">
                  <span className={`font-mono ${t.textSecondaryClass} truncate`}>{g.entityType}:{g.entityId}</span>
                  <span className={g.permission === 'read+followup'
                    ? 'rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--accent-text)]'
                    : 'rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]'}>
                    {g.permission === 'read+followup' ? '可跟进' : '只读'}
                  </span>
                  {g.revokedAt
                    ? <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]">已撤销</span>
                    : <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">生效中</span>}
                </div>
                {canWrite && !g.revokedAt && (
                  <button type="button" onClick={() => revokeShare(detailTeam, g)} disabled={busyId === `revoke-${g.id}`}
                    className={t.dangerButtonCls + ' disabled:opacity-50'}>
                    <X size={14} />撤销
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 组列表 + 建组/编辑表单 ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className={t.sectionTitleClass}>{teams.length} 个小组 · 跨部门业务协作单元</span>
        {canWrite && (
          <button type="button" onClick={() => (showForm && !editingTeamId ? setShowForm(false) : openCreate())} className={t.actionButtonCls}>
            {showForm && !editingTeamId ? <X size={14} strokeWidth={1.5} /> : <Plus size={14} strokeWidth={1.5} />}
            {showForm && !editingTeamId ? '取消' : '新建小组'}
          </button>
        )}
      </div>

      {error && <div className="text-[11px] font-light text-[var(--danger-text)]">{error}</div>}

      {showForm && canWrite && (
        <div className={t.cardClass + ' p-5 space-y-4'}>
          <div>
            <h3 className={t.sectionTitleClass}>{editingTeamId ? '编辑小组' : '新建小组'}</h3>
            <p className={`mt-1 text-[11px] font-light ${t.textSecondaryClass}`}>
              按品牌客户 / 市场 / 业务类型组建（DR-042 §2）；组建后可在组详情共享客户档案给组内协作。
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={t.labelCls}>组名</label>
              <input value={teamForm.name} onChange={e => setTeamForm({ ...teamForm, name: e.target.value })}
                className={t.inputCls + ' mt-1'} placeholder="如：波兰成衣组" />
            </div>
            <div>
              <label className={t.labelCls}>组长（可空缺）</label>
              <select className={t.selectCls + ' mt-1'} value={teamForm.leaderId} onChange={e => setTeamForm({ ...teamForm, leaderId: e.target.value })}>
                <option value="">空缺（组照常运作，T-06）</option>
                {personnel.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
            <div>
              <label className={t.labelCls}>关联部门（可选）</label>
              <select className={t.selectCls + ' mt-1'} value={teamForm.departmentId} onChange={e => setTeamForm({ ...teamForm, departmentId: e.target.value })}>
                <option value="">跨部门（不关联）</option>
                {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className={t.labelCls}>描述</label>
              <input value={teamForm.description} onChange={e => setTeamForm({ ...teamForm, description: e.target.value })}
                className={t.inputCls + ' mt-1'} placeholder="小组的业务定位（可选）" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!teamForm.name.trim() || busyId === 'team-form'} onClick={submitForm}
              className={t.primaryButtonCls + ' disabled:opacity-50'}>
              <Check size={14} />{busyId === 'team-form' ? '保存中…' : (editingTeamId ? '保存修改' : '创建小组')}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingTeamId(null); setTeamForm(emptyTeamForm); }}
              className={t.actionButtonCls}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading && teams.length === 0 && (
          <div className={t.cardClass + ' p-8 text-center'}>
            <p className={`text-xs font-light ${t.textSecondaryClass}`}>加载中…</p>
          </div>
        )}
        {!loading && teams.length === 0 && (
          <div className={t.cardClass + ' p-8 text-center'}>
            <p className={`text-xs font-light ${t.textSecondaryClass}`}>暂无小组。小组是跨部门业务协作单元——组建后可将客户档案受控共享给组内成员。</p>
          </div>
        )}
        {teams.map(team => (
          <div key={team.id} className={t.cardClass + ' p-4 flex items-center justify-between gap-4'}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-light ${t.textPrimaryClass}`}>{team.name}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">{team.memberCount} 成员</span>
                {team.department && <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-tertiary)]">{team.department}</span>}
                {!team.leaderId && <span className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]">组长空缺</span>}
              </div>
              <p className={`mt-1 text-[11px] font-light ${t.textSecondaryClass} truncate`}>{team.description || '无描述'}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {canWrite && (
                <button type="button" onClick={() => openEdit(team)} className={t.actionButtonCls}>
                  <Pencil size={14} />编辑
                </button>
              )}
              <button type="button" onClick={() => { setDetailTeamId(team.id); setGrants([]); setOverview(null); loadGrants(team.id); loadOverview(team.id); loadRelationOptions(); }} className={t.actionButtonCls}>
                <Users size={14} strokeWidth={1.5} />管理
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TeamManagementTab;
