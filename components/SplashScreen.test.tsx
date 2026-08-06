import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SplashScreen, {
    SPLASH_EXIT_FADE_MS,
    SPLASH_LOGO_EXIT_MS,
    SPLASH_MIN_VISIBLE_MS,
} from './SplashScreen';

describe('SplashScreen', () => {
    it('uses a dark launch palette when dark mode is active', () => {
        const html = renderToStaticMarkup(<SplashScreen isVisible={true} isDarkMode={true} />);

        expect(html).toContain('bg-transparent');
        expect(html).toContain('fill="var(--os-vnext-brand-blue)"');
        expect(html).toContain('fill="#FFFFFF"');
    });

    it('keeps the light launch palette when dark mode is inactive', () => {
        const html = renderToStaticMarkup(<SplashScreen isVisible={true} isDarkMode={false} />);

        expect(html).toContain('bg-transparent');
        expect(html).toContain('fill="var(--os-vnext-brand-blue)"');
        expect(html).toContain('fill="#1F1F1F"');
    });

    it('keeps the launch visible long enough to read and eases out slowly', () => {
        const html = renderToStaticMarkup(<SplashScreen isVisible={true} isDarkMode={true} />);

        expect(SPLASH_MIN_VISIBLE_MS).toBeGreaterThanOrEqual(3500);
        expect(SPLASH_EXIT_FADE_MS).toBeGreaterThanOrEqual(1100);
        expect(SPLASH_LOGO_EXIT_MS).toBeGreaterThanOrEqual(1300);
        expect(html).toContain('duration-[1200ms]');
        expect(html).toContain('duration-[1400ms]');
    });

});
