/**
 * DetailPanel - 详情面板组件
 * 
 * 支持两种模式：组织信息 和 联系人信息。
 * 采用 Bambook OS 风格的大玻璃面板展示详细信息。
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Relation, RelationCategory, FollowUpRecord, BrandLine, CommunicationLog, CommunicationType, CommunicationDirection, Order, Quotation } from '../../types';
import { apiService } from '../../services/apiService';
import {
    Building2, User, Globe, Mail, Phone, MapPin,
    CreditCard, DollarSign, Calendar, Clock, MessageCircle,
    Edit2, Trash2, Star, Tag, Briefcase, Factory,
    Warehouse, Navigation, Languages, Cake, FileText,
    Hash, Banknote, Plus, Loader2, MessagesSquare, Layers,
    ShieldCheck, Ban, Power
} from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';
import CapsuleDateInput from './CapsuleDateInput';
import { bdsConfirm } from './BdsDialog';
import CustomSelect from './CustomSelect';
import { CompiledEdgeFade, CompiledSurfacePanel } from './primitives/compiledSurfacePrimitives';
import { RelatedEntitiesPanel } from '../RelatedEntitiesPanel';
import { RelatedWorkspacesSection } from './RelatedWorkspacesSection';
import AuditHistorySection from '../AuditHistorySection';
import { FinanceCreditPanel } from '../finance/FinanceCreditPanel';
import {
    CrmContactsSection, CrmFollowUpsSection, CrmOpportunitiesSection,
    CrmCreditLimitSection, CrmCustomerTierSection,
} from './crm/crmRelationSections';

interface DetailPanelProps {
    type: 'organization' | 'contact';
    data: Relation;
    organization?: Relation;  // 联系人模式下需要传入所属组织
    onEdit: () => void;
    onDelete: () => void;
    isDarkMode: boolean;
    /** 跨模块导航（关联业务入口 → 目标模块自动筛选为该档案数据） */
    onNavigate?: (view: import('../../types').View) => void;
}

// ═══ 分类感知详情布局（2026-08-22 全览评审裁决）═══
// 不同类别的组织只看自己语义正确的区块——政府机构没有付款条款/信用额度，
// 供应商没有品牌线（PRD 6.2 品牌线为客户 360° 专属），代理商/伙伴不是
// 销售漏斗对象。详情页与新建/编辑表单（RelationsManager）共用此配置。
export interface RelationCategoryDetailConfig {
    /** 财务信息区块（付款条款/币种/税号/信用额度）——商业交易对手才有 */
    finance: boolean;
    /** CRM 通用区块（联系人名片 + 跟进管理）——有业务往来的对象都适用 */
    crmCore: boolean;
    /** CRM 销售漏斗区块（商机/信用额度/客户分层）——客户专属 */
    crmSales: boolean;
    /** 品牌线（客户 360° 品牌档案，PRD 6.2）——客户专属 */
    brandLines: boolean;
    /** 信用控制面板（Track F 额度/冻结门禁）——客户专属 */
    creditControl: boolean;
    /** 关联业务跳转角色：按供需语义筛目标模块数据；null = 不显示入口 */
    workspaceRole: 'customer' | 'supplier' | null;
}

export const RELATION_CATEGORY_DETAIL_CONFIG: Record<RelationCategory, RelationCategoryDetailConfig> = {
    Customer:   { finance: true,  crmCore: true,  crmSales: true,  brandLines: true,  creditControl: true,  workspaceRole: 'customer' },
    Supplier:   { finance: true,  crmCore: true,  crmSales: false, brandLines: false, creditControl: false, workspaceRole: 'supplier' },
    Agent:      { finance: true,  crmCore: true,  crmSales: false, brandLines: false, creditControl: false, workspaceRole: null },
    Partner:    { finance: true,  crmCore: true,  crmSales: false, brandLines: false, creditControl: false, workspaceRole: null },
    Government: { finance: false, crmCore: false, crmSales: false, brandLines: false, creditControl: false, workspaceRole: null },
    Internal:   { finance: false, crmCore: true,  crmSales: false, brandLines: false, creditControl: false, workspaceRole: null },
    Other:      { finance: true,  crmCore: true,  crmSales: false, brandLines: false, creditControl: false, workspaceRole: null },
};

// 信息项组件
const InfoItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string | number | undefined;
    isDarkMode: boolean;
    isLink?: boolean;
}> = ({ icon, label, value, isDarkMode, isLink }) => {
    if (!value && value !== 0) return null;
    const brandTextClass = BAMBOOK_OS.tone.text.brandEmphasis;

    return (
        <div className="flex items-start gap-3 py-2">
            <div className={`mt-0.5 text-[var(--text-tertiary)]`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-light uppercase tracking-[0.18em] mb-0.5 text-[var(--text-tertiary)]`}>
                    {label}
                </p>
                {isLink ? (
                    <a
                        href={String(value).startsWith('http') ? String(value) : `https://${value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`bds-btn bds-btn-link text-sm font-light ${brandTextClass}`}
                    >
                        {value}
                    </a>
                ) : (
                    <p className={`text-sm font-light whitespace-pre-line text-[var(--text-primary)]`}>
                        {value}
                    </p>
                )}
            </div>
        </div>
    );
};

