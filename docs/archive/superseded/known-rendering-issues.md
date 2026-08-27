# Known Rendering Issues

This document records rendering-level issues that are easy to misdiagnose in Bambook OS. Use it before changing material tokens or shared glass primitives.

Last reviewed: 2026-06-11

## Light Glass Horizontal Banding

### Symptom

In the main Electron app, light-mode glass containers can show subtle horizontal bands that look like ribs or ledges.

Observed traits:

- Visible on large glass surfaces such as sidebar, settings panels, and assistant workspace.
- Much more visible in light mode than dark mode.
- Band spacing grows as the glass container becomes taller.
- The issue appears on the glass surface, not on ordinary text or plain background.

### Root Cause

The confirmed cause is 8-bit gradient color banding in low-alpha, full-height vertical gradients used by the active OS material layers.

Relevant active material variables live in `styles/os-vnext.css`, especially:

- `--ui-lab-panel-highlight-background`
- `--ui-lab-panel-surface-background`
- related light-mode `linear-gradient(180deg, ...)` layers used by `::before` / `::after` and glass material scopes

These gradients use very small alpha differences, for example values around `0.070 -> 0.018` or lower. In an 8-bit rendering path, that provides only a small number of visible color steps. When stretched across a tall container, each step becomes a broad horizontal region.

Electron/Chromium can rasterize these low-alpha gradients into a low-precision intermediate texture before later overlay layers are composited. If the banding has already been baked into that texture, adding a separate dither layer above it may not break the underlying gradient steps.

### What Was Ruled Out

Do not start with these unless new evidence points there:

- Old SVG noise in `index.css`: in current OS roots, `styles/os-vnext.css` overrides the active glass material.
- `--ui-lab-panel-glass-film-background` radial sizing alone: fixed-pixel radial gradients did not remove the bands.
- Removing or weakening `backdrop-filter`: this changes the design language and does not identify the real material layer.
- UI Lab root assumptions: the acceptance surface was the main app under `.bambook-os-root`.

### Debugging Order

1. Confirm the issue is in the main app root `.bambook-os-root`.
2. Inspect the rendered glass element and its `::before` / `::after` computed styles.
3. Check `--ui-lab-panel-highlight-background` and `--ui-lab-panel-surface-background`.
4. Look for full-height `linear-gradient(180deg, ...)` with very small alpha deltas.
5. Test changes on the active scoped material in `styles/os-vnext.css`, not on old `index.css` noise.

### Fix Direction

Preserve the glass material and blur. Prefer fixes that remove or constrain the full-height low-alpha gradient banding source:

- Replace full-height low-alpha vertical gradients with fixed-range highlights where appropriate.
- Avoid extremely small alpha-delta `180deg` gradients over tall panels.
- If using dither, it must be part of the effective material layer or otherwise interact before banding is baked into the rendered texture.

Do not remove the frosted glass effect as a workaround.

