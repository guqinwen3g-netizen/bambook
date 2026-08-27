# Bambook Visual WIP Triage - 2026-07-09

## Current State

Main currently contains an uncommitted visual WIP across 36 files. This WIP is blocking Sylway merges because at least one approved frontend task overlaps with locally modified files.

This file is a coordination note for the current visual/UI convergence pass. It is not a new design authority. Long-term authority remains:

- `docs/design-system/flat-material-authority.md`
- `docs/design-system/rdl-component-authority.md`
- `styles/os-vnext.css`
- `components/ui/osMaterial.ts`
- `components/ui/bambookOsTokens.ts`
- `components/ui/RDLPrimitives.tsx`

## Confirmed Direction

- Flat matte surfaces, no ordinary container shadow.
- No default rim on normal cards/panels.
- No broad semantic rainbow palette for status.
- Selection is mainly opacity/material contrast, not pressed neumorphic state.
- Default typography is light or normal; bold is reserved for explicit hierarchy, not ordinary labels.
- Dashboard remains the strongest in-product visual reference.
- Finance is the first ERP density sample page.

## WIP Categories

### Keep As Baseline Candidates

- `components/ui/RDLPrimitives.tsx`
  - Shared primitives are the right direction: `RdlSurface`, `RdlPill`, `RdlSearch`, `RdlToolbar`, `RdlDataRow`, `RdlMetricCard`, `RdlOverlayIconButton`.
  - Needs review against real page use before becoming the migration base.

- `docs/design-system/flat-material-authority.md`
- `docs/design-system/rdl-component-authority.md`
  - Correct authority split: code-backed Bambook material authority plus RDL component interpretation.

- `styles/os-vnext.css`
  - RDL token variables and `rdl-*` classes are the right target location.
  - Durable RDL variables now live here. `flat-experimental.css` remains a migration shield, not the token authority.

- `components/FinanceManager.tsx`
  - Currently further ahead than the approved `task_mrcglvlt` patch: it consumes RDL primitives and neutral finance status tone.
  - Needs one focused pass to remove remaining page-local color/weight drift before becoming the first sample page.

### Baseline Commit Candidate Set

These files are coherent enough to review together as the first local visual baseline. They define shared material language, Dashboard/Finance sample behavior, or source guards for that behavior.

- `components/ui/RDLPrimitives.tsx`
- `components/ui/RDLPrimitives.test.ts`
- `components/rdlVisualBaseline.test.ts`
- `components/FinanceManager.tsx`
- `components/Dashboard.tsx`
- `components/Dashboard.test.tsx`
- `components/ui/osCompiler/compiledDashboardTemplates.tsx`
- `components/ui/bambookDesignSystem.ts`
- `components/ui/bambookDesignSystem.test.ts`
- `components/ui/bambookOsTokens.ts`
  - Default coordinate and inline danger tokens have been neutralized. No green/amber/purple/red default status classes are allowed in the baseline token layer.
- `components/ui/osMaterial.ts`
- `styles/os-vnext.css`
- `docs/design-system/flat-material-authority.md`
- `docs/design-system/rdl-component-authority.md`
- `docs/design-system/README.md`
- `docs/design-system/material-grammar.md`
- `docs/design-system/visual-wip-triage-2026-07-09.md`

Needs explicit visual confirmation before inclusion:

- `App.tsx`
- `App.test.ts`
- `index.css`
- `components/ui/SidePanelContainer.tsx`

Reason: these files affect the global shell and viewport, not only the Finance/Dashboard sample language.

### Hold Out Of Baseline

These files should not be committed as part of the first visual baseline unless they are separately brought to the same quality bar and reviewed page by page.

- `components/EmailManager.tsx`
- `components/ProductsManager.tsx`
- `components/ProductsManager.test.tsx`
- `components/ui/osCompiler/compiledProductsTemplates.tsx`
- `components/OrderManager.tsx`
- `components/OrderManager.glass.test.tsx`
- `components/ShipmentManager.tsx`
- `components/RelatedEntitiesPanel.tsx`
- `components/paymentReconcileManualUi.test.ts`
- `components/shippingMutationRuntimeQa.test.ts`
- `components/ui/MarketIntelligence.tsx`
- `components/ui/MarketIntelligence.test.tsx`
- `styles/flat-experimental.css`
- `docs/uiux-audit-cross-verification.md`
- `.workbuddy/memory/2026-07-08.md`

Reason: these are either half-migrated pages, page-specific runtime QA drift, temporary migration shields, or documentation/audit artifacts that are not part of the four-page visual acceptance baseline.

### Must Not Treat As Done

