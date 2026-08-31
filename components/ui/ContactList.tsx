/**
 * ContactList - 通讯录列表组件
 * 
 * 实现类似手机通讯录的垂直滚动列表，用于组织详情页的左侧面板。
 * 包含组织条目（特殊样式）和联系人列表。
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Relation } from '../../types';
import {
    Building2, User, Search, Plus,
    ChevronRight
} from 'lucide-react';
import {
    SIDEBAR_ACTIVE_CLASS,
} from './sidebarConstants';
import { BAMBOOK_OS } from './bambookOsTokens';
import { CompiledEdgeFade, CompiledSurfacePanel } from './primitives/compiledSurfacePrimitives';

// P3-2 收编：双写坍缩为单写自适应（真源 BAMBOOK_OS.controls.listRow / selectedSurface）。
export const CONTACT_LIST_ACTIVE_CLASS =
    `${SIDEBAR_ACTIVE_CLASS} text-deep-alt`;
export const CONTACT_LIST_HOVER_CLASS =
    BAMBOOK_OS.controls.listRow.hover;

interface ContactListProps {
    organization: Relation;
    contacts: Relation[];
    selectedId: string | null;  // null = 组织, 其他 = 联系人ID
    onSelect: (id: string | null) => void;
    onAddContact: () => void;
    /** R678-R6：无 relations:write 权限时隐藏「添加联系人」入口（默认 true 兼容既有调用方） */
    canWrite?: boolean;
    /** 联系人体系统一：Contact 表通讯录拉取中（区分空列表与加载态） */
    loading?: boolean;
    isDarkMode: boolean;
}

