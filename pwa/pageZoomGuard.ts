let pageZoomGuardInstalled = false;

export function installPageZoomGuard() {
  if (pageZoomGuardInstalled || typeof document === 'undefined') return;
  pageZoomGuardInstalled = true;

  const preventTrackpadPageZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  };

  const preventGesture = (event: Event) => {
    event.preventDefault();
  };

  document.addEventListener('wheel', preventTrackpadPageZoom, { capture: true, passive: false });
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
}
