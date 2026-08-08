/**
 * DetailPanel - 详情面板组件
 * 
 * 支持两种模式：组织信息 和 联系人信息。
 * 采用 Bambook OS 风格的大玻璃面板展示详细信息。
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Relation, FollowUpRecord, BrandLine, CommunicationLog, CommunicationType } from '../../types';
import { apiService } from '../../services/apiService';
import {
    Building2, User, Globe, Mail, Phone, MapPin,
    CreditCard, DollarSign, Calendar, Clock, MessageCircle,
    Edit2, Trash2, Star, Tag, Briefcase, Factory,
    Warehouse, Navigation, Languages, Cake, FileText,
    Hash, Banknote, Plus, Loader2, MessagesSquare, Layers
} from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';
import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives';
import { RelatedEntitiesPanel } from '../RelatedEntitiesPanel';
import AuditHistorySection from '../AuditHistorySection';
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
}

// 信息项组件
const InfoItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string | number | undefined;
    isDarkMode: boolean;
    isLink?: boolean;
}> = ({ icon, label, value, isDarkMode, isLink }) => {
    if (!value && value !== 0) return null;
    const brandTextClass = isDarkMode
        ? BAMBOOK_OS.tone.text.brandDark
        : BAMBOOK_OS.tone.text.brandLight;

    return (
        <div className="flex items-start gap-3 py-2">
            <div className={`mt-0.5 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-light uppercase tracking-[0.18em] mb-0.5 ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
                    {label}
                </p>
                {isLink ? (
                    <a
                        href={String(value).startsWith('http') ? String(value) : `https://${value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-sm font-light hover:underline ${brandTextClass}`}
                    >
                        {value}
                    </a>
                ) : (
                    <p className={`text-sm font-light whitespace-pre-line ${isDarkMode ? 'text-white/80' : 'text-slate-700'}`}>
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
    const sectionDividerClass = isDarkMode
        ? BAMBOOK_OS.tone.divider.sectionDark
        : BAMBOOK_OS.tone.divider.sectionLight;

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
                    <span className={isDarkMode ? 'text-white/58' : 'text-slate-600'}>{icon}</span>
                    <h4 className={`text-[11px] font-light uppercase tracking-[0.18em] ${isDarkMode ? 'text-white/66' : 'text-slate-700'}`}>
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
    isDarkMode
}) => {
    const isOrg = type === 'organization';
    const [followUps, setFollowUps] = useState<FollowUpRecord[] | null>(null);

    // ── 阶段 P3b：品牌线（组织专属）与沟通日志（全渠道流水）状态 ──
    const [brandLines, setBrandLines] = useState<BrandLine[] | null>(null);
    const [commLogs, setCommLogs] = useState<CommunicationLog[] | null>(null);
    const [brandLineForm, setBrandLineForm] = useState({ name: '', code: '' });
    const [commLogForm, setCommLogForm] = useState({ type: 'Email' as CommunicationType, occurredAt: new Date().toISOString().slice(0, 10), summary: '' });
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

    // 品牌线：仅组织布局拉取（PRD 6.2，客户 360° 品牌线档案）
    useEffect(() => {
        if (!isOrg) return;
        let cancelled = false;
        setBrandLines(null);
        apiService.listBrandLines(data.id)
            .then(items => { if (!cancelled) setBrandLines(items); })
            .catch(() => { if (!cancelled) setBrandLines([]); });
        return () => { cancelled = true; };
    }, [data.id, isOrg]);

    // 沟通日志：relation 级全渠道流水（PRD 12.3），组织/联系人布局共用
    useEffect(() => {
        let cancelled = false;
        setCommLogs(null);
        apiService.listCommLogs(data.id, { limit: 10 })
            .then(items => { if (!cancelled) setCommLogs(items); })
            .catch(() => { if (!cancelled) setCommLogs([]); });
        return () => { cancelled = true; };
    }, [data.id]);

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

    const handleAddCommLog = async () => {
        const summary = commLogForm.summary.trim();
        if (!summary || !commLogForm.occurredAt || commLogBusy) return;
        setCommLogBusy(true);
        setP3bError(null);
        try {
            const item = await apiService.createCommLog(data.id, {
                type: commLogForm.type,
                summary,
                occurredAt: commLogForm.occurredAt,
            });
            setCommLogs(prev => [item, ...(prev ?? [])]);
            setCommLogForm({ type: 'Email', occurredAt: new Date().toISOString().slice(0, 10), summary: '' });
        } catch (e: any) {
            setP3bError(`沟通日志添加失败：${e?.message || e}`);
        } finally {
            setCommLogBusy(false);
        }
    };

    const handleDeleteCommLog = async (id: string) => {
        if (commLogBusy) return;
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

    const actionButtonClass = isDarkMode
        ? BAMBOOK_OS.controls.actionControl.borderedDark
        : BAMBOOK_OS.controls.actionControl.borderedLight;
    const brandTextClass = isDarkMode
        ? BAMBOOK_OS.tone.text.brandDark
        : BAMBOOK_OS.tone.text.brandLight;
    const dataChipClass = isDarkMode
        ? BAMBOOK_OS.tone.chip.dataDark
        : BAMBOOK_OS.tone.chip.dataLight;
    const accentChipClass = isDarkMode
        ? BAMBOOK_OS.tone.chip.accentDark
        : BAMBOOK_OS.tone.chip.accentLight;
    const detailMaterialClass = `${BAMBOOK_OS.material.panelBase} ${BAMBOOK_OS.material.nestedSurface} bambook-outer-panel`;
    const inlinePanelClass = `${detailMaterialClass} bambook-tertiary-surface !rounded-control relative isolate overflow-hidden`;
    const panelDividerClass = isDarkMode
        ? BAMBOOK_OS.tone.divider.panelDark
        : BAMBOOK_OS.tone.divider.panelLight;
    const detailScrollRef = useRef<HTMLDivElement | null>(null);

    // 互动历史区块（组织/联系人两种布局共用，真源：CRM FollowUpRecord）
    const interactionHistorySection = (
        <InfoSection title="互动历史" icon={<Calendar size={14} />} isDarkMode={isDarkMode}>
            <div className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                <div className="flex items-center gap-2 mb-2">
                    <Calendar size={14} />
                    <span>最近互动: {new Date(data.lastInteraction).toLocaleDateString('zh-CN')}</span>
                </div>
                {followUps === null ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>加载中…</p>
                ) : followUps.length === 0 ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>暂无跟进记录，可在 CRM 模块添加</p>
                ) : (
                    <ul className="space-y-1.5">
                        {followUps.map(fu => (
                            <li key={fu.id} className={`text-xs leading-5 ${isDarkMode ? 'text-white/60' : 'text-slate-600'}`}>
                                <span className={`inline-block px-1.5 py-0.5 rounded mr-1.5 text-[10px] ${dataChipClass}`}>
                                    {FOLLOW_UP_TYPE_LABELS[fu.type] ?? fu.type}
                                </span>
                                <span className={isDarkMode ? 'text-white/40' : 'text-slate-500'}>{fu.followUpAt}</span>
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
            <div className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                {brandLines === null ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>加载中…</p>
                ) : brandLines.length === 0 ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>暂无品牌线档案</p>
                ) : (
                    <ul className="space-y-1.5">
                        {brandLines.map(bl => (
                            <li key={bl.id} className={`group flex items-center gap-1.5 text-xs leading-5 ${isDarkMode ? 'text-white/60' : 'text-slate-600'}`}>
                                <span className="break-all">{bl.name}</span>
                                {bl.code && (
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${dataChipClass}`}>{bl.code}</span>
                                )}
                                {!bl.isActive && (
                                    <span className={`text-[10px] ${isDarkMode ? 'text-white/30' : 'text-slate-400'}`}>已停用</span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleDeleteBrandLine(bl.id)}
                                    disabled={brandLineBusy}
                                    className={`ml-auto opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'text-white/30 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}
                                    title="删除品牌线"
                                >
                                    <Trash2 size={12} />
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
                        className={`flex-1 min-w-0 px-2 py-1 rounded-control text-xs font-light outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-white/60 border-slate-200 text-slate-800 placeholder:text-slate-400'}`}
                    />
                    <input
                        value={brandLineForm.code}
                        onChange={e => setBrandLineForm(prev => ({ ...prev, code: e.target.value }))}
                        placeholder="编码(可选)"
                        className={`w-20 px-2 py-1 rounded-control text-xs font-light outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-white/60 border-slate-200 text-slate-800 placeholder:text-slate-400'}`}
                    />
                    <button
                        type="button"
                        onClick={handleAddBrandLine}
                        disabled={brandLineBusy || !brandLineForm.name.trim()}
                        className={`shrink-0 h-6 w-6 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white/70' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="添加品牌线"
                    >
                        {brandLineBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    </button>
                </div>
            </div>
        </InfoSection>
    ) : null;

    // ── 阶段 P3b：沟通日志区块（PRD 12.3 全渠道沟通流水，组织/联系人布局共用）──
    const commLogsSection = (
        <InfoSection title="沟通日志" icon={<MessagesSquare size={14} />} isDarkMode={isDarkMode}>
            <div className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                {commLogs === null ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>加载中…</p>
                ) : commLogs.length === 0 ? (
                    <p className={`text-xs ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>暂无沟通记录</p>
                ) : (
                    <ul className="space-y-1.5">
                        {commLogs.map(cl => (
                            <li key={cl.id} className={`group flex items-baseline gap-1.5 text-xs leading-5 ${isDarkMode ? 'text-white/60' : 'text-slate-600'}`}>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] shrink-0 ${dataChipClass}`}>
                                    {COMM_TYPE_LABELS[cl.type] ?? cl.type}
                                </span>
                                <span className={`shrink-0 ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>{cl.occurredAt}</span>
                                <span className="break-all">{cl.summary}</span>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteCommLog(cl.id)}
                                    disabled={commLogBusy}
                                    className={`ml-auto self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${isDarkMode ? 'text-white/30 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}
                                    title="删除沟通日志"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {/* 内联添加表单（类型 + 日期 + 摘要） */}
                <div className="flex items-center gap-1.5 mt-2">
                    <select
                        value={commLogForm.type}
                        onChange={e => setCommLogForm(prev => ({ ...prev, type: e.target.value as CommunicationType }))}
                        className={`shrink-0 px-1.5 py-1 rounded-control text-xs font-light outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white/60 border-slate-200 text-slate-800'}`}
                    >
                        {COMM_TYPES.map(t => (
                            <option key={t} value={t}>{COMM_TYPE_LABELS[t]}</option>
                        ))}
                    </select>
                    <input
                        type="date"
                        value={commLogForm.occurredAt}
                        onChange={e => setCommLogForm(prev => ({ ...prev, occurredAt: e.target.value }))}
                        className={`shrink-0 px-1.5 py-1 rounded-control text-xs font-light outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white/60 border-slate-200 text-slate-800'}`}
                    />
                    <input
                        value={commLogForm.summary}
                        onChange={e => setCommLogForm(prev => ({ ...prev, summary: e.target.value }))}
                        placeholder="沟通摘要"
                        className={`flex-1 min-w-0 px-2 py-1 rounded-control text-xs font-light outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-white/60 border-slate-200 text-slate-800 placeholder:text-slate-400'}`}
                    />
                    <button
                        type="button"
                        onClick={handleAddCommLog}
                        disabled={commLogBusy || !commLogForm.summary.trim()}
                        className={`shrink-0 h-6 w-6 rounded-control flex items-center justify-center transition-colors disabled:opacity-40 ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white/70' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="添加沟通日志"
                    >
                        {commLogBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    </button>
                </div>
            </div>
        </InfoSection>
    );

    // P3b 操作错误提示（品牌线/沟通日志共用，轻量行内提示）
    const p3bErrorSection = p3bError ? (
        <p className="text-xs text-os-adaptive-danger">{p3bError}</p>
    ) : null;

    // 跨模块关联视图（EntityLink 图谱，组织/联系人两种布局共用）
    // 联系人双码合并：owned 链接挂在 relation.contact，订单角色链接指向 relation.person
    const relatedEntitiesSection = (
        <RelatedEntitiesPanel
            type={isOrg ? 'relation.organization' : 'relation.contact'}
            additionalTypes={isOrg ? undefined : ['relation.person']}
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
            {/* Header */}
            <div className={`shrink-0 p-5 border-b ${panelDividerClass}`}>
                <div className="flex items-center gap-4">
                    {/* 图标 */}
                    {isOrg ? (
                        <Building2 size={22} strokeWidth={1.5} className={`shrink-0 ${brandTextClass}`} />
                    ) : (
                        <User size={22} strokeWidth={1.5} className={`shrink-0 ${brandTextClass}`} />
                    )}

                    {/* 基本信息 */}
                    <div className="flex-1 min-w-0">
                        <h2 className={`text-lg font-light truncate ${isDarkMode ? 'text-white/95' : 'text-slate-900'}`}>
                            {data.name}
                        </h2>
                        <div className="flex items-center gap-3 mt-1.5">
                            {isOrg ? (
                                <>
                                    <span className={`text-xs font-light ${isDarkMode ? 'text-white/58' : 'text-slate-600'}`}>
                                        {data.type}
                                    </span>
                                    <span className={`flex items-center gap-1 text-xs font-light ${brandTextClass}`}>
                                        Tier {data.rating}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className={`flex items-center gap-1 text-xs font-light ${isDarkMode ? 'text-white/58' : 'text-slate-600'}`}>
                                        <Briefcase size={12} /> {data.role || '未设置职位'}
                                    </span>
                                    {data.department && (
                                        <span className={`text-xs ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
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
                      px-2 py-0.5 rounded-full text-[10px] font-light
                      ${dataChipClass}
                    `}
                                    >
                                        {tag}
                                    </span>
                                ))}
                                {data.tags.length > 4 && (
                                    <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
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
                h-9 px-3 rounded-control border flex items-center gap-2 text-xs font-light transition-all
                ${actionButtonClass}
              `}
                        >
                            <Edit2 size={14} /> 编辑
                        </button>
                    </div>
                </div>
            </div>

            {/* 内容区域 - 可滚动 */}
            <CompiledEdgeFade scrollRef={detailScrollRef} isDarkMode={isDarkMode} variant="subtle" zIndex={12} topHeight={64} bottomHeight={72} source="DetailPanel.edgeFade" />
            <div ref={detailScrollRef} className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-5 pb-8 space-y-3 ${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-detail-panel-shadow-viewport`}>
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
                                        <Factory size={14} className={isDarkMode ? 'text-white/40' : 'text-slate-500'} />
                                        <p className={`text-[10px] font-light uppercase tracking-[0.18em] ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
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
                                    <Navigation size={14} className={isDarkMode ? 'text-white/40' : 'text-slate-500'} />
                                    <span className={`text-[10px] font-mono ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
                                        {data.coordinates.lat.toFixed(6)}, {data.coordinates.lng.toFixed(6)}
                                    </span>
                                </div>
                            )}
                        </InfoSection>

                        {/* 财务信息 */}
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

                        {/* 备注与偏好 */}
                        {data.preferences && (
                            <InfoSection title="备注与偏好" icon={<FileText size={14} />} isDarkMode={isDarkMode}>
                                <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
                                    {data.preferences}
                                </p>
                            </InfoSection>
                        )}

                        {/* 阶段 C1：结构化 CRM 区块（组织布局）— 联系人名片 / 跟进管理 / 商机 / 信用额度 / 客户分层 */}
                        <CrmContactsSection relationId={data.id} isDarkMode={isDarkMode} />
                        <CrmFollowUpsSection relationId={data.id} isDarkMode={isDarkMode} />
                        <CrmOpportunitiesSection relationId={data.id} isDarkMode={isDarkMode} />
                        <CrmCreditLimitSection relationId={data.id} isDarkMode={isDarkMode} />
                        <CrmCustomerTierSection relationId={data.id} isDarkMode={isDarkMode} />

                        {/* 阶段 P3b：品牌线（PRD 6.2，组织专属） */}
                        {brandLinesSection}

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
                                <span key={i} className={`px-2 py-0.5 rounded text-[11px] font-light ${accentChipClass}`}>{tag}</span>
                              ))}
                            </div>
                          </InfoSection>
                        )}

                        {/* 个人简介 */}
                        {data.personalNote && (
                            <InfoSection title="个人备注" icon={<FileText size={14} />} isDarkMode={isDarkMode}>
                                <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
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
              w-full h-9 rounded-control flex items-center justify-center gap-2 text-xs font-light uppercase tracking-wider transition-all
              ${isDarkMode
                                ? 'text-white/55 hover:bg-white/8'
                                : 'text-slate-500 hover:bg-slate-100'
                            }
            `}
                    >
                        <Trash2 size={14} />
                        删除{isOrg ? '组织' : '联系人'}
                    </button>
                </div>
            </div>
        </CompiledSurfacePanel>
        </div>
    );
};

export default DetailPanel;
