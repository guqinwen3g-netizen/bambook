
import React from 'react';
import { motion } from 'framer-motion';

interface RollingTickerProps {
    value: number;
    prefix?: string;
    decimals?: number;
    className?: string; // Standard text classes for sizing
    style?: React.CSSProperties;
}

const Digit: React.FC<{ char: string, height: number }> = ({ char, height }) => {
    const digit = parseInt(char);
    const isNumber = !isNaN(digit);

    if (!isNumber) {
        return <span style={{ height }} className="flex items-center justify-center leading-none select-none">{char}</span>;
    }

    return (
        <div style={{ height, width: '0.6em' }} className="relative overflow-hidden inline-block select-none">
            <motion.div
                initial={false}
                animate={{ y: -1 * digit * height }}
                transition={{ type: "spring", stiffness: 100, damping: 15, mass: 0.5 }}
                className="absolute top-0 left-0 w-full flex flex-col items-center"
            >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                    <span key={i} style={{ height }} className="flex items-center justify-center leading-none w-full">
                        {i}
                    </span>
                ))}
            </motion.div>
        </div>
    );
};

export const RollingTicker: React.FC<RollingTickerProps> = ({ value, prefix = '', decimals = 2, className = '', style }) => {
    // Format the number to fixed string WITH COMMAS
    // We treat the integer part with commas, decimal part fixed
    const parts = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const valString = parts;
    const charArray = (prefix + valString).split('');

    // We need a measured height for the roll. 
    // For 'text-2xl' (24px) usually line-height is 32px.
    // For 'text-3xl' (30px) usually 36px.
    // We can pass a prop or assume relative fitting.
    // Let's deduce approximate height from pixel assumption or force a style.
    // A safer bet is to use standard heights based on expected tailwind classes passed.
    // But to be generic, let's assume '1em' if we can? 
    // Framer motion translateY with % works if container is sized?
    // Let's use hardcoded pixel height for "High-End" look to align perfectly.
    // text-3xl = 30px font size, 36px line height. 

    // We will assume the parent passes text size classes, but we enforce line-height.
    const pixelHeight = 36; // Matching text-3xl line-height approx

    return (
        <div className={`flex items-center tracking-tighter ${className}`} style={{ height: pixelHeight, lineHeight: `${pixelHeight}px`, ...style }}>
            {charArray.map((char, index) => (
                <Digit key={`${index}-${charArray.length}`} char={char} height={pixelHeight} />
            ))}
        </div>
    );
};
