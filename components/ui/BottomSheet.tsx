import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

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

    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            // Small delay to trigger animation
            requestAnimationFrame(() => setAnimateIn(true));
            // Lock body scroll
            document.body.style.overflow = 'hidden';
        } else {
            setAnimateIn(false);
            const timer = setTimeout(() => {
                setVisible(false);
                document.body.style.overflow = '';
            }, 300); // Match transition duration
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

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
                className={`fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 ${animateIn ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Sheet Content */}
            <div
                className={`
          w-full sm:max-w-lg bg-[var(--recessed-bg)] rounded-t-[24px] sm:rounded-card overflow-hidden shadow-none transition-transform duration-300 cubic-out
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
