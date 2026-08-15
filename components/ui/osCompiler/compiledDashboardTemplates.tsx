
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Order, Email, View, Insight } from '../../../types';
import { marketService } from '../../../services/marketService';
import { ExchangeScreen } from '../MarketIntelligence';

// ────────────────────────────────────────────────────────────────────
// 🧪 DIAGNOSTIC FLAGS — kept around for future regression hunting,
// but disabled in normal builds. Through extensive bisection these
// confirmed the real root cause: NOT the Dashboard's DOM weight, but
// the globe's `frameloop='demand' + setInterval(invalidate, 16ms)`
// scheduling, which fell out of sync with the browser compositor
// vsync whenever the overlay was heavy enough to push composite time
// past 16ms (Dashboard had heavy backdrop-filter glass panels;
// Orders did not). Fix lives in ProductionGlobe.tsx (frameloop is
// now always 'always' — R3F's internal RAF is phase-locked with
// vsync). See the comment block on the <Canvas> there.
// ────────────────────────────────────────────────────────────────────
const DIAG_FREEZE_DASHBOARD = false;

const DIAG_BLANK_DASHBOARD = false;
import { CompiledDashboardCard } from './compiledPrimitives';
import { BAMBOOK_OS } from '../bambookOsTokens';
import { OS_MATERIAL } from '../osMaterial';
import UserAvatar from '../UserAvatar';
import { getAuthState, subscribe } from '../../../services/authService';
import {
    TrendingUp,
    TrendingDown,
    RefreshCw,
    Search,
    ChevronDown
} from 'lucide-react';
import { NotificationCenterTrigger } from '../../NotificationCenter';
import { ComposedChart } from 'recharts/es6/chart/ComposedChart';
import { Area } from 'recharts/es6/cartesian/Area';
import { Bar } from 'recharts/es6/cartesian/Bar';
import { XAxis } from 'recharts/es6/cartesian/XAxis';
import { ResponsiveContainer } from 'recharts/es6/component/ResponsiveContainer';
import { Tooltip } from 'recharts/es6/component/Tooltip';

// 行情数据节奏：真源刷新间隔（数值仅随真源更新，无随机抖动轮询）
export const DASHBOARD_MARKET_TICK_MS = 60000;
export const DASHBOARD_CARD_ROTATION_MS = 16000;
export const DASHBOARD_VELOCITY_ROTATION_MS = 20000;
export const DASHBOARD_HUD_LAYER_CLASS = 'absolute inset-0 z-10 pointer-events-none';
export const DASHBOARD_HUD_SCROLLER_CLASS = 'dashboard-hud-scroller absolute inset-0 overflow-visible custom-scrollbar pointer-events-none';
export const DASHBOARD_HEADER_CARD_FADE_FEATHER_PX = 30;
export const DASHBOARD_HEADER_CARD_FADE_OFFSET_PX = 10;
export const DASHBOARD_EDGE_FADE_CARD_SELECTOR = '[data-os-dashboard-adaptive-card], .liquid-glass-card';
export const DASHBOARD_GLOBE_MAX_WIDTH_PX = 1680;
export const DASHBOARD_HUD_TOP_INSET_CLASS = 'pt-[116px]';
export const DASHBOARD_HUD_BOTTOM_INSET_CLASS = 'pb-[14px]';
export const DASHBOARD_GLOBE_HUD_FRAME_CLASS = 'max-w-[1680px] w-full mx-auto px-4';
export const DASHBOARD_EXPANDED_HUD_FRAME_CLASS = 'max-w-[1130px] min-w-0 w-full mx-auto px-4';
export const DASHBOARD_HUD_ROOT_CLASS = `dashboard-hud-root h-full min-h-0 flex flex-col justify-between ${DASHBOARD_GLOBE_HUD_FRAME_CLASS} ${DASHBOARD_HUD_TOP_INSET_CLASS} ${DASHBOARD_HUD_BOTTOM_INSET_CLASS} gap-1`;
export const DASHBOARD_GLOBE_STAGE_CLASS = 'dashboard-spatial-stage flex-1 w-full flex flex-row gap-1 lg:gap-1.5 items-end pt-3';
export const DASHBOARD_GLOBE_BOTTOM_CLASS = 'dashboard-spatial-bottom w-full flex flex-row gap-1 lg:gap-1.5 items-end h-[155px]';
export const DASHBOARD_EXPANDED_MAX_WIDTH_PX = 1130;
export const DASHBOARD_EXPANDED_MIN_WIDTH_PX = 0;
export const DASHBOARD_EXPANDED_METRIC_MIN_WIDTH_PX = 0;
export const DASHBOARD_EXPANDED_AI_MIN_WIDTH_PX = 340;
export const DASHBOARD_EXPANDED_MARKET_MIN_WIDTH_PX = 460;
export const DASHBOARD_EXPANDED_STATUS_MIN_WIDTH_PX = 220;
export const DASHBOARD_EXPANDED_PIPELINE_MIN_WIDTH_PX = 300;
export const DASHBOARD_EXPANDED_VELOCITY_MIN_WIDTH_PX = 560;
export const DASHBOARD_LIVE_SCAN_CLASS = 'dashboard-live-scan';
export const DASHBOARD_LIVE_SCAN_LIGHT_CLASS = 'dashboard-live-scan dashboard-live-scan-light';
export const DASHBOARD_MOBILE_PINCH_THRESHOLD_PX = 26;
export const DASHBOARD_CARD_RADIUS_CLASS = '!rounded-panel';
export const DASHBOARD_RAISED_CARD_CLASS = `${OS_MATERIAL.raisedCard} ${DASHBOARD_CARD_RADIUS_CLASS}`;
export const DASHBOARD_ACCENT_CARD_CLASS = 'bambook-dashboard-accent-card';
export const DASHBOARD_INSET_SURFACE_CLASS = OS_MATERIAL.insetSurface;
export const DASHBOARD_FLOATING_OVERLAY_CLASS = OS_MATERIAL.floatingOverlay;
export const DASHBOARD_ADAPTIVE_CARD_ATTR = 'data-os-dashboard-adaptive-card';
export const DASHBOARD_QUIET_ICON_DARK_CLASS = 'text-os-adaptive-subtitle';
export const DASHBOARD_QUIET_ICON_LIGHT_CLASS = 'text-os-adaptive-subtitle';
export const DASHBOARD_REFRESH_ICON_DARK_CLASS = `${DASHBOARD_QUIET_ICON_DARK_CLASS} hover:bg-[rgb(var(--bambook-rdl-theme-rgb)/0.08)]`;
export const DASHBOARD_REFRESH_ICON_LIGHT_CLASS = `${DASHBOARD_QUIET_ICON_LIGHT_CLASS} hover:bg-[rgb(var(--bambook-rdl-theme-rgb)/0.08)]`;
export const DASHBOARD_PIPELINE_TREND_POSITIVE_CLASS = 'text-os-adaptive-brand';
export const DASHBOARD_PIPELINE_TREND_NEGATIVE_CLASS = 'text-os-adaptive-subtitle';

const DashboardProgressRing = ({ value, displayValue }: { value: number; displayValue: React.ReactNode }) => {
    const normalized = Math.max(0, Math.min(100, value));
    const radius = 27;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - normalized / 100);

    return (
        <div className="relative h-[76px] w-[76px] shrink-0">
            <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
                <circle
                    cx="38"
                    cy="38"
                    r={radius}
                    fill="none"
                    stroke="rgba(120, 139, 162, 0.24)"
                    strokeWidth="4"
                />
                <circle
                    cx="38"
                    cy="38"
                    r={radius}
                    fill="none"
                    stroke="var(--os-vnext-brand-blue)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    className="transition-[stroke-dashoffset] duration-1000 ease-out"
                />
            </svg>
            <div data-ui-lab-wallpaper-contrast="primary" className="absolute inset-0 flex items-center justify-center text-[26px] font-light leading-none tracking-tight text-os-adaptive-primary tabular-nums">
                {displayValue}
            </div>
        </div>
    );
};

