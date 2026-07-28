import { marketScraper } from './marketScraper';
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
const VOLATILITY_REAL_FOREX = 0.00002;
const VOLATILITY_REAL_COMMODITY = 0.0001;
const VOLATILITY_SIM_FOREX = 0.00005;
const VOLATILITY_SIM_COMMODITY = 0.002;
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
        { symbol: 'WOOL (CN)', price: BASE_RATES['WOOL (CN)'], change: 1.25, prefix: '¥', isReal: false },
        { symbol: 'COTTON (CN)', price: BASE_RATES['COTTON (CN)'], change: 0.45, prefix: '¥', isReal: false },
        { symbol: 'LINEN (CN)', price: BASE_RATES['LINEN (CN)'], change: -0.05, prefix: '¥', isReal: false }
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
        
        try {
            console.log("⚡️ [MARKET] Fetching real-time market data from backend...");

            // 1. 获取实时汇率
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

            // 2. 从后端获取大宗商品数据 (真实期货数据)
            try {
                const res = await fetch(`${BACKEND_API}/market/all`);
                if (res.ok) {
                    const data = await res.json();
                    this.marketCache = data;
                    this.lastMarketUpdate = now;
                    
                    if (data.status === 'success') {
                        // 更新棉花价格 (真实期货)
                        if (data.commodities?.cotton?.price) {
                            this.updateBasePrice('COTTON (CN)', data.commodities.cotton.price);
                        }
                        
                        // 更新羊毛价格
                        if (data.commodities?.wool?.price) {
                            this.updateBasePrice('WOOL (CN)', data.commodities.wool.price);
                        }
                        
                        console.log(`✅ [MARKET] Real data synchronized at ${new Date().toLocaleTimeString()}`);
                    }
                }
            } catch (e) { 
                console.warn("Backend market API failed:", e); 
            }

            return this.tickers;
        } catch (e) {
            console.warn("Live refresh skipped", e);
            return this.tickers;
        }
    }

    // 生成微小的价格波动 (模拟真实市场的实时跳动)
    generateTick(): Ticker[] {
        this.tickers = this.tickers.map(item => {
            // 真实数据只用极小的波动模拟跳动
            // 模拟数据波动稍大
            const volatility = item.isReal
                ? (item.symbol.includes('/') ? VOLATILITY_REAL_FOREX : VOLATILITY_REAL_COMMODITY)
                : (item.symbol.includes('/') ? VOLATILITY_SIM_FOREX : VOLATILITY_SIM_COMMODITY);
            
            const move = (Math.random() - 0.5) * item.price * volatility;
            let newPrice = item.price + move;
            
            // 累计变化
            const dailyChange = item.change + (move / item.price) * 100;

            if (item.symbol.includes('/')) {
                newPrice = Math.round(newPrice * 10000) / 10000;
            } else {
                newPrice = Math.round(newPrice * 100) / 100;
            }

            return {
                ...item,
                price: newPrice,
                change: Math.round(dailyChange * 100) / 100
            };
        });
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
