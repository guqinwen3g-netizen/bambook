export type BambookDeviceMode = 'phone' | 'tablet' | 'desktop';

export function detectDeviceMode(win: Window = window): BambookDeviceMode {
  const forcedMode = new URLSearchParams(win.location.search).get('bambookDevice');
  if (forcedMode === 'phone' || forcedMode === 'tablet' || forcedMode === 'desktop') return forcedMode;

  const width = win.innerWidth || win.screen?.width || 1024;
  const hasCoarsePointer = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = (win.navigator.maxTouchPoints || 0) > 0 || hasCoarsePointer;

  if (hasTouch && width < 768) return 'phone';
  if (hasTouch && width < 1180) return 'tablet';
  return 'desktop';
}
