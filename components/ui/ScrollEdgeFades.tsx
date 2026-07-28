import React, { RefObject, useEffect, useState } from 'react';

export interface ScrollEdgeMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface ScrollEdgeFadeState {
  showTop: boolean;
  showBottom: boolean;
}

export interface ScrollEdgeBounds {
  viewportTop: number;
  viewportBottom: number;
  firstContentTop: number;
  lastContentBottom: number;
  topBoundary?: number;
  bottomBoundary?: number;
  edgeEpsilon?: number;
}

interface ScrollEdgeFadeOptions {
  edgeEpsilon?: number;
  topContentInset?: number;
  bottomContentInset?: number;
}

interface ScrollEdgeFadesProps {
  scrollRef: RefObject<HTMLElement | null>;
  maskRef?: RefObject<HTMLElement | null>;
  isDarkMode?: boolean;
  variant?: 'subtle' | 'normal' | 'strong';
  renderMode?: 'content-mask';
  topHeight?: number;
  bottomHeight?: number;
  zIndex?: number | string;
  topOffset?: number;
  bottomOffset?: number;
  topFadeStartOffset?: number;
  topFadeCurve?: 'linear' | 'steep';
  topContentInset?: number;
  bottomContentInset?: number;
  disableTop?: boolean;
  disableBottom?: boolean;
}

const EDGE_EPSILON = 2;

