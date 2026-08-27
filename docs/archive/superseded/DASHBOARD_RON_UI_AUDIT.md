# Dashboard Ron UI Audit

Date: 2026-07-06

Scope: Dashboard homepage, expanded sidebar, collapsed sidebar, dashboard HUD cards, material, layout, token usage, color, and component-level gap against a Ron Design Lab-derived Bambook OS direction.

Evidence:

- `output/playwright/dashboard-expanded-1440x920.png`
- `output/playwright/dashboard-collapsed-1440x920.png`
- `output/playwright/dashboard-hud-root-expanded.png`
- `output/playwright/dashboard-card-01.png` through `dashboard-card-08.png`

No production code was changed for this audit.

## Current State

The current Dashboard is a spatial cockpit over the MapLibre globe underlay.

Structure:

- fixed top HUD with title, search, clock, alert, account;
- expanded sidebar width: 232px;
- collapsed sidebar width: 64px;
- main HUD uses 8 adaptive cards:
  - Cognition;
  - Production;
  - Critical Analysis;
  - Neural Intelligence;
  - Market Intelligence / Raw Materials / Forex;
  - Status Index;
  - Pipeline Value;
  - Velocity Index.

Code ownership:

- layout and card composition: `components/Dashboard.tsx`;
- compiled mirror: `components/ui/osCompiler/compiledDashboardTemplates.tsx`;
- market card: `components/ui/MarketIntelligence.tsx`;
- root/sidebar/app positioning: `App.tsx`, `components/Sidebar.tsx`, `styles/os-vnext.css`;
- material: `OS_MATERIAL.raisedCard`, `.glass-panel`, `.bambook-blue-white-surface`, root-scoped overrides in `styles/os-vnext.css`.

## Layout Assessment

### What Works

- The page has a strong homepage identity: globe underlay plus operational HUD.
- Sidebar expanded and collapsed states are structurally stable.
- Collapsed sidebar successfully gives width back to the main canvas.
- The layout has a recognizable cockpit rhythm, not a generic white dashboard.
- Top chrome is light and does not fully block the map.

### Main Problem

The layout is still a two-side dashboard around a passive map, not a Ron-style product workfield.

In expanded state:

- left column starts at `x=248`, width about `279`;
- right column starts at `x=1105`, width about `319`;
- bottom cards sit from `x=248` to `x=1099`;
- the center map area has no anchored product object, selected region, route, exception object, or operational overlay.

In collapsed state:

- left cards move to `x=80`;
- right cards remain near `x=1104`;
- center remains visually empty.

This means the expanded/collapsed transition changes available space but not the information architecture.

### Ron Gap

Ron-style workspace pages usually make the primary object/workfield explicit. Here the map is visually dominant but semantically passive.

The current center area should either become:

1. a true operational map workfield with selected node, route, shipment/order evidence, and command affordances; or
2. a quieter spatial backdrop while a central summary object owns the middle.

Right now it is neither.

## Material Assessment

### Current Material

Dashboard cards render approximately as:

- background: `rgba(255, 255, 255, 0.58)`;
- border: effectively none in screenshot;
- shadow: effectively none in screenshot;
- radius: `34px`;
- backdrop: `saturate(1.24) blur(15px)`.

This is better than the older blue-white glass layer. It is flat, pale, and quiet.

### Material Problem

The cards are too materially uniform and too opaque for a Ron-derived home surface.

Every card uses the same large pill-like frosted plane. Because all cards have similar size, radius, fill, and blur, hierarchy comes from placement only, not from material role.

The material reads as:

- clean;
- gentle;
- usable;
- but still closer to "soft SaaS cards on map" than a mature Ron OS surface.

### Ron Gap

Ron direction should use:

- fewer visible object containers;
- more tonal layering inside the same material family;
- less equal-card repetition;
- card boundaries from fill/blur/spacing, not repeated oversized rounded rectangles;
- higher confidence in object-specific geometry.

Dashboard currently has too many same-level surfaces.

## Token And Design-System Assessment

### Positive

The page is not fully local CSS. It uses existing OS roles:

