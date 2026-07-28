/**
 * DetailPanel - 详情面板组件
 * 
 * 支持两种模式：组织信息 和 联系人信息。
 * 采用 Bambook OS 风格的大玻璃面板展示详细信息。
 */

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { Relation } from '../../types';
import {
    Building2, User, Globe, Mail, Phone, MapPin,
    CreditCard, DollarSign, Calendar, Clock, MessageCircle,
    Edit2, Trash2, Star, Tag, Briefcase, Factory,
    Warehouse, Navigation, Languages, Cake, FileText,
    Hash, Banknote
} from 'lucide-react';
import { BAMBOOK_OS } from './bambookOsTokens';
import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives';

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
                className="p-3.5 !rounded-[20px]"
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

const DetailPanel: React.FC<DetailPanelProps> = ({
    type,
    data,
    organization,
    onEdit,
    onDelete,
    isDarkMode
}) => {
    const isOrg = type === 'organization';
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
                      px-2 py-0.5 rounded-xl text-[10px] font-light
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

                        {/* 互动历史 */}
                        <InfoSection title="互动历史" icon={<Calendar size={14} />} isDarkMode={isDarkMode}>
                            <div className={`text-sm ${isDarkMode ? 'text-white/50' : 'text-slate-500'}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Calendar size={14} />
                                    <span>最近互动: {new Date(data.lastInteraction).toLocaleDateString('zh-CN')}</span>
                                </div>
                                <p className={`text-xs italic ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>
                                    (详细互动历史功能开发中)
                                </p>
                            </div>
                        </InfoSection>
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
