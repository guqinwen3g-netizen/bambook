import React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Loader2, Paperclip, Star, Flag, AlertTriangle } from 'lucide-react';
import { Email } from '../../types';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { cleanHtmlSnippet } from '../../utils/emailUtils';
import { BAMBOOK_OS } from '../ui/bambookOsTokens';
import {
    EmailIntentInfo,
    EMAIL_INTENT_LABELS,
    EMAIL_SIGNAL_LABELS,
} from '../../services/emailIntelligenceService';

const formatTime = (dateStr?: string | Date) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';

    if (isToday(date)) {
        return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
        return 'Yesterday';
    } else if (isThisYear(date)) {
        return format(date, 'MM/dd');
    } else {
        return format(date, 'yyyy/MM/dd');
    }
};


interface EmailListProps {
    emails: Email[];
    selectedId: string | null;
    onSelect: (email: Email) => void;
    onItemVisible?: (ids: string[]) => void;
    loadMore: () => void;
    hasMore: boolean;
    isLoadingMore: boolean;
    isDarkMode?: boolean;
    /** F5 意图徽标薄覆盖层：key = IMAP uid（字符串），仅已 AI 抽取的邮件有值 */
    intentByUid?: Record<string, EmailIntentInfo>;
}

const getAvatarColor = (name: string) => {
    const colors = [
        'bg-slate-400', 'bg-slate-500', 'bg-slate-600',
        'bg-slate-500', 'bg-slate-400', 'bg-slate-600',
        'bg-slate-500', 'bg-slate-400'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

const getInitials = (name: string) => {
    if (!name) return '?';
    const clean = name.replace(/<.*>/, '').trim();
    return clean.charAt(0).toUpperCase();
};

/**
 * F5 意图 chip 样式（RDL flat 纪律：本文件禁语义彩色，意图区分靠文字而非颜色）。
 * 信号 chip 前置 AlertTriangle 图标表达紧急/风险，保持中性色板。
 */
const INTENT_CHIP_CLASS = {
  dark: 'bg-white/[0.07] text-slate-300',
  light: 'bg-slate-500/[0.08] text-slate-500',
};

const SIGNAL_CHIP_CLASS = {
  dark: 'bg-white/[0.10] text-slate-200',
  light: 'bg-slate-500/[0.12] text-slate-700',
};

export const EmailList: React.FC<EmailListProps> = ({
    emails,
    selectedId,
    onSelect,
    onItemVisible,
    loadMore,
    hasMore,
    isLoadingMore,
    isDarkMode = false,
    intentByUid
}) => {
    const actionControlClass = isDarkMode ? BAMBOOK_OS.controls.actionControl.dark : BAMBOOK_OS.controls.actionControl.light;
    const selectedSurfaceClass = isDarkMode ? BAMBOOK_OS.controls.selectedSurface.dark : BAMBOOK_OS.controls.selectedSurface.light;
    const Footer = () => {
        if (!hasMore) return <div className={`p-8 text-center text-[10px] font-light uppercase tracking-widest bg-transparent ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>Bottom of sync stream</div>;
        return (
            <div className={`p-6 flex justify-center bg-transparent border-t ${isDarkMode ? 'border-white/10' : 'border-white/40'}`}>
                {isLoadingMore ? (
                    <div className="flex items-center gap-3 text-slate-400 text-[10px] font-light uppercase tracking-widest">
                        <Loader2 size={14} className="animate-spin text-slate-400" /> Connecting to node...
                    </div>
                ) : (
                    <button
                        onClick={loadMore}
                        className={`w-full py-3 border text-[10px] font-light uppercase tracking-widest rounded-full transition-all ${actionControlClass}`}
                    >
                        Load Previous Messages
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 h-full bg-transparent select-none">
            <Virtuoso
                style={{ height: '100%' }}
                data={emails}
                rangeChanged={(range) => {
                    if (onItemVisible && emails.length > 0) {
                        const visibleBatch = emails.slice(range.startIndex, range.endIndex + 1);
                        onItemVisible(visibleBatch.map(e => e.id));
                    }
                }}
                components={{ Footer }}
                itemContent={(index, email) => {
                    const isSelected = selectedId === email.id;
                    const initials = getInitials(email.sender);
                    const avatarColor = getAvatarColor(email.sender);
                    const emailUid = email.uid || (email.id.includes('-') ? email.id.split('-').pop()! : email.id);
                    const intentInfo = intentByUid?.[String(emailUid)];
                    const signalLabel = intentInfo?.customerSignal ? EMAIL_SIGNAL_LABELS[intentInfo.customerSignal] : undefined;

                    return (
                        <div
                            onClick={() => onSelect(email)}
                            className={`group flex items-start gap-3 px-4 py-4 border-b cursor-pointer transition-all ${isDarkMode ? 'border-white/[0.055]' : 'border-white/35'} ${isSelected
                                ? `${selectedSurfaceClass} relative after:absolute after:left-0 after:top-0 after:bottom-0 after:w-px after:bg-[var(--os-vnext-brand-blue)]`
                                : (isDarkMode ? 'hover:bg-white/[0.045] active:bg-white/[0.06]' : 'hover:bg-white/38 active:bg-white/48')
                                }`}
                        >
                            {/* Avatar or Unread Dot */}
                            <div className="relative shrink-0 mt-0.5">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-light shadow-none ${avatarColor}`}>
                                    {initials}
                                </div>
                                {!email.isRead && (
                                    <div className={`absolute -top-1 -right-1 w-3 h-3 bg-[var(--os-vnext-brand-blue)] rounded-full border-2 shadow-none ring-0 ${isDarkMode ? 'border-deep' : 'border-white'}`}></div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-baseline mb-0.5">
                                    <span className={`text-[13px] truncate pr-2 ${!email.isRead ? (isDarkMode ? 'font-light text-white' : 'font-light text-slate-900') : (isDarkMode ? 'font-light text-slate-400' : 'font-light text-slate-600')}`}>
                                        {email.sender.split('<')[0].trim() || 'Internal Node'}
                                    </span>
                                    <span className="text-[10px] font-light text-slate-400 shrink-0 tabular-nums">
                                        {formatTime(email.date)}
                                    </span>
                                </div>

                                <div className={`text-[12px] truncate mb-1 ${!email.isRead ? (isDarkMode ? 'font-light text-slate-200' : 'font-light text-slate-900') : (isDarkMode ? 'font-light text-slate-500' : 'font-light text-slate-700')}`}>
                                    {email.subject || '(No Subject)'}
                                </div>

                                <div className={`text-[11px] line-clamp-1 leading-relaxed ${isDarkMode ? 'text-slate-500 opacity-80' : 'text-slate-500 opacity-70'}`}>
                                    {email.snippet && email.snippet !== email.subject
                                        ? email.snippet
                                        : email.body
                                            ? cleanHtmlSnippet(email.body) || '(No preview available)'
                                            : '(No preview available)'
                                    }
                                </div>

                                <div className="flex items-center gap-2 mt-2">
                                    {intentInfo && intentInfo.intent && intentInfo.intent !== 'other' && (
                                        <span
                                            title={intentInfo.summary || undefined}
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-light leading-4 ${isDarkMode ? INTENT_CHIP_CLASS.dark : INTENT_CHIP_CLASS.light}`}
                                        >
                                            {EMAIL_INTENT_LABELS[intentInfo.intent]}
                                        </span>
                                    )}
                                    {signalLabel && (
                                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-light leading-4 ${isDarkMode ? SIGNAL_CHIP_CLASS.dark : SIGNAL_CHIP_CLASS.light}`}>
                                            <AlertTriangle size={10} strokeWidth={1.5} />
                                            {signalLabel}
                                        </span>
                                    )}
                                    {email.attachments && email.attachments.length > 0 && (
                                        <Paperclip size={12} strokeWidth={1} className="text-slate-400" />
                                    )}
                                    {email.isStarred && (
                                        <Flag size={12} strokeWidth={1} className="text-slate-500 fill-slate-500" />
                                    )}
                                    {email.isImportant && (
                                        <Star size={12} strokeWidth={1} className="text-slate-400 fill-slate-400" />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                }}
            />
        </div>
    );
};
