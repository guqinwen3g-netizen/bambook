import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExchangeScreen, MARKET_INTELLIGENCE_CARD_CLASS } from './MarketIntelligence';
import { OS_MATERIAL } from './osMaterial';

describe('ExchangeScreen', () => {
    it('uses the compact inset material rhythm for market rows', () => {
        const html = renderToStaticMarkup(
            <ExchangeScreen
                data={[{ symbol: 'USD/CNY', price: 7.12, change: 0.2, prefix: '' }]}
                isDarkMode={false}
                spotlightColor="rgba(147, 197, 253, 0.18)"
                spotlightSize={340}
            />
        );

        expect(html).toContain('gap-1.5 p-2 overflow-hidden');
        expect(html).toContain('flex-1 min-h-0 items-center');
        expect(html).toContain('rounded-[18px]');
        expect(html).toContain('bg-[var(--bambook-rdl-inset-fill)]');
        expect(html).toContain('text-os-adaptive-brand');
    });

    it('uses the same raised dashboard card material as other first-level dashboard components', () => {
        const html = renderToStaticMarkup(
            <ExchangeScreen
                data={[{ symbol: 'USD/CNY', price: 7.12, change: -0.01, prefix: '¥' }]}
                isDarkMode={false}
            />
        );

        expect(MARKET_INTELLIGENCE_CARD_CLASS).toBe(`${OS_MATERIAL.raisedCard} !rounded-[34px]`);
        expect(html).toContain(OS_MATERIAL.raisedCard);
        expect(html).not.toContain('bambook-blue-white-surface');
        expect(html).not.toContain('glass-panel');
        expect(html).toContain('!rounded-[34px]');
        expect(html).toContain('bg-[var(--bambook-rdl-inset-fill)]');
        expect(MARKET_INTELLIGENCE_CARD_CLASS).toContain('!rounded-[34px]');
        expect(html).not.toContain('rounded-sm');
        expect(html).not.toContain('border-white/5');
    });

    it('adapts its group heading like the other dashboard card headings', () => {
        const html = renderToStaticMarkup(
            <ExchangeScreen
                data={[{ symbol: 'WOOL (CN)', price: 97500.13, change: -0.01, prefix: '¥' }]}
                isDarkMode
            />
        );

        expect(html).toContain('data-ui-lab-wallpaper-contrast="muted"');
        expect(html).toContain('Forex Markets');
        expect(html).toContain('text-[13px] font-normal tracking-[0.04em] text-os-adaptive-subtitle');
        expect(html).not.toContain('FOREX MARKETS');
        expect(html).not.toContain('RAW MATERIALS');
        expect(html).not.toContain('style="color:#94A3B8"');
        expect(html).not.toContain('text-cyan-400');
    });
});
