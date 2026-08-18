import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { RollingTicker } from './RollingTicker';
import { SpotlightCard } from './SpotlightCard';
import { OS_MATERIAL } from './osMaterial';

export const MARKET_INTELLIGENCE_CARD_CLASS = `${OS_MATERIAL.raisedCard} !rounded-panel`;
type MarketIntelligenceCardComponent = React.ComponentType<React.ComponentProps<typeof SpotlightCard>>;

interface Ticker {
    symbol: string;
    price: number;
    change: number;
    prefix: string;
    isReal?: boolean; // false = 估算/回退值，UI 透出角标，不冒充实时行情
}

interface ExchangeScreenProps {
    data: Ticker[];
    isDarkMode?: boolean;
    spotlightColor?: string;
    spotlightSize?: number;
    liquidSpotlight?: boolean;
    idleSpotlightOpacity?: number;
    variant?: 'compact' | 'expanded';
    cardComponent?: MarketIntelligenceCardComponent;
}

export const ExchangeScreen: React.FC<ExchangeScreenProps> = ({ data, isDarkMode = true, spotlightColor, spotlightSize, liquidSpotlight = false, idleSpotlightOpacity, variant = 'compact', cardComponent: CardComponent = SpotlightCard }) => {
    const [activeGroup, setActiveGroup] = useState<'currency' | 'material'>('currency');
    const isExpanded = variant === 'expanded';

    // Split Data
    const currencies = data.filter(d => d.symbol.includes('/'));
    const materials = data.filter(d => !d.symbol.includes('/'));

    // Auto-Rotate Logic (6s interval)
    useEffect(() => {
        const interval = setInterval(() => {
            setActiveGroup(prev => prev === 'currency' ? 'material' : 'currency');
        }, 6000);
        return () => clearInterval(interval);
    }, []);

    const currentData = activeGroup === 'currency' ? currencies : materials;
    const groupLabel = activeGroup === 'currency' ? 'Forex Markets' : 'Raw Materials';

    // Cube Animation Variants - Right to Left Rotation
    const cubeVariants: Variants = {
        enter: {
            rotateY: 90,
            opacity: 0,
            x: '50%', // Slight offset for better 3D feel
            scale: 0.8
        },
        center: {
            zIndex: 1,
            rotateY: 0,
            opacity: 1,
            x: '0%',
            scale: 1,
            transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const } // Apple-like ease
        },
        exit: {
            zIndex: 0,
            rotateY: -90,
            opacity: 0,
            x: '-50%',
            scale: 0.8,
            transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }
        }
    };

    return (
        <div className="w-full relative group perspective-[1200px] h-full"> {/* Height controlled by parent */}
            {/* Main Crystal Glass Container */}
            <CardComponent
                data-os-dashboard-adaptive-card
                spotlightColor={spotlightColor}
                spotlightSize={spotlightSize}
                liquidSpotlight={liquidSpotlight}
                idleSpotlightOpacity={idleSpotlightOpacity}
                liquidSpotlightTone="light"
                className={`relative w-full h-full overflow-visible transition-all duration-700 ${MARKET_INTELLIGENCE_CARD_CLASS} flex flex-col`}
            >
                {/* Header - Fixed */}
                <div className="flex shrink-0 items-center justify-between px-5 py-3.5 z-20 relative">
                    <div className="flex items-center">
                        <span data-ui-lab-wallpaper-contrast="muted" className="text-[13px] font-normal tracking-[0.04em] text-os-adaptive-subtitle">
                            {groupLabel}
                        </span>
                    </div>


                </div>

                {/* 3D Content Area */}
                <div className="relative flex-1 overflow-hidden perspective-[1000px]">
                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div
                            key={activeGroup}
                            variants={cubeVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            className="flex flex-col w-full h-full absolute inset-0 no-scrollbar gap-1.5 p-2 overflow-hidden"
                            style={{ transformOrigin: "50% 50% -150px" }}
                        >
                            {currentData.map((item) => {
                                const isUp = item.change >= 0;
                                const accentColor = isDarkMode ? (isUp ? '#F43F5E' : '#06B6D4') : (isUp ? '#17365D' : '#587FA8');

                                return (
                                    <div
                                        key={item.symbol}
                                        className={`flex flex-1 min-h-0 items-center justify-between rounded-control bg-[var(--bambook-rdl-inset-fill)] ${isExpanded ? 'px-3 py-2.5' : 'px-2.5 py-2'}`}
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span data-ui-lab-wallpaper-contrast="primary" className="text-[13px] font-normal tracking-wide truncate text-os-adaptive-primary">
                                                    {item.symbol}
                                                </span>
                                                {item.isReal === false && (
                                                    <span className="shrink-0 text-[9px] font-light tracking-wide text-os-adaptive-subtitle">估算</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-0.5 mt-0.5" style={{ color: accentColor }}>
                                                {isUp ? <TrendingUp size={14} strokeWidth={1.25} /> : <TrendingDown size={14} strokeWidth={1.25} />}
                                                <span className="text-[12px] font-mono font-light">{isUp ? '+' : ''}{item.change.toFixed(2)}%</span>
                                            </div>
                                        </div>

                                        <RollingTicker
                                            value={item.price}
                                            prefix={item.prefix}
                                            decimals={item.symbol.includes('/') || item.symbol.includes('GBP') ? 4 : 2}
                                            className={`${isExpanded ? 'text-[22px]' : 'text-[20px]'} shrink-0 font-light tracking-tight text-os-adaptive-brand tabular-nums`}
                                            style={{ fontFamily: 'var(--font-primary)' }}
                                        />
                                    </div>
                                );
                            })}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </CardComponent>
        </div>
    );
};
