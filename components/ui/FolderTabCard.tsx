import React from 'react';
import { motion } from 'framer-motion';

interface FolderTabCardProps {
    children: React.ReactNode;
    title: string;
    isDarkMode: boolean;
    accentColor?: string;
    className?: string;
}

/**
 * 📂 HYPER-ROUNDED GLASS FOLDER
 * Inspired by the uploaded design with ultra-smooth S-curve shoulders.
 */
export const FolderTabCard: React.FC<FolderTabCardProps> = ({
    children,
    title,
    accentColor = '#0EA5E9',
    className = ''
}) => {
    return (
        <div className={`relative ${className} group`}>
            {/* 1. LAYERED BACKGROUND SYSTEM */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                    <defs>
                        <linearGradient id="glassGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" className="[stop-color:rgba(255,255,255,0.8)]" />
                            <stop offset="100%" className="[stop-color:rgba(248,250,252,0.9)]" />
                        </linearGradient>
                    </defs>

                    {/* 
                        SMOOTH FOLDER PATH:
                        Uses normalized coordinates (0-100) for Responsive Container 
                        M (0,15) -> Start below the tab top
                        C (0,0 20,0 20,0) -> Rounded top-left tab
                        L (35,0) -> Tab top
                        C (50,0 45,15 65,15) -> The "Magic Shoulder" (S-Curve)
                        L (90,15) -> Body Top
                        Q (100,15 100,25) -> Body Top-Right
                        ...
                    */}
                    <path
                        d="M 0,15
                           C 0,2 3,2 10,2
                           L 30,2
                           C 45,2 45,16 60,16
                           L 92,16
                           C 100,16 100,22 100,28
                           L 100,92
                           C 100,100 92,100 85,100
                           L 15,100
                           C 0,100 0,100 0,90
                           Z"
                        fill="url(#glassGrad)"
                        className="[stroke:rgba(255,255,255,0.95)]"
                        strokeWidth="0.5"
                    />
                </svg>
                {/* Backdrop blur layer */}
                <div className="absolute inset-0 backdrop-blur-2xl pointer-events-none" style={{ clipPath: 'content-box' }} />
            </div>

            {/* 2. TAB CONTENT AREA */}
            <div className="relative z-10 w-full h-full">
                {/* Top Tab Title */}
                <div className="absolute top-0 left-0 w-36 h-14 flex items-center px-8">
                    <span className={`text-[13px] font-light tracking-tight text-[var(--text-primary)]`}>
                        {title}
                    </span>
                </div>

                {/* Main Body (Shifted down to clear the shoulder) */}
                <div className="pt-14 px-8 pb-8">
                    {children}
                </div>
            </div>

            {/* 3. OPTICAL INNER GLOW (Subtle rim light at top left) */}
            <div className="absolute top-[2px] left-[15px] w-20 h-px bg-gradient-to-r from-transparent via-[var(--border-c-strong)] to-transparent pointer-events-none" />
        </div>
    );
};
