/**
 * C1 CRM 深化 — Relation 详情的结构化 CRM 区块（组织布局）
 *
 * 五个自包含区块，挂载于 DetailPanel 组织布局：
 *   1. CrmContactsSection      联系人名片管理（结构化 Contact，替代 backupContacts blob）
 *   2. CrmFollowUpsSection     跟进记录管理（新建/删除 + 下次跟进逾期标记）
 *   3. CrmOpportunitiesSection 商机管线（阶段徽章 + 推进/成交/流失流转）
 *   4. CrmCreditLimitSection   信用额度（生效额度/已用/剩余 + 设置 + 状态）
 *   5. CrmCustomerTierSection  客户分层（级别 + 权益 + 评定）
 *
 * 设计纪律：全部走 BAMBOOK_OS / statusSemanticClass token，零硬编码圆角/hex/shadow，
 * 零语义彩色类名（与 DetailPanel 同受 RDL low-residue 约束）。状态变更后服务端事件
 * （OpportunityStageChanged 等）经 eventBindings 走通知，前端不重复提示。
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, CreditCard, Layers, TrendingUp, Calendar,
  Plus, Trash2, Loader2, Star, Phone, Mail,
} from 'lucide-react';
import { BAMBOOK_OS } from '../bambookOsTokens';
import CapsuleDateInput from '../CapsuleDateInput';
import { CompiledSurfacePanel } from '../primitives/compiledSurfacePrimitives';
import { statusSemanticClass, StatusSemantic } from '../../rdlBusinessStatusTokens';
import { apiService } from '../../../services/apiService';
import {
  Contact, CreditLimit, CustomerTier, CustomerTierLevel, FollowUpRecord, Opportunity, OpportunityStage,
} from '../../../types';

// ────────────────────────────────────────────────────────────────
// 共享：区块外壳（与 DetailPanel InfoSection 同构 inset 面板）
// ────────────────────────────────────────────────────────────────

const CrmSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  isDarkMode: boolean;
  children: React.ReactNode;
}> = ({ title, icon, isDarkMode, children }) => {
  const sectionDividerClass = BAMBOOK_OS.tone.divider.section;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative">
      <CompiledSurfacePanel
        as="section"
        isDarkMode={isDarkMode}
        materialRole="insetSurface"
        materialTone="nested"
        className="p-3.5 !rounded-inset"
        contentClassName="relative z-10"
        compilerRole="relation-detail-crm-section"
        source="DetailPanel.CrmSection"
      >
        <div className={`flex items-center gap-2 mb-2.5 pb-2 border-b ${sectionDividerClass}`}>
          <span className="text-[var(--text-secondary)]">{icon}</span>
          <h4 className={`text-[11px] font-light uppercase tracking-[0.18em] text-[var(--text-primary)]`}>
            {title}
          </h4>
        </div>
        <div className="space-y-0.5">{children}</div>
      </CompiledSurfacePanel>
    </motion.div>
  );
};

// ────────────────────────────────────────────────────────────────
// 共享：样式 token（参照 DetailPanel P3b 范式）
// ────────────────────────────────────────────────────────────────

const inputCls = (isDarkMode: boolean) =>
  `bds-input sm`;

const addBtnCls = (isDarkMode: boolean) =>
  `shrink-0 h-6 w-6 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 bg-[var(--recessed-bg)] hover:bg-[var(--active-darken)] text-[var(--text-secondary)]`;

const rowDeleteCls = (isDarkMode: boolean) =>
  `ml-auto self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`;

const mutedTextCls = (isDarkMode: boolean) => `text-xs text-[var(--text-tertiary)]`;
const rowTextCls = (isDarkMode: boolean) => `text-xs leading-5 text-[var(--text-secondary)]`;

const chip = (semantic: StatusSemantic, isDarkMode: boolean) =>
  `inline-block px-1.5 py-0.5 rounded-bds-sm text-[10px] shrink-0 border ${statusSemanticClass(semantic, isDarkMode)}`;

const fmtMoney = (n: number, currency = 'CNY') => `${currency} ${Number(n || 0).toLocaleString()}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
/** 下次跟进日是否已逾期（YYYY-MM-DD 字符串比较，与本地零点口径一致） */
const isOverdue = (nextFollowUpAt?: string | null) => !!nextFollowUpAt && nextFollowUpAt < todayStr();

