import { useEffect, type RefObject } from 'react';

export interface StaticEdgeMaskOptions {
  /** 顶部渐隐终点（px）：滚离顶部后，视口顶到该距离内容由透明渐至不透明，默认 32 */
  topFadeEnd?: number;
  /** 底部渐隐高度（px）：滚离底部后，视口底部该距离内内容渐隐至透明，默认 48 */
  bottomFade?: number;
  /** 是否启用（如仅 grid 模式启用），默认 true */
  enabled?: boolean;
}

const EDGE_EPSILON = 2;

const buildMask = (showTop: boolean, showBottom: boolean, topFadeEnd: number, bottomFade: number) => {
  if (!showTop && !showBottom) return '';
  const top = showTop ? `transparent 0px, #000 ${topFadeEnd}px` : '#000 0px';
  const bottom = showBottom ? `#000 calc(100% - ${bottomFade}px), transparent 100%` : '#000 100%';
  return `linear-gradient(to bottom, ${top}, ${bottom})`;
};

/**
 * useStaticEdgeMask — 边缘渐隐 mask，直接挂在滚动容器自身。
 *
 * 与其他 ScrollEdgeFades 单参（scrollRef）页面同路径：
 *   1. 真透明度渐隐——mask 让内容自身在视口边缘淡出，而非覆盖背景色带；
 *   2. 滚到顶/滚到底时对应方向渐隐自动取消（与 ScrollEdgeFades 行为一致）；
 *   3. 不抖动——mask 字符串仅 4 种稳定组合（无逐帧变量），rAF 节流 + 缓存比较，
 *      只在越过 2px 阈值时写一次 DOM，滚动过程中零重算零重写；
 *   4. mask 在滚动容器合成路径末端应用，不截断内部卡片 backdrop-filter 采样
 *      （静止外壳挂 mask 才会截断，导致 hover 毛玻璃失效）；
 *   5. 渐隐区贴滚动视口边缘，无多余留白；
 *   6. 延迟挂载自愈——ref.current 在 AnimatePresence mode="wait" 等场景下 effect
 *      运行时可能仍为 null，rAF 轮询直到元素挂载再绑定监听；内容异步增长
 *      （数据加载/列表增删）由 MutationObserver 触发边缘状态重判。
 */
export const useStaticEdgeMask = (
  ref: RefObject<HTMLElement | null>,
  { topFadeEnd = 32, bottomFade = 48, enabled = true }: StaticEdgeMaskOptions = {},
) => {
  useEffect(() => {
    if (!enabled) return undefined;

    let el: HTMLElement | null = null;
    let raf = 0;
    let pollId = 0;
    let lastMask: string | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const apply = () => {
      if (!el) return;
      const showTop = el.scrollTop > EDGE_EPSILON;
      const showBottom = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_EPSILON;
      const mask = buildMask(showTop, showBottom, topFadeEnd, bottomFade);
      if (mask === lastMask) return;
      lastMask = mask;
      el.style.maskImage = mask;
      el.style.webkitMaskImage = mask;
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    const bind = (target: HTMLElement) => {
      el = target;
      apply();
      target.addEventListener('scroll', schedule, { passive: true });
      // 视口尺寸变化（窗口缩放/布局变更）时重判
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(target);
      // 内容异步增长（数据加载/列表增删/tab 切换内容挂载）时重判边缘状态
      mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(target, { childList: true, subtree: true });
    };

    // ref.current 可能因条件渲染/AnimatePresence 延迟挂载尚为 null——rAF 轮询直到元素出现
    const poll = () => {
      const target = ref.current;
      if (target) {
        bind(target);
        return;
      }
      pollId = requestAnimationFrame(poll);
    };
    poll();

    return () => {
      cancelAnimationFrame(pollId);
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (el) {
        el.removeEventListener('scroll', schedule);
        el.style.maskImage = '';
        el.style.webkitMaskImage = '';
      }
    };
  }, [ref, topFadeEnd, bottomFade, enabled]);
};