type CompiledDashboardPageBlueprint = {
    template: 'CompiledDashboardPage';
    source: 'Dashboard.ui-lab-1.0.contract';
    provenance: 'accepted';
    layout: {
        hudLayerClass: string;
        hudScrollerClass: string;
        hudRootClass: string;
        globeStageClass: string;
        globeBottomClass: string;
    };
    material: {
        raisedCardClass: string;
        insetSurfaceClass: string;
        floatingOverlayClass: string;
    };
    motion: {
        cardRotationMs: number;
        velocityRotationMs: number;
        marketTickMs: number;
    };
    edgeFade: {
        cardSelector: string;
        featherPx: number;
        offsetPx: number;
    };
};

export const compileDashboardPage = (): CompiledDashboardPageBlueprint => ({
    template: 'CompiledDashboardPage',
    source: 'Dashboard.ui-lab-1.0.contract',
    provenance: 'accepted',
    layout: {
        hudLayerClass: DASHBOARD_HUD_LAYER_CLASS,
        hudScrollerClass: DASHBOARD_HUD_SCROLLER_CLASS,
        hudRootClass: DASHBOARD_HUD_ROOT_CLASS,
        globeStageClass: DASHBOARD_GLOBE_STAGE_CLASS,
        globeBottomClass: DASHBOARD_GLOBE_BOTTOM_CLASS,
    },
    material: {
        raisedCardClass: DASHBOARD_RAISED_CARD_CLASS,
        insetSurfaceClass: DASHBOARD_INSET_SURFACE_CLASS,
        floatingOverlayClass: DASHBOARD_FLOATING_OVERLAY_CLASS,
    },
    motion: {
        cardRotationMs: DASHBOARD_CARD_ROTATION_MS,
        velocityRotationMs: DASHBOARD_VELOCITY_ROTATION_MS,
        marketTickMs: DASHBOARD_MARKET_TICK_MS,
    },
    edgeFade: {
        cardSelector: DASHBOARD_EDGE_FADE_CARD_SELECTOR,
        featherPx: DASHBOARD_HEADER_CARD_FADE_FEATHER_PX,
        offsetPx: DASHBOARD_HEADER_CARD_FADE_OFFSET_PX,
    },
});

// TYPEWRITER COMPONENT FOR AI BRIEFING
// Fixed: Uses proper index tracking to avoid closure issues and character drops
const TypewriterText: React.FC<{ text: string, speed?: number }> = ({ text, speed = 45 }) => {
    const [displayedText, setDisplayedText] = React.useState(DIAG_FREEZE_DASHBOARD ? text : "");
    const indexRef = React.useRef(0);

    React.useEffect(() => {
        if (DIAG_FREEZE_DASHBOARD) {
            setDisplayedText(text);
            return;
        }
        setDisplayedText("");
        indexRef.current = 0;

        if (!text || text.length === 0) return;

        const timer = setInterval(() => {
            const currentIndex = indexRef.current;
            if (currentIndex < text.length) {
                setDisplayedText(text.substring(0, currentIndex + 1));
                indexRef.current = currentIndex + 1;
            } else {
                clearInterval(timer);
            }
        }, speed);

        return () => clearInterval(timer);
    }, [text, speed]);

    return <span>{displayedText}</span>;
};

// 💎 CUSTOM TACTICAL FLAT BAR (Flat + Top Highlight Line)
// gradient 内联定义，避免引用问题
const RenderTacticalBar = (props: any) => {
    const { x, y, width, height, fill } = props;
    if (height === 0) return null;

    const isCurrent = fill === 'var(--os-vnext-brand-blue)';

    // 定义渐变颜色
    const gradientId = isCurrent ? 'inlineAccentGrad' : 'inlineAccentSoftGrad';
    const topColor = isCurrent ? 'var(--os-vnext-brand-blue)' : 'var(--os-vnext-brand-blue-soft)';
    const coreColor = isCurrent ? '#FFFFFF' : '#F0F9FF';
    const auraColor = isCurrent ? 'var(--os-vnext-brand-blue)' : 'var(--os-vnext-brand-blue-soft)';

    return (
        <g>
            {/* 内联渐变定义 */}
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={topColor} stopOpacity={isCurrent ? 0.6 : 0.4} />
                    <stop offset="50%" stopColor={topColor} stopOpacity={isCurrent ? 0.15 : 0.1} />
                    <stop offset="100%" stopColor={topColor} stopOpacity={0} />
                </linearGradient>
            </defs>

            {/* 1. MAIN GRADIENT BODY */}
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={`url(#${gradientId})`}
            />

            {/* 2. LASER CAP AURA (The soft glow) */}
            <line
                x1={x}
                y1={y}
                x2={x + width}
                y2={y}
                stroke={auraColor}
                strokeWidth={3}
                strokeOpacity={0.3}
            />

            {/* 3. LASER CAP CORE (The sharp peak) */}
            <line
                x1={x}
                y1={y}
                x2={x + width}
                y2={y}
                stroke={coreColor}
                strokeWidth={1}
                strokeOpacity={0.9}
            />

            {/* 4. TOP SPECULAR DOTS */}
            <circle cx={x} cy={y} r={0.5} fill={coreColor} fillOpacity={0.8} />
            <circle cx={x + width} cy={y} r={0.5} fill={coreColor} fillOpacity={0.8} />
        </g>
    );
};

/** Quote-weighted regional split from factory lat/lon (orders without coords → 其他/未标) */
function pipelineRegionsByAmount(orders: Order[]): { label: string; pct: number; amount: number }[] {
    const active = orders.filter(o => !o.deletedAt);
    const totalAmt = active.reduce((s, o) => s + (o.quoteAmount || 0), 0);
    if (totalAmt <= 0) return [];

    let apac = 0;
    let eu = 0;
    let amer = 0;
    let unk = 0;

    for (const o of active) {
        const v = o.quoteAmount || 0;
        const lat = o.factoryLat;
        const lon = o.factoryLon;
        if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
            unk += v;
            continue;
        }
        if (lon >= 60 && lon <= 155 && lat >= -50 && lat <= 55) apac += v;
        else if (lon >= -25 && lon <= 45 && lat >= 33 && lat <= 72) eu += v;
        else if (lon < -30 || (lon >= -175 && lon <= -50)) amer += v;
        else unk += v;
    }

    const rows = [
        { label: '亚太', amount: apac },
        { label: '欧洲', amount: eu },
        { label: '美洲', amount: amer },
        { label: '其他/未标', amount: unk }
    ]
        .filter(r => r.amount > 0)
        .map(r => ({ ...r, pct: Math.round(((r.amount / totalAmt) * 1000)) / 10 }))
        .sort((a, b) => b.amount - a.amount);

    return rows;
}

function regionLabelEn(label: string): string {
    const m: Record<string, string> = {
        '亚太': 'APAC',
        '欧洲': 'EU',
        '美洲': 'AMER',
        '其他/未标': 'OTHER'
    };
    return m[label] || label;
}

// —— Velocity chart: calendar weeks (Mon–Sun, local), robust dates & qty ——

function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

/** Local Monday 00:00:00 */
function startOfWeekMonday(d: Date): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay();
    const delta = dow === 0 ? -6 : 1 - dow;
    x.setDate(x.getDate() + delta);
    x.setHours(0, 0, 0, 0);
    return x;
}

function endOfWeekSunday(monday: Date): Date {
    const x = addDays(monday, 6);
    x.setHours(23, 59, 59, 999);
    return x;
}

function parseMaybeDate(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : t;
    }
    return null;
}

/**
 * Prefer orderDate (ms), then PO / client date strings, then updatedAt.
 */
function getOrderEventTimeMs(o: Order): number | null {
    if (o.orderDate != null && typeof o.orderDate === 'number' && !Number.isNaN(o.orderDate)) {
        return o.orderDate;
    }
    const po = parseMaybeDate(o.poDate);
    if (po != null) return po;
    const cd = parseMaybeDate(o.clientDate);
    if (cd != null) return cd;
    if (o.updatedAt != null) return o.updatedAt;
    return null;
}

