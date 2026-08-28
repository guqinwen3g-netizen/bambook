import { useEffect, type RefObject } from 'react';

export interface StaticEdgeMaskOptions {
  /** 顶部渐隐终点（px）：从视口顶到该距离内容由透明渐至完全不透明，默认 32 */
  topFadeEnd?: number;
  /** 底部渐隐高度（px）：视口底部该距离内内容渐隐至透明，默认 48 */
  bottomFade?: number;
  /** 是否启用（如仅 grid 模式启用），默认 true */
  enabled?: boolean;
}

/**
 * useStaticEdgeMask — 固定边缘渐隐 mask，直接挂在滚动容器自身。
 *
 * 与其他 8 个 ScrollEdgeFades 单参（scrollRef）页面同路径：
 *   1. 真透明度渐隐——mask 让内容自身在视口边缘淡出，而非覆盖背景色带；
 *   2. 一次设置、不监听滚动 → 无 JS 逐帧重算，渐变不抖动；
 *   3. mask 在滚动容器合成路径末端应用，不截断内部卡片 backdrop-filter 采样
 *      （静止外壳挂 mask 才会截断，导致 hover 毛玻璃失效）；
 *   4. 渐隐区贴滚动视口边缘，无多余留白。
 */
export const useStaticEdgeMask = (
  ref: RefObject<HTMLElement | null>,
  { topFadeEnd = 32, bottomFade = 48, enabled = true }: StaticEdgeMaskOptions = {},
) => {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    const mask = `linear-gradient(to bottom, transparent 0px, #000 ${topFadeEnd}px, #000 calc(100% - ${bottomFade}px), transparent 100%)`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
    return () => {
      el.style.maskImage = '';
      el.style.webkitMaskImage = '';
    };
  }, [ref, topFadeEnd, bottomFade, enabled]);
};