// 信息区块组件
const InfoSection: React.FC<{
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    isDarkMode: boolean;
}> = ({ title, icon, children, isDarkMode }) => {
    const sectionDividerClass = BAMBOOK_OS.tone.divider.section;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative"
        >
            <CompiledSurfacePanel
                as="section"
                isDarkMode={isDarkMode}
                materialRole="insetSurface"
                materialTone="nested"
                className="p-3.5 !rounded-inset"
                contentClassName="relative z-10"
                compilerRole="relation-detail-section-panel"
                source="DetailPanel.InfoSection"
            >
                <div className={`flex items-center gap-2 mb-2.5 pb-2 border-b ${sectionDividerClass}`}>
                    <span className="text-[var(--text-secondary)]">{icon}</span>
                    <h4 className={`text-xs font-light uppercase tracking-[0.18em] text-[var(--text-primary)]`}>
                        {title}
                    </h4>
                </div>
                <div className="space-y-0.5">
                    {children}
                </div>
            </CompiledSurfacePanel>
        </motion.div>
    );
};

const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
    Visit: '拜访',
    Call: '电话',
    Email: '邮件',
    WeChat: '微信',
    Meeting: '会议',
    Other: '其他',
};

// ── 阶段 P3b：沟通日志类型/方向可读化（PRD 12.3）──
const COMM_TYPE_LABELS: Record<string, string> = {
    Email: '邮件',
    Call: '电话',
    WeChat: '微信',
    Visit: '拜访',
    Meeting: '会议',
    Other: '其他',
};
const COMM_TYPES: CommunicationType[] = ['Email', 'Call', 'WeChat', 'Visit', 'Meeting', 'Other'];
const COMM_DIRECTION_LABELS: Record<string, string> = {
    Inbound: '客户发起',
    Outbound: '我方发起',
};

