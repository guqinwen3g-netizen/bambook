
import React, { useCallback, useEffect, useRef, useState } from 'react';

export const SPOTLIGHT_CARD_ENTRY_INSET = { x: 6, y: 6 };
export const SPOTLIGHT_CARD_EXIT_OUTSET = { x: 14, y: 12 };
export const SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER = 1;
export const SPOTLIGHT_CARD_FOLLOW_MIN_VISCOSITY = 0.08;
export const SPOTLIGHT_CARD_FOLLOW_MAX_VISCOSITY = 0.2;
export const SPOTLIGHT_CARD_FOLLOW_DISTANCE_DIVISOR = 1200;
export const SPOTLIGHT_CARD_DEFAULT_IDLE_POSITION = { x: "32%", y: "18%" } as const;
export const SPOTLIGHT_CARD_LIQUID_PRESSURE_MIN_DISTANCE = 124;
export const SPOTLIGHT_CARD_LIQUID_PRESSURE_SIZE_RATIO = 0.36;
export const SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_COMPRESSION = 0.16;
export const SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_EXPANSION = 0.2;
export const SPOTLIGHT_CARD_LIQUID_SIDE_STRETCH = 0.82;
export const SPOTLIGHT_CARD_LIQUID_CAP_STRETCH = 0.6;
export const SPOTLIGHT_CARD_LIQUID_MOTION_SPEED_DIVISOR = 4;
export const SPOTLIGHT_CARD_LIQUID_MOTION_BLEND = 0.28;
export const SPOTLIGHT_CARD_LIQUID_MOTION_DECAY = 0.9;
export const SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_FLOOR = 0.24;
export const SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_RANGE = 0.44;
export const SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH = 0.24;
export const SPOTLIGHT_CARD_LIQUID_TRAIL_OFFSET_RATIO = 0.28;
export const SPOTLIGHT_CARD_LIQUID_TRAIL_ALPHA_SCALE = 0.72;
export const SPOTLIGHT_CARD_LIQUID_TRAIL_STRETCH = 0.62;
export const SPOTLIGHT_CARD_LIGHT_SCOPE = 'border-box';
export const SPOTLIGHT_CARD_BORDER_LIGHT_BLEED_PX = 1;

type SpotlightPosition = {
    x: string;
    y: string;
};

type SpotlightSize = {
    width: number;
    height: number;
};

type SpotlightMotion = {
    x: number;
    y: number;
    speed: number;
};

export type SpotlightSizingMode = 'auto' | 'width' | 'shortSide' | 'frame';

type PointerViewportPosition = {
    clientX: number;
    clientY: number;
};

type SpotlightScrollController = {
    syncWithLastPointer: () => void;
};

const spotlightScrollControllers = new Set<SpotlightScrollController>();
let lastPointerViewportPosition: PointerViewportPosition | null = null;
let spotlightScrollFrame = 0;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ZERO_SPOTLIGHT_MOTION: SpotlightMotion = { x: 0, y: 0, speed: 0 };
const smoothPressure = (value: number) => {
    const clamped = clamp01(value);
    return clamped * clamped * (3 - 2 * clamped);
};

const resolveLiquidMotion = (previous: SpotlightMotion, deltaX: number, deltaY: number) => {
    const rawSpeed = clamp01(Math.hypot(deltaX, deltaY) / SPOTLIGHT_CARD_LIQUID_MOTION_SPEED_DIVISOR);
    return {
        x: previous.x * (1 - SPOTLIGHT_CARD_LIQUID_MOTION_BLEND) + deltaX * SPOTLIGHT_CARD_LIQUID_MOTION_BLEND,
        y: previous.y * (1 - SPOTLIGHT_CARD_LIQUID_MOTION_BLEND) + deltaY * SPOTLIGHT_CARD_LIQUID_MOTION_BLEND,
        speed: previous.speed * (1 - SPOTLIGHT_CARD_LIQUID_MOTION_BLEND) + rawSpeed * SPOTLIGHT_CARD_LIQUID_MOTION_BLEND,
    };
};

const resolveLiquidMotionStrength = (speed: number) => (
    speed <= 0
        ? 0
        : SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_FLOOR + smoothPressure(speed) * SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_RANGE
);

