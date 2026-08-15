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
        'bg-[var(--accent)]', 'bg-[var(--accent)]', 'bg-[var(--accent)]',
        'bg-[var(--accent)]', 'bg-[var(--accent)]', 'bg-[var(--accent)]',
        'bg-[var(--accent)]', 'bg-[var(--accent)]'
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
const INTENT_CHIP_CLASS = 'bg-[var(--recessed-bg)] text-[var(--text-tertiary)]';

const SIGNAL_CHIP_CLASS = 'bg-[var(--recessed-bg-strong)] text-[var(--text-primary)]';

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
    const actionControlClass = BAMBOOK_OS.controls.actionControl.base;
    const selectedSurfaceClass = BAMBOOK_OS.controls.selectedSurface.base;
    const Footer = () => {
        if (!hasMore) return <div className="p-8 text-center text-[10px] font-light uppercase tracking-widest bg-transparent text-[var(--text-tertiary)]">Bottom of sync stream</div>;
        return (
            <div className="p-6 flex justify-center bg-transparent border-t border-[var(--border-c-default)]">
                {isLoadingMore ? (
                    <div className="flex items-center gap-3 text-[var(--text-tertiary)] text-[10px] font-light uppercase tracking-widest">
                        <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" /> Connecting to node...
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
                            className={`group flex items-start gap-3 px-4 py-4 border-b cursor-pointer transition-all border-[var(--border-c-subtle)] ${isSelected
                                ? `${selectedSurfaceClass} relative after:absolute after:left-0 after:top-0 after:bottom-0 after:w-px after:bg-[var(--os-vnext-brand-blue)]`
                                : 'hover:bg-[var(--recessed-bg-hover)] active:bg-[var(--active-darken)]'
                                }`}
                        >
                            {/* Avatar or Unread Dot */}
                            <div className="relative shrink-0 mt-0.5">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-light shadow-none ${avatarColor}`}>
                                    {initials}
                                </div>
                                {!email.isRead && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--os-vnext-brand-blue)] rounded-full border-2 shadow-none ring-0 border-[var(--bg-card)]"></div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-baseline mb-0.5">
                                    <span className={`text-[13px] truncate pr-2 ${!email.isRead ? 'font-light text-[var(--text-primary)]' : 'font-light text-[var(--text-secondary)]'}`}>
                                        {email.sender.split('<')[0].trim() || 'Internal Node'}
                                    </span>
                                    <span className="text-[10px] font-light text-[var(--text-tertiary)] shrink-0 tabular-nums">
                                        {formatTime(email.date)}
                                    </span>
                                </div>

                                <div className={`text-[12px] truncate mb-1 ${!email.isRead ? 'font-light text-[var(--text-primary)]' : 'font-light text-[var(--text-secondary)]'}`}>
                                    {email.subject || '(No Subject)'}
                                </div>

                                <div className="text-[11px] line-clamp-1 leading-relaxed text-[var(--text-tertiary)] opacity-70">
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
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-light leading-4 ${INTENT_CHIP_CLASS}`}
                                        >
                                            {EMAIL_INTENT_LABELS[intentInfo.intent]}
                                        </span>
                                    )}
                                    {signalLabel && (
                                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-light leading-4 ${SIGNAL_CHIP_CLASS}`}>
                                            <AlertTriangle size={10} strokeWidth={1.5} />
                                            {signalLabel}
                                        </span>
                                    )}
                                    {email.attachments && email.attachments.length > 0 && (
                                        <Paperclip size={12} strokeWidth={1} className="text-[var(--text-tertiary)]" />
                                    )}
                                    {email.isStarred && (
                                        <Flag size={12} strokeWidth={1} className="text-[var(--text-tertiary)] fill-slate-500" />
                                    )}
                                    {email.isImportant && (
                                        <Star size={12} strokeWidth={1} className="text-[var(--text-tertiary)] fill-slate-400" />
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
