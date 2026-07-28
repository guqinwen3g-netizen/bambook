# Module Registry Plan

This plan defines the target shape for a single Bambook module registry. Phase 1 and the first low-risk Phase 2/4 call sites have been implemented; do not treat the remaining phases as complete until their status says so below.

Last reviewed: 2026-06-11

## 1. Problem

Main app module information is currently split across multiple files:

- `types.ts`: `View` enum.
- `App.tsx`: compiler surface keys, compiler flags, conditional rendering, sub-view state.
- `components/Sidebar.tsx`: navigation labels, icons, admin gating.
- `components/ui/osCompiler/compiledSidebarTemplates.tsx`: duplicated navigation labels and icons.
- `services/authService.ts`: view permission requirements.
- page components: local sub-view models such as orders fabric/garment and settings account/system.

This creates drift. A label, permission, icon, compiler switch, or entry component can change in one place but not another.

## 2. Goal

Create one registry that can answer:

1. What product module is this?
2. What `View` opens it?
3. What label and icon should navigation use?
4. Which permission gates it?
5. Is it shown in primary navigation?
6. Which compiler surface owns it?
7. Is the compiler surface accepted or provisional?
8. Which component renders the accepted compiler path and legacy fallback?
9. Does it have sub-views?
10. Which runtime surfaces should include or exclude it?

## 3. Non-Goals

- Do not replace React rendering in the first commit.
- Do not rename `View` enum values in the first commit.
- Do not delete fallback components while compiler surfaces still depend on them.
- Do not change permissions without a separate auth review.
- Do not use the registry to hide legacy routes without a migration note.

## 4. Proposed File

Preferred path:

```text
components/moduleRegistry.ts
```

Alternative if it grows too large:

```text
components/modules/moduleRegistry.ts
components/modules/moduleTypes.ts
components/modules/moduleNavigation.ts
components/modules/moduleCompiler.ts
```

Start with one file. Split only when the implementation becomes hard to read.

## 5. Proposed Types

```ts
import type { LucideIcon } from 'lucide-react';
import { View } from '../types';

export type MainCompilerSurface =
  | 'sidebar'
  | 'dashboard'
  | 'relations'
  | 'products'
  | 'settings'
  | 'assistant'
  | 'samples'
  | 'knowledgeBase'
  | 'orders'
  | 'emails'
  | 'businessTools'
  | 'adminPanel';

export type ModuleCompilerProvenance = 'accepted' | 'provisional' | 'legacy-only';

export type ModuleRuntimeSurface =
  | 'desktop'
  | 'electron'
  | 'mobile'
  | 'ui-lab'
  | 'ui-lab-2'
  | 'server'
  | 'ops';

export type ModuleSubView = {
  id: string;
  label: string;
  description?: string;
  view?: View;
  localStateKey?: string;
};

export type BambookModuleDefinition = {
  id: string;
  view: View;
  productLabel: string;
  internalName: string;
  icon: LucideIcon;
  nav: {
    primary: boolean;
    adminOnly?: boolean;
    order: number;
  };
  permissions: {
    required?: string;
    policy: 'public-authenticated' | 'permission' | 'dev-only' | 'role';
    roles?: string[];
  };
  compiler?: {
    surface: MainCompilerSurface;
    queryKey: string;
    storageKey: string;
    provenance: ModuleCompilerProvenance;
  };
  runtime: {
    surfaces: ModuleRuntimeSurface[];
    rootScope?: string;
  };
  entry: {
    current: string;
    compiled?: string;
    fallback?: string;
  };
  subViews?: ModuleSubView[];
  cleanup?: {
    namingDebt?: string;
    migrationNotes?: string[];
  };
};
```

## 6. Initial Registry Shape

The first registry should preserve current behavior.

| Module id | Product label | View | Compiler | Provenance | Permission |
| --- | --- | --- | --- | --- | --- |
| `dashboard` | 全景看板 | `View.Dashboard` | `dashboard` | accepted | authenticated |
| `assistant` | AI 助手 | `View.Assistant` | `assistant` | provisional | `ai:chat` |
| `relations` | 关系智库 | `View.Relations` | `relations` | accepted | `relations:read` |
| `products` | 数字档案 | `View.Products` | `products` | accepted | `products:read` |
| `orders` | 生产管理 | `View.Orders` | `orders` | provisional | `orders:read` |
| `development` | 开发管理 | `View.Development` | `development` | provisional | currently ungated |
| `emails` | 智能邮箱 | `View.Emails` | `emails` | provisional | `emails:read` |
| `data-center` | 数据中心 | `View.KnowledgeBase` | `knowledgeBase` | provisional | `knowledge:read` |
| `settings` | 设置 | `View.Settings` | `settings` | accepted | authenticated |
| `business-tools` | 业务工具 | `View.BusinessTools` | `businessTools` | provisional | `tools:execute` |
| `admin` | 管理后台 | `View.AdminPanel` | `adminPanel` | provisional | `users:read` plus nav role gate |

Special views:

| View | Registry posture |
| --- | --- |
| `View.AccountSettings` | sub-view of settings, not a primary module. |
| `View.SystemSettings` | sub-view of settings, not a primary module. |
| `View.UiLab` | dev-only lab entry, not a product module. |

## 7. Derived Functions

The registry should provide read-only helpers before replacing call sites.