const decayLiquidMotion = (previous: SpotlightMotion) => {
    const decayed = {
        x: previous.x * SPOTLIGHT_CARD_LIQUID_MOTION_DECAY,
        y: previous.y * SPOTLIGHT_CARD_LIQUID_MOTION_DECAY,
        speed: previous.speed * SPOTLIGHT_CARD_LIQUID_MOTION_DECAY,
    };

    return Math.abs(decayed.x) < 0.05 && Math.abs(decayed.y) < 0.05 && decayed.speed < 0.015
        ? ZERO_SPOTLIGHT_MOTION
        : decayed;
};

const setLastPointerViewportPosition = (clientX: number, clientY: number) => {
    lastPointerViewportPosition = { clientX, clientY };
};

const scheduleSpotlightScrollSync = () => {
    if (spotlightScrollFrame) return;
    spotlightScrollFrame = window.requestAnimationFrame(() => {
        spotlightScrollFrame = 0;
        spotlightScrollControllers.forEach((controller) => controller.syncWithLastPointer());
    });
};

const registerSpotlightScrollController = (controller: SpotlightScrollController) => {
    const hadControllers = spotlightScrollControllers.size > 0;
    spotlightScrollControllers.add(controller);

    if (!hadControllers) {
        window.addEventListener('scroll', scheduleSpotlightScrollSync, { capture: true, passive: true });
        window.addEventListener('resize', scheduleSpotlightScrollSync, { passive: true });
    }

    return () => {
        spotlightScrollControllers.delete(controller);
        if (spotlightScrollControllers.size > 0) return;

        window.removeEventListener('scroll', scheduleSpotlightScrollSync, { capture: true });
        window.removeEventListener('resize', scheduleSpotlightScrollSync);
        if (spotlightScrollFrame) {
            window.cancelAnimationFrame(spotlightScrollFrame);
            spotlightScrollFrame = 0;
        }
    };
};

export const scaleRgbaAlpha = (color: string, scale: number) => {
    const rgbaMatch = color.match(/^rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*)([\d.]+)(\s*)\)$/);
    if (!rgbaMatch) return color;

    const alpha = clamp(Number.parseFloat(rgbaMatch[2]) * scale, 0, 1);
    const roundedAlpha = Number(alpha.toFixed(3)).toString();
    return `rgba(${rgbaMatch[1]}${roundedAlpha}${rgbaMatch[3]})`;
};

const resolveSpotlightDimension = (cardSize: SpotlightSize, sizingMode: SpotlightSizingMode) => {
    const shortSide = Math.min(cardSize.width, cardSize.height);
    const longSide = Math.max(cardSize.width, cardSize.height);
    const aspectRatio = longSide / shortSide;

    if (sizingMode === 'width') {
        return {
            dimension: cardSize.width,
            spreadRatio: 1.42,
        };
    }

    return {
        dimension: shortSide,
        spreadRatio: aspectRatio > 1.9 ? 1.55 : 1.42,
    };
};

export const resolveSpotlightGeometry = (
    requestedSize: number,
    cardSize: SpotlightSize,
    sizingMode: SpotlightSizingMode = 'auto'
) => {
    if (!cardSize.width || !cardSize.height) {
        return { size: requestedSize, intensity: 1 };
    }

    const resolvedSizingMode = sizingMode === 'auto' ? 'shortSide' : sizingMode;
    const { dimension, spreadRatio } = resolveSpotlightDimension(cardSize, resolvedSizingMode);
    const minimumSize = Math.min(requestedSize, 160);
    const flattenedSize = dimension * spreadRatio + (220 - dimension) * 0.26;
    const size = Math.round(clamp(flattenedSize, minimumSize, requestedSize));

    return { size, intensity: 1 };
};

const parseSpotlightPosition = (position: SpotlightPosition) => ({
    x: position.x.endsWith('%') ? position.x : `${Number.parseFloat(position.x) || 0}px`,
    y: position.y.endsWith('%') ? position.y : `${Number.parseFloat(position.y) || 0}px`,
});