const DetailPanel: React.FC<DetailPanelProps> = ({
    type,
    data,
    organization,
    onEdit,
    onDelete,
    isDarkMode,
    onNavigate,
}) => {
    const isOrg = type === 'organization';
    const [followUps, setFollowUps] = useState<FollowUpRecord[] | null>(null);

    // ── 阶段 P3b：品牌线（组织专属）与沟通日志（全渠道流水）状态 ──
    const [brandLines, setBrandLines] = useState<BrandLine[] | null>(null);
    const [commLogs, setCommLogs] = useState<CommunicationLog[] | null>(null);
    const [brandLineForm, setBrandLineForm] = useState({ name: '', code: '' });
    // C3 沟通日志表单补全：方向（客户发起/我方发起）+ 主题 + 关联订单/报价
    const [commLogForm, setCommLogForm] = useState({
        type: 'Email' as CommunicationType,
        direction: 'Outbound' as CommunicationDirection,
        occurredAt: new Date().toISOString().slice(0, 10),
        subject: '',
        summary: '',
        orderId: '',
        quotationId: '',
    });
    // C3 关联单证下拉数据源（订单/报价挂在组织维度；联系人布局取所属组织）
    const [commLinkOrders, setCommLinkOrders] = useState<Order[]>([]);
    const [commLinkQuotations, setCommLinkQuotations] = useState<Quotation[]>([]);
    const [brandLineBusy, setBrandLineBusy] = useState(false);
    const [commLogBusy, setCommLogBusy] = useState(false);
    const [p3bError, setP3bError] = useState<string | null>(null);

    // 互动历史：CRM 跟进记录（FollowUpRecord）为单一真源，按当前 Relation 拉取
    useEffect(() => {
        let cancelled = false;
        setFollowUps(null);
        apiService.listFollowUps(data.id, { limit: 5, includeCompleted: true })
            .then(items => { if (!cancelled) setFollowUps(items); })
            .catch(() => { if (!cancelled) setFollowUps([]); });
        return () => { cancelled = true; };
    }, [data.id]);

    // 品牌线：仅组织布局且分类配置开启时拉取（PRD 6.2 客户 360° 品牌线档案——
    // 供应商/政府等无品牌线语义，不渲染也不发请求）
    // C4：includeInactive——停用切换需要看到已停用行（否则停用即消失，无法恢复启用）
    useEffect(() => {
        if (!isOrg || !RELATION_CATEGORY_DETAIL_CONFIG[data.category]?.brandLines) return;
        let cancelled = false;
        setBrandLines(null);
        apiService.listBrandLines(data.id, { includeInactive: true })
            .then(items => { if (!cancelled) setBrandLines(items); })
            .catch(() => { if (!cancelled) setBrandLines([]); });
        return () => { cancelled = true; };
    }, [data.id, isOrg, data.category]);

    // 沟通日志：relation 级全渠道流水（PRD 12.3），组织/联系人布局共用
    useEffect(() => {
        let cancelled = false;
        setCommLogs(null);
        apiService.listCommLogs(data.id, { limit: 10 })
            .then(items => { if (!cancelled) setCommLogs(items); })
            .catch(() => { if (!cancelled) setCommLogs([]); });
        return () => { cancelled = true; };
    }, [data.id]);

    // C3 沟通日志关联单证下拉：订单/报价挂在组织维度——联系人布局取所属组织 id
    const commLinkRelationId = isOrg ? data.id : (organization?.id ?? null);
    useEffect(() => {
        if (!commLinkRelationId) return;
        let cancelled = false;
        apiService.listOrders()
            .then(items => { if (!cancelled) setCommLinkOrders(items.filter(o => o.customerRelationId === commLinkRelationId && !o.deletedAt)); })
            .catch(() => { if (!cancelled) setCommLinkOrders([]); });
        apiService.listQuotations({ customerRelationId: commLinkRelationId, limit: 100 })
            .then(res => { if (!cancelled) setCommLinkQuotations(res.items); })
            .catch(() => { if (!cancelled) setCommLinkQuotations([]); });
        return () => { cancelled = true; };
    }, [commLinkRelationId]);

    const handleAddBrandLine = async () => {
        const name = brandLineForm.name.trim();
        if (!name || brandLineBusy) return;
        setBrandLineBusy(true);
        setP3bError(null);
        try {
            const item = await apiService.createBrandLine(data.id, { name, code: brandLineForm.code.trim() || undefined });
            setBrandLines(prev => [item, ...(prev ?? [])]);
            setBrandLineForm({ name: '', code: '' });
        } catch (e: any) {
            setP3bError(`品牌线添加失败：${e?.message || e}`);
        } finally {
            setBrandLineBusy(false);
        }
    };

    const handleDeleteBrandLine = async (id: string) => {
        if (brandLineBusy) return;
        // E1：删除确认统一走 bdsConfirm（破坏性操作 danger 语义）
        if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此品牌线？', danger: true }))) return;
        setBrandLineBusy(true);
        setP3bError(null);
        try {
            await apiService.deleteBrandLine(id);
            setBrandLines(prev => (prev ?? []).filter(bl => bl.id !== id));
        } catch (e: any) {
            setP3bError(`品牌线删除失败：${e?.message || e}`);
        } finally {
            setBrandLineBusy(false);
        }
    };

    // C4 品牌线启用/停用切换（数据模型 isActive 已支持，服务端 updateBrandLine 直通）
    const handleToggleBrandLine = async (bl: BrandLine) => {
        if (brandLineBusy) return;
        setBrandLineBusy(true);
        setP3bError(null);
        try {
            const updated = await apiService.updateBrandLine(bl.id, { isActive: !bl.isActive });
            setBrandLines(prev => (prev ?? []).map(x => (x.id === updated.id ? updated : x)));
        } catch (e: any) {
            setP3bError(`品牌线${bl.isActive ? '停用' : '启用'}失败：${e?.message || e}`);
        } finally {
            setBrandLineBusy(false);
        }
    };

    const handleAddCommLog = async () => {
        const summary = commLogForm.summary.trim();
        if (!summary || !commLogForm.occurredAt || commLogBusy) return;
        setCommLogBusy(true);
        setP3bError(null);
        try {
            const item = await apiService.createCommLog(data.id, {
                type: commLogForm.type,
                direction: commLogForm.direction,
                subject: commLogForm.subject.trim() || undefined,
                summary,
                occurredAt: commLogForm.occurredAt,
                orderId: commLogForm.orderId || undefined,
                quotationId: commLogForm.quotationId || undefined,
            });
            setCommLogs(prev => [item, ...(prev ?? [])]);
            setCommLogForm({ type: 'Email', direction: 'Outbound', occurredAt: new Date().toISOString().slice(0, 10), subject: '', summary: '', orderId: '', quotationId: '' });
        } catch (e: any) {
            setP3bError(`沟通日志添加失败：${e?.message || e}`);
        } finally {
            setCommLogBusy(false);
        }
    };

    const handleDeleteCommLog = async (id: string) => {
        if (commLogBusy) return;
        // E1：删除确认统一走 bdsConfirm（破坏性操作 danger 语义）
        if (!(await bdsConfirm({ title: '确认删除', body: '确认删除此沟通日志？', danger: true }))) return;
        setCommLogBusy(true);
        setP3bError(null);
        try {
            await apiService.deleteCommLog(id);
            setCommLogs(prev => (prev ?? []).filter(cl => cl.id !== id));
        } catch (e: any) {
            setP3bError(`沟通日志删除失败：${e?.message || e}`);
        } finally {
            setCommLogBusy(false);
        }
    };

    const actionButtonClass = BAMBOOK_OS.controls.actionControl.bordered;
    const brandTextClass = BAMBOOK_OS.tone.text.brandEmphasis;
    const dataChipClass = BAMBOOK_OS.tone.chip.data;
    const accentChipClass = BAMBOOK_OS.tone.chip.accent;
    const detailMaterialClass = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-outer-panel`;
    const inlinePanelClass = `${detailMaterialClass} bambook-tertiary-surface !rounded-control relative isolate overflow-hidden`;
    const panelDividerClass = BAMBOOK_OS.tone.divider.panel;
    const detailScrollRef = useRef<HTMLDivElement | null>(null);

    // 互动历史区块（组织/联系人两种布局共用，真源：CRM FollowUpRecord）
    const interactionHistorySection = (
        <InfoSection title="互动历史" icon={<Calendar size={14} />} isDarkMode={isDarkMode}>
            <div className={`text-sm text-[var(--text-tertiary)]`}>
                <div className="flex items-center gap-2 mb-2">
                    <Calendar size={14} />
                    <span>最近互动: {new Date(data.lastInteraction).toLocaleDateString('zh-CN')}</span>
                </div>
                {followUps === null ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>加载中…</p>
                ) : followUps.length === 0 ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>暂无跟进记录，可在 CRM 模块添加</p>
                ) : (
                    <ul className="space-y-1.5">
                        {followUps.map(fu => (
                            <li key={fu.id} className={`text-xs leading-5 text-[var(--text-secondary)]`}>
                                <span className={`inline-block px-1.5 py-0.5 rounded-bds-sm mr-1.5 text-[10px] ${dataChipClass}`}>
                                    {FOLLOW_UP_TYPE_LABELS[fu.type] ?? fu.type}
                                </span>
                                <span className="text-[var(--text-tertiary)]">{fu.followUpAt}</span>
                                <span className="mx-1">·</span>
                                <span className="break-all">{fu.content}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </InfoSection>
    );

    // ── 阶段 P3b：品牌线区块（PRD 6.2，仅组织布局）──
    const brandLinesSection = isOrg ? (
        <InfoSection title="品牌线" icon={<Layers size={14} />} isDarkMode={isDarkMode}>
            <div className={`text-sm text-[var(--text-tertiary)]`}>
                {brandLines === null ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>加载中…</p>
                ) : brandLines.length === 0 ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>暂无品牌线档案</p>
                ) : (
                    <ul className="space-y-1.5">
                        {brandLines.map(bl => (
                            <li key={bl.id} className={`group flex items-center gap-1.5 text-xs leading-5 text-[var(--text-secondary)]`}>
                                <span className="break-all">{bl.name}</span>
                                {bl.code && (
                                    <span className={`inline-block px-1.5 py-0.5 rounded-bds-sm text-[10px] ${dataChipClass}`}>{bl.code}</span>
                                )}
                                {!bl.isActive && (
                                    <span className={`text-[10px] text-[var(--text-tertiary)]`}>已停用</span>
                                )}
                                {/* C4 启用/停用切换（hover 显现，动作组首个按钮 ml-auto 推到行尾） */}
                                <button
                                    type="button"
                                    onClick={() => handleToggleBrandLine(bl)}
                                    disabled={brandLineBusy}
                                    className={`ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
                                    title={bl.isActive ? '停用品牌线' : '启用品牌线'}
                                >
                                    {bl.isActive ? <Ban size={14} /> : <Power size={14} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteBrandLine(bl.id)}
                                    disabled={brandLineBusy}
                                    className={`opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
                                    title="删除品牌线"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {/* 内联添加表单（同客户下 name 唯一，服务端校验） */}
                <div className="flex items-center gap-1.5 mt-2">
                    <input
                        value={brandLineForm.name}
                        onChange={e => setBrandLineForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="品牌线名称"
                        className={`flex-1 min-w-0 px-2 py-1 rounded-control text-xs font-light outline-none border bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]`}
                    />
                    <input
                        value={brandLineForm.code}
                        onChange={e => setBrandLineForm(prev => ({ ...prev, code: e.target.value }))}
                        placeholder="编码(可选)"
                        className={`w-20 px-2 py-1 rounded-control text-xs font-light outline-none border bg-[var(--recessed-bg)] border-[var(--border-c-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]`}
                    />
                    <button
                        type="button"
                        onClick={handleAddBrandLine}
                        disabled={brandLineBusy || !brandLineForm.name.trim()}
                        className={`shrink-0 h-6 w-6 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 bg-[var(--recessed-bg)] hover:bg-[var(--active-darken)] text-[var(--text-secondary)]`}
                        title="添加品牌线"
                    >
                        {brandLineBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                </div>
            </div>
        </InfoSection>
    ) : null;

    // ── 阶段 P3b：沟通日志区块（PRD 12.3 全渠道沟通流水，组织/联系人布局共用）──
    const commLogsSection = (
        <InfoSection title="沟通日志" icon={<MessagesSquare size={14} />} isDarkMode={isDarkMode}>
            <div className={`text-sm text-[var(--text-tertiary)]`}>
                {commLogs === null ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>加载中…</p>
                ) : commLogs.length === 0 ? (
                    <p className={`text-xs text-[var(--text-tertiary)]`}>暂无沟通记录</p>
                ) : (
                    <ul className="space-y-1.5">
                        {commLogs.map(cl => (
                            <li key={cl.id} className={`group flex items-baseline gap-1.5 text-xs leading-5 text-[var(--text-secondary)]`}>
                                <span className={`inline-block px-1.5 py-0.5 rounded-bds-sm text-[10px] shrink-0 ${dataChipClass}`}>
                                    {COMM_TYPE_LABELS[cl.type] ?? cl.type}
                                </span>
                                {/* C3：方向可读化（客户发起/我方发起，PRD 12.3） */}
                                <span className={`inline-block px-1.5 py-0.5 rounded-bds-sm text-[10px] shrink-0 ${dataChipClass}`}>
                                    {COMM_DIRECTION_LABELS[cl.direction] ?? cl.direction}
                                </span>
                                <span className={`shrink-0 text-[var(--text-tertiary)]`}>{cl.occurredAt}</span>
                                {cl.subject && (
                                    <span className={`shrink-0 text-[var(--text-primary)]`}>{cl.subject}</span>
                                )}
                                <span className="break-all">{cl.summary}</span>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteCommLog(cl.id)}
                                    disabled={commLogBusy}
                                    className={`ml-auto self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]`}
                                    title="删除沟通日志"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {/* 内联添加表单（C3 补全：类型 + 方向 + 日期 + 摘要 / 主题 + 关联订单/报价）
                    2026-08-31 W4 原生浮层收编：select 全部切 CustomSelect 自绘浮层 */}
                <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                        <CustomSelect
                            className="w-24 shrink-0"
                            size="compact"
                            ariaLabel="沟通类型"
                            options={COMM_TYPES.map(t => ({ value: t, label: COMM_TYPE_LABELS[t] }))}
                            value={commLogForm.type}
                            onChange={v => setCommLogForm(prev => ({ ...prev, type: v as CommunicationType }))}
                        />
                        <CustomSelect
                            className="w-24 shrink-0"
                            size="compact"
                            ariaLabel="沟通方向"
                            options={(['Inbound', 'Outbound'] as CommunicationDirection[]).map(d => ({ value: d, label: COMM_DIRECTION_LABELS[d] }))}
                            value={commLogForm.direction}
                            onChange={v => setCommLogForm(prev => ({ ...prev, direction: v as CommunicationDirection }))}
                        />
                        <CapsuleDateInput
                            value={commLogForm.occurredAt}
                            onChange={v => setCommLogForm(prev => ({ ...prev, occurredAt: v }))}
                            className="bds-input sm shrink-0"
                        />
                        <input
                            value={commLogForm.summary}
                            onChange={e => setCommLogForm(prev => ({ ...prev, summary: e.target.value }))}
                            placeholder="沟通摘要"
                            className={`flex-1 min-w-0 bds-input sm`}
                        />
                        <button
                            type="button"
                            onClick={handleAddCommLog}
                            disabled={commLogBusy || !commLogForm.summary.trim()}
                            className={`shrink-0 h-6 w-6 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 bg-[var(--recessed-bg)] hover:bg-[var(--active-darken)] text-[var(--text-secondary)]`}
                            title="添加沟通日志"
                        >
                            {commLogBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <input
                            value={commLogForm.subject}
                            onChange={e => setCommLogForm(prev => ({ ...prev, subject: e.target.value }))}
                            placeholder="主题(可选)"
                            className={`flex-1 min-w-0 bds-input sm`}
                        />
                        <CustomSelect
                            className="w-40 shrink-0"
                            size="compact"
                            ariaLabel="关联订单"
                            options={[
                                { value: '', label: '不关联订单' },
                                ...commLinkOrders.map(o => ({ value: o.id, label: `${o.poNumber || o.id}${o.product ? ` · ${o.product}` : ''}` })),
                            ]}
                            value={commLogForm.orderId}
                            onChange={v => setCommLogForm(prev => ({ ...prev, orderId: v }))}
                        />
                        <CustomSelect
                            className="w-36 shrink-0"
                            size="compact"
                            ariaLabel="关联报价"
                            options={[
                                { value: '', label: '不关联报价' },
                                ...commLinkQuotations.map(q => ({ value: q.id, label: q.quotationNumber })),
                            ]}
                            value={commLogForm.quotationId}
                            onChange={v => setCommLogForm(prev => ({ ...prev, quotationId: v }))}
                        />
                    </div>
                </div>
            </div>
        </InfoSection>
    );

    // P3b 操作错误提示（品牌线/沟通日志共用，轻量行内提示）
    const p3bErrorSection = p3bError ? (
        <p className="text-xs text-os-adaptive-danger">{p3bError}</p>
    ) : null;

    // 分类感知布局配置（2026-08-22 全览评审：不同类别只看语义正确的区块）
    const categoryConfig = RELATION_CATEGORY_DETAIL_CONFIG[data.category] ?? RELATION_CATEGORY_DETAIL_CONFIG.Other;

    // 跨模块关联（产品化 Links）：
    //   组织 → 关联业务导航枢纽（点击跳目标模块并自动筛选为该客户/供应商的数据）；
    //   联系人 → 保留图谱关联视图（联系人的业务踪迹经组织聚合，导航入口在组织侧）。
    //   workspaceRole=null（代理商/伙伴/政府/内部）无供需语义——不显示跳转入口，
    //   避免按错误角色（此前一律按 customer）筛选目标模块数据。
    const relatedEntitiesSection = isOrg ? (
        categoryConfig.workspaceRole ? (
            <RelatedWorkspacesSection
                relationId={data.id}
                relationName={data.chineseName || data.englishName || data.name}
                relationRole={categoryConfig.workspaceRole}
                onNavigate={onNavigate}
                isDarkMode={isDarkMode}
            />
        ) : null
    ) : (
        <RelatedEntitiesPanel
            type="relation.contact"
            additionalTypes={['relation.person']}
            id={data.id}
            isDarkMode={isDarkMode}
            title="关联视图"
        />
    );

    // 阶段 D / D6：变更历史（实体审计，组织/联系人两种布局共用；Relation targetType 统一为 'Relation'）
    const auditHistorySection = (
        <AuditHistorySection
            targetType="Relation"
            targetId={data.id}
            isDarkMode={isDarkMode}
            title="变更历史"
        />
    );

    return (
        <div className={BAMBOOK_OS.layout.relationsDetailMainShellClass}>
        <CompiledSurfacePanel
            isDarkMode={isDarkMode}
            className="h-full flex flex-col"
            contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"
            compilerRole="relation-detail-main-panel"
            source="DetailPanel.MainPanel"
        >
            {/* Header 随详情内容一并滚动（与开发/货运/财务详情同一范式）：标题+操作区不再固定，把完整高度让给详情内容 */}
            <CompiledEdgeFade scrollRef={detailScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={64} bottomHeight={72} source="DetailPanel.edgeFade" />
            <div ref={detailScrollRef} className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-detail-panel-shadow-viewport`}>
            <div className={`p-5 border-b ${panelDividerClass}`}>
                <div className="flex items-center gap-4">
                    {/* 图标 */}
                    {isOrg ? (
                        <Building2 size={24} strokeWidth={1.5} className={`shrink-0 ${brandTextClass}`} />
                    ) : (
                        <User size={24} strokeWidth={1.5} className={`shrink-0 ${brandTextClass}`} />
                    )}

                    {/* 基本信息 */}
                    <div className="flex-1 min-w-0">
                        <h2 className={`text-lg font-light truncate text-[var(--text-primary)]`}>
                            {data.name}
                        </h2>
                        <div className="flex items-center gap-3 mt-1.5">
                            {isOrg ? (
                                <>
                                    <span className={`text-xs font-light text-[var(--text-secondary)]`}>
                                        {data.type}
                                    </span>
                                    <span className={`flex items-center gap-1 text-xs font-light ${brandTextClass}`}>
                                        Tier {data.rating}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className={`flex items-center gap-1 text-xs font-light text-[var(--text-secondary)]`}>
                                        <Briefcase size={14} /> {data.role || '未设置职位'}
                                    </span>
                                    {data.department && (
                                        <span className={`text-xs text-[var(--text-tertiary)]`}>
                                            · {data.department}
                                        </span>
                                    )}
                                </>
                            )}
                        </div>

                        {/* 标签 */}
                        {data.tags && data.tags.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                                {data.tags.slice(0, 4).map(tag => (
                                    <span
                                        key={tag}
                                        className={`
                      min-w-0 max-w-full truncate px-2 py-0.5 rounded-full text-[10px] font-light
                      ${dataChipClass}
                    `}
                                    >
                                        {tag}
                                    </span>
                                ))}
                                {data.tags.length > 4 && (
                                    <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
                                        +{data.tags.length - 4}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2 shrink-0">
                        <button
                            onClick={onEdit}
                            className={`
                h-9 px-3 rounded-control border flex items-center gap-2 text-xs font-light transition-colors duration-200
                ${actionButtonClass}
              `}
                        >
                            <Edit2 size={14} /> 编辑
                        </button>
                    </div>
                </div>
            </div>

            {/* 内容区域 - 可滚动（头部已并入本滚动容器） */}
            <div className="px-5 pt-5 pb-8 space-y-3">
                {isOrg ? (
                    // ========== 组织信息布局 ==========
                    <>
                        {/* 联系方式 */}
                        <InfoSection title="联系方式" icon={<Phone size={14} />} isDarkMode={isDarkMode}>
                            <InfoItem icon={<Globe size={14} />} label="公司官网" value={data.website} isDarkMode={isDarkMode} isLink />
                            <InfoItem icon={<Mail size={14} />} label="主要邮箱" value={data.contactInfo} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Phone size={14} />} label="联系电话" value={data.phone} isDarkMode={isDarkMode} />
                        </InfoSection>

                        {/* 地址信息 */}
                        <InfoSection title="地址信息" icon={<MapPin size={14} />} isDarkMode={isDarkMode}>
                            <InfoItem icon={<Building2 size={14} />} label="注册地址" value={data.officialAddress} isDarkMode={isDarkMode} />
                            <InfoItem icon={<FileText size={14} />} label="Bill To / 账单地址" value={data.billingAddress} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Navigation size={14} />} label="Ship To / 发货地址" value={data.shippingAddress} isDarkMode={isDarkMode} />

                            {data.factoryAddresses && data.factoryAddresses.length > 0 && (
                                <div className="py-2">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Factory size={14} className="text-[var(--text-tertiary)]" />
                                        <p className={`text-[10px] font-light uppercase tracking-[0.18em] text-[var(--text-tertiary)]`}>
                                            工厂地址 ({data.factoryAddresses.length})
                                        </p>
                                    </div>
                                    <div className="space-y-2 ml-6">
                                        {data.factoryAddresses.map((addr, idx) => (
                                            <div
                                                key={idx}
                                                className={`
                          p-3 rounded-control text-sm font-light
                          ${inlinePanelClass}
                        `}
                                            >
                                                <span className={`relative z-10 text-[10px] font-light mr-2 ${brandTextClass}`}>
                                                    #{idx + 1}
                                                </span>
                                                <span className="relative z-10">{addr}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <InfoItem icon={<Warehouse size={14} />} label="仓库地址" value={data.warehouseAddress} isDarkMode={isDarkMode} />

                            {data.coordinates && (
                                <div className="flex items-center gap-2 py-2">
                                    <Navigation size={14} className="text-[var(--text-tertiary)]" />
                                    <span className={`text-[10px] font-mono text-[var(--text-tertiary)]`}>
                                        {data.coordinates.lat.toFixed(6)}, {data.coordinates.lng.toFixed(6)}
                                    </span>
                                </div>
                            )}
                        </InfoSection>

                        {/* 财务信息（分类感知：商业交易对手专属——政府机构/内部组织无付款条款语义） */}
                        {categoryConfig.finance && (
                            <InfoSection title="财务信息" icon={<DollarSign size={14} />} isDarkMode={isDarkMode}>
                                <InfoItem icon={<CreditCard size={14} />} label="付款条款" value={data.paymentTerms} isDarkMode={isDarkMode} />
                                <InfoItem icon={<Banknote size={14} />} label="付款偏好" value={data.paymentPreference} isDarkMode={isDarkMode} />
                                <InfoItem icon={<DollarSign size={14} />} label="交易币种" value={data.currency} isDarkMode={isDarkMode} />
                                <InfoItem icon={<Hash size={14} />} label="税号" value={data.taxId} isDarkMode={isDarkMode} />
                                {data.creditLimit !== undefined && data.creditLimit > 0 && (
                                    <InfoItem
                                        icon={<CreditCard size={14} />}
                                        label="信用额度"
                                        value={`$${data.creditLimit.toLocaleString()}`}
                                        isDarkMode={isDarkMode}
                                    />
                                )}
                            </InfoSection>
                        )}

                        {/* 备注与偏好 */}
                        {data.preferences && (
                            <InfoSection title="备注与偏好" icon={<FileText size={14} />} isDarkMode={isDarkMode}>
                                <p className={`text-sm leading-relaxed text-[var(--text-secondary)]`}>
                                    {data.preferences}
                                </p>
                            </InfoSection>
                        )}

                        {/* 阶段 C1：结构化 CRM 区块（组织布局，分类感知）—
                            crmCore（联系人名片/跟进）：有业务往来的对象通用；
                            crmSales（商机/信用额度/客户分层）：销售漏斗语义，客户专属 */}
                        {categoryConfig.crmCore && (
                            <CrmContactsSection relationId={data.id} isDarkMode={isDarkMode} />
                        )}
                        {categoryConfig.crmCore && (
                            <CrmFollowUpsSection relationId={data.id} isDarkMode={isDarkMode} />
                        )}
                        {categoryConfig.crmSales && (
                            <CrmOpportunitiesSection relationId={data.id} isDarkMode={isDarkMode} />
                        )}
                        {categoryConfig.crmSales && (
                            <CrmCreditLimitSection relationId={data.id} isDarkMode={isDarkMode} />
                        )}
                        {categoryConfig.crmSales && (
                            <CrmCustomerTierSection relationId={data.id} isDarkMode={isDarkMode} />
                        )}

                        {/* 信用控制联动（Track F，分类感知）：客户档案详情内嵌信用面板 —— 额度/占用/冻结门禁/CreditLimitHistory 时间线 */}
                        {(categoryConfig.creditControl || data.type === 'Customer') && (
                            <InfoSection title="信用控制 Credit Control" icon={<ShieldCheck size={14} />} isDarkMode={isDarkMode}>
                                <FinanceCreditPanel
                                    embedded
                                    isDarkMode={isDarkMode}
                                    relations={[data]}
                                    customerId={data.id}
                                />
                            </InfoSection>
                        )}

                        {/* 阶段 P3b：品牌线（PRD 6.2 客户 360° 专属，分类感知：供应商/政府等无品牌线语义） */}
                        {categoryConfig.brandLines && brandLinesSection}

                        {/* 阶段 P3b：沟通日志（PRD 12.3 全渠道流水） */}
                        {commLogsSection}

                        {p3bErrorSection}

                        {/* 跨模块关联视图（EntityLink 图谱） */}
                        {relatedEntitiesSection}

                        {/* 变更历史（实体审计） */}
                        {auditHistorySection}
                    </>
                ) : (
                    // ========== 联系人信息布局 ==========
                    <>
                        {/* 所属组织 */}
                        {organization && (
                            <InfoSection title="所属组织" icon={<Building2 size={14} />} isDarkMode={isDarkMode}>
                                <InfoItem icon={<Building2 size={14} />} label="组织" value={organization.name} isDarkMode={isDarkMode} />
                            </InfoSection>
                        )}

                        {/* 联系方式 */}
                        <InfoSection title="联系方式" icon={<Phone size={14} />} isDarkMode={isDarkMode}>
                            <InfoItem icon={<Mail size={14} />} label="邮箱" value={data.email || data.contactInfo} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Phone size={14} />} label="座机" value={data.phone} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Phone size={14} />} label="手机" value={data.mobile} isDarkMode={isDarkMode} />
                            <InfoItem icon={<MessageCircle size={14} />} label="微信" value={data.wechat} isDarkMode={isDarkMode} />
                            <InfoItem icon={<MessageCircle size={14} />} label="WhatsApp" value={data.whatsapp} isDarkMode={isDarkMode} />
                            {(data.otherContacts as Array<{type: string; value: string}> || []).map((oc, i) => (
                              <InfoItem key={i} icon={<MessageCircle size={14} />} label={oc.type} value={oc.value} isDarkMode={isDarkMode} />
                            ))}
                        </InfoSection>

                        {/* 个人信息 */}
                        <InfoSection title="个人信息" icon={<User size={14} />} isDarkMode={isDarkMode}>
                            <InfoItem icon={<Briefcase size={14} />} label="部门" value={data.department} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Briefcase size={14} />} label="职务" value={data.role} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Cake size={14} />} label="生日" value={data.birthday} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Languages size={14} />} label="语言偏好" value={data.language} isDarkMode={isDarkMode} />
                            <InfoItem icon={<Clock size={14} />} label="时区" value={data.timezone} isDarkMode={isDarkMode} />
                        </InfoSection>

                        {/* AI 标签 */}
                        {(data.tags || []).length > 0 && (
                          <InfoSection title="AI 标签" icon={<Tag size={14} />} isDarkMode={isDarkMode}>
                            <div className="flex flex-wrap gap-1.5">
                              {(data.tags || []).map((tag: string, i: number) => (
                                <span key={i} className={`px-2 py-0.5 rounded-bds-sm text-xs font-light ${accentChipClass}`}>{tag}</span>
                              ))}
                            </div>
                          </InfoSection>
                        )}

                        {/* 个人简介 */}
                        {data.personalNote && (
                            <InfoSection title="个人备注" icon={<FileText size={14} />} isDarkMode={isDarkMode}>
                                <p className={`text-sm leading-relaxed text-[var(--text-secondary)]`}>
                                    {data.personalNote}
                                </p>
                            </InfoSection>
                        )}

                        {/* 互动历史（CRM 跟进记录） */}
                        {interactionHistorySection}

                        {/* 阶段 P3b：沟通日志（PRD 12.3 全渠道流水） */}
                        {commLogsSection}

                        {p3bErrorSection}

                        {/* 跨模块关联视图（EntityLink 图谱） */}
                        {relatedEntitiesSection}

                        {/* 变更历史（实体审计） */}
                        {auditHistorySection}
                    </>
                )}

                {/* 删除按钮 */}
                <div className="pt-4">
                    <button
                        onClick={onDelete}
                        className={`
              w-full h-9 rounded-control flex items-center justify-center gap-2 text-xs font-light uppercase tracking-wider transition-colors duration-200
              text-[var(--text-tertiary)] hover:bg-[var(--recessed-bg-hover)]
            `}
                    >
                        <Trash2 size={14} />
                        删除{isOrg ? '组织' : '联系人'}
                    </button>
                </div>
            </div>
            </div>
        </CompiledSurfacePanel>
        </div>
    );
};

export default DetailPanel;