const readUiLabAppScale = (element: HTMLElement) => {
  const root = element.closest<HTMLElement>('.ui-lab-real-os-root');
  if (!root) return 1;

  const parsed = Number.parseFloat(window.getComputedStyle(root).getPropertyValue('--ui-lab-app-scale'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export function getScrollEdgeFadeState(
  metrics: ScrollEdgeMetrics,
  options: ScrollEdgeFadeOptions | number = {},
): ScrollEdgeFadeState {
  const resolvedOptions = typeof options === 'number' ? { edgeEpsilon: options } : options;
  const edgeEpsilon = resolvedOptions.edgeEpsilon ?? EDGE_EPSILON;
  const topContentInset = resolvedOptions.topContentInset ?? 0;
  const bottomContentInset = resolvedOptions.bottomContentInset ?? 0;
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const lastContentTouchScrollTop = Math.max(0, maxScrollTop - bottomContentInset);
  const hasOverflow = maxScrollTop > edgeEpsilon;

  if (!hasOverflow) {
    return { showTop: false, showBottom: false };
  }

  return {
    showTop: metrics.scrollTop > edgeEpsilon,
    showBottom: metrics.scrollTop < lastContentTouchScrollTop - edgeEpsilon,
  };
}

export function getScrollEdgeFadeStateFromBounds(bounds: ScrollEdgeBounds): ScrollEdgeFadeState {
  const edgeEpsilon = bounds.edgeEpsilon ?? EDGE_EPSILON;
  const topBoundary = bounds.topBoundary ?? bounds.viewportTop;
  const bottomBoundary = bounds.bottomBoundary ?? bounds.viewportBottom;

  return {
    showTop: bounds.firstContentTop < topBoundary - edgeEpsilon,
    showBottom: bounds.lastContentBottom > bottomBoundary + edgeEpsilon,
  };
}

const readPixels = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isAtScrollBottom = (element: HTMLElement) =>
  element.scrollTop + element.clientHeight >= element.scrollHeight - EDGE_EPSILON;

const readScrollState = (
  element: HTMLElement,
  topContentInset?: number,
  bottomContentInset?: number,
) => {
  const elementStyle = window.getComputedStyle(element);
  const firstChild = element.firstElementChild instanceof HTMLElement ? element.firstElementChild : null;
  const childStyle = firstChild ? window.getComputedStyle(firstChild) : null;
  const measuredTopInset = Math.max(
    readPixels(elementStyle.paddingTop),
    childStyle ? readPixels(childStyle.paddingTop) : 0,
  );
  const measuredBottomInset = Math.max(
    readPixels(elementStyle.paddingBottom),
    childStyle ? readPixels(childStyle.paddingBottom) : 0,
  );

  const scrollState = getScrollEdgeFadeState({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }, {
    topContentInset: topContentInset ?? measuredTopInset,
    bottomContentInset: bottomContentInset ?? measuredBottomInset,
  });

  if (isAtScrollBottom(element)) {
    return {
      ...scrollState,
      showBottom: false,
    };
  }

  const bottomSentinel = element.querySelector<HTMLElement>('[data-scroll-edge-bottom-sentinel]');

  if (bottomSentinel) {
    const viewportRect = element.getBoundingClientRect();
    const sentinelRect = bottomSentinel.getBoundingClientRect();

    return {
      ...scrollState,
      showBottom: sentinelRect.top > viewportRect.bottom - EDGE_EPSILON,
    };
  }

  return scrollState;
};

const buildContentMask = (
  state: ScrollEdgeFadeState,
  topHeight: number,
  bottomHeight: number,
  topOffset = 0,
  topFadeStartOffset = 0,
  topFadeCurve: 'linear' | 'steep' = 'linear',
) => {
  if (!state.showTop && !state.showBottom) return '';

  const topSafeHeight = Math.max(0, topOffset);
  const topFadeStart = topSafeHeight + Math.max(0, topFadeStartOffset);
  const topStart = topSafeHeight > 0
    ? `black 0px, black ${topSafeHeight}px, transparent ${topSafeHeight}px, `
    : topFadeStart > 0
      ? `transparent 0px, transparent ${topFadeStart}px, `
      : 'transparent 0px, ';
  const topEnd = topFadeStart + topHeight;
  const topRamp = topFadeCurve === 'steep'
    ? `${topStart}rgba(0,0,0,0.04) ${topFadeStart + Math.round(topHeight * 0.22)}px, rgba(0,0,0,0.82) ${topFadeStart + Math.round(topHeight * 0.58)}px, black ${topEnd}px`
    : `${topStart}black ${topEnd}px`;

  if (state.showTop && state.showBottom) {
    return `linear-gradient(to bottom, ${topRamp}, black calc(100% - ${bottomHeight}px), transparent 100%)`;
  }

  if (state.showTop) {
    return `linear-gradient(to bottom, ${topRamp}, black 100%)`;
  }

  return `linear-gradient(to bottom, black 0%, black calc(100% - ${bottomHeight}px), transparent 100%)`;
};

export const ScrollEdgeFades: React.FC<ScrollEdgeFadesProps> = ({
  scrollRef,
  maskRef,
  renderMode = 'content-mask',
  topHeight = 96,
  bottomHeight = 112,
  topOffset = 0,
  topFadeStartOffset = 0,
  topFadeCurve = 'linear',
  topContentInset,
  bottomContentInset,
  disableTop = false,
  disableBottom = false,
}) => {
  const [state, setState] = useState<ScrollEdgeFadeState>({ showTop: false, showBottom: false });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let frame = 0;
    const update = () => setState(readScrollState(element, topContentInset, bottomContentInset));
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    update();
    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null;
    resizeObserver?.observe(element);
    if (element.firstElementChild) {
      resizeObserver?.observe(element.firstElementChild);
    }

    const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleUpdate) : null;
    mutationObserver?.observe(element, { childList: true, subtree: true, attributes: true });

    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottomContentInset, scrollRef, topContentInset]);

  useEffect(() => {
    if (renderMode !== 'content-mask') return;

    const element = maskRef?.current ?? scrollRef.current;
    if (!element) return;

    const resolvedState = {
      showTop: disableTop ? false : state.showTop,
      showBottom: disableBottom ? false : state.showBottom,
    };
    const appScale = readUiLabAppScale(element);
    const mask = buildContentMask(
      resolvedState,
      topHeight / appScale,
      bottomHeight / appScale,
      topOffset / appScale,
      topFadeStartOffset / appScale,
      topFadeCurve,
    );
    element.style.maskImage = mask;
    element.style.webkitMaskImage = mask;

    return () => {
      element.style.maskImage = '';
      element.style.webkitMaskImage = '';
    };
  }, [bottomHeight, disableBottom, disableTop, maskRef, renderMode, scrollRef, state, topFadeCurve, topFadeStartOffset, topHeight, topOffset]);

  return null;
};

export default ScrollEdgeFades;