- `components/EmailManager.tsx`
  - It has started consuming RDL primitives, but still contains many old-language residues:
    - `font-bold` / `font-medium` on ordinary labels and controls.
    - red, emerald, rose, and blue state colors.
    - mobile header and modal areas still use old material language.
  - Status: experimental migration, not acceptable baseline.

- `components/ProductsManager.tsx`
  - Still contains many semantic colors, shadows, rim-like borders, and old modal material.
  - Status: do not migrate further until the four sample pages are accepted.

- `components/OrderManager.tsx`
- `components/ShipmentManager.tsx`
  - Still contain red/emerald/sky/amber semantic styling.
  - Status: later batch migration only.

- `styles/flat-experimental.css`
  - Useful migration shield.
  - Must not become the final source of truth. Any rule required for final rendering should move to tokens/material roles.

### Freeze / Special Case

- `components/MapLibreProductionGlobe.tsx`
  - Globe remains a special visual layer.
  - No more building-data exploration in this frontend convergence pass.
  - Only stability, viewport centering, marker labels, and demo-tour correctness are in scope.

## Immediate Blocking Issue

`task_mrcglvlt` is approved but cannot merge because main has dirty WIP overlapping with `components/FinanceManager.tsx`.

Resolution path:

1. Locally finish or reduce the current Finance WIP.
2. Decide whether to absorb `task_mrcglvlt` manually into the local baseline or merge it after the dirty overlap is removed.
3. Commit a clean visual baseline before opening more implementation tasks.

Current decision:

- Absorb the approved Finance direction into the local baseline instead of merging the older overlapping patch as-is.
- Do not commit the half-migrated Email/Products/Orders/Shipping changes as part of this baseline.
- Keep Globe work frozen outside viewport/stability fixes.
- Use `rdlVisualBaseline.test.ts`, `RDLPrimitives.test.ts`, and `bambookDesignSystem.test.ts` as the minimum source guard before any new single-page implementation task. `bambookDesignSystem.test.ts` locks the authority boundary: `os-vnext.css` owns durable RDL tokens, while `flat-experimental.css` only proves the temporary no-shadow/no-rim migration shield.

## Current Baseline Guard

Added local source assertions:

- `components/ui/RDLPrimitives.test.ts`
  - Locks the shared RDL primitive family.
  - Asserts primitive surfaces remain flat: no rim, no shadow, no transparent text.
  - Asserts primitive `danger` state is neutral and does not reintroduce red/rose/amber/emerald/green/sky semantic colors.

- `components/rdlVisualBaseline.test.ts`
  - Locks the current Finance sample page to shared RDL primitives.
  - Asserts Finance has no semantic color families, no raised shadows, and no default medium/bold typography.
  - Asserts Finance status/filter states are driven by neutral material opacity.
  - Asserts Dashboard ordinary labels use light/normal weight while preserving the single accent for instrument states.
  - Asserts shared OS status tokens do not reintroduce red/green/amber/purple default semantic styling.

Focused validation:

- `npm exec -- vitest run components/ui/bambookDesignSystem.test.ts components/ui/RDLPrimitives.test.ts components/rdlVisualBaseline.test.ts --no-file-parallelism`
- Result: 3 files / 19 tests passed.

Additional source checks:

- Dashboard + Finance ordinary typography: no `font-medium`, `font-semibold`, or `font-bold`.
- Finance + RDL primitives: no `emerald`, `rose-`, `red-`, `amber-`, `sky-`, `green-`, `shadow-xl`, `shadow-lg`, `shadow-2xl`, or `border-l`.
- `git diff --check`: clean.

## Four-Page Acceptance Order

1. Dashboard
   - Preserve, do not over-migrate.
   - Extract confirmed material/spacing/type rules.

2. Finance
   - First ERP dense-data sample.
   - Verify: filter pills, status pills, feedback banners, tables, modal material.

3. Digital Archives
   - Redesign hierarchy deliberately.
   - Do not just remove panels.

4. Assistant
   - Last sample page.
   - Chat bubbles, markdown, tool panels, and workspace rails need a separate grammar.

## Next Local Action

Make the main WIP mergeable by reducing it to a coherent visual baseline:

- Keep shared authority docs/primitives.
- Finish Finance sample alignment.
- Do not include half-migrated Email/Products page rewrites in the same baseline unless they are brought to the same quality bar.
- After baseline commit, unblock `task_mrcglvlt` and continue sample-page work through clean Sylway tasks.

Concrete next action:

1. Review the baseline candidate set above file by file.
2. Move any global-shell files (`App.tsx`, `index.css`, `SidePanelContainer.tsx`) into the baseline only if they are required for Dashboard/Finance rendering and do not encode page-local decisions.
3. Leave hold-out files dirty but uncommitted, or restore them only after confirming they are not user-owned WIP.
4. Once the baseline candidate set is final, create one visual-baseline commit and then activate the Finance visual验收 task.
