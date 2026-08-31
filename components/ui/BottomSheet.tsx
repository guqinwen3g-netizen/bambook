import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { acquireBodyScrollLock, releaseBodyScrollLock } from './BdsDialog';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    height?: 'auto' | 'full' | 'half'; // auto: dynamic, full: nearly full screen, half: fixed height
    isDarkMode?: boolean;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
    isOpen,
    onClose,
    title,
    children,
    height = 'auto',
    isDarkMode = false
}) => {
    const [visible, setVisible] = useState(false);
    const [animateIn, setAnimateIn] = useState(false);
    // 滚动锁句柄：open 时获取、退场动画结束后归还；中途重开复用未归还句柄，避免计数漂移
    const releaseLockRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            // Small delay to trigger animation
            requestAnimationFrame(() => setAnimateIn(true));
            // Lock body scroll（共享引用计数，与 BdsDialog 并存时最后关闭者才恢复）
            if (!releaseLockRef.current) releaseLockRef.current = acquireBodyScrollLock();
        } else {
            setAnimateIn(false);
            const timer = setTimeout(() => {
                setVisible(false);
                // 与原实现一致：锁住整个 300ms 退场动画后再恢复滚动
                releaseBodyScrollLock(releaseLockRef.current);
                releaseLockRef.current = null;
            }, 300); // Match transition duration
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // 卸载兜底：开态或退场中被父级直接卸载时归还锁，防止 body 永久 hidden
    useEffect(() => () => {
        releaseBodyScrollLock(releaseLockRef.current);
        releaseLockRef.current = null;
    }, []);

    // ESC 关闭：与遮罩点击同语义——统一走 onClose，由消费方决定是否可关
    // （如 SampleRoomPanel 提交中 onClose={() => !itemSaving && ...}，Esc 同样被该条件拦截）
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!visible) return null;

    const heightClasses = {
        auto: 'h-auto max-h-[90vh]',
        full: 'h-[92vh]',
        half: 'h-[50vh]',
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:justify-center">
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-[var(--mask-bg)] transition-opacity duration-300 ${animateIn ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Sheet Content */}
            <div
                className={`
          w-full sm:max-w-lg bg-[var(--frosted-bg)] backdrop-blur-2xl border border-[var(--frosted-border)] rounded-t-card sm:rounded-card overflow-hidden shadow-none transition-transform duration-300 cubic-out
          ${heightClasses[height]}
          ${animateIn ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-full opacity-0 scale-95'}
          border-t border-[var(--border-c-subtle)] sm:border
          flex flex-col
        `}
            >
                {/* Handle Bar (Mobile Visual Cue) */}
                <div className="w-full flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing sm:hidden" onClick={onClose}>
                    <div className="w-12 h-1.5 rounded-full bg-[var(--recessed-bg-strong)]"></div>
                </div>

                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between shrink-0">
                    <h3 className={`text-lg font-light tracking-tight text-[var(--text-primary)]`}>{title}</h3>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-full transition-colors hover:bg-[var(--recessed-bg-hover)] text-[var(--text-tertiary)]`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 pb-8 overscroll-contain safe-bottom text-left">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default BottomSheet;