```ts
export function getModuleByView(view: View): BambookModuleDefinition | undefined;
export function getPrimaryNavigationModules(options: {
  isAdmin: boolean;
  canAccessView: (view: View) => boolean;
  allowedViews?: readonly View[];
}): BambookModuleDefinition[];
export function getCompilerSurfaceForView(view: View): MainCompilerSurface | undefined;
export function getViewPermission(view: View): string | undefined;
export function isDevOnlyView(view: View): boolean;
export function resolveSettingsMode(view: View): 'account' | 'system' | null;
```

Rules:

- Helpers must preserve current behavior first.
- No helper should import React components in the first phase.
- Component references can be added later or kept in `App.tsx` until the render plan is ready.

## 8. Migration Phases

### Phase 1: Registry Read Model

Add `moduleRegistry.ts` with metadata only.

Replace nothing except possibly tests that assert the registry matches current hard-coded values.

Status: complete as of 2026-06-11.

Implemented:

- `components/moduleRegistry.ts`
- module definitions for the primary desktop product modules
- module lookup by `View`
- primary navigation derivation
- settings sub-view mode resolution
- compiler surface query/localStorage key lookup

Risk: low.

### Phase 2: Navigation Derivation

Replace duplicated nav arrays in:

- `components/Sidebar.tsx`
- `components/ui/osCompiler/compiledSidebarTemplates.tsx`

Both should derive from the same registry. This removes label/icon drift.

Status: first desktop pass complete as of 2026-06-11.

Implemented:

- real Sidebar primary navigation now uses `getPrimaryNavigationModules`
- compiled Sidebar primary navigation now uses `getPrimaryNavigationModules`
- existing visual structure, account menu, permission filter, and `allowedViews` behavior are preserved

Not included:

- mobile/PWA navigation
- UI Lab-specific controlled navigation rules

Risk: medium. Visual and permission behavior can drift if filter logic changes.

### Phase 3: Permission Derivation

Move `VIEW_PERMISSION_REQUIREMENTS` source data out of `authService.ts`, then let auth and module metadata derive from the same neutral source.

Keep existing `canAccessView` behavior:

- Dashboard and Settings remain authenticated-public.
- `View.UiLab` remains dev-only.
- ungated views remain explicitly marked, not accidentally missing.

Status: first pass complete as of 2026-06-11.

Implemented:

- `lib/modulePermissions.ts` owns explicit permission policy for every `View`
- `services/authService.ts` now derives `canAccessView` from the neutral permission module
- `components/moduleRegistry.ts` uses the same permission definitions for module metadata
- `authService.ts` does not import `components/moduleRegistry.ts`, avoiding a service -> UI dependency

Preserved:

- Dashboard and Settings remain authenticated-public
- `View.UiLab` remains dev-only
- Admin sidebar role gate remains separate from `users:read`

Risk: high when changed, now covered by targeted auth tests.

### Phase 4: Compiler Surface Derivation

Move these from `App.tsx` into registry metadata:

- compiler surface key
- query key
- localStorage key
- provenance

`shouldUseCompilerSurface` should consume registry data instead of local records.

Status: key lookup complete as of 2026-06-11.

Implemented:

- `App.tsx` now reads compiler query/localStorage keys through `getCompilerSurfaceConfig`
- `App.tsx` initializes compiler surface flags from `BAMBOOK_MAIN_COMPILER_SURFACES`
- URL and localStorage behavior is unchanged
- page rendering still stays in `App.tsx`

Risk: medium. LocalStorage persistence can affect user-visible rendering.

### Phase 5: App Rendering Plan

Only after phases 1-4 are stable, consider a render registry or route-like table.

Do not rush this. App rendering currently passes many page-specific props. A premature render registry may hide important dependencies.

Risk: high.

## 9. Sub-View Modeling

Current hidden sub-view models:

- Settings:
  - account
  - system
- Orders:
  - fabric orders
  - garment orders
- Products:
  - normal product archive
  - product module settings workspace

These should be modeled as module sub-views before any URL/router work.

Proposed posture:

- Settings sub-views can map to existing `View.AccountSettings` and `View.SystemSettings`.
- Orders sub-views should remain local state initially.
- Products settings workspace should remain local state initially.

## 10. Naming Cleanup Targets

Do not rename in the registry migration commit. First record the debt:

| Current code name | Product name | Target decision needed |
| --- | --- | --- |
| `Samples`, `SampleManager` | 开发管理 | (Completed) Renamed to `Development` / `DevelopmentManager` in June 2026. |
| `KnowledgeBase` | 数据中心 | Whether target code name is `DataCenter` or `DataTwin`. |
| `Products` | 数字档案 | Whether code remains Products or migrates to DigitalArchive. |
| `Orders` | 生产管理 | Whether fabric/garment become sub-route concepts. |

## 11. Tests To Add When Implementing

Suggested targeted tests:

1. Registry contains every `View` used in primary navigation.
2. Sidebar and compiled sidebar labels are derived from the same registry.
3. Permissions derived from registry match current `canAccessView` behavior.
4. Compiler surface query/storage keys match current values.
5. Settings, AccountSettings, and SystemSettings resolve to one settings module with correct mode.
6. Admin navigation role gate remains separate from `users:read` permission until product decision is made.

## 12. Rollback Strategy

Each migration phase should be independently revertible:

- Phase 1 adds metadata only.
- Phase 2 changes navigation only.
- Phase 3 changes auth only.
- Phase 4 changes compiler switching only.
- Phase 5 changes rendering only.

Do not combine phases in one cleanup PR.
