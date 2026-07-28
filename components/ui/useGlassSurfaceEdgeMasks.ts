import { RefObject, useEffect } from 'react';

const EDGE_EPSILON = 2;
const GLASS_SURFACE_SELECTOR = '[data-glass-edge-mask]';
const MASKABLE_SURFACE_SELECTOR = GLASS_SURFACE_SELECTOR;

type EdgeFadeActivation = 'zone' | 'clip';

type UseGlassSurfaceEdgeMasksOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  scopeSelector?: string | null;
  surfaceSelector?: string;
  topHeight?: number;
  bottomHeight?: number;
  shadowCasterBottomHeight?: number;
  topFadeActivation?: EdgeFadeActivation;
  bottomFadeActivation?: EdgeFadeActivation;
  topFadeStartOffset?: number;
  bottomFadeEndOffset?: number;
  bottomContentInset?: number;
  syncWheelScroll?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const clearSurfaceMask = (surface: HTMLElement) => {
  surface.style.maskImage = '';
  surface.style.webkitMaskImage = '';
  surface.style.pointerEvents = '';
};

const hiddenSurfaceMask = 'linear-gradient(transparent, transparent)';

const readUiLabAppScale = (element: HTMLElement) => {
  const root = element.closest<HTMLElement>('.ui-lab-real-os-root');
  if (!root) return 1;

  const parsed = Number.parseFloat(window.getComputedStyle(root).getPropertyValue('--ui-lab-app-scale'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const scaleRect = (rect: DOMRect, scale: number) => ({
  top: rect.top / scale,
  bottom: rect.bottom / scale,
  height: rect.height / scale,
} as DOMRect);

const getScrollState = (element: HTMLElement, bottomContentInset = 0) => {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const hasOverflow = maxScrollTop > EDGE_EPSILON;
  const showTop = hasOverflow && element.scrollTop > EDGE_EPSILON;
  const showBottom = hasOverflow && element.scrollTop < Math.max(0, maxScrollTop - bottomContentInset) - EDGE_EPSILON;

  return { showTop, showBottom };
};

const resolveWheelDeltaY = (event: WheelEvent, scroller: HTMLElement) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * scroller.clientHeight;
  return event.deltaY;
};

export const buildGlassSurfaceMask = (
  surfaceRect: DOMRect,
  viewportRect: DOMRect,
  state: { showTop: boolean; showBottom: boolean },
  topHeight: number,
  bottomHeight: number,
  topFadeActivation: EdgeFadeActivation,
  bottomFadeActivation: EdgeFadeActivation,
  topFadeStartOffset: number,
  bottomFadeEndOffset = 0,
) => {
  const height = surfaceRect.height;
  if (height <= 0) return '';

  const topZoneStart = viewportRect.top + topFadeStartOffset;
  const topZoneEnd = topZoneStart + topHeight;
  const bottomZoneEnd = viewportRect.bottom;
  const bottomTransparentStop = bottomZoneEnd - bottomFadeEndOffset;
  const bottomZoneStart = bottomTransparentStop - bottomHeight;

  if (state.showTop && surfaceRect.bottom <= topZoneStart) {
    return hiddenSurfaceMask;
  }

  if (state.showBottom && surfaceRect.top >= bottomZoneEnd) {
    return hiddenSurfaceMask;
  }

  const topActivationEdge = topFadeActivation === 'clip' ? topZoneStart : topZoneEnd;
  const topActive = state.showTop && surfaceRect.top < topActivationEdge;
  const bottomActivationEdge = bottomFadeActivation === 'clip' ? bottomZoneEnd : bottomZoneStart;
  const bottomActive = state.showBottom && surfaceRect.bottom > bottomActivationEdge;

  if (!topActive && !bottomActive) return '';

  const stops: string[] = [];

  if (topActive) {
    const rawTopStart = Math.max(0, topZoneStart - surfaceRect.top);
    const rawTopEnd = Math.max(rawTopStart, topZoneEnd - surfaceRect.top);
    stops.push(`transparent 0px`, `transparent ${rawTopStart}px`, `black ${rawTopEnd}px`, `black 100%`);
  }

  if (bottomActive) {
    const rawBottomStart = bottomZoneStart - surfaceRect.top;
    const rawBottomTransparentStop = Math.max(
      rawBottomStart,
      Math.min(bottomTransparentStop, surfaceRect.bottom) - surfaceRect.top,
    );
    stops.push(
      ...(rawBottomStart > 0 ? [`black 0px`] : []),
      `black ${rawBottomStart}px`,
      `transparent ${rawBottomTransparentStop}px`,
      `transparent 100%`,
    );
  }

  return `linear-gradient(to bottom, ${stops.join(', ')})`;
};

export function useGlassSurfaceEdgeMasks({
  scrollRef,
  enabled = true,
  scopeSelector = '.ui-lab-real-os-root',
  surfaceSelector = MASKABLE_SURFACE_SELECTOR,
  topHeight = 72,
  bottomHeight = 96,
  topFadeActivation = 'clip',
  bottomFadeActivation = 'clip',
  topFadeStartOffset = 0,
  bottomFadeEndOffset = 0,
  bottomContentInset = 0,
  syncWheelScroll = false,
}: UseGlassSurfaceEdgeMasksOptions) {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    if (scopeSelector && !scroller.closest(scopeSelector)) return;

    let frame = 0;
    const getSurfaces = () => Array.from(scroller.querySelectorAll<HTMLElement>(surfaceSelector));

    const updateSurfaceMasks = () => {
      frame = 0;
      const appScale = readUiLabAppScale(scroller);
      const scrollerRect = scroller.getBoundingClientRect();
      const viewportRect = scaleRect(scrollerRect, appScale);
      const state = getScrollState(scroller, bottomContentInset);

      getSurfaces().forEach((surface) => {
        const surfaceRect = scaleRect(surface.getBoundingClientRect(), appScale);
        const mask = buildGlassSurfaceMask(
          surfaceRect,
          viewportRect,
          state,
          topHeight / appScale,
          bottomHeight / appScale,
          topFadeActivation,
          bottomFadeActivation,
          topFadeStartOffset / appScale,
          bottomFadeEndOffset / appScale,
        );

        if (!mask) {
          clearSurfaceMask(surface);
          return;
        }

        surface.style.maskImage = mask;
        surface.style.webkitMaskImage = mask;
        surface.style.pointerEvents = mask === hiddenSurfaceMask ? 'none' : '';
      });
    };

    const updateOnScroll = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      updateSurfaceMasks();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!syncWheelScroll || event.defaultPrevented) return;

      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const nextScrollTop = clamp(scroller.scrollTop + resolveWheelDeltaY(event, scroller), 0, maxScrollTop);
      if (nextScrollTop === scroller.scrollTop) return;

      event.preventDefault();
      scroller.scrollTop = nextScrollTop;
      updateOnScroll();
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateSurfaceMasks);
    };

    updateSurfaceMasks();
    scroller.addEventListener('wheel', handleWheel, { passive: false });
    scroller.addEventListener('scroll', updateOnScroll, { passive: true });
    window.addEventListener('resize', schedule);

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(scroller);
    resizeObserver?.observe(scroller.firstElementChild ?? scroller);

    const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    mutationObserver?.observe(scroller, { childList: true, subtree: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      getSurfaces().forEach(clearSurfaceMask);
      scroller.removeEventListener('wheel', handleWheel);
      scroller.removeEventListener('scroll', updateOnScroll);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottomContentInset, bottomFadeActivation, bottomFadeEndOffset, bottomHeight, enabled, scopeSelector, scrollRef, surfaceSelector, syncWheelScroll, topFadeActivation, topFadeStartOffset, topHeight]);
}