/** Header quantity or sum of line qty when header is 0 */
function getOrderQuantity(o: Order): number {
    const q = o.quantity;
    if (q != null && q > 0) return q;
    if (o.lines?.length) {
        return o.lines.reduce((s, l) => s + (l.quantity || 0), 0);
    }
    return 0;
}

function formatShortDay(ts: number): string {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

type VelocityWeekRow = {
    name: string;
    weekShort: string;
    weekRange: string;
    weekly: number;
    prevWeekly: number;
    cumulative: number;
};

function normalizeVelocityChartData(data: VelocityWeekRow[]): any[] {
    const withRawVisuals = data.map(d => {
        const rawVisual = !d.weekly || d.weekly < 1 ? 0 : Math.pow(d.weekly, 0.85);
        const rawVisualPrev = !d.prevWeekly || d.prevWeekly < 1 ? 0 : Math.pow(d.prevWeekly, 0.85);
        return { ...d, rawVisual, rawVisualPrev };
    });
    const maxVisualHeight = Math.max(
        1,
        ...withRawVisuals.map(d => d.rawVisual),
        ...withRawVisuals.map(d => d.rawVisualPrev)
    );
    const scaleFactor = 123 / maxVisualHeight;
    const finalCum = data[data.length - 1]?.cumulative || 1;
    return withRawVisuals.map(d => ({
        ...d,
        visualWeekly: d.rawVisual * scaleFactor + 30,
        visualWeeklyPrev: d.rawVisualPrev * scaleFactor + 30,
        visualCumulative: (d.cumulative / finalCum) * (maxVisualHeight * scaleFactor + 30)
    }));
}

/**
 * Last 13 calendar weeks (Mon–Sun, local), oldest → newest.
 * Qty from getOrderQuantity; event time from getOrderEventTimeMs (orderDate → PO/client → updatedAt).
 */
function buildVelocityWeeks(orders: Order[], kind: 'fabric' | 'garment') {
    const today = new Date();
    const thisMonday = startOfWeekMonday(today);

    const matchType = (o: Order) =>
        kind === 'fabric' ? o.type === 'Fabric' : o.type === 'Garment' || !o.type;

    const pool = orders.filter(o => !o.deletedAt).filter(matchType);

    const rows: VelocityWeekRow[] = [];
    let cumulative = 0;

    for (let s = 0; s < 13; s++) {
        const weekMonday = addDays(thisMonday, (s - 12) * 7);
        const weekStart = weekMonday;
        const weekEnd = endOfWeekSunday(weekMonday);

        const prevMonday = addDays(weekMonday, -7);
        const prevStart = prevMonday;
        const prevEnd = endOfWeekSunday(prevMonday);

        const t0 = weekStart.getTime();
        const t1 = weekEnd.getTime();
        const p0 = prevStart.getTime();
        const p1 = prevEnd.getTime();

        let weekly = 0;
        let prevWeekly = 0;

        for (const o of pool) {
            const t = getOrderEventTimeMs(o);
            if (t == null) continue;
            const qty = getOrderQuantity(o);
            if (qty <= 0) continue;
            if (t >= t0 && t <= t1) weekly += qty;
            if (t >= p0 && t <= p1) prevWeekly += qty;
        }

        cumulative += weekly;

        const sun = endOfWeekSunday(weekMonday);
        const weekShort = `${sun.getMonth() + 1}/${sun.getDate()}`;
        const weekRange = `${formatShortDay(weekStart.getTime())}–${formatShortDay(sun.getTime())}`;

        rows.push({
            name: weekShort,
            weekShort,
            weekRange,
            weekly,
            prevWeekly,
            cumulative
        });
    }

    const hasSignal = rows.some(row => row.weekly > 0 || row.prevWeekly > 0);
    // 数据诚实：无真实订单信号时返回 null，由渲染层显示空态；禁止 demo 序列掉包冒充真实图表
    if (!hasSignal) return null;
    return normalizeVelocityChartData(rows);
}

interface CompiledDashboardPageProps {
    orders: Order[];
    emails: Email[];
    insights: Insight[];
    onNavigate: (view: View) => void;
    briefing?: string;
    isBriefingLoading?: boolean;
    isCloudConnected?: boolean;
    isDarkMode?: boolean;
    onRefreshBriefing?: () => void;
    isMobileSpatial?: boolean;
    hasGlobeUnderlay?: boolean;
}

const DashboardMarketHub = React.memo(function DashboardMarketHub({
    isDarkMode,
    spotlightColor,
    spotlightSize,
    liquidSpotlight,
    idleSpotlightOpacity,
    variant = 'compact',
}: {
    isDarkMode: boolean;
    spotlightColor: string;
    spotlightSize: number;
    liquidSpotlight: boolean;
    idleSpotlightOpacity: number;
    variant?: 'compact' | 'expanded';
}) {
    const [marketData, setMarketData] = useState<any[]>([]);

    useEffect(() => {
        let cancelled = false;
        marketService.init().then(() => {
            if (!cancelled) setMarketData([...marketService.getTickers()]);
        });

        // 数值仅随真源刷新更新（60s），展示值即后端真源值
        const liveRefresh = setInterval(() => {
            marketService.refreshCommodities().then(tickers => {
                if (!cancelled) setMarketData([...tickers]);
            });
        }, DASHBOARD_MARKET_TICK_MS);

        return () => {
            cancelled = true;
            clearInterval(liveRefresh);
        };
    }, []);

    return (
        <ExchangeScreen
            data={marketData}
            isDarkMode={isDarkMode}
            spotlightColor={spotlightColor}
            spotlightSize={spotlightSize}
            liquidSpotlight={liquidSpotlight}
            idleSpotlightOpacity={idleSpotlightOpacity}
            variant={variant}
            cardComponent={CompiledDashboardCard}
        />
    );
});

function getTouchDistance(touches: TouchList): number {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

export const CompiledDashboardPage: React.FC<CompiledDashboardPageProps> = ({ orders, emails, insights, onNavigate: _onNavigate, briefing, isBriefingLoading, isCloudConnected: _isCloudConnected, isDarkMode = false, onRefreshBriefing, isMobileSpatial = false, hasGlobeUnderlay = true }) => {
    const blueprint = useMemo(() => compileDashboardPage(), []);
    const [authUser, setAuthUser] = React.useState(() => getAuthState().user);

    React.useEffect(() => subscribe((next) => setAuthUser(next.user)), []);

    const accountName = authUser?.displayName || authUser?.email || 'Bambook Team';
    const liveOrders = useMemo(() => orders.filter(o => !o.deletedAt), [orders]);
    const liveInsights = useMemo(() => insights.filter(i => !i.deletedAt), [insights]);

    const insightsCount = liveInsights.length;
    const highInsightCount = liveInsights.filter(i => i.importance === 'High').length;

    const alertCount = liveOrders.filter(o => o.status === 'Alert').length;
    const activeCount = liveOrders.filter(o => o.status === 'Production').length;
    const unreadEmailCount = emails.filter(e => !e.isRead).length;

    const uniqueProductionFactories = useMemo(() => {
        const names = liveOrders
            .filter(o => o.status === 'Production' && o.millName?.trim())
            .map(o => o.millName!.trim());
        return new Set(names).size;
    }, [liveOrders]);

    const regionBreakdown = useMemo(() => pipelineRegionsByAmount(orders), [orders]);
    const pipelineRegionRows = useMemo(() => {
        const r = regionBreakdown;
        const row = (i: number) =>
            r[i]
                ? { label: regionLabelEn(r[i].label), pct: r[i].pct }
                : { label: '—', pct: 0 };
        return [row(0), row(1), row(2)] as const;
    }, [regionBreakdown]);

    // Calculate Total Pipeline Value
    const totalValue = liveOrders.reduce((acc, o) => acc + (o.quoteAmount || 0), 0);

    // [REAL-TIME ANALYTICS]
    // 1. Calculate Production Velocity (Orders updated/active per day over last 7 days)
    const [fabricData, setFabricData] = useState<any[] | null>(null);
    const [garmentData, setGarmentData] = useState<any[] | null>(null);
    const [activeVelocity, setActiveVelocity] = useState<'fabric' | 'garment'>('fabric');
    const [pipelineView, setPipelineView] = useState<'total' | 'region'>('total');
    const [cognitionView, setCognitionView] = useState<'nodes' | 'efficiency'>('nodes');
    const [productionView, setProductionView] = useState<'threads' | 'factories' | 'orders'>('threads');
    const [criticalView, setCriticalView] = useState<'production' | 'logistics' | 'market'>('production');
    const dashboardSpotlightColor = isDarkMode ? BAMBOOK_OS.spotlight.cardDarkColor : BAMBOOK_OS.spotlight.cardLightColor;
    const dashboardSpotlightSize = isDarkMode ? BAMBOOK_OS.spotlight.panelDarkSize : BAMBOOK_OS.spotlight.panelLightSize;
    const dashboardIdleSpotlightOpacity = 0;
    const dashboardCardLabelClass = 'text-[13px] font-normal tracking-[0.04em] text-os-adaptive-subtitle';
    const dashboardMetricCaptionClass = 'text-[12px] font-normal text-os-adaptive-subtitle';
    const [mobileSpatialMode, setMobileSpatialMode] = useState<'globe' | 'cards'>('globe');
    const pinchStartDistanceRef = React.useRef(0);
    const pinchResolvedRef = React.useRef(false);

    // Sync Global Pulse — slow rotation across the view-state cards.
    // (Originally toggled off during the stutter investigation; restored
    // now that the real culprit was the globe's setInterval-based
    // FrameThrottle rather than these state updates.)
    useEffect(() => {
        if (DIAG_FREEZE_DASHBOARD) return;
        const interval = setInterval(() => {
            setPipelineView(prev => prev === 'total' ? 'region' : 'total');
            setCognitionView(prev => prev === 'nodes' ? 'efficiency' : 'nodes');
            setProductionView(prev => {
                if (prev === 'threads') return 'factories';
                if (prev === 'factories') return 'orders';
                return 'threads';
            });
            setCriticalView(prev => {
                if (prev === 'production') return 'logistics';
                if (prev === 'logistics') return 'market';
                return 'production';
            });
        }, DASHBOARD_CARD_ROTATION_MS);
        return () => clearInterval(interval);
    }, []);

    // 3. Velocity Split Rotation (Cube Feel) with Manual Override Reset
    useEffect(() => {
        if (DIAG_FREEZE_DASHBOARD) return;
        const timer = setTimeout(() => {
            setActiveVelocity(prev => prev === 'fabric' ? 'garment' : 'fabric');
        }, DASHBOARD_VELOCITY_ROTATION_MS);
        return () => clearTimeout(timer);
    }, [activeVelocity]);

    // 2. Calculate Trend (Pipeline Value change vs previous period - Simulated for now based on recent orders)
    const calculateTrend = () => {
        // In a real DB we'd query last month's value. 
        // Here we simulate a "growth" based on the ratio of 'Production' vs 'Pending' value
        const productionVal = liveOrders.filter(o => o.status === 'Production').reduce((acc, o) => acc + o.quoteAmount, 0);
        const pendingVal = liveOrders.filter(o => o.status === 'Pending').reduce((acc, o) => acc + o.quoteAmount, 0);
        // Avoid division by zero
        if (pendingVal === 0) return 0;
        return ((productionVal - pendingVal) / pendingVal) * 100;
    };
    const trendValue = calculateTrend();

    // 3. Dynamic Progress Bars Calculation
    // Base "Memory Capacity" for visual relativity (e.g. 100 nodes = 100%)
    const memoryCapacity = 100;
    const memoryPercent = Math.min((insightsCount / memoryCapacity) * 100, 100);

    // Risks relative to total orders
    const risksPercent = liveOrders.length > 0 ? (alertCount / liveOrders.length) * 100 : 0;

    // Output relative to total orders
    const outputPercent = liveOrders.length > 0 ? (activeCount / liveOrders.length) * 100 : 0;

    useEffect(() => {
        setFabricData(buildVelocityWeeks(orders, 'fabric'));
        setGarmentData(buildVelocityWeeks(orders, 'garment'));
    }, [orders]);

    useEffect(() => {
        if (!isMobileSpatial || !hasGlobeUnderlay || typeof document === 'undefined') return;

        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 2) return;
            pinchStartDistanceRef.current = getTouchDistance(event.touches);
            pinchResolvedRef.current = false;
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (event.touches.length !== 2 || pinchStartDistanceRef.current <= 0) return;
            event.preventDefault();
            const delta = getTouchDistance(event.touches) - pinchStartDistanceRef.current;
            if (pinchResolvedRef.current || Math.abs(delta) < DASHBOARD_MOBILE_PINCH_THRESHOLD_PX) return;
            pinchResolvedRef.current = true;
            setMobileSpatialMode(delta < 0 ? 'cards' : 'globe');
        };

        const resetPinch = () => {
            pinchStartDistanceRef.current = 0;
            pinchResolvedRef.current = false;
        };

        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', resetPinch);
        document.addEventListener('touchcancel', resetPinch);

        return () => {
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', resetPinch);
            document.removeEventListener('touchcancel', resetPinch);
        };
    }, [hasGlobeUnderlay, isMobileSpatial]);

    // DIAGNOSTIC: when freeze is on, also kill all CSS animations on the
    // entire body via a global className. Tailwind utilities like
    // animate-pulse / animate-ping / animate-spin / animate-spin-slow are
    // CSS keyframe animations that the MotionConfig below cannot reach.
    useEffect(() => {
        if (!DIAG_FREEZE_DASHBOARD) return;
        document.body.classList.add('diag-freeze-animations');
        return () => {
            document.body.classList.remove('diag-freeze-animations');
        };
    }, []);

    const dashboardHeaderRef = React.useRef<HTMLDivElement | null>(null);
    const dashboardScrollerRef = React.useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const scroller = dashboardScrollerRef.current;
        const header = dashboardHeaderRef.current;
        if (!scroller || !header) return;
        scroller.querySelectorAll<HTMLElement>(DASHBOARD_EDGE_FADE_CARD_SELECTOR).forEach((card) => {
            card.style.maskImage = '';
            card.style.webkitMaskImage = '';
            card.style.pointerEvents = '';
            card.removeAttribute('data-glass-edge-mask');
        });
        return;
    }, []);

    const effectiveMobileSpatialMode = hasGlobeUnderlay ? mobileSpatialMode : 'cards';
    const mobileSpatialClass = isMobileSpatial
        ? `bambook-mobile-dashboard-spatial bambook-mobile-dashboard-${effectiveMobileSpatialMode}-focus`
        : '';
    const useExpandedDashboardLayout = !hasGlobeUnderlay && !isMobileSpatial;
    const dashboardHeaderClass = 'dashboard-header-hud absolute top-0 left-0 right-0 z-40 pt-4 mt-[5px] pointer-events-none';
    const dashboardHeaderFrameClass = useExpandedDashboardLayout
        ? DASHBOARD_EXPANDED_HUD_FRAME_CLASS
        : DASHBOARD_GLOBE_HUD_FRAME_CLASS;
    const dashboardRootClass = useExpandedDashboardLayout
        ? `dashboard-hud-root h-full min-h-0 grid ${DASHBOARD_EXPANDED_HUD_FRAME_CLASS} ${DASHBOARD_HUD_TOP_INSET_CLASS} ${DASHBOARD_HUD_BOTTOM_INSET_CLASS} gap-1 lg:gap-1.5`
        : `dashboard-hud-root h-full min-h-0 grid ${DASHBOARD_GLOBE_HUD_FRAME_CLASS} ${DASHBOARD_HUD_TOP_INSET_CLASS} ${DASHBOARD_HUD_BOTTOM_INSET_CLASS} gap-1 lg:gap-1.5`;
    const dashboardRootStyle = useExpandedDashboardLayout
        ? { gridTemplateRows: 'minmax(0, 1fr) minmax(168px, 0.38fr)' }
        : {
            gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
            gridTemplateRows: 'minmax(0, 1fr) minmax(176px, clamp(176px, 23vh, 210px))'
        };
    const dashboardStageClass = useExpandedDashboardLayout
        ? 'dashboard-spatial-stage w-full h-full min-h-0 grid grid-cols-12 gap-1.5 items-stretch'
        : 'dashboard-spatial-stage col-span-12 row-start-1 grid grid-cols-12 grid-rows-2 gap-1.5 min-h-0 items-stretch';
    const dashboardStageStyle = useExpandedDashboardLayout
        ? { gridTemplateRows: 'minmax(0, 0.48fr) minmax(0, 1fr)' }
        : { gridTemplateRows: 'minmax(0, 0.48fr) minmax(0, 0.52fr)' };
    const dashboardCenterClass = useExpandedDashboardLayout
        ? 'dashboard-spatial-center flex-1 min-w-0 h-full min-h-[300px]'
        : 'dashboard-spatial-center col-start-5 col-span-4 row-start-1 row-span-2 min-w-0 h-full min-h-0';
    const dashboardLeftClass = useExpandedDashboardLayout
        ? 'dashboard-spatial-left col-span-12 grid gap-1.5 min-h-0 min-w-0'
        : 'dashboard-spatial-left col-start-1 col-span-4 row-start-1 row-span-2 grid grid-cols-2 grid-rows-[minmax(0,0.82fr)_minmax(0,1fr)] gap-1.5 min-h-0 min-w-0 self-end';
    const dashboardLeftStyle = useExpandedDashboardLayout
        ? { gridTemplateColumns: `repeat(3, minmax(${DASHBOARD_EXPANDED_METRIC_MIN_WIDTH_PX}px, 1fr))` }
        : undefined;
    const dashboardRightClass = useExpandedDashboardLayout
        ? 'dashboard-spatial-right col-span-12 grid gap-1.5 min-h-0'
        : 'dashboard-spatial-right col-start-10 col-span-3 row-start-2 grid gap-1.5 min-h-0 min-w-0';
    const dashboardRightStyle = useExpandedDashboardLayout
        ? { gridTemplateColumns: `minmax(${DASHBOARD_EXPANDED_AI_MIN_WIDTH_PX}px, 0.92fr) minmax(${DASHBOARD_EXPANDED_MARKET_MIN_WIDTH_PX}px, 1.08fr)` }
        : undefined;
    const dashboardAiCardClass = useExpandedDashboardLayout
        ? `${DASHBOARD_RAISED_CARD_CLASS} p-6 flex flex-col justify-between h-full w-full overflow-y-auto no-scrollbar transition-all duration-300`
        : `${DASHBOARD_RAISED_CARD_CLASS} p-6 flex flex-col justify-between h-full w-full overflow-y-auto no-scrollbar transition-all duration-300`;
    const dashboardMarketHubClass = useExpandedDashboardLayout
        ? 'h-full min-h-0 overflow-visible transition-all duration-300'
        : 'col-start-1 col-span-4 row-start-1 h-full min-h-0 overflow-visible transition-all duration-300';
    const dashboardBottomClass = useExpandedDashboardLayout
        ? 'dashboard-spatial-bottom w-full h-full min-h-0 grid gap-1.5 items-stretch'
        : 'dashboard-spatial-bottom col-span-12 row-start-2 grid grid-cols-12 gap-1.5 min-h-0 items-stretch';
    const dashboardBottomStyle = useExpandedDashboardLayout
        ? { gridTemplateColumns: `minmax(${DASHBOARD_EXPANDED_STATUS_MIN_WIDTH_PX}px, 0.62fr) minmax(${DASHBOARD_EXPANDED_PIPELINE_MIN_WIDTH_PX}px, 0.86fr) minmax(${DASHBOARD_EXPANDED_VELOCITY_MIN_WIDTH_PX}px, 1.72fr)` }
        : undefined;
    const dashboardStatusCardClass = useExpandedDashboardLayout
        ? `${DASHBOARD_RAISED_CARD_CLASS} p-5 flex flex-col justify-center gap-2 h-full transition-all duration-300`
        : `col-start-5 col-span-2 row-start-1 min-w-0 ${DASHBOARD_RAISED_CARD_CLASS} p-5 flex flex-col justify-center gap-2 h-full transition-all duration-300`;
    const dashboardPipelineCardClass = useExpandedDashboardLayout
        ? `min-w-0 ${DASHBOARD_RAISED_CARD_CLASS} p-0 flex flex-col h-full overflow-visible perspective-[1000px] transition-all duration-300`
        : `col-start-2 row-start-2 min-w-0 ${DASHBOARD_RAISED_CARD_CLASS} p-0 flex flex-col h-full overflow-visible perspective-[1000px] transition-all duration-300`;
    const dashboardVelocityHubClass = useExpandedDashboardLayout
        ? 'min-w-0 w-full perspective-[1200px] h-full pointer-events-auto'
        : 'col-start-7 col-span-6 row-start-1 min-w-0 w-full perspective-[1200px] h-full pointer-events-auto';
    const dashboardHeaderPillClass = BAMBOOK_OS.controls.actionControl.base;

    const dashboardContent = (
        <div
            data-os-compiler-template={blueprint.template}
            data-os-compiler-source={blueprint.source}
            data-os-compiler-provenance={blueprint.provenance}
            data-os-compiler-role="dashboard-hud-root"
            data-os-compiler-edge-fade-source="DASHBOARD_HEADER_CARD_FADE_*"
            className={`relative w-full h-full bg-transparent selection:bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.30)] pointer-events-none ${mobileSpatialClass}`}
        >
            {/* LAYER 1: GRID OVERLAY ONLY */}
            <div data-dashboard-bg-grid className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>



            {/* LAYER 2: HUD INTERFACE - FLOATING HEADER & CARD-LEVEL FADE */}
            <div className={DASHBOARD_HUD_LAYER_CLASS}>
                {/* TOP HUD: HEADERS (Fixed) */}
                <div ref={dashboardHeaderRef} data-os-adaptive-container="0" className={dashboardHeaderClass}>
                    {/* Changed to flex-wrap to follow natural flow instead of strict breakpoint switching */}
                    {/* Keep the title row flexible so it can make room for mobile chrome. */}
                    <div className={dashboardHeaderFrameClass}>
                        <div className="flex w-full flex-row flex-wrap justify-between items-center gap-4">
                            <div className={`flex min-w-0 flex-1 items-center gap-4 text-[var(--text-primary)]`}>
                                <h1
                                    className="text-[26px] font-light tracking-tight whitespace-nowrap text-os-adaptive-title ![text-shadow:none] transition-all"
                                >
                                    Bambook Hub
                                    <span className="ml-2.5 align-middle text-[12px] font-light tracking-[0.14em] text-os-adaptive-subtitle">工作台</span>
                                </h1>
                                {!isMobileSpatial && (
                                    <label className={`pointer-events-auto flex h-14 w-[300px] max-w-[30vw] items-center gap-3 rounded-card-lg border px-5 ${dashboardHeaderPillClass} text-os-adaptive-subtitle`}>
                                        <Search size={18} strokeWidth={1.35} />
                                        <input
                                            aria-label="Search Bambook Hub"
                                            className="min-w-0 flex-1 bg-transparent text-[14px] font-normal text-os-adaptive-primary outline-none placeholder:text-os-adaptive-subtitle"
                                            placeholder="Search..."
                                        />
                                    </label>
                                )}
                            </div>

                            {!isMobileSpatial && (
                                <div className="flex items-center gap-3 self-end md:self-auto">
                                    <div className="text-right">
                                        <div
                                            className="text-[26px] font-light leading-none tracking-tight tabular-nums text-[var(--os-adaptive-primary)] transition-colors"
                                        >
                                            {new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        <div
                                            className="text-[11px] font-light uppercase tracking-[0.14em] text-[var(--os-adaptive-subtitle)] mt-1"
                                        >
                                            UTC+8 Shanghai
                                        </div>
                                    </div>
                                    <NotificationCenterTrigger className="pointer-events-auto" />
                                    <button
                                        type="button"
                                        aria-label="Bambook Team"
                                        className={`pointer-events-auto flex h-14 items-center gap-3 rounded-card-lg border px-4 pr-5 ${dashboardHeaderPillClass} text-os-adaptive-primary`}
                                    >
                                        <UserAvatar
                                            name={accountName}
                                            email={authUser?.email}
                                            avatarUrl={authUser?.avatarUrl}
                                            isDarkMode={isDarkMode}
                                            sizeClassName="h-9 w-9"
                                            textClassName="text-xs"
                                            adaptive
                                        />
                                        <span className="text-[13px] font-normal">Bambook Team</span>
                                        <ChevronDown size={15} strokeWidth={1.4} className="text-os-adaptive-subtitle" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div ref={dashboardScrollerRef} className={DASHBOARD_HUD_SCROLLER_CLASS}>
                    <div className={dashboardRootClass} style={dashboardRootStyle}>

                        {/* MIDDLE SECTION: RESPONSIVE GRID */}
                        {/* On Desktop, this pushes content to sides to reveal Globe in center. On smaller screens, it stacks. */}
                        {/* MIDDLE SECTION: RESPONSIVE GRID */}
                        {/* MIDDLE SECTION: ULTIMATE STABLE FLEX LAYOUT */}
                        {/* STRATEGY: "Two Bricks and a Spring" */}
                        {/* Mobile (<md): Vertical Stack. */}
                        {/* Desktop/Tablet (>=md): Left(260px) -- Stretchable Spacer -- Right(320px). */}
                        {/* Components behave like solid objects moving closer together, with ZERO shape distortion. */}
                        {/* Desktop (Always): Left(260px) -- Stretchable Spacer -- Right(320px). */}
                        {/* Components behave like solid objects moving closer together, with ZERO shape distortion. */}
                        <motion.div className={dashboardStageClass} style={dashboardStageStyle}>

                            {/* LEFT PANEL: DATA METRICS */}
                            {/* Fixed Width Brick: 260px. Never shrinks, never grows. */}
                            <motion.div className={dashboardLeftClass} style={dashboardLeftStyle}>
                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={`p-5 xl:p-6 ${DASHBOARD_RAISED_CARD_CLASS} ${DASHBOARD_ACCENT_CARD_CLASS} flex flex-col justify-between flex-1 h-full transition-all duration-300 ${useExpandedDashboardLayout ? '' : 'order-2'}`}>
                                    <div className="flex items-center">
                                        <span data-ui-lab-wallpaper-contrast="muted" className={dashboardCardLabelClass}>Cognition</span>
                                    </div>
                                    <div className="flex min-h-0 flex-1 items-end justify-between gap-4 pt-3">
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={cognitionView}
                                                initial={{ y: 8, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -8, opacity: 0 }}
                                                className="min-w-0 pb-1"
                                            >
                                                <div data-ui-lab-wallpaper-contrast="muted" className={dashboardMetricCaptionClass}>
                                                    {cognitionView === 'nodes' ? 'Active Nodes' : 'High Priority'}
                                                </div>
                                                <div className="mt-3 h-[3px] w-14 rounded-full bg-[var(--os-vnext-brand-blue)]" />
                                            </motion.div>
                                        </AnimatePresence>
                                        <DashboardProgressRing value={memoryPercent} displayValue={cognitionView === 'nodes' ? insightsCount : highInsightCount} />
                                    </div>
                                </CompiledDashboardCard>

                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={`p-5 xl:p-6 ${DASHBOARD_RAISED_CARD_CLASS} ${DASHBOARD_ACCENT_CARD_CLASS} flex flex-col justify-between flex-1 h-full transition-all duration-300 ${useExpandedDashboardLayout ? '' : 'order-1 col-span-2'}`}>
                                    <div className="flex items-center">
                                        <span data-ui-lab-wallpaper-contrast="muted" className={dashboardCardLabelClass}>Production</span>
                                    </div>
                                    <div className={`overflow-hidden ${useExpandedDashboardLayout ? '' : 'grid grid-cols-[minmax(0,1fr)_minmax(120px,0.72fr)] items-end gap-5'}`}>
                                        <div className="min-w-0">
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={productionView}
                                                initial={{ y: 8, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -8, opacity: 0 }}
                                                data-ui-lab-wallpaper-contrast="primary"
                                                className="text-[30px] font-light leading-none tracking-tight text-os-adaptive-primary tabular-nums"
                                            >
                                                {productionView === 'threads' ? activeCount : productionView === 'factories' ? uniqueProductionFactories : liveOrders.length}
                                            </motion.div>
                                        </AnimatePresence>
                                        <div data-ui-lab-wallpaper-contrast="muted" className={dashboardMetricCaptionClass}>
                                            {productionView === 'threads' ? 'Active Lines' : productionView === 'factories' ? 'Production Bases' : 'Live Orders'}
                                        </div>
                                        <div className="h-[3px] w-full rounded-full mt-3 overflow-hidden bg-[var(--recessed-bg-strong)]">
                                            <div className="h-full rounded-full transition-all duration-1000 bg-[var(--os-vnext-brand-blue)]" style={{ width: `${outputPercent}%` }} />
                                        </div>
                                        </div>
                                        {!useExpandedDashboardLayout && (
                                            <div className="min-w-0">
                                                <div data-ui-lab-wallpaper-contrast="muted" className={dashboardMetricCaptionClass}>
                                                    Pipeline Value
                                                </div>
                                                <div data-ui-lab-wallpaper-contrast="primary" className="mt-2 text-[24px] font-light leading-none tracking-tight text-os-adaptive-primary tabular-nums">
                                                    ${(totalValue / 1000).toFixed(1)}k
                                                </div>
                                                <div className="h-[3px] w-full rounded-full mt-4 overflow-hidden bg-[var(--recessed-bg-strong)]">
                                                    <div className="h-full rounded-full transition-all duration-1000 bg-[var(--os-vnext-brand-blue)]" style={{ width: `${Math.min(100, Math.max(18, Math.round(totalValue / 1000)))}%` }} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </CompiledDashboardCard>

                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={`p-5 xl:p-6 ${DASHBOARD_RAISED_CARD_CLASS} flex flex-col justify-between flex-1 h-full transition-all duration-300 ${useExpandedDashboardLayout ? '' : 'order-3'}`}>
                                    <div className="flex items-center">
                                        <span data-ui-lab-wallpaper-contrast="muted" className={dashboardCardLabelClass}>Critical Analysis</span>
                                    </div>
                                    <div className="flex min-h-0 flex-1 items-end justify-between gap-4 pt-3">
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={criticalView}
                                                initial={{ y: 8, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -8, opacity: 0 }}
                                                className="min-w-0 pb-1"
                                            >
                                                <div data-ui-lab-wallpaper-contrast="muted" className={dashboardMetricCaptionClass}>
                                                    {criticalView === 'production' ? 'Line Blocks' : criticalView === 'logistics' ? 'Delay Risks' : 'Unread Inbox'}
                                                </div>
                                                <div className="mt-3 h-[3px] w-14 rounded-full bg-[var(--os-vnext-brand-blue)]" />
                                            </motion.div>
                                        </AnimatePresence>
                                        <DashboardProgressRing value={risksPercent} displayValue={criticalView === 'production' ? alertCount : criticalView === 'logistics' ? liveOrders.filter(o => o.status === 'Pending').length : unreadEmailCount} />
                                    </div>
                                </CompiledDashboardCard>
                            </motion.div>

                            {/* CENTER SPACER: The "Spring" */}
                            {!useExpandedDashboardLayout && (
                                <motion.div className={dashboardCenterClass}></motion.div>
                            )}

                            {/* RIGHT PANEL: INTELLIGENCE FEED */}
                            {/* Fixed Width Brick: 320px. */}
                            <motion.div className={dashboardRightClass} style={dashboardRightStyle}>
                                {/* AI Briefing Module (Restyled to match Pipeline Value/Forex) */}
                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={dashboardAiCardClass}>
                                    <div className="flex items-center">
                                        <span data-ui-lab-wallpaper-contrast="brand" className="text-[13px] font-normal tracking-[0.04em] text-[var(--os-vnext-brand-blue)]">Neural Intelligence</span>
                                    </div>

                                    <div className="flex-1 flex flex-col justify-center mt-4 h-full">
                                        <AnimatePresence mode="wait">
                                            {isBriefingLoading ? (
                                                <motion.div
                                                    key="loading"
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                    className="relative w-full h-12 flex flex-col items-center justify-center gap-2"
                                                >
                                                    {/* Naked Scan Beam */}
                                                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                                        <motion.div
                                                            animate={{
                                                                y: ['-100%', '100%'],
                                                                opacity: [0, 0.3, 0]
                                                            }}
                                                            transition={{
                                                                duration: 3,
                                                                repeat: Infinity,
                                                                ease: "linear"
                                                            }}
                                                            className="h-[40%] w-full bg-gradient-to-b from-transparent via-[rgb(var(--os-vnext-brand-blue-rgb)/0.10)] to-transparent"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex gap-1.5">
                                                            {[0, 1, 2].map(i => (
                                                                <motion.div
                                                                    key={i}
                                                                    animate={{ scale: [1, 1.4, 1], opacity: [0.2, 0.6, 0.2] }}
                                                                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }}
                                                                    className="w-1 h-1 rounded-full bg-[var(--os-vnext-brand-blue)]"
                                                                />
                                                            ))}
                                                        </div>
                                                        <span data-ui-lab-wallpaper-contrast="muted" className="text-[13px] font-normal text-os-adaptive-subtitle">
                                                            Processing
                                                        </span>
                                                    </div>
                                                </motion.div>
                                            ) : (
                                                <motion.div
                                                    key="content"
                                                    initial={{ opacity: 0, y: 5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    transition={{ duration: 1.0, ease: "easeOut" }}
                                                    data-ui-lab-wallpaper-contrast="muted"
                                                    className="font-light leading-relaxed text-[14px] tracking-wide text-os-adaptive-subtitle"
                                                >
                                                    <TypewriterText text={briefing || "All systems nominal. Global supply chain metrics optimizing within expected parameters."} />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    <div className="mt-4 flex items-center justify-between">
                                        <div className="text-[11px] font-normal tracking-[0.06em] text-os-adaptive-subtitle">
                                            v2.5 System
                                        </div>
                                        <button
                                            onClick={onRefreshBriefing}
                                            disabled={isBriefingLoading}
                                            data-ui-lab-wallpaper-contrast="muted"
                                            className={`p-1.5 rounded-full transition-all duration-300 ${DASHBOARD_REFRESH_ICON_DARK_CLASS}`}
                                            title="Manual Sync"
                                        >
                                            <RefreshCw size={12} strokeWidth={1} className={isBriefingLoading ? "animate-spin" : ""} />
                                        </button>
	                                    </div>
	                                </CompiledDashboardCard>

                                {useExpandedDashboardLayout && (
                                    <div className={dashboardMarketHubClass}>
                                        <DashboardMarketHub isDarkMode={isDarkMode} spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} liquidSpotlight idleSpotlightOpacity={dashboardIdleSpotlightOpacity} variant="expanded" />
                                    </div>
                                )}
		                            </motion.div>
		                        </motion.div>

		                        {/* BOTTOM HUD: TIMELINE & CONTROLS - LIFTED TO FIT ON SCREEN */}
		                        <div className={dashboardBottomClass} style={dashboardBottomStyle}>
                                    {!useExpandedDashboardLayout && (
                                        <div className={dashboardMarketHubClass}>
                                            <DashboardMarketHub isDarkMode={isDarkMode} spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} liquidSpotlight idleSpotlightOpacity={dashboardIdleSpotlightOpacity} variant="compact" />
                                        </div>
                                    )}
		                            {/* Legend / Status Panel - Now Responsive Width [180px - 260px] */}
                            <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={dashboardStatusCardClass}>
                                <div data-ui-lab-wallpaper-contrast="muted" className={`${dashboardCardLabelClass} mb-3 block pb-2`}>Status Index</div>
                                <div className="space-y-3">
                                    {[
                                        { label: 'Alert', color: 'bg-neutral-500', count: alertCount },
                                        { label: 'Production', color: 'bg-[var(--os-vnext-brand-blue)]', count: activeCount },
                                        { label: 'Shipping', color: 'bg-[rgb(var(--os-vnext-brand-blue-rgb)/0.60)]', count: liveOrders.filter(o => o.status === 'Shipping').length }
                                    ].map(s => (
                                        <div key={s.label} className="flex flex-row items-center justify-between gap-1">
                                            <span data-ui-lab-wallpaper-contrast="muted" className="text-[13px] font-normal text-os-adaptive-subtitle">{s.label}</span>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${s.color} animate-pulse block`}></div>
                                                <span data-ui-lab-wallpaper-contrast="muted" className="text-[13px] font-light tabular-nums text-os-adaptive-subtitle">{s.count}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CompiledDashboardCard>

	                            {useExpandedDashboardLayout && (
                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={dashboardPipelineCardClass}>
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={pipelineView}
                                        initial={{ opacity: 0, y: 12, filter: 'blur(10px)', scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
                                        exit={{ opacity: 0, y: -12, filter: 'blur(10px)', scale: 1.02 }}
                                        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
                                        className="w-full h-full p-6 flex flex-col justify-between"
                                    >
                                        <div className="flex items-center">
                                            <div data-ui-lab-wallpaper-contrast="muted" className={dashboardCardLabelClass}>
                                                {pipelineView === 'total' ? 'Pipeline Value' : 'Regional Alpha'}
                                            </div>
                                        </div>

                                        {/* Main Content Area: Grounded at the bottom */}
                                        <div className="flex items-end justify-between">
                                            {pipelineView === 'total' ? (
                                                <>
                                                    <div className="flex items-baseline gap-1">
                                                        <span data-ui-lab-wallpaper-contrast="muted" className="text-[13px] font-normal text-os-adaptive-subtitle">$</span>
                                                        <div data-ui-lab-wallpaper-contrast="muted" className={`text-[30px] font-light leading-none tabular-nums tracking-tight text-[var(--text-primary)]`}>
                                                            {(totalValue / 1000).toFixed(1)}<span className="text-sm ml-0.5 font-light">k</span>
                                                        </div>
                                                    </div>

                                                    {trendValue !== 0 && (
                                                        <div data-ui-lab-wallpaper-contrast={trendValue >= 0 ? 'brand' : undefined} className={`flex items-center gap-1 text-[13px] font-normal font-mono tracking-tighter mb-1.5 ${trendValue >= 0 ? DASHBOARD_PIPELINE_TREND_POSITIVE_CLASS : DASHBOARD_PIPELINE_TREND_NEGATIVE_CLASS}`}>
                                                            {trendValue >= 0 ? <TrendingUp size={10} strokeWidth={1.5} /> : <TrendingDown size={10} strokeWidth={1.5} />}
                                                            <span>{trendValue >= 0 ? '+' : ''}{trendValue.toFixed(1)}%</span>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <div className={`flex flex-col gap-1.5 w-full ${useExpandedDashboardLayout ? 'max-w-[180px]' : 'max-w-[120px]'}`}>
                                                        {pipelineRegionRows
                                                            .slice(0, useExpandedDashboardLayout ? 3 : 2)
                                                            .map((row) => (
                                                                <div key={row.label} className="flex justify-between items-center text-[13px] gap-3">
                                                                    <span data-ui-lab-wallpaper-contrast="muted" className={`text-[var(--text-tertiary)] font-light truncate ${useExpandedDashboardLayout ? 'max-w-[112px]' : 'max-w-[72px]'}`} title={row.label}>
                                                                        {row.label}
                                                                    </span>
                                                                    <span data-ui-lab-wallpaper-contrast="brand" className="font-mono font-light text-[var(--os-vnext-brand-blue)]">{row.pct}%</span>
                                                                </div>
                                                            ))}
                                                    </div>


                                                </>
                                            )}
                                        </div>
                                    </motion.div>
                                </AnimatePresence>
	                            </CompiledDashboardCard>
                                )}

                            {/* 3D Switching Velocity Hub (Rubik's Cube Style) */}
                            <div className={dashboardVelocityHubClass}>
                                <CompiledDashboardCard spotlightColor={dashboardSpotlightColor} spotlightSize={dashboardSpotlightSize} idleSpotlightOpacity={dashboardIdleSpotlightOpacity} liquidSpotlight liquidSpotlightTone="light" className={`relative w-full h-full ${DASHBOARD_RAISED_CARD_CLASS} p-0 flex flex-col overflow-visible transition-all duration-300`}>
                                    {/* Header - Stays Fixed */}
                                    <div className="flex justify-between items-center px-5 pt-5 mb-1 z-20">
                                        <div className="flex items-center">
                                            <span
                                                data-ui-lab-wallpaper-contrast="muted"
                                                className={`${dashboardCardLabelClass} transition-all duration-500`}
                                                title="13 calendar weeks (Mon–Sun, local). Quantity by order line; date: orderDate → PO date → client date → updated. Bars: this week vs prior week."
                                            >
                                                Velocity Index
                                            </span>
                                        </div>

                                        {/* Naked Tacticle Navigation - NO COMPLEX CONTAINERS */}
                                        <div className="flex items-center gap-3 z-30">
                                            <button
                                                onClick={() => setActiveVelocity('fabric')}
                                                data-ui-lab-wallpaper-contrast={activeVelocity === 'fabric' ? 'brand' : 'muted'}
                                                className={`text-[13px] font-normal transition-all duration-300 ${activeVelocity === 'fabric' ? 'text-os-adaptive-brand' : 'text-os-adaptive-subtitle'}`}
                                            >
                                                Fabric
                                            </button>
                                            <div className="w-[1px] h-2 bg-accent/20" />
                                            <button
                                                onClick={() => setActiveVelocity('garment')}
                                                data-ui-lab-wallpaper-contrast={activeVelocity === 'garment' ? 'brand' : 'muted'}
                                                className={`text-[13px] font-normal transition-all duration-300 ${activeVelocity === 'garment' ? 'text-os-adaptive-brand' : 'text-os-adaptive-subtitle'}`}
                                            >
                                                Garment
                                            </button>
                                        </div>
                                    </div>

                                    <AnimatePresence mode="popLayout" initial={false}>
                                        <motion.div
                                            key={activeVelocity}
                                            initial={{ rotateX: 60, opacity: 0, y: 10, scale: 0.95 }}
                                            animate={{ rotateX: 0, opacity: 1, y: 0, scale: 1 }}
                                            exit={{ rotateX: -60, opacity: 0, y: -10, scale: 0.95 }}
                                            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                                            style={{ transformOrigin: "50% 50% -120px" }}
                                            className="absolute inset-0 px-0 pb-0 pt-0 flex flex-col overflow-visible"
                                        >
                                            <div className="flex-1 w-full min-h-0" style={{ minHeight: 10, minWidth: 10 }}>
                                                {(activeVelocity === 'fabric' ? fabricData : garmentData) ? (
                                                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 10, height: 10 }}>
                                                    <ComposedChart
                                                        data={activeVelocity === 'fabric' ? fabricData : garmentData}
                                                        margin={{ top: 44, right: 6, left: 4, bottom: 22 }}
                                                        style={{ overflow: 'visible' }}
                                                        barGap={0}
                                                        barCategoryGap={0}
                                                    >
                                                        <defs>
                                                            {/* Area/Trend Gradients - 保留给 Area 组件使用 */}
                                                            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="var(--os-vnext-brand-blue)" stopOpacity={0.1} />
                                                                <stop offset="95%" stopColor="var(--os-vnext-brand-blue)" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <XAxis
                                                            dataKey="name"
                                                            tick={{ fontSize: 9, fill: isDarkMode ? 'var(--bambook-gray-600)' : '#94a3b8' }}
                                                            axisLine={false}
                                                            tickLine={false}
                                                            interval={1}
                                                            height={24}
                                                            boundaryGap={false}
                                                        />
                                                        <Tooltip
                                                            cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}
                                                            content={({ active, payload }) => {
                                                                if (active && payload && payload.length && !payload[0].payload.isAnchor) {
                                                                    const d = payload[0].payload;
                                                                    const kindLabel = activeVelocity === 'fabric' ? 'Fabric' : 'Garment';
                                                                    const wow =
                                                                        d.prevWeekly > 0
                                                                            ? (((d.weekly - d.prevWeekly) / d.prevWeekly) * 100).toFixed(1)
                                                                            : null;
                                                                    return (
                                                                        <div className={`px-3 py-2 border rounded-control max-w-[240px] ${DASHBOARD_FLOATING_OVERLAY_CLASS} text-[var(--text-primary)]`}>
                                                                            <div className="text-[13px] font-normal tracking-wide mb-2">{kindLabel} · {d.weekRange ?? d.name}</div>
                                                                            <div className="flex flex-col gap-1">
                                                                                <div className="flex justify-between gap-3">
                                                                                    <span className="text-[13px]">This week</span>
                                                                                    <span className="text-[13px] font-mono font-light text-[var(--os-vnext-brand-blue)]">{Math.round(d.weekly)}</span>
                                                                                </div>
                                                                                <div className="flex justify-between gap-3">
                                                                                    <span className="text-[13px]">Prior week</span>
                                                                                    <span className="text-[13px] font-mono font-light text-[var(--os-vnext-brand-blue-soft)]">{Math.round(d.prevWeekly)}</span>
                                                                                </div>
                                                                                {wow !== null && (
                                                                                    <div className="flex justify-between gap-3">
                                                                                        <span className="text-[13px]">WoW</span>
                                                                                        <span className={`text-[13px] font-mono font-light ${Number(wow) >= 0 ? 'text-os-adaptive-brand' : 'text-os-adaptive-subtitle'}`}>
                                                                                            {Number(wow) >= 0 ? '+' : ''}{wow}%
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                                <div className="pt-1 mt-1 border-t border-[var(--border-c-default)] flex justify-between gap-3">
                                                                                    <span className="text-[13px]">13w sum</span>
                                                                                    <span className="text-[13px] font-mono font-light text-[var(--os-vnext-brand-blue-soft)]">{Math.round(d.cumulative)}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }
                                                                return null;
                                                            }}
                                                        />
                                                        {/* Architectural Weekly Bars */}
                                                        <Bar
                                                            dataKey="visualWeeklyPrev"
                                                            fill="var(--os-vnext-brand-blue-soft)"
                                                            shape={<RenderTacticalBar />}
                                                            animationDuration={1500}
                                                        />
                                                        <Bar
                                                            dataKey="visualWeekly"
                                                            fill="var(--os-vnext-brand-blue)"
                                                            shape={<RenderTacticalBar />}
                                                            animationDuration={1800}
                                                        />
                                                        {/* Cumulative Quarterly Growth Line */}
                                                        <Area
                                                            type="monotone"
                                                            dataKey="visualCumulative"
                                                            stroke="var(--os-vnext-brand-blue)"
                                                            strokeWidth={1.5}
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            fillOpacity={1}
                                                            fill="rgb(var(--os-vnext-brand-blue-rgb) / 0.05)"
                                                            animationDuration={2500}
                                                            animationBegin={1200}
                                                            dot={{ r: 0 }}
                                                            activeDot={{ r: 4, fill: '#fff', strokeWidth: 1.5, stroke: "var(--os-vnext-brand-blue)" }}
                                                        />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                                ) : (
                                                <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-5 pb-5 text-center">
                                                    <span className={`${dashboardCardLabelClass} text-os-adaptive-subtitle`}>暂无近 13 周订单数据</span>
                                                    <span className="text-[11px] font-light text-os-adaptive-subtitle">No order signal in the last 13 weeks</span>
                                                </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    </AnimatePresence>
                                </CompiledDashboardCard>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (DIAG_BLANK_DASHBOARD) {
        return null;
    }
    if (DIAG_FREEZE_DASHBOARD) {
        return (
            <MotionConfig transition={{ duration: 0 }}>
                {dashboardContent}
            </MotionConfig>
        );
    }
    return dashboardContent;
};
