# Bambook Ron UI Kernel Audit

Date: 2026-07-06

Scope: read-only UI system audit for migrating Bambook from the current mixed AI/legacy visual stack toward a Ron Design Lab-derived Bambook OS skin.

## Verdict

Bambook does not need another full-page redraw pass. The current bottleneck is that the Ron direction has not been translated into Bambook-owned primitives, tokens, route rules, and visual gates.

The app already has the beginning of a real OS skin:

- `components/ui/bambookOsTokens.ts`
- `components/ui/osMaterial.ts`
- `components/ui/osVNext.ts`
- `components/ui/OSPrimitives.tsx`
- `components/ui/SidePanelContainer.tsx`
- `components/ui/osCompiler/*`
- `styles/os-vnext.css`
- shared glass/container classes in `index.css`

But production UI still mixes:

- accepted compiler surfaces;
- provisional compiler slots;
- legacy page-local Tailwind styling;
- old blue-white material naming;
- visible border/shadow glass rules;
- UI Lab and Liquid Glass experiments;
- direct business-page layout ownership.

This explains why repeated AI redesign rounds are inefficient and unstable: every page can still reinterpret the style locally.

## Confirmed Current System

### Accepted or partially accepted compiler surfaces

`components/moduleRegistry.ts` records compiler provenance per module.

Accepted:

- `dashboard`
- `relations`
- `products`
- `settings`

Provisional:

- `assistant`
- `orders`
- `invoices`
- `payment-vouchers`
- `shipments`
- `development`
- `emails`
- `knowledgeBase`
- `businessTools`
- `adminPanel`
- `hr`

This is the right migration boundary: accepted surfaces can become references, provisional surfaces should be migrated through kernel primitives rather than manually restyled.

### Existing primitive layers

There are two overlapping primitive systems:

1. `OSPrimitives.tsx` + `styles/os-vnext.css`
   - Cleaner role-based primitives: panel, card, toolbar, button, field, table, dialog, scroll frame.
   - Good direction, but not yet the dominant production path.

2. `BAMBOOK_OS` + `SidePanelContainer` + `compiled*`
   - More widely used by real modules.
   - Carries important hard-won glass/backdrop fixes.
   - Still has legacy visual vocabulary: `blue-white`, border/shadow surfaces, material classes that are too permissive.

The migration should converge these systems. Do not create a third visual system.

## Root Cause

Problem type: design-system migration and product UI architecture gap.

The repeated redesign failures are not primarily caused by poor taste in one page. They come from missing execution rules:

- Ron style is treated as visual inspiration instead of a compiled Bambook OS contract.
- Material, radius, accent, shadow, and container boundaries are not fully locked in one source of truth.
- Business modules do not yet have UI route contracts.
- Page-local classes can override system primitives.
- There is no visual acceptance gate for "Ron-derived Bambook OS" readiness.

## Bambook Ron UI Kernel

Use Ron Design Lab as taste source, not as a source to copy. The target is a Bambook-owned OS skin.

### Primitive 1: Workspace Shell

Owned by:

- `components/Sidebar.tsx`
- `components/ui/osCompiler/compiledSidebarTemplates.tsx`
- `App.tsx`
- `styles/os-vnext.css`
- shared adaptive contrast utilities

Keep:

- accepted sidebar hover/press/selected behavior;
- adaptive wallpaper contrast;
- compact desktop command spine;
- no decorative default sidebar clone.

Needs:

- one shell contract for expanded/collapsed sidebar, top chrome, and module canvas;
- no page-local nav chrome.

### Primitive 2: Matte Frosted Container

Owned by:

- `components/ui/SidePanelContainer.tsx`
- `components/ui/osMaterial.ts`
- `components/ui/bambookOsTokens.ts`
- `index.css`
- `styles/os-vnext.css`

Target:

- no visible outline as primary boundary;
- translucent fill, blur, tonal lift, inner highlight, and spatial layering;
- external shadow only when a route explicitly needs depth;
- avoid rim, bevel, glossy gradient, diagonal shine, and heavy drop shadow.

Current risk:

- `.glass-panel`, `.bambook-dashboard-glass-color`, `.bambook-card-glass`, `.bambook-outer-panel`, and `os-vnext-*` still use border/shadow as regular material behavior.

### Primitive 3: Workfield Surface

Owned by:

- accepted dashboard compiler;
- future route wrappers for orders, products, development, finance, shipment, email, data center.

Target:

- the main product object should dominate the layout;
- tables, charts, lists, maps, and chat should not all become equal cards;
- business modules need route-specific workfield anatomy before visual polish.

### Primitive 4: Inspector / Detail Panel

Owned by:

- `components/ui/DetailPanel.tsx`
- `components/ui/SidePanelContainer.tsx`
- relation/product/order/detail surfaces.

Target:

- object-driven right/side detail;
- clear selected-object dependency;
- detail panel uses system container primitive, not page-local cards.

### Primitive 5: Command / Control Row

Owned by:

- `CompiledToolbar`
- `BAMBOOK_OS.controls`
- page filters, search, action rows, assistant controls.

Target:

- icon-first compact controls;
- restrained selected state;
- clear difference between action, state, field, and destructive command;
- no large generic SaaS toolbar.

## Route Map

### Dashboard / 全景看板

Status: accepted compiler surface.

Role: reference for spatial dashboard, globe/HUD, live data cards.

Rule: preserve compiler ownership. Use it as a reference for adaptive cards and glass/backdrop lessons, not as a template for every business page.

