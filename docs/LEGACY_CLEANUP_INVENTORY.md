# Legacy Cleanup Inventory

This inventory tracks high-confidence legacy or stale candidates. It is not a deletion approval list. Each item must pass a second reference and runtime-entry review before removal.

Last reconciled: 2026-07-24

> Completion note: every path listed under “Marked Candidates” was already absent from the active checkout when this inventory was reconciled. These sections are historical evidence of completed cleanup, not open work. Use [WORKSPACE_HYGIENE.md](./WORKSPACE_HYGIENE.md) for current workspace rules.

## Status Legend

| Status | Meaning |
| --- | --- |
| Marked | Candidate identified; do not delete yet. |
| Needs owner decision | Product/engineering decision required before migration. |
| Needs entry audit | Confirm no manual/dev/deploy entry remains. |
| Protected | Do not delete without dedicated review. |
| Completed historically | The recorded path is absent from the active checkout; retain only as audit history. |

## Marked Candidates

### Old Mobile PWA Shell

Status: Completed historically

Files:

- `pwa/mobile/MobilePwaApp.tsx`
- `pwa/mobile/MobilePwaDashboard.tsx`
- `pwa/mobile/MobilePwaDock.tsx`
- `pwa/mobile/MobilePwaRelationsView.tsx`
- `pwa/mobile/mobileRoutes.ts`
- related `.bambook-pwa-mobile` CSS in `index.css`

Current evidence:

- The current mobile entry is `pwa/mobile/MobileWebApp.tsx`.
- `index.tsx` dynamically imports `MobileWebApp`, not `MobilePwaApp`.
- Existing mobile tests already assert the old `MobilePwaApp` entry is not imported.

Do not delete until:

- manual preview paths are checked,
- mobile tests are reviewed,
- any remaining `.bambook-pwa-mobile` CSS ownership is mapped.

### Classic Assistant Window

Status: Completed historically

Files:

- `components/AgentPetWindowClassic.tsx`
- `components/mascot/BambookPandaAgentClassic.tsx`

Current evidence:

- Current renderer entry imports `AgentPetWindow`.
- The classic window appears self-contained and not part of the current main path.
- This is a file-level candidate only. The shared `bambook-agent-pet-*` class family is still used by the current non-classic pet window and must not be marked legacy as a group.

Do not delete until:

- Electron/preload/manual pet preview paths are checked,
- package scripts and dev-only entries are searched,
- any fallback use is ruled out.

### Old Brand/Icon Components

Status: Completed historically

Files:

- `components/PandaIcon.tsx`
- `components/BambookLogo.tsx`
- `components/Logo.tsx`

Current evidence:

- Current app surfaces use `BambookIcon`, `BambookWordmark`, or newer brand assets.
- Some old brand components appear only as standalone declarations or audit baseline references.

Do not delete until:

- brand asset ownership is decided,
- audit baseline references are reviewed,
- no external story/demo/manual usage remains.

### Outdated Cleanup Notes

Status: Completed historically

Files:

- `server/prisma/PHASE6_CLEANUP_NOTES.md`

Current evidence:

- The note references a future cleanup that appears to have already happened.
- It references deleted files and old migration status.

Suggested action:

- Replace with an archive note or update the file to state that Phase 6 cleanup has completed.

### Stale Mobile Ignore

Status: Completed historically

Files:

- `vite.config.ts`
- `App.test.ts`

Current evidence:

- `vite.config.ts` still ignores `**/components/mobile/**`.
- Tests currently assert this old ignore remains.
- The old `components/mobile` directory is gone.

Suggested action:

- Decide whether this ignore still protects anything.
- If not, remove the ignore and update the test in a dedicated small change.

## Protected Or Not Yet Classified

These are not cleanup candidates even if they look redundant:

- `styles/design-system.css`: legacy but still imported.
- `components/ui/osCompiler/*`: duplicated with real pages but still used by the main application.
- `bambook-shadow-sibling-stack`
- `data-glass-edge-mask`
- `GlassEdgeFadeShadow`
- backend legacy sync routes during cutover
- `server/ops-panel`
- `server/scripts/ops/*`
- database migrations

## Next Cleanup Pass

Recommended order:

1. Add explicit `@deprecated` comments to marked legacy files, without changing behavior.
2. Remove stale docs/config only after targeted references are checked.
3. Migrate or delete old mobile PWA shell only after confirming no manual entry remains.
4. Remove old brand/icon components only after brand ownership is confirmed.
