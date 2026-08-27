# Page Generation

Page generation is now a Design Compiler problem. A page does not choose layout, material, shadow, title position, toolbar structure, animation, or text rhythm. It declares semantic intent, then the compiler returns the blueprint.

The goal of Bambook OS grammar is that a new page has one valid shape after its inputs are known.

## Required Inputs

Before designing a page, declare:

- Page type.
- Primary task.
- Information density.
- Navigation depth.
- Dominant content model.
- Mutation model.
- Empty and error states.

## Derivation Order

1. Choose page shell and canvas.
2. Choose title bar hierarchy.
3. Choose level-1 frame surface.
4. Map content groups to level-2 surfaces.
5. Map inline records to level-3 or derived level-4 surfaces.
6. Assign component state models.
7. Assign adaptive color roles only where background contrast requires it.
8. Write content labels and empty states from content grammar.

In UI Lab 2.0 this order is executed by `compileBambookPage`. The rendered page must be traceable to compiler output through `data-os-compiler-*` markers.

## Page Types

Dashboard:

- Spacious density.
- Summary cards.
- Ambient/adaptive text allowed.
- No heavy nested controls.

List And Detail:

- Standard density.
- Sidebar/list or grid navigation.
- Detail scroll viewport owns fade.
- Detail sections use level 2; inline records use level 3.

Form:

- Standard density.
- Form map may be secondary panel.
- Fields use recessed family.
- Submit/cancel actions remain title or bottom action controls.

Data Table:

- Compact density.
- Fixed header.
- Row hover is table hover.
- Empty state lives inside table surface.

Settings:

- Standard density.
- Sections are level 2.
- Switches, segmented controls, inputs, and chips must use component grammar.

Module Backstage Configuration:

- Standard to compact density.
- It belongs to the module that owns the complexity, not global settings.
- The entry may live near the module surface, but the opened UI is a main-area workspace, not a drawer.
- Use progressive drill-in for complex configuration groups; do not flatten fields, dictionaries, display rules, and rule fields into one long page.
- The outer user-facing module stays simple and task-first; advanced setup moves into this backstage layer.
- The title bar uses the module name in Chinese. Do not add English overlines, prototype badges, or explanatory labels above the title.
- The title bar uses `BAMBOOK_OS.layout.desktopTitleBarWithInsetClass`, the same title size and tone as Dashboard, Relations, Products, and Settings navigation pages.
- Four-character module names split as 2+2 for brand color, for example `数字` primary plus `档案` brand. A suffix such as `配置` is a breadcrumb child, not part of the four-character module name.
- Backstage pages use breadcrumb title grammar: module title, chevron separator, current child label. Do not merge the child label into the brand-colored module title.
- Backstage pages use `BAMBOOK_OS.layout.desktopWorkspaceFrameClass` for the full workspace and `BAMBOOK_OS.layout.desktopBackstagePanelRowClass` for the constrained main panel row.
- Backstage pages inherit main-area geometry: `64px` title bar, `0px` title-to-panel gap, `26px` bottom inset, and `10px` more bottom lift than Sidebar.
- Backstage pages use the split workspace contract: left navigation panel and right main work panel are sibling level-1 panels.
- Back navigation uses the title back-button recipe and the shared `ChevronLeft` title icon sizing. Do not substitute a different arrow family.
- Backstage split panels must not be wrapped by a larger visual frame panel. The row itself owns sibling gap and page placement.
- Backstage split panels must not use `edgeFadeItem`, because ghost shadow wrappers are only for masked scroll surfaces that need outward shadow.
- Avoid instructional philosophy copy. The page should show available configuration areas, not explain why the page exists.
- Configuration category rows follow the owning module's content-card rhythm: bare icon, label, short description, and selected state.
- Configuration category and drill-in buttons use `BAMBOOK_OS.controls.navigationRow`; selected rows use `BAMBOOK_OS.controls.selectedSurface`, not a page-local selected approximation.
- Content inside a backstage panel uses section/card typography. It must not promote section titles to page-title scale.

Internal Reference:

- Design grammar references, material libraries, audits, and sample matrices are dev-only content.
- They must not appear as product chrome, global floating buttons, or visible user features in Dashboard, Relations, Products, or Settings.
- If visual samples are needed in UI Lab, expose them through an explicit dev reference route or documentation surface.

## Uniqueness Rule

If two visual outcomes seem valid, do not choose by taste. Identify the missing input:

- Is it a different page type?
- Is the content density different?
- Is the navigation depth different?
- Is this state selected, hover-only, or focus?
- Is this content metadata or semantic status?

Only after the missing input is answered may the visual result be derived.