### Relations / 关系智库

Status: accepted compiler surface.

Role: relationship/object intelligence workspace.

Rule: use as reference for object/detail workflows and edge-fade handling.

### Products / 数字档案

Status: accepted compiler surface.

Role: asset/file/object catalog.

Rule: use as reference for object list + detail migration.

### Settings / 设置

Status: accepted compiler surface.

Role: system/account control surface.

Rule: use as reference for segmented control, nested settings panels, and lower-density form surfaces.

### Assistant / AI 助手

Status: provisional.

Role: Agent OS workbench.

Risk: many inline rounded borders, fields, and panels still live in page-local classes.

Migration direction: define an Agent workbench route: history rail, conversation workfield, tool/runtime inspector, input dock.

### Orders / 生产管理

Status: provisional.

Role: operational production workfield.

Migration direction: define order route before styling. It needs queue/list, selected order workfield, evidence/detail panel, and command row. Do not make it a generic table dashboard.

### Finance / 发票管理 / 财务管理

Status: provisional.

Role: financial document/control route.

Migration direction: amount/document object, evidence rows, approval/action controls, compact inspector.

### Shipments / 货运管理

Status: provisional.

Role: logistics tracking and exception handling.

Migration direction: shipment route should have timeline/workfield, state chips, location/evidence side panel, and sparse command controls.

### Development / 开发管理

Status: provisional.

Role: product development and production preparation route.

Migration direction: object lifecycle, sample/development stages, document/evidence side panel, action dock.

### Email / 智能邮箱

Status: provisional.

Role: communication triage workspace.

Migration direction: message queue, reading workfield, entity/action inspector, reply command dock.

### Data Center / 数据中心

Status: provisional, with naming debt.

Role: data twin / knowledge center.

Risk: `View.KnowledgeBase` opens `DataTwinCenter`.

Migration direction: resolve naming later; UI route should be data object graph/workfield, not generic file library.

### OPS / Admin / Business Tools / HR

Status: provisional.

Role: utility/admin surfaces.

Migration direction: lower priority. Keep functional, then migrate through the same primitives after primary business routes stabilize.

## Hard Gates

Do not accept a UI change as Ron-derived Bambook OS unless it passes these gates:

1. The surface uses a shared primitive or compiler wrapper.
2. The page does not introduce a new local glass/card material.
3. Container boundary does not rely on visible outline as the main visual signal.
4. Shadow is absent or explicitly route-owned; no generic depth stack.
5. Accent is owned by state, command, metric, or selected object, not sprayed across panels.
6. The main product object is identifiable in the first viewport.
7. Sidebar accepted hover/press/selected behavior remains unchanged unless intentionally retuned in UI Lab.
8. Backdrop-filter changes do not blur the globe/canvas itself.
9. Edge fades attach to the real scroll viewport, not an inner wrapper.
10. Provisional business modules do not become equal-card dashboards.

## Anti-Patterns To Stop

- page-by-page "make it Ron style" prompts;
- copying Ron screenshots into Bambook layouts;
- adding new local `glass`, `card`, `panel`, `border`, or `shadow` classes;
- using `border` as the default material boundary;
- turning every business module into dashboard cards;
- applying Dashboard HUD visual logic to order/finance/email routes;
- treating UI Lab Liquid Glass experiments as production style;
- changing global material tokens to fix one page;
- using screenshots as the only acceptance method without a component/route rule.

## First Implementation Sequence

### Step 1: Material Contract

Create a small Bambook Ron material contract around the existing material owners.

Target files:

- `components/ui/bambookOsTokens.ts`
- `components/ui/osMaterial.ts`
- `styles/os-vnext.css`
- selected shared material block in `index.css`

Expected output:

- named material roles: shell, panel, raised-card, inset, floating, toolbar, command;
- explicit no-outline/default-flat rule;
- old `blue-white` names marked compatibility-only;
- no page-local new material classes.

### Step 2: Route Contract

Extend existing `moduleRegistry.ts` with UI route category metadata.

Suggested route categories:

- `spatial-dashboard`
- `agent-workbench`
- `object-catalog`
- `object-detail-workflow`
- `operation-control`
- `finance-document-control`
- `logistics-timeline`
- `communication-triage`
- `admin-utility`

Expected output:

- every module has a route category;
- provisional modules know which primitive layout they should migrate toward.

### Step 3: UI Lab Kernel Tuner

Expand the current `DesignTuner` beyond sidebar-only variables.

Target:

- real `SidePanelContainer`;
- real sidebar nav item;
- real toolbar/control row;
- real detail panel;
- toggles for light/dark, hover/press/selected/focus;
- export string only, no automatic persistence.

### Step 4: One Business Route Pilot

Pick one high-value route, preferably `orders` or `development`.

Do not redraw the whole app. Build one route through:

1. route contract;
2. material primitive;
3. workfield primitive;
4. inspector primitive;
5. command/control row;
6. visual gate review.

### Step 5: Propagate Only After Gate Pass

Only after one business route passes should the same primitive set be applied to finance, shipment, email, and data center.

## Recommended Immediate Decision

Start with `orders` if the priority is business value.

Start with `development` if the priority is proving the route/workfield model with lower business-data risk.

Start with `assistant` if the priority is Bambook Agent OS identity.

Recommendation: start with `orders`. It is important enough to expose real product constraints and will force the kernel to solve workfield, detail, state, and command surfaces instead of only dashboard polish.

## Validation

No tests or browser checks were run. This is a read-only architecture/design-system audit document.

