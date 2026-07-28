# Tokens

Bambook OS uses three token layers.

## Primitive Tokens

Primitive tokens are exact values:

- Color values.
- Radius.
- Blur.
- Shadow geometry.
- Motion timing.
- Font sizes.
- Spacing steps.

They live mainly in `styles/os-vnext.css`.

Rule: primitive tokens are not consumed directly by pages unless no semantic token exists.

## Semantic Tokens

Semantic tokens describe visual meaning:

- `framePanel`
- `raisedCard`
- `insetSurface`
- `floatingOverlay`
- `selectedSurface`
- `recessedField`
- `actionControl`
- `stateControl`
- `chip`
- `status`
- `desktopPageFrameClass`
- `desktopPanelRowClass`
- `desktopSinglePanelBodyClass`
- `desktopSplitNavPanelClass`
- `desktopSplitMainPanelClass`
- `desktopTitleSafeLeftStyle`
- `desktopMainScrollViewportClass`
- `desktopToolbarRowClass`
- `desktopCardGridClass`
- `desktopTableViewportClass`
- `relationsDetailListWidth`
- `relationsDetailListShellClass`
- `relationsDetailListPanelClass`
- `relationsDetailMainShellClass`

They live mainly in `components/ui/bambookOsTokens.ts` and `components/ui/osMaterial.ts`.

Rule: pages should compose semantic recipes instead of raw colors or raw shadows.

Layout inset tokens:

- Sidebar shell inset: `16px` top and bottom.
- Main title bar height: `64px`.
- Title-to-panel gap: `0px`.
- Title safe-left style: empty shared object; page titles use the same left origin in expanded and collapsed Sidebar states.
- Main panel top inset: `64px` from viewport top.
- Main panel bottom inset: `26px`.
- Main panel bottom lift beyond Sidebar: `10px`.
- Relations detail canvas: `1180px`.
- Relations contact list panel: `280px`.
- Relations detail and organization-chart main panel: remaining width inside the same `1180px` canvas.
- Relations table viewport: `-64px` title overlap recovery, `80px` top padding, `40px` table bottom edge.
- Relations table columns: `27% / 22% / 27% / 17% / 7%`, shared by header `<colgroup>` and body row grid.

Rule: main-area containers do not reuse Sidebar bottom inset. Page rows and single-panel bodies consume the main bottom inset through shared layout recipes.

## Decision Tokens

Decision tokens encode when a semantic token is valid:

- Level 1 can use shared glass.
- Nested surfaces use nested glass.
- Selected state uses selected surface.
- Fields use recessed field.
- Plain content scroll boundaries use `ScrollEdgeFades`; masked glass with outward shadow uses the paired glass + ghost-shadow mask primitive.
- Wallpaper text uses adaptive contrast only on approved roles.

They live in `components/ui/bambookDesignSystem.ts`.

Rule: when a page needs a visual style, choose a decision token first. If no decision token fits, extend the grammar before styling.

## Token Promotion Rule

A repeated page-local value becomes a token only when:

- It appears in at least two comparable contexts, or
- It defines a system primitive, or
- It prevents visual ambiguity for future pages.

Do not promote one-off business layout values unless they describe a reusable grammar rule.