- `OS_MATERIAL.raisedCard`;
- `BAMBOOK_OS.spotlight`;
- adaptive text roles like `text-os-adaptive-*`;
- root-scoped material variables in `styles/os-vnext.css`.

### Problem

Dashboard still uses bridge classes:

- `.glass-panel`;
- `.bambook-blue-white-surface`;
- Dashboard-specific constants like `DASHBOARD_RAISED_CARD_CLASS`;
- fixed grid constants and hard-coded card radius `!rounded-[34px]`.

These are workable but not yet a clean Ron/Bambook kernel.

### Risk

If future pages copy Dashboard constants, Bambook will become a collection of dashboard-style cards instead of a route-aware OS.

Dashboard should be treated as a special homepage route, not as the source pattern for production, finance, shipment, email, or development pages.

## Color Assessment

### Current Color

Palette:

- pale blue map/canvas;
- white/blue frosted card fill;
- blue accent for brand/state/value;
- red and cyan/blue for market movement;
- dark slate text.

### What Works

- The page is coherent.
- Accent is restrained.
- Collapsed sidebar contrast is readable.
- The map and cards live in the same pale family.

### Problems

- The page is still dominated by one blue/cyan family.
- The map, cards, accent, search, and values all share similar temperature.
- Important state differences are low in semantic richness.
- Some text now became too large and medium-weight after recent local changes, reducing the fine Ron-like hierarchy.

### Ron Gap

Ron-derived color should feel more like restrained product lighting than a blue UI theme. The page needs:

- a clearer neutral base;
- fewer blue accents;
- one stronger semantic focal color only where state needs it;
- more tonal contrast between map, panels, inner rows, and values.

## Typography Assessment

### Current Positive

- Light weights are mostly preserved.
- The title and major numbers are readable.
- Icons use thin Lucide-style stroke.

### Current Problems

Recent changes increased labels like `Cognition`, `Production`, `Critical Analysis`, `Neural Intelligence`, `Status Index`, `Pipeline Value`, and `Velocity Index` to `18px font-medium`.

This makes small card labels compete with content values. It also removes the earlier compact system-label rhythm.

The page now has too many similar-size headings.

### Ron Gap

Ron-like UI should have:

- smaller, quieter labels;
- stronger value hierarchy where values matter;
- compact metadata;
- no heavy repeated card titles.

Recommendation:

- Restore card labels to a compact title/token role, around `12-14px`, not universal `18px`.
- Keep values larger, but allow context labels to stay small.
- Use `18px` only for true section headers or large workfield titles.

## Component-Level Findings

### Sidebar Expanded

Status: mostly good baseline.

Strengths:

- selected state is calm;
- collapsed/expanded transition is stable;
- icon rhythm is consistent;
- account block feels integrated.

Issues:

- expanded sidebar still behaves like a vertical app menu; for homepage it is acceptable, but business routes may need stronger module grouping later.
- active item material is close to accepted and should not be randomly retuned.

Decision:

- Keep as baseline.
- Do not use Dashboard work to redesign sidebar unless the task is explicitly sidebar tuning.

### Sidebar Collapsed

Status: good, but visually detached.

Strengths:

- compact rail preserves app identity.
- icon contrast over map is readable.

Issue:

- collapsed state exposes how empty the center map is.

Decision:

- No sidebar fix needed first. Fix center workfield ownership.

### Top HUD

Status: acceptable, not Ron-level.

Problems:

- `Bambook Hub` + search + time/account form a common SaaS topbar.
- search is visually prominent despite not being the homepage's primary action.
- clock is large and decorative.

Direction:

- reduce clock dominance;
- make search an action/control object, not a large central pill;
- let the top HUD frame the workfield instead of competing with it.

### Cognition / Production / Critical Analysis

Status: visually clean, structurally repetitive.

Problems:

- three stacked cards with the same anatomy;
- values are too sparse for the large surface area;
- labels are oversized after recent change;
- progress bars are too minimal to justify the card height.

Direction:

- merge into one "system pulse" strip or compact metric cluster;
- use one shared card with three metric objects inside;
- reduce vertical stack height and return space to center workfield.

### Neural Intelligence

