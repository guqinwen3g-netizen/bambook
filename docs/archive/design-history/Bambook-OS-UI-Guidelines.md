# Bambook OS UI Guidelines

This document records the current visual direction approved from Sidebar, Dashboard, and Relations Manager. It is a practical implementation guide, not a marketing design manifesto.

## Design Direction

Bambook OS is a lightweight glass workbench. It should feel like a focused operating surface rather than a traditional SaaS admin page.

Core principles:

- Use soft blue-white glass in light mode and deep blue-black glass in dark mode.
- Keep typography light, quiet, and precise.
- Prefer interaction light and material response over heavy borders.
- Do not introduce colorful badge systems unless the color has strong semantic value.
- Avoid decorative cards inside cards; use one panel with lightweight internal groups.

## Design Thinking

Use this system as a way of classifying UI, not just copying approved classes.

When a new component appears, judge it in three passes:

- Material role: what physical thing is it in the OS?
- State model: does it have a persistent selected state or only momentary interaction?
- Layout role: is it structural chrome, content surface, or scrolling content?

This is the intended reasoning model:

- Panel: large glass container with visible edge, transmitted color, and stable structure.
- Card: lighter actionable surface inside a page flow, usually not visually heavier than a panel.
- State control: can stay selected. Example: sidebar nav, grid-table switch, contacts-structure switch.
- Action control: reacts only while interacting. Example: save, add, open, edit.
- Recessed field: cut into the panel rather than floating above it.

State logic:

- Action control uses `idle / hover / press`.
- State control uses `idle / hover / press / active`.
- Field uses `idle / focus`.

Layout logic:

- Chrome stays cleaner and lighter than content panels.
- Fade belongs to the real scrolling viewport, not the title bar or toolbar above it.
- Prefer one outer panel with lightweight internal grouping instead of stacked inner cards.

## Material

Shared panel material starts from `SidePanelContainer` and `BAMBOOK_OS.material`.

Panel baseline:

- `rounded-[24px]`
- `border`
- `backdrop-blur-[14px]`
- `backdrop-saturate-[135%]`
- `bambook-dashboard-glass-color`
- subtle blue-white or blue-black surface tint

Cards:

- Relations category cards and Dashboard cards are the card baseline.
- Card size in Relations desktop grid: `300px x 220px`.
- Card radius: `rounded-3xl`.
- Light mode card surface should not become solid white.
- Dark mode card surface should not become gray-white.

Controls:

- Main button radius: `rounded-[18px]`.
- Compact title controls: `rounded-2xl` or inner `rounded-[14px]`.
- Small action buttons should not expose thick white material edges.
- Shared control recipes live in `BAMBOOK_OS.controls`.
- A recipe means a ready-to-use class group, such as toolbar surface, title action, or form field. Use recipes first when the visual behavior is already approved.
- Recipes preserve precision. They are not simplified placeholders; they should carry the full approved edge, shadow, tint, and motion behavior together.

## Light

There are three different light behaviors:

- Tracking light: follows pointer on panels, dashboard cards, and relation cards.
- Active light: persists only on selected state controls.
- Hover light: appears only while hovering for one-shot navigation or action controls.

Rules:

- Cards and one-shot title actions do not keep active state.
- Sidebar nav, view switches, and grid/table toggles can keep active state.
- Dashboard cards can have tracking light but should not gain selected rims unless they become actionable state controls.
- Panel-level spotlight belongs to the panel, not every child control.

## Buttons

Use two mental models:

- Action button: idle, hover, press.
- State button: idle, hover, press, active.

Action examples:

- Add organization
- Save profile
- Edit
- Add member

State examples:

- Sidebar nav item
- Grid/table display switch
- Contacts/org-chart switch

## Inputs

Inputs are recessed areas cut into the panel, not brighter panels.

Current field baseline:

- `h-9` for single-line fields.
- `text-xs`.
- `rounded-2xl`.
- Light mode uses subtle gray-blue border and inset shadow.
- Dark mode uses darker recessed fill, not solid white.
- Focus should feel slightly pressed, not like a bright blue outline.

## Navigation And Layout

Relations Manager is the current title/navigation baseline.

Rules:

- Title bar contains navigation hierarchy.
- Detail view switch belongs in the title bar, not a separate row.
- Functional controls can occupy the title bar's empty center space when it saves vertical space.
- Level-one and level-two cards should align in width and height when they represent comparable navigation items.
- Table mode should use a fixed panel: fixed header, scrollable body.
- Relations Manager is a visual reference, but only token-backed parts should be treated as reusable implementation reference.
- Before copying a Relations pattern elsewhere, confirm whether it uses `BAMBOOK_OS` recipes or still owns page-local styling.

## Scrolling

Scroll happens inside the real content viewport.

Rules:

- Panel header stays fixed; panel body scrolls.
- Table header stays fixed; table body scrolls.
- Edge fade appears only when content is clipped and should disappear at scroll boundaries.
- Native scrollbars stay hidden.