const toPixelPosition = (position: SpotlightPosition, rect: DOMRect) => ({
    x: position.x.endsWith('%') ? (Number.parseFloat(position.x) / 100) * rect.width : Number.parseFloat(position.x) || 0,
    y: position.y.endsWith('%') ? (Number.parseFloat(position.y) / 100) * rect.height : Number.parseFloat(position.y) || 0,
});

const toPixelPositionInSize = (position: SpotlightPosition, size: SpotlightSize) => ({
    x: position.x.endsWith('%') ? (Number.parseFloat(position.x) / 100) * size.width : Number.parseFloat(position.x) || 0,
    y: position.y.endsWith('%') ? (Number.parseFloat(position.y) / 100) * size.height : Number.parseFloat(position.y) || 0,
});

const liquidTone = (tone: 'dark' | 'light', alpha: number) => {
    const boostedAlpha = tone === 'light' ? alpha * 2.2 : alpha * 1.5;
    const finalAlpha = Math.min(1, Math.max(0, boostedAlpha));
    // 浅色态的玻璃容器 edge light 直接接入主题色变量，确保与 spotlight 同色相；
    // 暗色态保留白色光，避免在深色壁纸上把高光染成主题色而失去通透感。
    return tone === 'dark'
        ? `rgba(255, 255, 255, ${finalAlpha})`
        : `rgb(var(--os-vnext-brand-blue-rgb) / ${finalAlpha})`;
};

interface SpotlightCardProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    as?: React.ElementType;
    className?: string;
    spotlightColor?: string;
    spotlightSize?: number;
    liquidSpotlight?: boolean;
    liquidEdgeGlow?: boolean;
    liquidSpotlightTone?: 'dark' | 'light';
    idleSpotlightOpacity?: number;
    activeSpotlightOpacity?: number;
    idleSpotlightPosition?: SpotlightPosition;
    spotlightSizing?: SpotlightSizingMode;
    fadeOnPointerDown?: boolean;
    type?: React.ButtonHTMLAttributes<HTMLButtonElement>['type'];
}