const ContactList: React.FC<ContactListProps> = ({
    organization,
    contacts,
    selectedId,
    onSelect,
    onAddContact,
    canWrite = true,
    loading = false,
    isDarkMode
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const contactListScrollRef = useRef<HTMLDivElement | null>(null);

    // 根据搜索词过滤联系人
    const filteredContacts = useMemo(() => {
        if (!searchTerm.trim()) return contacts;
        const lower = searchTerm.toLowerCase();
        return contacts.filter(c =>
            c.name.toLowerCase().includes(lower) ||
            c.role?.toLowerCase().includes(lower) ||
            c.department?.toLowerCase().includes(lower)
        );
    }, [contacts, searchTerm]);

    const isOrgSelected = selectedId === null;
    const searchInputClass = BAMBOOK_OS.controls.recessedField.base;
    const actionButtonClass = BAMBOOK_OS.controls.actionControl.bordered;
    const brandTextClass = BAMBOOK_OS.tone.text.brandEmphasis;
    const idleItemClass =
        `border border-transparent bg-transparent shadow-none ${CONTACT_LIST_HOVER_CLASS} ${BAMBOOK_OS.controls.listRow.press}`;
    const activeItemClass =
        CONTACT_LIST_ACTIVE_CLASS;

    return (
        <div className={BAMBOOK_OS.layout.relationsDetailListShellClass}>
        <CompiledSurfacePanel
            isDarkMode={isDarkMode}
            className={BAMBOOK_OS.layout.relationsDetailListPanelClass}
            contentClassName="relative z-10 flex min-h-0 flex-1 flex-col"
            compilerRole="relation-contact-list-panel"
            source="ContactList.Panel"
        >
            <div className="px-4 pt-4 pb-3 shrink-0">
                <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                        <p className={`text-[10px] font-light uppercase tracking-[0.2em] text-[var(--text-tertiary)]`}>
                            通讯录
                        </p>
                        <p className={`mt-1 text-xs font-light text-[var(--text-tertiary)]`}>
                            {filteredContacts.length} 位联系人
                        </p>
                    </div>
                    <span className={`text-[10px] font-light text-[var(--text-tertiary)]`}>
                        {selectedId ? '联系人' : '组织'}
                    </span>
                </div>
                <div className="relative">
                    <Search
                        size={14}
                        className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--text-tertiary)]`}
                    />
                    <input
                        type="text"
                        placeholder="搜索联系人..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`
              w-full h-9 pl-9 pr-4 rounded-inset text-xs font-light
              border outline-none transition-colors duration-200 ${searchInputClass}
            `}
                    />
                </div>
            </div>

            {/* 组织条目 (固定在顶部) */}
            <div className="px-3 pb-2 shrink-0">
                <button
                    onClick={() => onSelect(null)}
                    className={`
            w-full px-3 py-2.5 flex items-center gap-3 transition-colors duration-200 relative isolate overflow-hidden rounded-control
            ${isOrgSelected
                            ? activeItemClass
                            : idleItemClass
                        }
          `}
                >
                    {/* 组织图标 */}
                    <Building2
                        size={18}
                        strokeWidth={1.5}
                        className={`shrink-0 ${brandTextClass}`}
                    />

                    <div className="flex-1 min-w-0 text-left">
                        <p className={`font-light text-sm truncate text-[var(--text-primary)]`}>
                            {organization.name}
                        </p>
                        <p className={`text-[10px] font-light uppercase tracking-wider text-[var(--text-tertiary)]`}>
                            公司信息
                        </p>
                    </div>

                    {isOrgSelected && (
                        <ChevronRight size={14} className={brandTextClass} />
                    )}
                </button>
            </div>

            {/* 联系人列表 (可滚动) */}
            <div className={`mx-4 mb-1 h-px shrink-0 bg-[var(--recessed-bg-strong)]`} />
            <CompiledEdgeFade
                scrollRef={contactListScrollRef}
                isDarkMode={isDarkMode}
                variant="subtle"
                zIndex={12}
                topHeight={28}
                bottomHeight={48}
                source="ContactList.edgeFade"
            />
            <div ref={contactListScrollRef} className={`flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-1 space-y-1 ${BAMBOOK_OS.layout.panelShadowViewportClass} bambook-contact-list-shadow-viewport`}>
                <AnimatePresence>
                    {filteredContacts.map((contact, idx) => {
                        const isSelected = selectedId === contact.id;
                        return (
                             <motion.button
                                key={contact.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ delay: idx * 0.02 }}
                                onClick={() => onSelect(contact.id)}
                                className={`
	                  w-full px-3 py-2.5 flex items-center gap-3 transition-colors duration-200 group relative isolate overflow-hidden rounded-control
                  ${isSelected
                                        ? activeItemClass
                                        : idleItemClass
                                    }
                `}
                            >
                                <span
                                    className={`w-4 shrink-0 text-center text-sm font-light transition-colors duration-200 ${
                                        isSelected
                                            ? brandTextClass
                                            : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'
                                    }`}
                                >
                                    {contact.name.charAt(0).toUpperCase()}
                                </span>

                                <div className="flex-1 min-w-0 text-left">
                                    <p className={`font-light text-sm truncate text-[var(--text-primary)]`}>
                                        {contact.name}
                                    </p>
                                    <p className={`text-xs truncate text-[var(--text-tertiary)]`}>
                                        {contact.role || contact.department || '未设置职位'}
                                    </p>
                                </div>



                                {isSelected && (
                                    <ChevronRight size={14} className={brandTextClass} />
                                )}
                            </motion.button>
                        );
                    })}
                </AnimatePresence>

                {/* 空状态（加载中区分呈现，避免闪「暂无联系人」） */}
                {filteredContacts.length === 0 && (
                    <div className={`py-8 text-center text-[var(--text-tertiary)]`}>
                        <User size={24} className="mx-auto mb-2 opacity-50" />
                        <p className="text-xs font-light">
                            {loading ? '通讯录加载中...' : searchTerm ? '未找到匹配的联系人' : '暂无联系人'}
                        </p>
                    </div>
                )}
            </div>

            {/* 添加联系人按钮（R678-R6：无写权限时隐藏） */}
            {canWrite && (
            <div className="p-3 shrink-0">
                <button
                    onClick={onAddContact}
                    className={`
            w-full h-9 rounded-control flex items-center justify-center gap-2 transition-colors duration-200
            border font-light text-xs
            ${actionButtonClass}
          `}
                >
                    <Plus size={16} strokeWidth={1.5} />
                    添加联系人
                </button>
            </div>
            )}
        </CompiledSurfacePanel>
        </div>
    );
};

export default ContactList;