Edge fade glass panels:

- A glass panel that needs edge fade must keep `data-glass-edge-mask` on the real glass surface. This preserves fullscreen backdrop sampling for the frosted layer.
- Do not move the edge mask to an outer wrapper around the glass card. Wrapper-owned masks can keep shadows alive, but they break the glass sampling contract.
- Do not rely on the masked glass card for outward shadow. A masked surface clips its own shadow by design.
- Use `SidePanelContainer edgeFadeItem` for panel primitives that need glass, spotlight, edge fade, and outward shadow together.
- Use `GlassEdgeFadeShadow` for non-panel cards or rows that still need the same edge-fade shadow split.
- Both entries render a sibling `bambook-sibling-shadow-caster` below the real surface. The real surface owns the mask and glass; the sibling owns the outward shadow.
- The shadow sibling may extend beyond the panel with a transparent bleed, currently `40px`, but it must not add visible background, blur, content, or pointer interaction.
- If the shadow sibling lives inside an `overflow-y-auto` viewport, reserve bleed space and lock horizontal overflow. The Relations add form uses `bambook-relation-form-scroll-viewport` for this.

Edge fade activation:

- For stacked cards, prefer clip-based activation: `topFadeActivation: 'clip'` and `bottomFadeActivation: 'clip'`.
- Clip-based activation starts when the panel physically enters the clipped edge, then grows the fade by overlap depth. This avoids the fade popping in late without fading adjacent cards early.
- Do not add a pre-activation lead zone for stacked panels unless the page has a proven non-overlap layout. Lead zones can make the next card fade before it reaches the edge.
- Top and bottom fade lengths should usually match unless a page has a deliberate asymmetry.
- Current Relations add-form baseline: `topHeight: 57`, `topFadeStartOffset: 44`, `bottomHeight: 57`, `shadowCasterBottomHeight: 72`, with both edge activations set to `clip`.

## Motion

Motion should be quiet and continuous.

Current baseline:

- Standard state duration: about `260ms`.
- Layout movement: `0.36s` with `[0.16, 1, 0.3, 1]`.
- Hover movement should be small, usually `-translate-y-[1px]` or card `-4px`.
- Avoid abrupt active jumps between sibling controls.

## Implementation Notes

Token entrypoint:

- `components/ui/bambookOsTokens.ts`

Token structure:

- `patterns`: semantic thinking model for future reuse.
- `material`: large-surface glass recipes.
- `spotlight`: shared tracking light color and size values.
- `controls`: approved control recipes. Prefer role names such as `actionControl`, `stateControl`, and `recessedField`; use page-specific aliases only when preserving compatibility.
- `tone`: low-level color roles grouped by `text`, `chip`, `surface`, `divider`, and `status`. Do not add new flat tone keys.
- `typography`: shared text weight and tracking roles. Relations Manager defaults to `font-light`; use heavier weights only with an explicit new role.
- `layout`: stable sizing and spacing constants.
- `motion`: shared timing and layout movement.

Implementation rule:

- Page files may compose recipes and own layout, but should not invent new material states when an approved role recipe exists.

Current first tokenized surface:

- `components/ui/SidePanelContainer.tsx`
- Relations subcomponents now consume shared recipes for recessed fields, bordered action controls, compact cards, floating tool clusters, and lightweight inline panels.
- Inline panels are for small linked information rows inside a larger panel. They should stay quieter than the parent panel and must not grow their own heavy rim.
- Helper roles such as panel dividers, progress tracks, form-map indexes, and nested form rows are tokenized because these details create the perceived material thickness.
- Form icon buttons are separate roles: add, remove, compact remove, inline danger, and quiet action. Do not reuse title buttons or sidebar active states for these tiny controls.
- Coordinate status is its own semantic status treatment. Keep it token-backed so the colors are deliberate system feedback, not random page decoration.
- Select menus, relation tables, form labels, inline brand text, and org-chart meta controls now have explicit token roles. These are stable enough to copy; do not re-create their colors in page files.
- Recessed form fields must match select triggers structurally: text inputs, date inputs, and textareas need both the shared `recessedField` recipe and an actual `border` width class. Token border colors alone are not enough because no line is painted without the border layer.
- Native date controls must keep their calendar indicator aligned with field text color. In UI Lab, this is handled by the OS CSS date-field rule and `color-scheme`, with dark mode forcing the picker icon to the same light direction as the input text.
- Table and index-list row highlight is not card treatment. Row hover/highlight must span the full table content width, use squared row edges, and must not inherit card shadow bleed gutters such as `panelShadowViewportClass`. Reserve shadow bleed only for card grids where external shadows need visible overflow.

Migration order:

1. Keep visuals unchanged.
2. Move stable repeated values into `BAMBOOK_OS`.
3. Replace callers gradually.
4. Add tests that protect the visual contract.
5. Only then copy the system to other product areas.