Status: weak content density.

Problems:

- large empty area;
- text truncates visually as if content is unfinished;
- `v2.5 System` looks like metadata filler;
- refresh icon is too detached.

Direction:

- turn into an actionable daily briefing card:
  - top: one-line state;
  - body: 2-3 short signals;
  - bottom: next action / refresh / timestamp.
- If it stays sparse, reduce its height.

### Market Intelligence

Status: has a concrete visual bug.

Problem:

- `RollingTicker` digits are clipped/overlapped in the screenshot.
- The accessible text exposes repeated `0-9`, confirming the rolling digit implementation expands many hidden digits.

Direction:

- fix rolling ticker clipping or replace it with a simpler tabular number for Dashboard.
- raw market values should not dominate the homepage unless tied to Bambook business decisions.
- use a quieter value row, not large animated numerals in every row.

### Status Index

Status: compact and useful.

Problem:

- it is too visually similar to the left metric cards.
- dot/status relation is basic.

Direction:

- keep, but integrate into a system pulse cluster.

### Pipeline Value

Status: useful but too isolated.

Problems:

- value is good, but the card does not explain what action/decision follows.
- red trend is small and can feel arbitrary.

Direction:

- attach to order/shipment risk or selected region.
- pair with a visible "what changed" mini event.

### Velocity Index

Status: best current Ron-aligned component.

Strengths:

- thin chart grammar;
- light axis;
- bare Fabric/Garment control;
- low container noise.

Problem:

- same thick parent card as all other cards.

Direction:

- use this as the chart grammar reference;
- reduce card material weight around it.

## Priority Optimization Direction

### P0: Make The Center A Real Homepage Workfield

Choose one:

1. Map-first operational workfield:
   - selected production/shipment node;
   - route line or region focus;
   - inline risk markers;
   - small command/info dock near selected object.

2. Executive control object:
   - central "Bambook Today" object;
   - order/production/shipment/finance signal graph;
   - map becomes a quiet spatial backdrop.

Recommendation: choose map-first, because the current homepage already invests in the globe/map.

### P1: Reduce Equal-Card Repetition

Combine:

- Cognition;
- Production;
- Critical Analysis;
- Status Index;

into one compact system-pulse cluster.

Keep:

- Velocity Index as chart object;
- Pipeline Value as financial object;
- Neural Intelligence as daily briefing object;
- Market as optional support, not dominant.

### P1: Recalibrate Typography

Create Dashboard-specific type roles:

- `dashboard-card-label`: 12-14px, light/normal, quiet;
- `dashboard-metric-value`: 28-34px, light;
- `dashboard-support-text`: 11-13px;
- `dashboard-section-title`: 16-18px only for true larger modules.

Avoid universal `18px font-medium` on every card title.

### P1: Fix Market Ticker

Either:

- fix `RollingTicker` clipping and hidden digit layout; or
- use static `tabular-nums` on Dashboard and reserve rolling animation for a dedicated market tool.

### P2: Material Role Split

Introduce Dashboard material levels:

- `dashboard-primary-workfield-overlay`;
- `dashboard-support-card`;
- `dashboard-metric-object`;
- `dashboard-floating-control`;

Then stop using one `DASHBOARD_RAISED_CARD_CLASS` for every object.

### P2: Top HUD Quieting

Reduce:

- search width;
- time prominence;
- account pill density.

Make the top HUD more like ambient chrome.

## Suggested First Patch Scope

Do not start by changing global material tokens.

First scoped patch:

1. Fix `MarketIntelligence` ticker clipping or switch Dashboard market rows to static numbers.
2. Revert/rebalance Dashboard card labels away from universal `18px font-medium`.
3. Create a compact `SystemPulseCluster` to replace the left three stacked metric cards plus Status Index.
4. Add a central map workfield overlay with one selected object summary.

This would improve Ron alignment without destabilizing Sidebar or global material.

## Validation Notes

Screenshots were captured with a local cached owner auth state in dev mode. This was only for UI inspection and did not authenticate against production.

The local worktree already had uncommitted Dashboard/MarketIntelligence changes before this audit. Findings are based on the current worktree state.

