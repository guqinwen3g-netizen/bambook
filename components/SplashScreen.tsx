import React, { useEffect, useState } from 'react';
import BambookWordmark from './BambookWordmark';

export const SPLASH_MIN_VISIBLE_MS = 3800;
export const SPLASH_EXIT_FADE_MS = 1200;
export const SPLASH_LOGO_EXIT_MS = 1400;

interface SplashScreenProps {
    isVisible: boolean;
    isDarkMode: boolean;
    onAnimationComplete?: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ isVisible, isDarkMode, onAnimationComplete }) => {
    const [shouldRender, setShouldRender] = useState(true);
    const [isAnimatingOut, setIsAnimatingOut] = useState(false);

    useEffect(() => {
        if (!isVisible) {
            setIsAnimatingOut(true);
            // Wait for animation to finish before unmounting
            const timer = setTimeout(() => {
                setShouldRender(false);
                if (onAnimationComplete) onAnimationComplete();
            }, SPLASH_LOGO_EXIT_MS);
            return () => clearTimeout(timer);
        } else {
            setShouldRender(true);
            setIsAnimatingOut(false);
        }
    }, [isVisible, onAnimationComplete]);

    if (!shouldRender) return null;

    const wordmarkClass = 'drop-shadow-[0_16px_34px_rgb(var(--os-vnext-brand-blue-rgb)/0.16)] dark:drop-shadow-[0_0_28px_rgb(var(--os-vnext-brand-blue-rgb)/0.34)]';

    return (
        <div
            className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-transparent transition-opacity duration-[1200ms] ease-[cubic-bezier(0.7,0,0.3,1)] ${isAnimatingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
        >
            <div
                className={`relative z-10 transform transition-all duration-[1400ms] ease-[cubic-bezier(0.7,0,0.3,1)] ${isAnimatingOut
                    ? 'scale-[30] opacity-0'
                    : 'scale-100 opacity-100'
                    }`}
            >
                <div className={`${wordmarkClass} transform translate-y-[-2px]`}>
                    <BambookWordmark className="w-64 h-auto md:w-96" variant="dual" isDarkMode={isDarkMode} bamColor="var(--os-vnext-brand-blue)" />
                </div>
            </div>
        </div>
    );
};

export default SplashScreen;
