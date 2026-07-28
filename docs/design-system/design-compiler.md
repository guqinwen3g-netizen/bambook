# Design Compiler

Bambook OS design output must be compiler-derived. UI Lab 2.0 is the review surface for that compiler, not a separate design system.

## Goal

The same semantic input must produce the same visible UI every time. A page does not choose layout, material, shadow, typography, motion, state, icon treatment, copy shape, responsive behavior, or slot structure locally.

Pages provide intent. The compiler provides the visual answer.

## Compiler Input

Every page starts with:

- Page type.
- Primary task.
- Density.
- Navigation depth.
- Content model.
- Mutation model.
- State model.
- Entity kind.
- Reference surface.

If this input is not enough to produce one visual answer, the grammar is incomplete. Do not resolve the gap with page-local styling.

Compiler input is semantic only. It must not contain direct visual requests such as color, shadow, radius, max width, title position, toolbar layout, or animation class. If a page needs a new visual result, add a semantic input or variant to the compiler contract first.

## Compiler Output

The compiler returns a blueprint for:

- `layout`: page shell, title bar, canvas, panel row, split workspace, toolbar row, scroll viewport, section stack, card grid, table viewport, form stack.
- `material`: sidebar shell, level-1 frame panel, level-2 raised or inset panel, level-3 inline surface, floating overlay.
- `shadow`: role, depth, attachment mode, ghost shadow when scroll fade requires it.
- `typography`: page title, breadcrumb, section title, metadata, field label, table header, button label.
- `motion`: hover, press, selected transition, layout transition.
- `state`: idle, hover, press, selected, focus, disabled, loading, empty, error, dirty, readonly.
- `iconography`: bare icon by default, icon well only for approved component roles.
- `content-language`: Chinese interface structure, source identifiers preserved, explicit missing values.
- `responsive-scale`: desktop canvas, title height, bottom inset, UI Lab scale variable, viewport profile.
- `visual-provenance`: accepted, provisional, experimental, retired.
- `reference-snapshot`: the visual surface used for fidelity review.
- `slot contract`: title, toolbar, panel, content, empty, error, floating, and contextual slots.
- `layer-stack`: wallpaper, ambient, app shell, page, floating controls, overlays, and toast order.
- `ownership`: which node owns radius, overflow, backdrop sampling, mask fidelity, ghost shadow, and row separators.
- `action-hierarchy`: primary, secondary, destructive, inline, row, bulk, icon tool, and state toggle roles.
- `data-formatting`: numbers, dates, currency, percentages, source identifiers, status text, and missing values.
- `portal-overlay`: select menu, popover, tooltip, modal, and toast root, placement, dismissal, focus return, shadow, backdrop, and motion.

## Fidelity Gate

The compiler has two gates:

- Uniqueness gate: one semantic input must produce one blueprint.
- Fidelity Gate: the blueprint must name the accepted or provisional reference surface it is trying to reproduce.

`accepted` means the reference is allowed to define future output. `provisional` means UI Lab currently contains the surface, but it still needs review before becoming a standard. `experimental` means dev-only sample. `retired` means historical evidence only.

A provisional system can be rendered in UI Lab 2.0, but it must be visible in the fidelity report. It cannot silently become the standard.

Legacy or partially migrated surfaces must be marked `provisionalBridge`. A bridge can help migration, but it cannot define accepted output or be reused as a standard.

## Uniformity Contracts

UI Lab 2.0 compiles all reusable visual decisions, not only panels.

- Semantic input schema: pages declare `pageType`, `primaryTask`, `density`, `navigationDepth`, `contentModel`, `mutationModel`, `stateModel`, `entityKind`, and `referenceSurface`.
- Variant grammar: every primitive declares allowed variants before use. Pages cannot invent ad-hoc variants.
- Slot grammar: templates own slot structure, placement, spacing, typography, and state treatment.
- Layer stack: z-index is compiler-owned. Portals, ghost shadows, spotlights, and overlays do not create local stacking systems.
- Ownership: container owns radius; scroll viewport owns clipping and fade bounds; glass node owns backdrop sampling and mask fidelity; ghost sibling owns outward shadow.
- Action hierarchy: action role determines slot, size, label policy, icon policy, and state model.
- Data formatting: missing, unavailable, loading, error, date, number, currency, percentage, status, and source identifier formats come from content grammar.
- Portal overlay: overlay root, placement, dismissal, focus return, shadow, backdrop, and motion are compiler-owned.
- Responsive profile: desktop, ultrawide, short-height, Electron, and mobile PWA select canvas, scale, title origin, bottom inset, and sidebar behavior.
- Reference snapshot: accepted reusable output needs route, viewport, theme, wallpaper, scale, reference surface, and pixel tolerance.
- CI gate: new UI fails when it bypasses compiler-owned visual contracts.

## Slot Contract

Templates own slot structure. Pages fill content only.

Required slots:

- `title.leading`
- `title.identity`
- `title.actions`
- `toolbar.search`
- `toolbar.filters`
- `toolbar.viewSwitch`
- `toolbar.actions`
- `content.primary`
- `content.empty`
- `content.error`

Optional slots:

- `title.breadcrumb`
- `panel.header`
- `panel.footer`
- `floatingAction`
- `contextualAction`

The slot decides placement, spacing, typography, and state treatment. The page cannot move the slot.

## Forbidden

No page-local:

- Title layout.
- Panel width.
- Material color.
- Shadow.
- Radius.
- Hover state.
- Selected state.
- Focus ring.
- Animation.
- Toolbar structure.
- Scroll fade.
- Z-index layer.
- Portal placement.
- Overlay material.
- Data formatting.
- Responsive profile.
- Instructional product UI copy.
- Nested card inside card.

If a reusable visual cannot be expressed through the compiler, it is not ready for standard UI.
