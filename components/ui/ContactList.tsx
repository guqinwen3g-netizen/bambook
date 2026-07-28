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
    SIDEBAR_ACTIVE_DARK_CLASS,
    SIDEBAR_ACTIVE_LIGHT_CLASS,
    SIDEBAR_HOVER_DARK_CLASS,
    SIDEBAR_HOVER_LIGHT_CLASS,
    SIDEBAR_PRESS_DARK_CLASS,
    SIDEBAR_PRESS_LIGHT_CLASS,
} from '../Sidebar';
import { BAMBOOK_OS } from './bambookOsTokens';
import { CompiledEdgeFade, CompiledSurfacePanel } from './osCompiler/compiledSurfacePrimitives';

export const CONTACT_LIST_ACTIVE_DARK_CLASS =
    `${SIDEBAR_ACTIVE_DARK_CLASS} text-slate-50`;
export const CONTACT_LIST_ACTIVE_LIGHT_CLASS =
    `${SIDEBAR_ACTIVE_LIGHT_CLASS} text-deep-alt`;
export const CONTACT_LIST_HOVER_DARK_CLASS =
    SIDEBAR_HOVER_DARK_CLASS;
export const CONTACT_LIST_HOVER_LIGHT_CLASS =
    SIDEBAR_HOVER_LIGHT_CLASS;

interface ContactListProps {
    organization: Relation;
    contacts: Relation[];
    selectedId: string | null;  // null = 组织, 其他 = 联系人ID
    onSelect: (id: string | null) => void;
    onAddContact: () => void;
    isDarkMode: boolean;
}

const ContactList: React.FC<ContactListProps> = ({
    organization,
    contacts,
    selectedId,
    onSelect,
    onAddContact,
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
    const searchInputClass = isDarkMode
        ? BAMBOOK_OS.controls.recessedField.dark
        : BAMBOOK_OS.controls.recessedField.light;
    const actionButtonClass = isDarkMode
        ? BAMBOOK_OS.controls.actionControl.borderedDark
        : BAMBOOK_OS.controls.actionControl.borderedLight;
    const brandTextClass = isDarkMode
        ? BAMBOOK_OS.tone.text.brandDark
        : BAMBOOK_OS.tone.text.brandLight;
    const idleItemClass = isDarkMode
        ? `border border-transparent bg-transparent shadow-none ${CONTACT_LIST_HOVER_DARK_CLASS} ${SIDEBAR_PRESS_DARK_CLASS}`
        : `border border-transparent bg-transparent shadow-none ${CONTACT_LIST_HOVER_LIGHT_CLASS} ${SIDEBAR_PRESS_LIGHT_CLASS}`;
    const activeItemClass = isDarkMode
        ? CONTACT_LIST_ACTIVE_DARK_CLASS
        : CONTACT_LIST_ACTIVE_LIGHT_CLASS;

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
                        <p className={`text-[10px] font-light uppercase tracking-[0.2em] ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
                            通讯录
                        </p>
                        <p className={`mt-1 text-xs font-light ${isDarkMode ? 'text-white/62' : 'text-slate-500'}`}>
                            {filteredContacts.length} 位联系人
                        </p>
                    </div>
                    <span className={`text-[10px] font-light ${isDarkMode ? 'text-white/38' : 'text-slate-500'}`}>
                        {selectedId ? '联系人' : '组织'}
                    </span>
                </div>
                <div className="relative">
                    <Search
                        size={14}
                        className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}
                    />
                    <input
                        type="text"
                        placeholder="搜索联系人..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`
              w-full h-9 pl-9 pr-4 rounded-inset text-xs font-light
              border outline-none transition-all ${searchInputClass}
            `}
                    />
                </div>
            </div>

            {/* 组织条目 (固定在顶部) */}
            <div className="px-3 pb-2 shrink-0">
                <button
                    onClick={() => onSelect(null)}
                    className={`
            w-full px-3 py-2.5 flex items-center gap-3 transition-all duration-200 relative isolate overflow-hidden rounded-control
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
                        <p className={`font-light text-sm truncate ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>
                            {organization.name}
                        </p>
                        <p className={`text-[10px] font-light uppercase tracking-wider ${isDarkMode ? 'text-white/46' : 'text-slate-500'}`}>
                            公司信息
                        </p>
                    </div>

                    {isOrgSelected && (
                        <ChevronRight size={14} className={brandTextClass} />
                    )}
                </button>
            </div>

            {/* 联系人列表 (可滚动) */}
            <div className={`mx-4 mb-1 h-px shrink-0 ${isDarkMode ? 'bg-white/[0.06]' : 'bg-slate-200/50'}`} />
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
	                  w-full px-3 py-2.5 flex items-center gap-3 transition-all duration-200 group relative isolate overflow-hidden rounded-control
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
                                            : (isDarkMode ? 'text-white/58 group-hover:text-white/78' : 'text-slate-500 group-hover:text-slate-700')
                                    }`}
                                >
                                    {contact.name.charAt(0).toUpperCase()}
                                </span>

                                <div className="flex-1 min-w-0 text-left">
                                    <p className={`font-light text-sm truncate ${isDarkMode ? 'text-white/90' : 'text-slate-900'}`}>
                                        {contact.name}
                                    </p>
                                    <p className={`text-[11px] truncate ${isDarkMode ? 'text-white/40' : 'text-slate-500'}`}>
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

                {/* 空状态 */}
                {filteredContacts.length === 0 && (
                    <div className={`py-8 text-center ${isDarkMode ? 'text-white/30' : 'text-slate-500'}`}>
                        <User size={24} className="mx-auto mb-2 opacity-50" />
                        <p className="text-xs font-light">
                            {searchTerm ? '未找到匹配的联系人' : '暂无联系人'}
                        </p>
                    </div>
                )}
            </div>

            {/* 添加联系人按钮 */}
            <div className="p-3 shrink-0">
                <button
                    onClick={onAddContact}
                    className={`
            w-full h-9 rounded-control flex items-center justify-center gap-2 transition-all duration-200
            border font-light text-xs
            ${actionButtonClass}
          `}
                >
                    <Plus size={16} strokeWidth={1.5} />
                    添加联系人
                </button>
            </div>
        </CompiledSurfacePanel>
        </div>
    );
};

export default ContactList;
