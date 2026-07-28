export const PHONE_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

let pageZoomGuardInstalled = false;
let phoneZoomGuardInstalled = false;

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

export function installPhoneZoomGuard() {
  if (typeof document === 'undefined') return;

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) {
    viewport.content = PHONE_VIEWPORT_CONTENT;
  }

  if (phoneZoomGuardInstalled) return;
  phoneZoomGuardInstalled = true;

  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  document.addEventListener('touchmove', preventPinch, { passive: false });
}