const FOLLOW_UP_TYPES = ['Visit', 'Call', 'Email', 'WeChat', 'Meeting', 'Other'] as const;
const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  Visit: '拜访', Call: '电话', Email: '邮件', WeChat: '微信', Meeting: '会议', Other: '其他',
};

// ════════════════════════════════════════════════════════════════
// 1. 联系人名片管理（结构化 Contact）
// ════════════════════════════════════════════════════════════════

export const CrmContactsSection: React.FC<{ relationId: string; isDarkMode: boolean }> = ({ relationId, isDarkMode }) => {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [form, setForm] = useState({ name: '', title: '', mobile: '', email: '', isPrimary: false, isDecisionMaker: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContacts(null);
    apiService.listContacts(relationId)
      .then(items => { if (!cancelled) setContacts(items); })
      .catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [relationId]);

  const handleAdd = async () => {
    const name = form.name.trim();
    if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      const item = await apiService.createContact(relationId, {
        name,
        title: form.title.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        isPrimary: form.isPrimary,
        isDecisionMaker: form.isDecisionMaker,
      });
      // 若设为主联系人，服务端已清除其它主标记，前端同步
      setContacts(prev => {
        const rest = (prev ?? []).map(c => (item.isPrimary ? { ...c, isPrimary: false } : c));
        return [item, ...rest];
      });
      setForm({ name: '', title: '', mobile: '', email: '', isPrimary: false, isDecisionMaker: false });
    } catch (e: any) {
      setError(`联系人添加失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiService.deleteContact(id);
      setContacts(prev => (prev ?? []).filter(c => c.id !== id));
    } catch (e: any) {
      setError(`联系人删除失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleSetPrimary = async (c: Contact) => {
    if (busy || c.isPrimary) return;
    setBusy(true); setError(null);
    try {
      const updated = await apiService.updateContact(c.id, { isPrimary: true });
      setContacts(prev => (prev ?? []).map(x => ({ ...x, isPrimary: x.id === updated.id })));
    } catch (e: any) {
      setError(`设置主联系人失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  return (
    <CrmSection title="联系人名片" icon={<Users size={14} />} isDarkMode={isDarkMode}>
      <div className={`text-sm text-[var(--text-tertiary)]`}>
        {contacts === null ? (
          <p className={mutedTextCls(isDarkMode)}>加载中…</p>
        ) : contacts.length === 0 ? (
          <p className={mutedTextCls(isDarkMode)}>暂无联系人名片</p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map(c => (
              <li key={c.id} className={`group flex items-center gap-1.5 ${rowTextCls(isDarkMode)}`}>
                <span className={`break-all text-[var(--text-primary)]`}>{c.name}</span>
                {c.title && <span className="text-[var(--text-tertiary)]">{c.title}</span>}
                {c.isPrimary && <span className={chip('active', isDarkMode)}>主联系人</span>}
                {c.isDecisionMaker && <span className={chip('info', isDarkMode)}>决策人</span>}
                {c.status === 'Left' && <span className={chip('neutral', isDarkMode)}>已离职</span>}
                {(c.mobile || c.email) && (
                  <span className={`hidden sm:inline-flex items-center gap-1 text-[var(--text-tertiary)]`}>
                    {c.mobile && <><Phone size={14} />{c.mobile}</>}
                    {!c.mobile && c.email && <><Mail size={14} />{c.email}</>}
                  </span>
                )}
                {!c.isPrimary && c.status !== 'Left' && (
                  <button type="button" onClick={() => handleSetPrimary(c)} disabled={busy}
                    className={`ml-auto self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
                    title="设为主联系人">
                    <Star size={12} />
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(c.id)} disabled={busy} className={c.isPrimary ? rowDeleteCls(isDarkMode) : `self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`} title="删除联系人">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* 内联添加表单 */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="姓名*" className={`flex-1 min-w-[90px] ${inputCls(isDarkMode)}`} />
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="职位" className={`w-20 ${inputCls(isDarkMode)}`} />
          <input value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} placeholder="手机" className={`w-24 ${inputCls(isDarkMode)}`} />
          <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="邮箱" className={`w-28 ${inputCls(isDarkMode)}`} />
          <label className={`flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]`}>
            <input type="checkbox" checked={form.isPrimary} onChange={e => setForm(p => ({ ...p, isPrimary: e.target.checked }))} /> 主
          </label>
          <label className={`flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]`}>
            <input type="checkbox" checked={form.isDecisionMaker} onChange={e => setForm(p => ({ ...p, isDecisionMaker: e.target.checked }))} /> 决策
          </label>
          <button type="button" onClick={handleAdd} disabled={busy || !form.name.trim()} className={addBtnCls(isDarkMode)} title="添加联系人">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </button>
        </div>
        {error && <p className="text-xs text-os-adaptive-danger mt-1">{error}</p>}
      </div>
    </CrmSection>
  );
};

// ════════════════════════════════════════════════════════════════
// 2. 跟进记录管理（新建/删除 + 下次跟进逾期标记）
// ════════════════════════════════════════════════════════════════

export const CrmFollowUpsSection: React.FC<{ relationId: string; isDarkMode: boolean }> = ({ relationId, isDarkMode }) => {
  const [items, setItems] = useState<FollowUpRecord[] | null>(null);
  const [form, setForm] = useState({ type: 'Call' as string, content: '', followUpAt: todayStr(), nextFollowUpAt: '', nextFollowUpTopic: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DR-042 §6.2/§8.3：访问档位（v2.1：owner=归属人全权 / team-followup=可跟进 / team-read=只读）+ 共享 chips
  const [accessMode, setAccessMode] = useState<string>('owner');
  const [teamShares, setTeamShares] = useState<Array<{ teamId: string; teamName: string; permission: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    apiService.listFollowUps(relationId, { includeCompleted: true })
      .then(rows => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    // DR-042：档位解析失败按最严格档（none）——写门禁 fail-closed
    apiService.getRelationTeamShares(relationId)
      .then(d => { if (!cancelled) { setAccessMode(d.accessMode); setTeamShares(d.teamShares); } })
      .catch(() => { if (!cancelled) setAccessMode('none'); });
    return () => { cancelled = true; };
  }, [relationId]);

  const canAddFollowUp = accessMode === 'owner' || accessMode === 'team-followup';

  const handleAdd = async () => {
    const content = form.content.trim();
    if (!content || !form.followUpAt || busy) return;
    setBusy(true); setError(null);
    try {
      const item = await apiService.createFollowUp(relationId, {
        type: form.type,
        content,
        followUpAt: form.followUpAt,
        nextFollowUpAt: form.nextFollowUpAt || undefined,
        nextFollowUpTopic: form.nextFollowUpTopic.trim() || undefined,
      });
      setItems(prev => [item, ...(prev ?? [])]);
      setForm({ type: 'Call', content: '', followUpAt: todayStr(), nextFollowUpAt: '', nextFollowUpTopic: '' });
    } catch (e: any) {
      setError(`跟进记录添加失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiService.deleteFollowUp(id);
      setItems(prev => (prev ?? []).filter(f => f.id !== id));
    } catch (e: any) {
      setError(`跟进记录删除失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  return (
    <CrmSection title="跟进管理" icon={<Calendar size={14} />} isDarkMode={isDarkMode}>
      {/* DR-042 §8.3：共享 chips（该客户被共享给的小组）+ 档位提示 */}
      {teamShares.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-light text-[var(--text-tertiary)]">共享至</span>
          {teamShares.map(s => (
            <span key={s.teamId} className="rounded-full px-2 py-0.5 text-[10px] font-light bg-[var(--recessed-bg)] text-[var(--text-secondary)]"
              title={s.permission === 'read+followup' ? '组员可查看并添加跟进' : '组员仅可查看'}>
              {s.teamName} · {s.permission === 'read+followup' ? '可跟进' : '只读'}
            </span>
          ))}
        </div>
      )}
      <div className={`text-sm text-[var(--text-tertiary)]`}>
        {items === null ? (
          <p className={mutedTextCls(isDarkMode)}>加载中…</p>
        ) : items.length === 0 ? (
          <p className={mutedTextCls(isDarkMode)}>暂无跟进记录</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map(fu => (
              <li key={fu.id} className={`group ${rowTextCls(isDarkMode)}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className={chip('info', isDarkMode)}>{FOLLOW_UP_TYPE_LABELS[fu.type] ?? fu.type}</span>
                  <span className={`shrink-0 text-[var(--text-tertiary)]`}>{fu.followUpAt}</span>
                  {fu.contact?.name && <span className="text-[var(--text-tertiary)]">· {fu.contact.name}</span>}
                  {accessMode === 'department' && (
                    <button type="button" onClick={() => handleDelete(fu.id)} disabled={busy} className={rowDeleteCls(isDarkMode)} title="删除跟进记录">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p className={`break-all ml-0.5 text-[var(--text-primary)]`}>{fu.content}</p>
                {fu.nextFollowUpAt && (
                  <p className={`ml-0.5 text-[10px] ${isOverdue(fu.nextFollowUpAt) ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                    下次跟进 {fu.nextFollowUpAt}{fu.nextFollowUpTopic ? ` · ${fu.nextFollowUpTopic}` : ''}
                    {isOverdue(fu.nextFollowUpAt) && <span className={`ml-1.5 ${chip('danger', isDarkMode)}`}>已逾期</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* DR-042 §6.2：内联添加表单仅 owner / team-followup 档渲染（T-20 read 档不渲染输入框） */}
        {canAddFollowUp ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <select className="bds-select sm shrink-0 w-auto" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                {FOLLOW_UP_TYPES.map(t => <option key={t} value={t}>{FOLLOW_UP_TYPE_LABELS[t]}</option>)}
              </select>
              <CapsuleDateInput value={form.followUpAt} onChange={v => setForm(p => ({ ...p, followUpAt: v }))} className="bds-input sm shrink-0" />
              <input value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="跟进内容*" className={`flex-1 min-w-0 ${inputCls(isDarkMode)}`} />
              <button type="button" onClick={handleAdd} disabled={busy || !form.content.trim()} className={addBtnCls(isDarkMode)} title="添加跟进记录">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <CapsuleDateInput value={form.nextFollowUpAt} onChange={v => setForm(p => ({ ...p, nextFollowUpAt: v }))} className="bds-input sm shrink-0" />
              <input value={form.nextFollowUpTopic} onChange={e => setForm(p => ({ ...p, nextFollowUpTopic: e.target.value }))} placeholder="下次跟进主题(可选)" className={`flex-1 min-w-0 ${inputCls(isDarkMode)}`} />
            </div>
          </div>
        ) : (
          accessMode !== 'department' && (
            <p className={`mt-2 text-[11px] ${mutedTextCls(isDarkMode)}`}>
              {accessMode === 'team-read' ? '组共享为只读档位，仅可查看跟进历史（DR-042 read 档）' : '无该客户的跟进权限'}
            </p>
          )
        )}
        {error && <p className="text-xs text-os-adaptive-danger mt-1">{error}</p>}
      </div>
    </CrmSection>
  );
};

// ════════════════════════════════════════════════════════════════
// 3. 商机管线（阶段徽章 + 推进/成交/流失流转）
// ════════════════════════════════════════════════════════════════

const STAGE_LABELS: Record<OpportunityStage, string> = {
  Prospecting: '初步接触', Qualification: '需求确认', Proposal: '方案报价',
  Negotiation: '商务谈判', ClosedWon: '已成交', ClosedLost: '已流失',
};
const STAGE_SEMANTIC: Record<OpportunityStage, StatusSemantic> = {
  Prospecting: 'neutral', Qualification: 'info', Proposal: 'active',
  Negotiation: 'warning', ClosedWon: 'success', ClosedLost: 'danger',
};
/** 推进到的下一开放阶段（ClosedWon/ClosedLost 为终态，不在推进链） */
const NEXT_STAGE: Partial<Record<OpportunityStage, OpportunityStage>> = {
  Prospecting: 'Qualification', Qualification: 'Proposal', Proposal: 'Negotiation', Negotiation: 'ClosedWon',
};

export const CrmOpportunitiesSection: React.FC<{ relationId: string; isDarkMode: boolean }> = ({ relationId, isDarkMode }) => {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [form, setForm] = useState({ title: '', amount: '', currency: 'CNY', expectedCloseDate: '', source: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    apiService.listOpportunities({ relationId })
      .then(rows => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [relationId]);

  const patch = (updated: Opportunity) => setItems(prev => (prev ?? []).map(o => (o.id === updated.id ? updated : o)));

  const handleAdd = async () => {
    const title = form.title.trim();
    const amount = Number(form.amount);
    if (!title || !form.amount || !Number.isFinite(amount) || busy) return;
    setBusy(true); setError(null);
    try {
      const item = await apiService.createOpportunity(relationId, {
        title,
        amount,
        currency: form.currency || 'CNY',
        expectedCloseDate: form.expectedCloseDate || undefined,
        source: form.source.trim() || undefined,
      });
      setItems(prev => [item, ...(prev ?? [])]);
      setForm({ title: '', amount: '', currency: 'CNY', expectedCloseDate: '', source: '' });
    } catch (e: any) {
      setError(`商机创建失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleTransition = async (id: string, toStage: OpportunityStage) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      patch(await apiService.transitionOpportunity(id, toStage));
    } catch (e: any) {
      setError(`商机流转失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiService.deleteOpportunity(id);
      setItems(prev => (prev ?? []).filter(o => o.id !== id));
    } catch (e: any) {
      setError(`商机删除失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const isTerminal = (s: OpportunityStage) => s === 'ClosedWon' || s === 'ClosedLost';

  return (
    <CrmSection title="商机管线" icon={<TrendingUp size={14} />} isDarkMode={isDarkMode}>
      <div className={`text-sm text-[var(--text-tertiary)]`}>
        {items === null ? (
          <p className={mutedTextCls(isDarkMode)}>加载中…</p>
        ) : items.length === 0 ? (
          <p className={mutedTextCls(isDarkMode)}>暂无商机</p>
        ) : (
          <ul className="space-y-2">
            {items.map(o => (
              <li key={o.id} className={`group ${rowTextCls(isDarkMode)}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`break-all text-[var(--text-primary)]`}>{o.title}</span>
                  <span className={chip(STAGE_SEMANTIC[o.stage], isDarkMode)}>{STAGE_LABELS[o.stage]}</span>
                  <button type="button" onClick={() => handleDelete(o.id)} disabled={busy} className={rowDeleteCls(isDarkMode)} title="删除商机">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className={`flex items-center gap-2 ml-0.5 text-[10px] text-[var(--text-tertiary)]`}>
                  <span>{fmtMoney(o.amount, o.currency)}</span>
                  <span>· 概率 {o.probability}%</span>
                  {o.expectedCloseDate && <span>· 预计 {o.expectedCloseDate}</span>}
                  {o.source && <span>· {o.source}</span>}
                </div>
                {!isTerminal(o.stage) && (
                  <div className="flex items-center gap-1.5 ml-0.5 mt-1">
                    {NEXT_STAGE[o.stage] && (
                      <button type="button" onClick={() => handleTransition(o.id, NEXT_STAGE[o.stage]!)} disabled={busy}
                        className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>
                        推进 → {STAGE_LABELS[NEXT_STAGE[o.stage]!]}
                      </button>
                    )}
                    {o.stage === 'Negotiation' && (
                      <button type="button" onClick={() => handleTransition(o.id, 'ClosedLost')} disabled={busy}
                        className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]`}>
                        标记流失
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* 内联创建表单 */}
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="商机标题*" className={`flex-1 min-w-0 ${inputCls(isDarkMode)}`} />
            <input value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="金额*" inputMode="decimal" className={`w-24 ${inputCls(isDarkMode)}`} />
            <select className="bds-select sm shrink-0 w-auto" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
              {['CNY', 'USD', 'EUR', 'JPY', 'HKD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={handleAdd} disabled={busy || !form.title.trim() || !form.amount.trim()} className={addBtnCls(isDarkMode)} title="创建商机">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <CapsuleDateInput value={form.expectedCloseDate} onChange={v => setForm(p => ({ ...p, expectedCloseDate: v }))} className="bds-input sm shrink-0" />
            <input value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))} placeholder="商机来源(可选，如 展会/转介绍)" className={`flex-1 min-w-0 ${inputCls(isDarkMode)}`} />
          </div>
        </div>
        {error && <p className="text-xs text-os-adaptive-danger mt-1">{error}</p>}
      </div>
    </CrmSection>
  );
};

// ════════════════════════════════════════════════════════════════
// 4. 信用额度（生效额度/已用/剩余 + 设置 + 状态流转）
// ════════════════════════════════════════════════════════════════

const CREDIT_STATUS_LABELS: Record<string, string> = { Active: '生效中', Frozen: '已冻结', Expired: '已过期', Revoked: '已撤销' };
const CREDIT_STATUS_SEMANTIC: Record<string, StatusSemantic> = { Active: 'active', Frozen: 'warning', Expired: 'neutral', Revoked: 'danger' };

export const CrmCreditLimitSection: React.FC<{ relationId: string; isDarkMode: boolean }> = ({ relationId, isDarkMode }) => {
  const [active, setActive] = useState<CreditLimit | null>(null);
  const [history, setHistory] = useState<CreditLimit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ totalLimit: '', currency: 'CNY', validFrom: todayStr(), validTo: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    Promise.all([
      apiService.getActiveCreditLimit(relationId).catch(() => null),
      apiService.listCreditLimitHistory(relationId).catch(() => [] as CreditLimit[]),
    ]).then(([a, h]) => {
      if (cancelled) return;
      setActive(a); setHistory(h); setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [relationId]);

  const handleSet = async () => {
    const totalLimit = Number(form.totalLimit);
    if (!form.totalLimit || !Number.isFinite(totalLimit) || totalLimit <= 0 || !form.validFrom || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await apiService.setCreditLimit(relationId, {
        totalLimit,
        currency: form.currency || 'CNY',
        validFrom: form.validFrom,
        validTo: form.validTo || undefined,
        notes: form.notes.trim() || undefined,
      });
      setActive(created);
      setHistory(prev => [created, ...prev.map(x => (x.id === created.id ? x : { ...x, status: 'Expired' }))]);
      setShowForm(false);
      setForm({ totalLimit: '', currency: 'CNY', validFrom: todayStr(), validTo: '', notes: '' });
    } catch (e: any) {
      setError(`信用额度设置失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const handleStatus = async (id: string, status: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const updated = await apiService.updateCreditLimitStatus(id, status);
      setActive(prev => (prev && prev.id === updated.id ? updated : prev));
      setHistory(prev => prev.map(x => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      setError(`状态更新失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const usedPct = active && active.totalLimit > 0 ? Math.min(100, Math.round((active.usedAmount / active.totalLimit) * 100)) : 0;
  const usedSemantic: StatusSemantic = usedPct >= 100 ? 'danger' : usedPct >= 80 ? 'warning' : 'active';

  return (
    <CrmSection title="信用额度" icon={<CreditCard size={14} />} isDarkMode={isDarkMode}>
      <div className={`text-sm text-[var(--text-tertiary)]`}>
        {!loaded ? (
          <p className={mutedTextCls(isDarkMode)}>加载中…</p>
        ) : !active ? (
          <p className={mutedTextCls(isDarkMode)}>尚未设置信用额度</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-sm text-[var(--text-primary)]`}>{fmtMoney(active.totalLimit, active.currency)}</span>
              <span className={chip(CREDIT_STATUS_SEMANTIC[active.status] ?? 'neutral', isDarkMode)}>{CREDIT_STATUS_LABELS[active.status] ?? active.status}</span>
            </div>
            <div className={`text-[10px] text-[var(--text-tertiary)]`}>
              已用 {fmtMoney(active.usedAmount, active.currency)} · 剩余 {fmtMoney(active.totalLimit - active.usedAmount, active.currency)} · 生效 {active.validFrom}{active.validTo ? ` 至 ${active.validTo}` : ' · 长期'}
            </div>
            {/* 使用率进度条 */}
            <div className={`h-1.5 w-full rounded-full overflow-hidden bg-[var(--recessed-bg-strong)]`}>
              <div className={`h-full rounded-full ${usedSemantic === 'danger' ? 'bg-[var(--text-secondary)]' : usedSemantic === 'warning' ? 'bg-[var(--text-tertiary)]' : 'bg-[var(--text-tertiary)]'}`} style={{ width: `${usedPct}%` }} />
            </div>
            <div className="flex items-center gap-1.5">
              {active.status === 'Active' && (
                <button type="button" onClick={() => handleStatus(active.id, 'Frozen')} disabled={busy}
                  className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>
                  冻结额度
                </button>
              )}
              {active.status === 'Frozen' && (
                <button type="button" onClick={() => handleStatus(active.id, 'Active')} disabled={busy}
                  className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>
                  解冻额度
                </button>
              )}
              <button type="button" onClick={() => setShowForm(s => !s)} disabled={busy}
                className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>
                {showForm ? '收起' : '调整额度'}
              </button>
            </div>
            {history.length > 1 && (
              <p className={`text-[10px] text-[var(--text-tertiary)]`}>历史 {history.length} 条额度记录（当前为最新生效）</p>
            )}
          </div>
        )}
        {/* 设置/调整表单 */}
        {(!active || showForm) && loaded && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input value={form.totalLimit} onChange={e => setForm(p => ({ ...p, totalLimit: e.target.value }))} placeholder="总额度*" inputMode="decimal" className={`w-28 ${inputCls(isDarkMode)}`} />
              <select className="bds-select sm shrink-0 w-auto" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                {['CNY', 'USD', 'EUR', 'JPY', 'HKD'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <CapsuleDateInput value={form.validFrom} onChange={v => setForm(p => ({ ...p, validFrom: v }))} className="bds-input sm shrink-0" />
              <button type="button" onClick={handleSet} disabled={busy || !form.totalLimit.trim()} className={addBtnCls(isDarkMode)} title="设置信用额度">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <CapsuleDateInput value={form.validTo} onChange={v => setForm(p => ({ ...p, validTo: v }))} className="bds-input sm shrink-0" />
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="备注(可选)" className={`flex-1 min-w-0 ${inputCls(isDarkMode)}`} />
            </div>
            {active && <p className={`text-[10px] text-[var(--text-tertiary)]`}>新额度生效后，当前额度将自动封闭为历史</p>}
          </div>
        )}
        {error && <p className="text-xs text-os-adaptive-danger mt-1">{error}</p>}
      </div>
    </CrmSection>
  );
};

// ════════════════════════════════════════════════════════════════
// 5. 客户分层（级别徽章 + 权益 + 评定）
// ════════════════════════════════════════════════════════════════

const TIER_LABELS: Record<CustomerTierLevel, string> = { Bronze: '青铜', Silver: '白银', Gold: '黄金', Platinum: '铂金', VIP: 'VIP' };
const TIER_SEMANTIC: Record<CustomerTierLevel, StatusSemantic> = { Bronze: 'neutral', Silver: 'info', Gold: 'active', Platinum: 'warning', VIP: 'success' };
const TIER_LEVELS: CustomerTierLevel[] = ['Bronze', 'Silver', 'Gold', 'Platinum', 'VIP'];
const CREDIT_PRIORITY_LABELS: Record<string, string> = { High: '高', Normal: '普通', Low: '低' };

export const CrmCustomerTierSection: React.FC<{ relationId: string; isDarkMode: boolean }> = ({ relationId, isDarkMode }) => {
  const [active, setActive] = useState<CustomerTier | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ level: 'Bronze' as CustomerTierLevel, discountRate: '', paymentTermsDays: '', creditPriority: 'Normal', criteria: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    apiService.getActiveCustomerTier(relationId)
      .then(t => { if (!cancelled) { setActive(t); setLoaded(true); } })
      .catch(() => { if (!cancelled) { setActive(null); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [relationId]);

  const handleAssign = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const created = await apiService.assignCustomerTier(relationId, {
        level: form.level,
        discountRate: form.discountRate ? Number(form.discountRate) : undefined,
        paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
        creditPriority: form.creditPriority,
        criteria: form.criteria.trim() || undefined,
        evaluatedAt: todayStr(),
      });
      setActive(created);
      setShowForm(false);
    } catch (e: any) {
      setError(`分层评定失败：${e?.message || e}`);
    } finally { setBusy(false); }
  };

  return (
    <CrmSection title="客户分层" icon={<Layers size={14} />} isDarkMode={isDarkMode}>
      <div className={`text-sm text-[var(--text-tertiary)]`}>
        {!loaded ? (
          <p className={mutedTextCls(isDarkMode)}>加载中…</p>
        ) : !active ? (
          <p className={mutedTextCls(isDarkMode)}>尚未评定客户分层</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={chip(TIER_SEMANTIC[active.level], isDarkMode)}>{TIER_LABELS[active.level]}</span>
              <span className={`text-[10px] text-[var(--text-tertiary)]`}>信用优先级 {CREDIT_PRIORITY_LABELS[active.creditPriority] ?? active.creditPriority}</span>
            </div>
            <div className={`text-[10px] text-[var(--text-tertiary)]`}>
              {active.discountRate != null && <span>折扣率 {active.discountRate}% · </span>}
              {active.paymentTermsDays != null && <span>账期 {active.paymentTermsDays} 天 · </span>}
              <span>评定 {active.evaluatedAt}</span>
            </div>
            {active.criteria && <p className={`text-[10px] text-[var(--text-tertiary)]`}>依据：{active.criteria}</p>}
          </div>
        )}
        <div className="mt-1.5">
          <button type="button" onClick={() => setShowForm(s => !s)} disabled={busy}
            className={`px-1.5 py-0.5 rounded-control text-[10px] border transition-colors border-[var(--border-c-default)] text-[var(--text-secondary)] hover:bg-[var(--recessed-bg-hover)]`}>
            {showForm ? '收起' : active ? '重新评定' : '评定分层'}
          </button>
        </div>
        {showForm && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <select className="bds-select sm w-auto" value={form.level} onChange={e => setForm(p => ({ ...p, level: e.target.value as CustomerTierLevel }))}>
                {TIER_LEVELS.map(l => <option key={l} value={l}>{TIER_LABELS[l]}</option>)}
              </select>
              <input value={form.discountRate} onChange={e => setForm(p => ({ ...p, discountRate: e.target.value }))} placeholder="折扣率%" inputMode="decimal" className={`w-20 ${inputCls(isDarkMode)}`} />
              <input value={form.paymentTermsDays} onChange={e => setForm(p => ({ ...p, paymentTermsDays: e.target.value }))} placeholder="账期天" inputMode="numeric" className={`w-20 ${inputCls(isDarkMode)}`} />
              <select className="bds-select sm w-auto" value={form.creditPriority} onChange={e => setForm(p => ({ ...p, creditPriority: e.target.value }))}>
                {['High', 'Normal', 'Low'].map(c => <option key={c} value={c}>{CREDIT_PRIORITY_LABELS[c]}</option>)}
              </select>
              <button type="button" onClick={handleAssign} disabled={busy} className={addBtnCls(isDarkMode)} title="评定分层">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
            <input value={form.criteria} onChange={e => setForm(p => ({ ...p, criteria: e.target.value }))} placeholder="评定依据(可选，如 年采购额 > 100万)" className={`w-full ${inputCls(isDarkMode)}`} />
            {active && <p className={`text-[10px] text-[var(--text-tertiary)]`}>新分层生效后，当前分层将自动封闭为历史</p>}
          </div>
        )}
        {error && <p className="text-xs text-os-adaptive-danger mt-1">{error}</p>}
      </div>
    </CrmSection>
  );
};
