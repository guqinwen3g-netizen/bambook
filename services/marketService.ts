import { getApiBaseUrl } from './apiBase';

// Market Data Service
interface Ticker {
    symbol: string;
    price: number;
    change: number;
    prefix: string;
    isReal?: boolean; // 标记是否为真实数据
}

const API_ENDPOINT = 'https://api.exchangerate-api.com/v4/latest/USD';
const REFRESH_DEBOUNCE_MS = 30_000;
const BACKEND_API = getApiBaseUrl();

const BASE_RATES: Record<string, number> = {
    'USD/CNY': 7.25,
    'EUR/CNY': 7.85,
    'GBP/CNY': 9.25,
    'WOOL (CN)': 97500.00,
    'LINEN (CN)': 87500.00,
    'COTTON (CN)': 15839.00
};

class MarketService {
    private tickers: Ticker[] = [
        { symbol: 'USD/CNY', price: BASE_RATES['USD/CNY'], change: 0.00, prefix: '¥', isReal: false },
        { symbol: 'EUR/CNY', price: BASE_RATES['EUR/CNY'], change: 0.00, prefix: '¥', isReal: false },
        { symbol: 'GBP/CNY', price: BASE_RATES['GBP/CNY'], change: 0.00, prefix: '¥', isReal: false },
        { symbol: 'WOOL (CN)', price: BASE_RATES['WOOL (CN)'], change: 0.00, prefix: '¥', isReal: false },
        { symbol: 'COTTON (CN)', price: BASE_RATES['COTTON (CN)'], change: 0.00, prefix: '¥', isReal: false },
        { symbol: 'LINEN (CN)', price: BASE_RATES['LINEN (CN)'], change: 0.00, prefix: '¥', isReal: false }
    ];

    private isInitialized = false;
    private lastMarketUpdate = 0;
    private marketCache: any = null;

    async init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        await this.refreshCommodities();
    }

    private updateBasePrice(symbol: string, price: number, isReal = true) {
        if (typeof price !== 'number' || isNaN(price)) return;
        const target = this.tickers.find(t => t.symbol === symbol);
        if (target) {
            // 计算变化百分比
            const changePercent = target.price > 0 ? ((price - target.price) / target.price) * 100 : 0;
            target.price = price;
            target.change = changePercent;
            target.isReal = isReal;
        }
    }

    // 从后端获取真实市场数据
    async refreshCommodities() {
        const now = Date.now();
        
        // 防抖：每 30 秒最多刷新一次
        if (now - this.lastMarketUpdate < REFRESH_DEBOUNCE_MS && this.marketCache) {
            return this.tickers;
        }
        
        // 优先走后端单一真源（汇率+大宗商品一次拉取，服务端出网更稳定）；
        // 后端不可达时（离线模式）回退到客户端直连汇率 API。
        let backendOk = false;
        try {
            const res = await fetch(`${BACKEND_API}/market/all`);
            if (res.ok) {
                const data = await res.json();
                this.marketCache = data;
                this.lastMarketUpdate = now;

                if (data.status === 'success') {
                    backendOk = true;

                    // 汇率（后端实时源）
                    if (typeof data.forex?.USD_CNY === 'number') {
                        this.updateBasePrice('USD/CNY', data.forex.USD_CNY, !data.forex.isEstimate);
                    }
                    if (typeof data.forex?.EUR_CNY === 'number') {
                        this.updateBasePrice('EUR/CNY', data.forex.EUR_CNY, !data.forex.isEstimate);
                    }
                    if (typeof data.forex?.GBP_CNY === 'number') {
                        this.updateBasePrice('GBP/CNY', data.forex.GBP_CNY, !data.forex.isEstimate);
                    }

                    // 大宗商品：isEstimate → isReal=false（估算值不冒充实时行情）
                    if (typeof data.commodities?.cotton?.price === 'number') {
                        this.updateBasePrice('COTTON (CN)', data.commodities.cotton.price, !data.commodities.cotton.isEstimate);
                    }
                    if (typeof data.commodities?.wool?.price === 'number') {
                        this.updateBasePrice('WOOL (CN)', data.commodities.wool.price, !data.commodities.wool.isEstimate);
                    }
                    if (typeof data.commodities?.linen?.price === 'number') {
                        this.updateBasePrice('LINEN (CN)', data.commodities.linen.price, !data.commodities.linen.isEstimate);
                    }
                }
            }
        } catch (e) {
            console.warn("Backend market API failed:", e);
        }

        // 离线回退：客户端直连汇率 API
        if (!backendOk) {
            try {
                const forexRes = await fetch(API_ENDPOINT);
                const forexData = await forexRes.json();
                if (forexData.rates) {
                    const cnyRate = forexData.rates.CNY;
                    this.updateBasePrice('USD/CNY', cnyRate);
                    if (forexData.rates.EUR) {
                        this.updateBasePrice('EUR/CNY', (1 / forexData.rates.EUR) * cnyRate);
                    }
                    if (forexData.rates.GBP) {
                        this.updateBasePrice('GBP/CNY', (1 / forexData.rates.GBP) * cnyRate);
                    }
                }
            } catch (e) {
                console.warn("Forex API failed:", e);
            }
        }

        return this.tickers;
    }

    // 数据诚实：展示值即最近一次真源刷新的值，不叠加随机抖动（此前 generateTick 已移除）
    getTickers(): Ticker[] {
        return this.tickers;
    }

    // 获取数据源信息
    getDataSource() {
        return {
            forex: 'Real-time (exchangerate-api.com)',
            cotton: 'Real-time (Yahoo Finance CT=F)',
            wool: 'Estimated (EMI Index)',
            linen: 'Weekly Index'
        };
    }

    // 获取 USD/CNY 实时汇率（供业务工具使用）
    getUsdCnyRate(): number {
        const usdCny = this.tickers.find(t => t.symbol === 'USD/CNY');
        return usdCny?.price ?? BASE_RATES['USD/CNY'];
    }
}

export const marketService = new MarketService();