export const SpotlightCard = React.forwardRef<HTMLElement, SpotlightCardProps>(({
    children,
    as: Component = 'div',
    className = "",
    spotlightColor = "rgba(255, 255, 255, 0.15)",
    spotlightSize = 600,
    liquidSpotlight = false,
    liquidEdgeGlow = true,
    liquidSpotlightTone = 'dark',
    idleSpotlightOpacity = 1,
    activeSpotlightOpacity = 1,
    idleSpotlightPosition = SPOTLIGHT_CARD_DEFAULT_IDLE_POSITION,
    spotlightSizing = 'auto',
    fadeOnPointerDown = false,
    style,
    ...props
}, forwardedRef) => {
    const CardComponent = Component as React.ElementType<any>;
    const divRef = useRef<HTMLElement>(null);
    const spotlightLayerRef = useRef<HTMLDivElement>(null);
    const pointerInsideRef = useRef(false);
    const spotlightPosRef = useRef<SpotlightPosition>(parseSpotlightPosition(idleSpotlightPosition));
    const spotlightTargetRef = useRef<SpotlightPosition>(parseSpotlightPosition(idleSpotlightPosition));
    const spotlightMotionRef = useRef<SpotlightMotion>(ZERO_SPOTLIGHT_MOTION);
    // 保存最近一次有效的 motion 方向（单位向量），鼠标静止后仍可用作 bias 输入。
    // 鼠标进入跟踪时初始化为 (1,0)，离开跟踪时不重置（保留方向到下次进入仍可用作过渡）。
    const lastMotionDirectionRef = useRef<{ x: number; y: number }>({ x: 1, y: 0 });
    const spotlightFrameRef = useRef<number | null>(null);
    const cardSizeRef = useRef<SpotlightSize>({ width: 0, height: 0 });
    const [opacity, setOpacity] = useState(idleSpotlightOpacity);
    const [isTrackingPointer, setIsTrackingPointer] = useState(false);

    const isInsideEntryZone = useCallback((clientX: number, clientY: number, rect: DOMRect) => (
        clientX >= rect.left + SPOTLIGHT_CARD_ENTRY_INSET.x &&
        clientX <= rect.right - SPOTLIGHT_CARD_ENTRY_INSET.x &&
        clientY >= rect.top + SPOTLIGHT_CARD_ENTRY_INSET.y &&
        clientY <= rect.bottom - SPOTLIGHT_CARD_ENTRY_INSET.y
    ), []);

    const isInsideExitZone = useCallback((clientX: number, clientY: number, rect: DOMRect) => (
        clientX >= rect.left - SPOTLIGHT_CARD_EXIT_OUTSET.x &&
        clientX <= rect.right + SPOTLIGHT_CARD_EXIT_OUTSET.x &&
        clientY >= rect.top - SPOTLIGHT_CARD_EXIT_OUTSET.y &&
        clientY <= rect.bottom + SPOTLIGHT_CARD_EXIT_OUTSET.y
    ), []);

    const isPastViewportExitBoundary = useCallback((clientX: number, clientY: number) => (
        clientX <= SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER ||
        clientX >= window.innerWidth - SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER ||
        clientY <= SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER ||
        clientY >= window.innerHeight - SPOTLIGHT_CARD_VIEWPORT_EXIT_GUTTER
    ), []);

    const isPointerOwnedByCard = useCallback((clientX: number, clientY: number) => {
        if (!divRef.current) return false;

        const elementAtPointer = document.elementFromPoint(clientX, clientY);
        return !!elementAtPointer && divRef.current.contains(elementAtPointer);
    }, []);

    const getClampedCardPoint = useCallback((clientX: number, clientY: number, rect: DOMRect): SpotlightPosition => ({
        x: `${Math.min(rect.width, Math.max(0, clientX - rect.left))}px`,
        y: `${Math.min(rect.height, Math.max(0, clientY - rect.top))}px`,
    }), []);

    const animateSpotlightTo = useCallback((target: SpotlightPosition, immediate = false) => {
        spotlightTargetRef.current = parseSpotlightPosition(target);

        if (immediate || !divRef.current) {
            spotlightPosRef.current = spotlightTargetRef.current;
            spotlightMotionRef.current = ZERO_SPOTLIGHT_MOTION;
            flushRef.current?.();
            if (spotlightFrameRef.current !== null) {
                window.cancelAnimationFrame(spotlightFrameRef.current);
                spotlightFrameRef.current = null;
            }
            return;
        }

        if (spotlightFrameRef.current !== null) return;

        const step = () => {
            if (!divRef.current) {
                spotlightFrameRef.current = null;
                return;
            }

            const rect = divRef.current.getBoundingClientRect();
            cardSizeRef.current = { width: rect.width, height: rect.height };
            const current = toPixelPosition(spotlightPosRef.current, rect);
            const targetPx = toPixelPosition(spotlightTargetRef.current, rect);
            const dx = targetPx.x - current.x;
            const dy = targetPx.y - current.y;
            const distance = Math.hypot(dx, dy);

            if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) {
                spotlightPosRef.current = spotlightTargetRef.current;
                const decayedMotion = decayLiquidMotion(spotlightMotionRef.current);
                spotlightMotionRef.current = decayedMotion;
                flushRef.current?.();
                if (decayedMotion === ZERO_SPOTLIGHT_MOTION) {
                    spotlightFrameRef.current = null;
                    return;
                }
                spotlightFrameRef.current = window.requestAnimationFrame(step);
                return;
            }

            const viscosity = Math.min(
                SPOTLIGHT_CARD_FOLLOW_MAX_VISCOSITY,
                Math.max(SPOTLIGHT_CARD_FOLLOW_MIN_VISCOSITY, distance / SPOTLIGHT_CARD_FOLLOW_DISTANCE_DIVISOR)
            );
            const nextX = current.x + dx * viscosity;
            const nextY = current.y + dy * viscosity;
            const next = {
                x: `${nextX}px`,
                y: `${nextY}px`,
            };
            const nextMotion = resolveLiquidMotion(spotlightMotionRef.current, nextX - current.x, nextY - current.y);
            // 记录有效的 motion 方向，供鼠标静止时使用，避免 bias 突然归零造成主光斑跳跃。
            const motionMag = Math.hypot(nextMotion.x, nextMotion.y);
            if (motionMag > 0.01) {
                lastMotionDirectionRef.current = { x: nextMotion.x / motionMag, y: nextMotion.y / motionMag };
            }
            spotlightPosRef.current = next;
            spotlightMotionRef.current = nextMotion;
            flushRef.current?.();
            spotlightFrameRef.current = window.requestAnimationFrame(step);
        };

        spotlightFrameRef.current = window.requestAnimationFrame(step);
    }, []);

    const releasePointer = useCallback(() => {
        pointerInsideRef.current = false;
        animateSpotlightTo(idleSpotlightPosition, false);
        setOpacity(idleSpotlightOpacity);
        setIsTrackingPointer(false);
    }, [animateSpotlightTo, idleSpotlightOpacity, idleSpotlightPosition]);

    const updatePointerSpotlight = useCallback((clientX: number, clientY: number) => {
        if (!divRef.current) return;

        const rect = divRef.current.getBoundingClientRect();
        cardSizeRef.current = { width: rect.width, height: rect.height };
        if (!pointerInsideRef.current) {
            if (!isInsideEntryZone(clientX, clientY, rect)) return;
            pointerInsideRef.current = true;
            setOpacity(activeSpotlightOpacity);
            setIsTrackingPointer(true);
        }

        if (isPastViewportExitBoundary(clientX, clientY) || !isInsideExitZone(clientX, clientY, rect)) {
            releasePointer();
            return;
        }

        animateSpotlightTo(getClampedCardPoint(clientX, clientY, rect));
    }, [
        activeSpotlightOpacity,
        animateSpotlightTo,
        getClampedCardPoint,
        isInsideEntryZone,
        isInsideExitZone,
        isPastViewportExitBoundary,
        releasePointer,
    ]);

    const syncWithLastPointer = useCallback(() => {
        if (!lastPointerViewportPosition || !divRef.current) return;

        if (!isPointerOwnedByCard(lastPointerViewportPosition.clientX, lastPointerViewportPosition.clientY)) {
            if (pointerInsideRef.current) releasePointer();
            return;
        }

        updatePointerSpotlight(lastPointerViewportPosition.clientX, lastPointerViewportPosition.clientY);
    }, [isPointerOwnedByCard, releasePointer, updatePointerSpotlight]);

    const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
        setLastPointerViewportPosition(e.clientX, e.clientY);
        if (pointerInsideRef.current) return;
        updatePointerSpotlight(e.clientX, e.clientY);
    };

    const handlePointerDown = () => {
        if (fadeOnPointerDown) setOpacity(0);
    };

    useEffect(() => {
        const idlePosition = parseSpotlightPosition(idleSpotlightPosition);
        spotlightTargetRef.current = idlePosition;
        if (!pointerInsideRef.current) {
            animateSpotlightTo(idlePosition, true);
        }
    }, [animateSpotlightTo, idleSpotlightPosition]);

    useEffect(() => () => {
        if (spotlightFrameRef.current !== null) {
            window.cancelAnimationFrame(spotlightFrameRef.current);
        }
    }, []);

    useEffect(() => registerSpotlightScrollController({ syncWithLastPointer }), [syncWithLastPointer]);

    // 直接读 ref 计算 spotlight gradient background 字符串，不经过 React state。
    // 这样在 step 函数高频调用时，避免 setState → React reconcile → fiber walk 的整条路径，
    // 浏览器只在我们调用 spotlightLayerRef.current.style.backgroundImage 这一行时
    // 接到一个 DOM 属性变化，触发该节点的 paint。父级玻璃面板没有 React state 变化，
    // 不进入 reconcile，可减少多余 invalidation。
    const computeSpotlightBackground = useCallback((): string => {
        const cardSize = cardSizeRef.current;
        const position = spotlightPosRef.current;
        const motion = spotlightMotionRef.current;
        const { size: resolvedSpotlightSize, intensity: spotlightIntensity } = resolveSpotlightGeometry(spotlightSize, cardSize, spotlightSizing);
        const liquidPosition = toPixelPositionInSize(position, cardSize);
        const pressureDistance = Math.max(
            SPOTLIGHT_CARD_LIQUID_PRESSURE_MIN_DISTANCE,
            resolvedSpotlightSize * SPOTLIGHT_CARD_LIQUID_PRESSURE_SIZE_RATIO
        );
        const leftPressure = cardSize.width ? smoothPressure((pressureDistance - liquidPosition.x) / pressureDistance) : 0;
        const rightPressure = cardSize.width ? smoothPressure((pressureDistance - (cardSize.width - liquidPosition.x)) / pressureDistance) : 0;
        const topPressure = cardSize.height ? smoothPressure((pressureDistance - liquidPosition.y) / pressureDistance) : 0;
        const bottomPressure = cardSize.height ? smoothPressure((pressureDistance - (cardSize.height - liquidPosition.y)) / pressureDistance) : 0;
        const horizontalPressure = Math.max(leftPressure, rightPressure);
        const verticalPressure = Math.max(topPressure, bottomPressure);
        const cornerPressure = Math.max(
            Math.min(leftPressure, topPressure),
            Math.min(leftPressure, bottomPressure),
            Math.min(rightPressure, topPressure),
            Math.min(rightPressure, bottomPressure)
        );
        const liquidMotionDistance = Math.hypot(motion.x, motion.y);
        // 跟踪鼠标期间（pointerInside），即使 motion.speed 衰减到 0（鼠标静止），
        // 也强制 motion strength 保持在最大值（FLOOR + RANGE = 0.68）。
        // 这样 spotlight 移动→静止时，主光斑形状/trail 不会突然收缩。
        // 鼠标离开 spotlight（pointerInside=false）时，按 motion 自然衰减，
        // 是 release 过渡，不会感知到"跳跃"。
        const rawLiquidMotionStrength = resolveLiquidMotionStrength(clamp01(motion.speed));
        const liquidMotionStrength = pointerInsideRef.current
            ? Math.max(rawLiquidMotionStrength, SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_FLOOR + SPOTLIGHT_CARD_LIQUID_MOTION_STRENGTH_RANGE)
            : rawLiquidMotionStrength;
        // 跟踪期间，若 motion 已归零（鼠标静止），用最近一次有效方向作为 bias 来源；
        // 否则会因 bias=0 导致主光斑拉长项归零、形状跳跃。
        const useFallbackDirection = pointerInsideRef.current && liquidMotionDistance < 0.01;
        const liquidMotionX = useFallbackDirection
            ? lastMotionDirectionRef.current.x
            : (liquidMotionDistance ? motion.x / liquidMotionDistance : 0);
        const liquidMotionY = useFallbackDirection
            ? lastMotionDirectionRef.current.y
            : (liquidMotionDistance ? motion.y / liquidMotionDistance : 0);
        const liquidMotionHorizontalBias = Math.abs(liquidMotionX);
        const liquidMotionVerticalBias = Math.abs(liquidMotionY);
        const liquidMainWidth = Math.round(resolvedSpotlightSize * (0.86 - horizontalPressure * SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_COMPRESSION + verticalPressure * SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_EXPANSION + liquidMotionHorizontalBias * liquidMotionStrength * SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH - cornerPressure * 0.06));
        const liquidMainHeight = Math.round(resolvedSpotlightSize * (0.86 - verticalPressure * SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_COMPRESSION + horizontalPressure * SPOTLIGHT_CARD_LIQUID_MAIN_EDGE_EXPANSION + liquidMotionVerticalBias * liquidMotionStrength * SPOTLIGHT_CARD_LIQUID_MOTION_MAIN_STRETCH - cornerPressure * 0.06));
        const liquidLeftWidth = Math.round(resolvedSpotlightSize * (0.3 + leftPressure * 0.34));
        const liquidLeftHeight = Math.round(resolvedSpotlightSize * (0.98 + leftPressure * SPOTLIGHT_CARD_LIQUID_SIDE_STRETCH));
        const liquidRightWidth = Math.round(resolvedSpotlightSize * (0.3 + rightPressure * 0.34));
        const liquidRightHeight = Math.round(resolvedSpotlightSize * (0.98 + rightPressure * SPOTLIGHT_CARD_LIQUID_SIDE_STRETCH));
        const liquidTopWidth = Math.round(resolvedSpotlightSize * (0.98 + topPressure * SPOTLIGHT_CARD_LIQUID_CAP_STRETCH));
        const liquidTopHeight = Math.round(resolvedSpotlightSize * (0.26 + topPressure * 0.24));
        const liquidBottomWidth = Math.round(resolvedSpotlightSize * (0.98 + bottomPressure * SPOTLIGHT_CARD_LIQUID_CAP_STRETCH));
        const liquidBottomHeight = Math.round(resolvedSpotlightSize * (0.26 + bottomPressure * 0.24));
        const liquidTrailOffset = resolvedSpotlightSize * SPOTLIGHT_CARD_LIQUID_TRAIL_OFFSET_RATIO * liquidMotionStrength;
        const liquidTrailX = `${clamp(liquidPosition.x - liquidMotionX * liquidTrailOffset, -resolvedSpotlightSize, cardSize.width + resolvedSpotlightSize)}px`;
        const liquidTrailY = `${clamp(liquidPosition.y - liquidMotionY * liquidTrailOffset, -resolvedSpotlightSize, cardSize.height + resolvedSpotlightSize)}px`;
        const liquidTrailWidth = Math.round(resolvedSpotlightSize * (0.42 + liquidMotionStrength * (0.24 + liquidMotionHorizontalBias * SPOTLIGHT_CARD_LIQUID_TRAIL_STRETCH)));
        const liquidTrailHeight = Math.round(resolvedSpotlightSize * (0.42 + liquidMotionStrength * (0.24 + liquidMotionVerticalBias * SPOTLIGHT_CARD_LIQUID_TRAIL_STRETCH)));
        const resolvedSpotlightColor = scaleRgbaAlpha(spotlightColor, spotlightIntensity);
        const liquidTrailColor = scaleRgbaAlpha(resolvedSpotlightColor, SPOTLIGHT_CARD_LIQUID_TRAIL_ALPHA_SCALE * liquidMotionStrength);
        const liquidLeftColor = liquidTone(liquidSpotlightTone, (0.025 + leftPressure * 0.08) * spotlightIntensity);
        const liquidRightColor = liquidTone(liquidSpotlightTone, (0.022 + rightPressure * 0.072) * spotlightIntensity);
        const liquidTopColor = liquidTone(liquidSpotlightTone, topPressure * 0.052 * spotlightIntensity);
        const liquidBottomColor = liquidTone(liquidSpotlightTone, bottomPressure * 0.052 * spotlightIntensity);
        const liquidEdgeColor = liquidTone(liquidSpotlightTone, (0.018 + horizontalPressure * 0.04) * spotlightIntensity);
        const liquidEdgeSoftColor = liquidTone(liquidSpotlightTone, (0.014 + horizontalPressure * 0.032) * spotlightIntensity);

        const liquidEdgeBackground = liquidEdgeGlow
            ? `,
                radial-gradient(${liquidLeftWidth}px ${liquidLeftHeight}px at 2% ${position.y}, ${liquidLeftColor}, transparent 64%),
                radial-gradient(${liquidRightWidth}px ${liquidRightHeight}px at 98% ${position.y}, ${liquidRightColor}, transparent 64%),
                radial-gradient(${liquidTopWidth}px ${liquidTopHeight}px at ${position.x} 2%, ${liquidTopColor}, transparent 66%),
                radial-gradient(${liquidBottomWidth}px ${liquidBottomHeight}px at ${position.x} 98%, ${liquidBottomColor}, transparent 66%),
                linear-gradient(90deg, transparent 0%, ${liquidEdgeColor} 7%, transparent 18%, transparent 82%, ${liquidEdgeSoftColor} 93%, transparent 100%)`
            : '';
        return liquidSpotlight
            ? `
                radial-gradient(${liquidMainWidth}px ${liquidMainHeight}px at ${position.x} ${position.y}, ${resolvedSpotlightColor}, transparent 68%),
                radial-gradient(${liquidTrailWidth}px ${liquidTrailHeight}px at ${liquidTrailX} ${liquidTrailY}, ${liquidTrailColor}, transparent 72%)${liquidEdgeBackground}
            `
            : `radial-gradient(${resolvedSpotlightSize}px circle at ${position.x} ${position.y}, ${resolvedSpotlightColor}, transparent 38%)`;
    }, [spotlightSize, spotlightSizing, spotlightColor, liquidSpotlight, liquidSpotlightTone, liquidEdgeGlow]);

    // 把当前 spotlightBackground 直接写入 DOM
    const flushSpotlightBackground = useCallback(() => {
        const node = spotlightLayerRef.current;
        if (!node) return;
        node.style.backgroundImage = computeSpotlightBackground();
    }, [computeSpotlightBackground]);

    // ref 化 flush 函数，让 animateSpotlightTo 和 step 函数（useCallback []）能稳定引用它
    const flushRef = useRef(flushSpotlightBackground);
    flushRef.current = flushSpotlightBackground;

    // mount 时和 props 变化时（影响 background 计算）刷新一次 DOM 背景
    useEffect(() => {
        // 测量初始 cardSize
        const node = divRef.current;
        if (node) {
            const rect = node.getBoundingClientRect();
            cardSizeRef.current = { width: rect.width, height: rect.height };
        }
        flushSpotlightBackground();
    }, [flushSpotlightBackground]);

    // 容器尺寸变化时也要刷新（cardSize 影响 spotlight 大小和位置）
    useEffect(() => {
        const node = divRef.current;
        if (!node) return;
        let ro: ResizeObserver | null = null;
        try {
            ro = new ResizeObserver(() => {
                const rect = node.getBoundingClientRect();
                cardSizeRef.current = { width: rect.width, height: rect.height };
                flushRef.current?.();
            });
            ro.observe(node);
        } catch {
            // ignore
        }
        return () => { ro?.disconnect(); };
    }, []);

    useEffect(() => {
        if (!isTrackingPointer) return;

        const handleWindowPointerMove = (event: PointerEvent) => {
            setLastPointerViewportPosition(event.clientX, event.clientY);
            if (!isPointerOwnedByCard(event.clientX, event.clientY)) {
                releasePointer();
                return;
            }
            updatePointerSpotlight(event.clientX, event.clientY);
        };

        const handleWindowPointerOut = (event: PointerEvent) => {
            if (!pointerInsideRef.current || event.relatedTarget) return;
            releasePointer();
        };

        const handleWindowBlur = () => {
            releasePointer();
        };

        window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
        window.addEventListener('pointerout', handleWindowPointerOut);
        window.addEventListener('blur', handleWindowBlur);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerout', handleWindowPointerOut);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [isPointerOwnedByCard, isTrackingPointer, releasePointer, updatePointerSpotlight]);

    const setRefs = useCallback((node: HTMLElement | null) => {
        divRef.current = node;
        if (typeof forwardedRef === 'function') {
            forwardedRef(node);
        } else if (forwardedRef) {
            forwardedRef.current = node;
        }
    }, [forwardedRef]);

    return React.createElement(
        CardComponent as any,
        {
            ...props,
            ref: setRefs,
            onPointerMove: handlePointerMove,
            onPointerDown: handlePointerDown,
            style: {
                ...style,
                // Bug 修复：原本用 `overflow: clip` + `overflowClipMargin` 让边缘内反光
                // 可以越界 1px。但在 .bambook-os-root 的 `zoom: var(--ui-lab-app-scale)` 上下文
                // 中，`overflow: clip` 在某些浏览器版本会静默失效，导致内部巨大的 radial-gradient
                // 光斑（半径 460~520px）从窄长容器（如 sidebar 270px、Assistant 主面板）
                // 向外溢出，hover 时形成整窗高、横跨数百 px 的"幽灵透明光层"。
                // 改用 `overflow: hidden`：hidden 行为不受 zoom 影响，可靠裁切。
                // 副作用：失去了 1px 的边缘 light bleed，但视觉上几乎不可见，权衡可接受。
                overflow: 'hidden',
            } as React.CSSProperties,
            className: `relative isolate ${className}`,
        },
        children,
        (
            <div
                className="pointer-events-none absolute -inset-px z-20 overflow-hidden rounded-[inherit]"
                data-spotlight-scope={SPOTLIGHT_CARD_LIGHT_SCOPE}
                aria-hidden="true"
            >
                <div
                    ref={spotlightLayerRef}
                    className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
                    style={{
                        opacity,
                        backgroundClip: SPOTLIGHT_CARD_LIGHT_SCOPE,
                    }}
                />
            </div>
        ),
    );
});

SpotlightCard.displayName = 'SpotlightCard';
