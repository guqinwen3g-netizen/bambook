/**
 * CRM 管理 CrmManager
 * Phase 3 C1 CRM 深化：客户关系管理全栈界面
 *
 * 功能（5 个 Tab）：
 *   1. 商机管线（Opportunities）— 销售管线阶段流转、成交/流失
 *   2. 跟进记录（Follow-ups）— 销售跟进日志、逾期提醒
 *   3. 联系人（Contacts）— 只读视图（阶段 IA-2：档案唯一权威源在关系智库，点击跳转编辑）
 *   4. 信用额度（Credit Limits）— 信用额度管理、用量跟踪
 *   5. 客户分层（Customer Tiers）— 客户分层评定、权益管理
 *
 * 设计原则：
 *   - 每个客户（Relation）下管理所有 CRM 实体
 *   - 顶部客户选择器切换当前客户
 *   - Tab 切换不同 CRM 维度
 *   - 状态用 bds-badge 语义变体（SEMANTIC_BADGE_VARIANT）
 *   - BDS v2.1 组件族（bds-card/bds-btn/bds-input/bds-modal 等）
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  X,
  Users,
  TrendingUp,
  Phone,
  CreditCard,
  Award,
  Target,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  Relation,
  Contact,
  CreditLimit,
  CreditLimitInput,
  FollowUpRecord,
  FollowUpInput,
  Opportunity,
  OpportunityInput,
  OpportunityStage,
  CustomerTier,
  CustomerTierInput,
  CustomerTierLevel,
  View,
} from '../types';
import { primeRelationsOrgDetailPreview } from './RelationsManager';
import { PageHeader } from './ui/PageHeader';
import CapsuleDateInput from './ui/CapsuleDateInput';
import { bdsToast } from './ui/bdsToast';
import { bdsConfirm } from './ui/BdsDialog';
import { StatusSemantic } from './rdlBusinessStatusTokens';
import { BAMBOOK_OS } from './ui/bambookOsTokens';
import { RelatedEntitiesPanel } from './RelatedEntitiesPanel';

// ==================== 常量 ====================

type CrmTab = 'opportunities' | 'followups' | 'contacts' | 'credit' | 'tier';

const TABS: Array<{ id: CrmTab; label: string; icon: LucideIcon }> = [
  { id: 'opportunities', label: '商机管线', icon: Target },
  { id: 'followups', label: '跟进记录', icon: Phone },
  { id: 'contacts', label: '联系人', icon: Users },
  { id: 'credit', label: '信用额度', icon: CreditCard },
  { id: 'tier', label: '客户分层', icon: Award },
];

const OPPORTUNITY_STAGES: Array<{ id: OpportunityStage; label: string; semantic: StatusSemantic }> = [
  { id: 'Prospecting', label: '潜在客户', semantic: 'neutral' },
  { id: 'Qualification', label: '资格确认', semantic: 'info' },
  { id: 'Proposal', label: '方案报价', semantic: 'info' },
  { id: 'Negotiation', label: '商务谈判', semantic: 'warning' },
  { id: 'ClosedWon', label: '已成交', semantic: 'success' },
  { id: 'ClosedLost', label: '已流失', semantic: 'danger' },
];

const STAGE_TRANSITION_TARGETS: Record<OpportunityStage, OpportunityStage[]> = {
  Prospecting: ['Qualification', 'ClosedLost'],
  Qualification: ['Proposal', 'ClosedLost'],
  Proposal: ['Negotiation', 'ClosedLost'],
  Negotiation: ['ClosedWon', 'ClosedLost'],
  ClosedWon: [],
  ClosedLost: [],
};

const FOLLOWUP_TYPES = [
  { id: 'Visit', label: '拜访' },
  { id: 'Call', label: '电话' },
  { id: 'Email', label: '邮件' },
  { id: 'WeChat', label: '微信' },
  { id: 'Meeting', label: '会议' },
  { id: 'Other', label: '其他' },
];

const TIER_LEVELS: Array<{ id: CustomerTierLevel; label: string; semantic: StatusSemantic }> = [
  { id: 'Bronze', label: '青铜', semantic: 'neutral' },
  { id: 'Silver', label: '白银', semantic: 'info' },
  { id: 'Gold', label: '黄金', semantic: 'warning' },
  { id: 'Platinum', label: '铂金', semantic: 'active' },
  { id: 'VIP', label: 'VIP', semantic: 'success' },
];

const CREDIT_STATUS_LABELS: Record<string, string> = {
  Active: '生效中',
  Frozen: '已冻结',
  Expired: '已过期',
  Revoked: '已撤销',
};

const CURRENCIES = ['CNY', 'USD', 'EUR'];

// BDS 徽章语义变体映射（bds-badge 无 active/rebate 变体，归并到 info）
type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
const SEMANTIC_BADGE_VARIANT: Record<StatusSemantic, BadgeVariant> = {
  neutral: 'neutral',
  active: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  destructive: 'danger',
  rebate: 'info',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return dateStr;
}

// ==================== 组件 Props ====================

interface CrmManagerProps {
  isDarkMode?: boolean;
  onNavigate?: (view: View) => void;
}

// ==================== 主组件 ====================

export default function CrmManager({ isDarkMode, onNavigate }: CrmManagerProps) {
  const [activeTab, setActiveTab] = useState<CrmTab>('opportunities');
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // 数据状态
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [overdueFollowUps, setOverdueFollowUps] = useState<FollowUpRecord[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeCreditLimit, setActiveCreditLimit] = useState<CreditLimit | null>(null);
  const [creditHistory, setCreditHistory] = useState<CreditLimit[]>([]);
  const [activeTier, setActiveTier] = useState<CustomerTier | null>(null);
  const [tierHistory, setTierHistory] = useState<CustomerTier[]>([]);

  // 弹窗状态
  const [showOpportunityForm, setShowOpportunityForm] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState<Opportunity | null>(null);
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUpRecord | null>(null);
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [showTierForm, setShowTierForm] = useState(false);

  // ── 加载客户列表 ──
  const loadRelations = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiService.listRelations();
      const filtered = search
        ? list.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()) || (r.category || '').includes(search.toLowerCase()))
        : list;
      setRelations(filtered);
      if (!selectedRelationId && filtered.length > 0) {
        setSelectedRelationId(filtered[0].id);
      }
    } catch (e) {
      console.error('[CrmManager] loadRelations failed', e);
    } finally {
      setLoading(false);
    }
  }, [search, selectedRelationId]);

  useEffect(() => {
    loadRelations();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 加载当前客户 CRM 数据 ──
  const loadCrmData = useCallback(async () => {
    if (!selectedRelationId) return;
    try {
      const [opps, fus, ovdu, cts, acl, clh, at, th] = await Promise.all([
        apiService.listOpportunities({ relationId: selectedRelationId }),
        apiService.listFollowUps(selectedRelationId, { limit: 50, includeCompleted: true }),
        apiService.listOverdueFollowUps(),
        apiService.listContacts(selectedRelationId),
        apiService.getActiveCreditLimit(selectedRelationId),
        apiService.listCreditLimitHistory(selectedRelationId),
        apiService.getActiveCustomerTier(selectedRelationId),
        apiService.listCustomerTierHistory(selectedRelationId),
      ]);
      setOpportunities(opps);
      setFollowUps(fus);
      // 只保留当前客户的逾期
      setOverdueFollowUps(ovdu.filter((f) => f.relationId === selectedRelationId));
      setContacts(cts);
      setActiveCreditLimit(acl);
      setCreditHistory(clh);
      setActiveTier(at);
      setTierHistory(th);
    } catch (e) {
      console.error('[CrmManager] loadCrmData failed', e);
    }
  }, [selectedRelationId]);

  useEffect(() => {
    loadCrmData();
  }, [loadCrmData]);

  const selectedRelation = useMemo(
    () => relations.find((r) => r.id === selectedRelationId),
    [relations, selectedRelationId],
  );

  // ══════════════════════════════════════════════════════════════
  // 商机操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveOpportunity = async (input: OpportunityInput, id?: string) => {
    if (!selectedRelationId) return;
    try {
      if (id) {
        await apiService.updateOpportunity(id, input);
      } else {
        await apiService.createOpportunity(selectedRelationId, input);
      }
      setShowOpportunityForm(false);
      setEditingOpportunity(null);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`保存商机失败：${e?.message || e}`);
    }
  };

  const handleTransitionOpportunity = async (id: string, toStage: OpportunityStage) => {
    try {
      await apiService.transitionOpportunity(id, toStage);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`阶段流转失败：${e?.message || e}`);
    }
  };

  const handleDeleteOpportunity = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此商机？', danger: true }))) return;
    try {
      await apiService.deleteOpportunity(id);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 跟进操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveFollowUp = async (input: FollowUpInput, id?: string) => {
    if (!selectedRelationId) return;
    try {
      if (id) {
        await apiService.updateFollowUp(id, input);
      } else {
        await apiService.createFollowUp(selectedRelationId, input);
      }
      setShowFollowUpForm(false);
      setEditingFollowUp(null);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`保存跟进失败：${e?.message || e}`);
    }
  };

  const handleDeleteFollowUp = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此跟进记录？', danger: true }))) return;
    try {
      await apiService.deleteFollowUp(id);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 联系人（阶段 IA-2：只读。写路径统一收口在关系智库 DetailPanel 联系人名片区块）
  // ══════════════════════════════════════════════════════════════

  const handleManageContactsInRelations = () => {
    if (!selectedRelationId) return;
    primeRelationsOrgDetailPreview(selectedRelationId);
    onNavigate?.(View.Relations);
  };

  // ══════════════════════════════════════════════════════════════
  // 信用额度操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveCreditLimit = async (input: CreditLimitInput) => {
    if (!selectedRelationId) return;
    try {
      await apiService.setCreditLimit(selectedRelationId, input);
      setShowCreditForm(false);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`设置信用额度失败：${e?.message || e}`);
    }
  };

  const handleUpdateCreditStatus = async (id: string, status: string) => {
    try {
      await apiService.updateCreditLimitStatus(id, status);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`更新状态失败：${e?.message || e}`);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // 客户分层操作
  // ══════════════════════════════════════════════════════════════

  const handleSaveTier = async (input: CustomerTierInput) => {
    if (!selectedRelationId) return;
    try {
      await apiService.assignCustomerTier(selectedRelationId, input);
      setShowTierForm(false);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`评定分层失败：${e?.message || e}`);
    }
  };

  const handleDeleteTier = async (id: string) => {
    if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此分层记录？', danger: true }))) return;
    try {
      await apiService.deleteCustomerTier(id);
      await loadCrmData();
    } catch (e: any) {
      bdsToast.danger(`删除失败：${e?.message || e}`);
    }
  };

  // ── 渲染 ──

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="客户关系管理"
        subtitle="CRM Customer Relationship Management"
      />

      {/* 客户选择器 + 搜索 */}
      <div className="px-7 pt-3 pb-3 flex items-center gap-3 flex-wrap">
        <div className="bds-filterbar flex-1 min-w-60">
          <Search className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="搜索客户名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bds-input sm flex-1"
          />
          <select
            value={selectedRelationId ?? ''}
            onChange={(e) => setSelectedRelationId(e.target.value || null)}
            className="bds-select"
            style={{ width: 'auto', minWidth: 200 }}
          >
            <option value="">选择客户...</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.category})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={loadRelations}
          className="bds-btn bds-btn-ghost bds-btn-icon"
          title="刷新客户列表"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 栏（BDS Tabs 下划线式） */}
      <div className="px-7 pb-3">
        <div className="bds-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`bds-tab flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-7 py-4">
        {!selectedRelation ? (
          <div className="bds-empty">
            <div className="glyph"><Users size={24} /></div>
            <div className="title">请先选择一个客户</div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'opportunities' && (
                <OpportunitiesTab
                  opportunities={opportunities}
                  selectedRelation={selectedRelation}
                  onCreate={() => { setEditingOpportunity(null); setShowOpportunityForm(true); }}
                  onEdit={(opp) => { setEditingOpportunity(opp); setShowOpportunityForm(true); }}
                  onTransition={handleTransitionOpportunity}
                  onDelete={handleDeleteOpportunity}
                />
              )}
              {activeTab === 'followups' && (
                <FollowUpsTab
                  followUps={followUps}
                  overdueFollowUps={overdueFollowUps}
                  contacts={contacts}
                  opportunities={opportunities}
                  selectedRelation={selectedRelation}
                  onCreate={() => { setEditingFollowUp(null); setShowFollowUpForm(true); }}
                  onEdit={(fu) => { setEditingFollowUp(fu); setShowFollowUpForm(true); }}
                  onDelete={handleDeleteFollowUp}
                />
              )}
              {activeTab === 'contacts' && (
                <ContactsTab
                  contacts={contacts}
                  selectedRelation={selectedRelation}
                  onManageInRelations={handleManageContactsInRelations}
                />
              )}
              {activeTab === 'credit' && (
                <CreditLimitTab
                  activeCreditLimit={activeCreditLimit}
                  creditHistory={creditHistory}
                  selectedRelation={selectedRelation}
                  onCreate={() => setShowCreditForm(true)}
                  onUpdateStatus={handleUpdateCreditStatus}
                />
              )}
              {activeTab === 'tier' && (
                <CustomerTierTab
                  activeTier={activeTier}
                  tierHistory={tierHistory}
                  selectedRelation={selectedRelation}
                  onCreate={() => setShowTierForm(true)}
                  onDelete={handleDeleteTier}
                />
              )}

              {/* 跨模块关联视图（EntityLink 图谱）— 客户全维度：订单/报价/商机/开发案/发票等 */}
              <div className="pt-4">
                <RelatedEntitiesPanel
                  type="relation.organization"
                  id={selectedRelation.id}
                  isDarkMode={isDarkMode}
                  title="客户关联视图"
                />
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* 弹窗 */}
      <AnimatePresence>
        {showOpportunityForm && (
          <OpportunityForm
            opportunity={editingOpportunity}
            onSave={handleSaveOpportunity}
            onClose={() => { setShowOpportunityForm(false); setEditingOpportunity(null); }}
          />
        )}
        {showFollowUpForm && (
          <FollowUpForm
            followUp={editingFollowUp}
            contacts={contacts}
            opportunities={opportunities}
            onSave={handleSaveFollowUp}
            onClose={() => { setShowFollowUpForm(false); setEditingFollowUp(null); }}
          />
        )}
        {showCreditForm && (
          <CreditLimitForm
            onSave={handleSaveCreditLimit}
            onClose={() => setShowCreditForm(false)}
          />
        )}
        {showTierForm && (
          <CustomerTierForm
            onSave={handleSaveTier}
            onClose={() => setShowTierForm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== 商机 Tab ====================

function OpportunitiesTab({
  opportunities,
  selectedRelation,
  onCreate,
  onEdit,
  onTransition,
  onDelete,
}: {
  opportunities: Opportunity[];
  selectedRelation: Relation;
  onCreate: () => void;
  onEdit: (opp: Opportunity) => void;
  onTransition: (id: string, toStage: OpportunityStage) => void;
  onDelete: (id: string) => void;
}) {
  const pipelineSummary = useMemo(() => {
    const summary: Record<string, { count: number; totalAmount: number }> = {};
    for (const opp of opportunities) {
      if (!summary[opp.stage]) summary[opp.stage] = { count: 0, totalAmount: 0 };
      summary[opp.stage].count += 1;
      summary[opp.stage].totalAmount += opp.amount;
    }
    return summary;
  }, [opportunities]);

  const totalAmount = opportunities.reduce((sum, o) => sum + o.amount, 0);
  const wonAmount = opportunities.filter((o) => o.stage === 'ClosedWon').reduce((s, o) => s + o.amount, 0);

  return (
    <div className="space-y-4">
      {/* 管线汇总 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bds-card" style={{ padding: 'var(--space-3)' }}>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>商机总数</div>
          <div className="bds-tnum text-xl mt-1" style={{ color: 'var(--text-primary)' }}>{opportunities.length}</div>
        </div>
        <div className="bds-card" style={{ padding: 'var(--space-3)' }}>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>管线总额</div>
          <div className="bds-tnum text-xl mt-1" style={{ color: 'var(--text-primary)' }}>{formatAmount(totalAmount, opportunities[0]?.currency ?? 'CNY')}</div>
        </div>
        <div className="bds-card" style={{ padding: 'var(--space-3)' }}>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>已成交</div>
          <div className="bds-tnum text-xl mt-1" style={{ color: 'var(--text-primary)' }}>{formatAmount(wonAmount, opportunities[0]?.currency ?? 'CNY')}</div>
        </div>
        <div className="bds-card" style={{ padding: 'var(--space-3)' }}>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>当前客户</div>
          <div className="text-sm mt-1 truncate" style={{ color: 'var(--text-primary)' }}>{selectedRelation.name}</div>
        </div>
      </div>

      {/* 管线阶段卡片 */}
      <div className="flex items-center justify-between">
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>销售管线</h3>
        <button onClick={onCreate} className="bds-btn bds-btn-secondary">
          <Plus className="w-4 h-4" />
          新建商机
        </button>
      </div>

      {/* 阶段列 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {OPPORTUNITY_STAGES.map((stage) => {
          const stageOpps = opportunities.filter((o) => o.stage === stage.id);
          const summary = pipelineSummary[stage.id];
          return (
            <div key={stage.id} className="bds-card" style={{ padding: 'var(--space-3)', minHeight: 120 }}>
              <div className="flex items-center justify-between mb-2">
                <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[stage.semantic]}`}>{stage.label}</span>
                <span className="bds-tnum text-xs" style={{ color: 'var(--text-tertiary)' }}>{summary?.count ?? 0}</span>
              </div>
              <div className="space-y-2">
                {stageOpps.map((opp) => (
                  <div
                    key={opp.id}
                    className="bds-inset rounded-compact p-2 cursor-pointer transition-colors hover:bg-[var(--hover-darken)]"
                    onClick={() => onEdit(opp)}
                  >
                    <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{opp.title}</div>
                    <div className="bds-tnum text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{formatAmount(opp.amount, opp.currency)}</div>
                    <div className="flex items-center gap-1 mt-1">
                      {STAGE_TRANSITION_TARGETS[opp.stage].length > 0 && (
                        <select
                          className="text-xs bg-transparent outline-none cursor-pointer"
                          style={{ color: 'var(--text-tertiary)' }}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onTransition(opp.id, e.target.value as OpportunityStage);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">流转 →</option>
                          {STAGE_TRANSITION_TARGETS[opp.stage].map((target) => (
                            <option key={target} value={target}>
                              {OPPORTUNITY_STAGES.find((s) => s.id === target)?.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        className="ml-auto transition-colors hover:text-[var(--danger-text)]"
                        style={{ color: 'var(--text-quaternary)' }}
                        onClick={(e) => { e.stopPropagation(); onDelete(opp.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {stageOpps.length === 0 && (
                  <div className="text-xs text-center py-2 opacity-50" style={{ color: 'var(--text-quaternary)' }}>无</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 跟进记录 Tab ====================

function FollowUpsTab({
  followUps,
  overdueFollowUps,
  contacts,
  opportunities,
  selectedRelation,
  onCreate,
  onEdit,
  onDelete,
}: {
  followUps: FollowUpRecord[];
  overdueFollowUps: FollowUpRecord[];
  contacts: Contact[];
  opportunities: Opportunity[];
  selectedRelation: Relation;
  onCreate: () => void;
  onEdit: (fu: FollowUpRecord) => void;
  onDelete: (id: string) => void;
}) {
  const today = todayStr();
  return (
    <div className="space-y-4">
      {overdueFollowUps.length > 0 && (
        <div className="rounded-card p-3" style={{ background: 'var(--danger-tint)' }}>
          <div className="flex items-center gap-2 text-sm mb-2" style={{ color: 'var(--danger-text)' }}>
            <AlertCircle className="w-4 h-4" />
            逾期跟进 ({overdueFollowUps.length})
          </div>
          <div className="space-y-1">
            {overdueFollowUps.slice(0, 5).map((fu) => (
              <div key={fu.id} className="text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Clock className="w-3 h-3" style={{ color: 'var(--danger-text)' }} />
                <span>{fu.nextFollowUpTopic || fu.content}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>— 原定 {formatDate(fu.nextFollowUpAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>跟进记录 ({followUps.length})</h3>
        <button onClick={onCreate} className="bds-btn bds-btn-secondary">
          <Plus className="w-4 h-4" />
          新建跟进
        </button>
      </div>

      <div className="space-y-2">
        {followUps.length === 0 && (
          <div className="bds-empty">
            <div className="glyph"><Phone size={24} /></div>
            <div className="title">暂无跟进记录</div>
          </div>
        )}
        {followUps.map((fu) => {
          const isOverdue = fu.nextFollowUpAt && fu.nextFollowUpAt < today;
          const typeMeta = FOLLOWUP_TYPES.find((t) => t.id === fu.type);
          return (
            <div
              key={fu.id}
              className="bds-card interactive"
              style={{ padding: 'var(--space-3)' }}
              onClick={() => onEdit(fu)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bds-badge sm neutral">
                      {typeMeta?.label || fu.type}
                    </span>
                    {isOverdue && (
                      <span className="bds-badge sm danger">
                        逾期
                      </span>
                    )}
                    {fu.contact && (
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>联系人：{fu.contact.name}</span>
                    )}
                    {fu.salesRepName && (
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>销售：{fu.salesRepName}</span>
                    )}
                  </div>
                  <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>{fu.content}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    <span>跟进：{formatDate(fu.followUpAt)}</span>
                    {fu.nextFollowUpAt && (
                      <span style={isOverdue ? { color: 'var(--danger-text)' } : undefined}>
                        下次：{formatDate(fu.nextFollowUpAt)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="transition-colors hover:text-[var(--danger-text)]"
                  style={{ color: 'var(--text-quaternary)' }}
                  onClick={(e) => { e.stopPropagation(); onDelete(fu.id); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 联系人 Tab ====================

function ContactsTab({
  contacts,
  selectedRelation,
  onManageInRelations,
}: {
  contacts: Contact[];
  selectedRelation: Relation;
  onManageInRelations: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>联系人 ({contacts.length})</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>档案由关系智库统一维护，此处只读</p>
        </div>
        <button
          onClick={onManageInRelations}
          className="bds-btn bds-btn-secondary shrink-0"
        >
          在关系智库中维护
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {contacts.length === 0 && (
          <div className="bds-empty col-span-full">
            <div className="glyph"><Users size={24} /></div>
            <div className="title">暂无联系人</div>
            <div className="desc">可到关系智库为「{selectedRelation.name}」建立联系人档案</div>
          </div>
        )}
        {contacts.map((c) => (
          <div
            key={c.id}
            className="bds-card"
            style={{ padding: 'var(--space-3)' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  {c.isPrimary && (
                    <span className="bds-badge sm success">
                      主联系人
                    </span>
                  )}
                  {c.isDecisionMaker && (
                    <span className="bds-badge sm neutral">
                      <Star className="w-3 h-3" />
                      决策人
                    </span>
                  )}
                  <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[c.status === 'Active' ? 'active' : 'neutral']}`}>
                    {c.status === 'Active' ? '在职' : c.status === 'Left' ? '离职' : '非活跃'}
                  </span>
                </div>
                {c.title && <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{c.title}{c.department ? ` · ${c.department}` : ''}</div>}
                <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                  {c.email && <span>{c.email}</span>}
                  {c.mobile && <span>{c.mobile}</span>}
                  {c.wechat && <span>微信：{c.wechat}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== 信用额度 Tab ====================

function CreditLimitTab({
  activeCreditLimit,
  creditHistory,
  selectedRelation,
  onCreate,
  onUpdateStatus,
}: {
  activeCreditLimit: CreditLimit | null;
  creditHistory: CreditLimit[];
  selectedRelation: Relation;
  onCreate: () => void;
  onUpdateStatus: (id: string, status: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* 当前生效 */}
      <div className="flex items-center justify-between">
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>当前信用额度</h3>
        <button onClick={onCreate} className="bds-btn bds-btn-secondary">
          <Plus className="w-4 h-4" />
          设置信用额度
        </button>
      </div>

      {activeCreditLimit ? (
        <div className="bds-card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>总额度</div>
              <div className="bds-tnum text-lg mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {formatAmount(activeCreditLimit.totalLimit, activeCreditLimit.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>已用额度</div>
              <div
                className="bds-tnum text-lg mt-0.5"
                style={{ color: activeCreditLimit.usedAmount > activeCreditLimit.totalLimit ? 'var(--danger-text)' : 'var(--warning-text)' }}
              >
                {formatAmount(activeCreditLimit.usedAmount, activeCreditLimit.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>可用额度</div>
              <div className="bds-tnum text-lg mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {formatAmount(activeCreditLimit.totalLimit - activeCreditLimit.usedAmount, activeCreditLimit.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>状态</div>
              <div
                className="text-sm mt-0.5"
                style={{ color: activeCreditLimit.status === 'Active' ? 'var(--success-text)' : 'var(--text-secondary)' }}
              >
                {CREDIT_STATUS_LABELS[activeCreditLimit.status] || activeCreditLimit.status}
              </div>
            </div>
          </div>

          {/* 用量进度条（BDS Progress） */}
          <div className="mt-3">
            <div
              className={`bds-progress ${
                activeCreditLimit.usedAmount > activeCreditLimit.totalLimit
                  ? 'danger'
                  : activeCreditLimit.usedAmount / activeCreditLimit.totalLimit > 0.8
                  ? 'warning'
                  : 'success'
              }`}
            >
              <div
                className="fill"
                style={{ width: `${Math.min(100, (activeCreditLimit.usedAmount / activeCreditLimit.totalLimit) * 100)}%` }}
              />
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              用量 {((activeCreditLimit.usedAmount / activeCreditLimit.totalLimit) * 100).toFixed(1)}%
              {activeCreditLimit.usedAmount > activeCreditLimit.totalLimit && ' · 已超额！'}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>生效：{formatDate(activeCreditLimit.validFrom)}</span>
            <span>失效：{formatDate(activeCreditLimit.validTo)}</span>
            {activeCreditLimit.approvedBy && <span>审批：{activeCreditLimit.approvedBy}</span>}
          </div>

          {activeCreditLimit.status === 'Active' && (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => onUpdateStatus(activeCreditLimit.id, 'Frozen')}
                className="bds-btn bds-btn-secondary"
              >
                冻结
              </button>
              <button
                onClick={() => onUpdateStatus(activeCreditLimit.id, 'Revoked')}
                className="bds-btn bds-btn-danger"
              >
                撤销
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bds-card" style={{ padding: 0 }}>
          <div className="bds-empty">
            <div className="glyph"><CreditCard size={24} /></div>
            <div className="title">暂无生效信用额度</div>
          </div>
        </div>
      )}

      {/* 历史记录 */}
      {creditHistory.length > 1 && (
        <div>
          <h3 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>历史记录</h3>
          <div className="space-y-1">
            {creditHistory.map((cl) => (
              <div key={cl.id} className="flex items-center gap-3 text-xs rounded-compact px-3 py-2 bds-inset">
                <span className={`bds-badge sm ${cl.status === 'Active' ? 'success' : 'neutral'}`}>
                  {CREDIT_STATUS_LABELS[cl.status] || cl.status}
                </span>
                <span className="bds-tnum" style={{ color: 'var(--text-primary)' }}>额度 {formatAmount(cl.totalLimit, cl.currency)}</span>
                <span className="bds-tnum" style={{ color: 'var(--text-tertiary)' }}>已用 {formatAmount(cl.usedAmount, cl.currency)}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>{cl.validFrom} ~ {formatDate(cl.validTo)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 客户分层 Tab ====================

function CustomerTierTab({
  activeTier,
  tierHistory,
  selectedRelation,
  onCreate,
  onDelete,
}: {
  activeTier: CustomerTier | null;
  tierHistory: CustomerTier[];
  selectedRelation: Relation;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="bds-overline" style={{ color: 'var(--text-tertiary)' }}>当前分层</h3>
        <button onClick={onCreate} className="bds-btn bds-btn-secondary">
          <Award className="w-4 h-4" />
          评定分层
        </button>
      </div>

      {activeTier ? (
        <div className="bds-card">
          <div className="flex items-center gap-3">
            {(() => {
              const tierMeta = TIER_LEVELS.find((t) => t.id === activeTier.level);
              return (
                <span className={`bds-badge lg ${SEMANTIC_BADGE_VARIANT[tierMeta?.semantic || 'neutral']}`}>
                  {tierMeta?.label || activeTier.level}
                </span>
              );
            })()}
            <div className="flex-1">
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>客户分层已评定</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                评定日期 {formatDate(activeTier.evaluatedAt)} · 有效期至 {formatDate(activeTier.validUntil)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-3">
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>折扣率</div>
              <div className="bds-tnum text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {activeTier.discountRate ? `${activeTier.discountRate}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>账期天数</div>
              <div className="bds-tnum text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {activeTier.paymentTermsDays ? `${activeTier.paymentTermsDays} 天` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>信用优先级</div>
              <div
                className="text-sm mt-0.5"
                style={{ color: activeTier.creditPriority === 'High' ? 'var(--success-text)' : activeTier.creditPriority === 'Low' ? 'var(--danger-text)' : 'var(--text-secondary)' }}
              >
                {activeTier.creditPriority === 'High' ? '高' : activeTier.creditPriority === 'Low' ? '低' : '常规'}
              </div>
            </div>
          </div>

          {activeTier.criteria && (
            <div className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              评定依据：{activeTier.criteria}
            </div>
          )}

          <button
            className="mt-3 text-xs hover:underline"
            style={{ color: 'var(--danger-text)' }}
            onClick={() => onDelete(activeTier.id)}
          >
            删除此分层
          </button>
        </div>
      ) : (
        <div className="bds-card" style={{ padding: 0 }}>
          <div className="bds-empty">
            <div className="glyph"><Award size={24} /></div>
            <div className="title">暂无客户分层</div>
          </div>
        </div>
      )}

      {/* 历史 */}
      {tierHistory.length > 1 && (
        <div>
          <h3 className="bds-overline mb-2" style={{ color: 'var(--text-tertiary)' }}>分层历史</h3>
          <div className="space-y-1">
            {tierHistory.map((t) => {
              const tierMeta = TIER_LEVELS.find((tl) => tl.id === t.level);
              return (
                <div key={t.id} className="flex items-center gap-3 text-xs rounded-compact px-3 py-2 bds-inset">
                  <span className={`bds-badge sm ${SEMANTIC_BADGE_VARIANT[tierMeta?.semantic || 'neutral']}`}>
                    {tierMeta?.label || t.level}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{formatDate(t.evaluatedAt)} ~ {formatDate(t.validUntil)}</span>
                  {t.discountRate && <span className="bds-tnum" style={{ color: 'var(--text-tertiary)' }}>折扣 {t.discountRate}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 表单组件 ====================

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="bds-modal-mask"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bds-modal"
        style={{ width: '32rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="bds-text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="bds-btn bds-btn-ghost" style={{ padding: '0 var(--space-2)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputClass = "bds-input";
const textareaClass = "bds-input bds-textarea";

function OpportunityForm({
  opportunity,
  onSave,
  onClose,
}: {
  opportunity: Opportunity | null;
  onSave: (input: OpportunityInput, id?: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(opportunity?.title ?? '');
  const [amount, setAmount] = useState(opportunity?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState(opportunity?.currency ?? 'CNY');
  const [stage, setStage] = useState<OpportunityStage>(opportunity?.stage ?? 'Prospecting');
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate ?? '');
  const [source, setSource] = useState(opportunity?.source ?? '');
  const [salesRepName, setSalesRepName] = useState(opportunity?.salesRepName ?? '');
  const [description, setDescription] = useState(opportunity?.description ?? '');
  const [notes, setNotes] = useState(opportunity?.notes ?? '');

  const handleSubmit = () => {
    if (!title.trim() || !amount) {
      bdsToast.warning('请填写商机标题和金额');
      return;
    }
    onSave({
      title: title.trim(),
      amount: parseFloat(amount),
      currency,
      stage,
      expectedCloseDate: expectedCloseDate || undefined,
      source: source || undefined,
      salesRepName: salesRepName || undefined,
      description: description || undefined,
      notes: notes || undefined,
    }, opportunity?.id);
  };

  return (
    <ModalShell title={opportunity ? '编辑商机' : '新建商机'} onClose={onClose}>
      <Field label="商机标题 *">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2026 春季西装订单" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="预计金额 *">
          <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="币种">
          <select className="bds-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {!opportunity && (
        <Field label="初始阶段">
          <select className="bds-select" value={stage} onChange={(e) => setStage(e.target.value as OpportunityStage)}>
            {OPPORTUNITY_STAGES.filter((s) => s.id !== 'ClosedWon' && s.id !== 'ClosedLost').map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="预计成交日期">
          <CapsuleDateInput className="bds-input" value={expectedCloseDate} onChange={setExpectedCloseDate} />
        </Field>
        <Field label="商机来源">
          <input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="展会/转介绍/主动开发" />
        </Field>
      </div>
      <Field label="销售代表">
        <input className={inputClass} value={salesRepName} onChange={(e) => setSalesRepName(e.target.value)} />
      </Field>
      <Field label="描述">
        <textarea className={textareaClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">保存</button>
      </div>
    </ModalShell>
  );
}

function FollowUpForm({
  followUp,
  contacts,
  opportunities,
  onSave,
  onClose,
}: {
  followUp: FollowUpRecord | null;
  contacts: Contact[];
  opportunities: Opportunity[];
  onSave: (input: FollowUpInput, id?: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(followUp?.type ?? 'Call');
  const [content, setContent] = useState(followUp?.content ?? '');
  const [followUpAt, setFollowUpAt] = useState(followUp?.followUpAt ?? todayStr());
  const [contactId, setContactId] = useState(followUp?.contactId ?? '');
  const [nextFollowUpAt, setNextFollowUpAt] = useState(followUp?.nextFollowUpAt ?? '');
  const [nextFollowUpTopic, setNextFollowUpTopic] = useState(followUp?.nextFollowUpTopic ?? '');
  const [opportunityId, setOpportunityId] = useState(followUp?.opportunityId ?? '');
  const [salesRepName, setSalesRepName] = useState(followUp?.salesRepName ?? '');
  const [notes, setNotes] = useState(followUp?.notes ?? '');

  const handleSubmit = () => {
    if (!content.trim()) {
      bdsToast.warning('请填写跟进内容');
      return;
    }
    onSave({
      type,
      content: content.trim(),
      followUpAt,
      contactId: contactId || undefined,
      nextFollowUpAt: nextFollowUpAt || undefined,
      nextFollowUpTopic: nextFollowUpTopic || undefined,
      opportunityId: opportunityId || undefined,
      salesRepName: salesRepName || undefined,
      notes: notes || undefined,
    }, followUp?.id);
  };

  return (
    <ModalShell title={followUp ? '编辑跟进' : '新建跟进'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="跟进类型">
          <select className="bds-select" value={type} onChange={(e) => setType(e.target.value)}>
            {FOLLOWUP_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="跟进日期">
          <CapsuleDateInput className="bds-input" value={followUpAt} onChange={setFollowUpAt} />
        </Field>
      </div>
      <Field label="跟进内容 *">
        <textarea className={textareaClass} rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="沟通了什么..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="关联联系人">
          <select className="bds-select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">不关联</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="关联商机">
          <select className="bds-select" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
            <option value="">不关联</option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="下次跟进日期">
          <CapsuleDateInput className="bds-input" value={nextFollowUpAt} onChange={setNextFollowUpAt} />
        </Field>
        <Field label="下次跟进主题">
          <input className={inputClass} value={nextFollowUpTopic} onChange={(e) => setNextFollowUpTopic(e.target.value)} />
        </Field>
      </div>
      <Field label="销售代表">
        <input className={inputClass} value={salesRepName} onChange={(e) => setSalesRepName(e.target.value)} />
      </Field>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">保存</button>
      </div>
    </ModalShell>
  );
}

function CreditLimitForm({
  onSave,
  onClose,
}: {
  onSave: (input: CreditLimitInput) => void;
  onClose: () => void;
}) {
  const [totalLimit, setTotalLimit] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [validFrom, setValidFrom] = useState(todayStr());
  const [validTo, setValidTo] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!totalLimit) {
      bdsToast.warning('请填写信用额度');
      return;
    }
    onSave({
      totalLimit: parseFloat(totalLimit),
      currency,
      validFrom,
      validTo: validTo || undefined,
      approvedBy: approvedBy || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <ModalShell title="设置信用额度" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="信用额度 *">
          <input type="number" className={inputClass} value={totalLimit} onChange={(e) => setTotalLimit(e.target.value)} />
        </Field>
        <Field label="币种">
          <select className="bds-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="生效日期 *">
          <CapsuleDateInput className="bds-input" value={validFrom} onChange={setValidFrom} />
        </Field>
        <Field label="失效日期">
          <CapsuleDateInput className="bds-input" value={validTo} onChange={setValidTo} />
        </Field>
      </div>
      <Field label="审批人">
        <input className={inputClass} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
      </Field>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">保存</button>
      </div>
    </ModalShell>
  );
}

function CustomerTierForm({
  onSave,
  onClose,
}: {
  onSave: (input: CustomerTierInput) => void;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<CustomerTierLevel>('Silver');
  const [criteria, setCriteria] = useState('');
  const [discountRate, setDiscountRate] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('');
  const [creditPriority, setCreditPriority] = useState('Normal');
  const [evaluatedAt, setEvaluatedAt] = useState(todayStr());
  const [validUntil, setValidUntil] = useState('');
  const [evaluatedBy, setEvaluatedBy] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    onSave({
      level,
      criteria: criteria || undefined,
      discountRate: discountRate ? parseFloat(discountRate) : undefined,
      paymentTermsDays: paymentTermsDays ? parseInt(paymentTermsDays, 10) : undefined,
      creditPriority,
      evaluatedAt,
      validUntil: validUntil || undefined,
      evaluatedBy: evaluatedBy || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <ModalShell title="评定客户分层" onClose={onClose}>
      <Field label="分层等级">
        <select className="bds-select" value={level} onChange={(e) => setLevel(e.target.value as CustomerTierLevel)}>
          {TIER_LEVELS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="折扣率 (%)">
          <input type="number" className={inputClass} value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} placeholder="如 5.00" />
        </Field>
        <Field label="账期天数">
          <input type="number" className={inputClass} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="信用优先级">
          <select className="bds-select" value={creditPriority} onChange={(e) => setCreditPriority(e.target.value)}>
            <option value="High">高</option>
            <option value="Normal">常规</option>
            <option value="Low">低</option>
          </select>
        </Field>
        <Field label="评定日期 *">
          <CapsuleDateInput className="bds-input" value={evaluatedAt} onChange={setEvaluatedAt} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="有效期至">
          <CapsuleDateInput className="bds-input" value={validUntil} onChange={setValidUntil} />
        </Field>
        <Field label="评定人">
          <input className={inputClass} value={evaluatedBy} onChange={(e) => setEvaluatedBy(e.target.value)} />
        </Field>
      </div>
      <Field label="评定依据">
        <input className={inputClass} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="如：年采购额 > 100万" />
      </Field>
      <Field label="备注">
        <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="bds-btn bds-btn-ghost">取消</button>
        <button onClick={handleSubmit} className="bds-btn bds-btn-primary">保存</button>
      </div>
    </ModalShell>
  );
}
