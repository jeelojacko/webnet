# STRUCT-194.1 — validation

Branch: `refactor/issue194-cad-workspace-extraction-a`
Baseline: `b746036510348d65cb5cfa945e0a9cebefe294ff`
Working tree only — **not committed** (parent inspects + commits). No branch
switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean (exit 0) |
| Lint (touched) | `npx eslint src/components/SurveyCadWorkspace.tsx src/components/surveyCad/SurveyCadWorkspaceManagers.tsx src/components/surveyCad/SurveyCadWorkspaceEditForms.tsx src/components/surveyCad/cadDependencyDiagnostics.ts src/hooks/surveyCad/useSurveyCadDrawingSource.ts tests/cad_workspace_extraction_1941.test.tsx` | 0 errors |
| Portable paths | `npm run check:portable-paths` | 6196 tracked paths, 0 violations |
| Production build | `npm run build` | clean, `✓ built in 10.88s` |

## Focused tests

| Suite | Result |
| --- | --- |
| `tests/cad_workspace_extraction_1941.test.tsx` (new) | 19/19 |
| `tests/cad_app_controller.test.tsx`, `cad_shell_snapshot_memo_184`, `cad_viewport_filter_root_186`, `cad_surface_contour_race_185`, `cad_surface_revision_cache_185`, `cad_sheet_history_19b` | 6 files, 26/26 |
| `tests/surveyCadWorkspace/` | 52 files, 144 pass / 1 skip |
| `cad_adjustment_dependency`, `cad_dependency_gates`, `cad_pointer_culling_183`, `cad_pointer_perf_183`, `cad_viewport_filter_186`, `cad_survey_snapshot_cap_191`, `cad_shell_snapshot_contract`, `cad_f2f_stale_banner`, `cad_shell_panels` | 9 files, 156/156 |

## Full agent tier

`npm run test:agent` → **1004 passed / 3 failed (1007 files)**, 9527 passed +
1 skipped tests. The 3 failures are the known pre-existing
`study-desktop` real-data calibration/preflight failures (frozen
`sourcePackageId` drift, unrelated to CAD and untouched by this phase; see the
TODO history for the stash-proven trio). No CAD test failed.

## Browser QA (real Chromium, Playwright)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-dependency-17e.spec.ts` | 1/1 (import CURRENT, edit STALE, refresh, F2F sync, ownership, parcel, gates, round-trip) |
| `tests-browser/cad-drawing-18c.spec.ts` | 11/11 (layer manager, visibility/freeze, locked layer, colors, linetype, LWT, Properties+undo, WNCAD save/reopen, no-plot export) |

These exercise the extracted chrome, toolbar, dependency chip, drafting panel,
managers, and drawing save/reopen path through the real built UI.

## Coverage map (Acceptance A + E)

`tests/cad_workspace_extraction_1941.test.tsx` drives the **actual production
hook/components**:

- **Drawing source (Seam 1):** controlled `drawing` overrides persisted;
  null + persisted falls back; `canFeedDraftingFromResult` gate on/off
  (`metadata.source` `adjustment-result` vs `parsed-input`); blank drawing with
  `ft` units; controlled setter identity; fallback no-op identity; replacement
  mapping with `cad-drawing:` stripping; functional updater receives the
  migrated previous drawing; `null` replacement; no-setter no-throw.
- **Dependency diagnostics (Seam 2):** CURRENT (pinned owner-conflict fallback
  phrase), MANUAL-ONLY label, missing linked stations, result replacement, F2F
  drift, unstamped legacy, derived-label `STALED` promotion + non-promotion,
  no-reason fallback, exact chip punctuation/title/action.
- **Manager composition (Seam 3):** drafting panel and Export Center mount only
  after their toggles (and unmount on close); `shellChrome` hides the
  dedicated chrome but keeps the dependency chip; survey manager overlay mounts
  from the shell link and closes; `data-*`/`aria-label` selectors preserved.

## Identity / lifecycle notes validated

- Hook order unchanged (fixed one-for-one replacement of the `legacyDrawing`
  `useMemo`); no conditional hooks.
- `shellLink` registration effects untouched; `#183` pointer channel, `#184`
  snapshot memo + 500 cap, `#185` contour race, `#186` viewport filter, engine
  geometry/schemas/persistence bytes/cache epoch/workers/protocol all
  unchanged.
- StrictMode-safe (no new refs during render, no state writes during render);
  the manager component uses grouped presentational props and adds no
  `React.memo`.

## Limitations

- Browser QA was scoped to the two directly affected specs; no new screenshots
  were produced (no intended visual change).
- The root file remains over the repo's 900-line guidance (2862 lines); this is
  the first of the #194 phases and the root is smaller, not larger.
- Net root reduction is 289 lines rather than the ~350 target; the gap is the
  irreducible manager-wrapper wiring (see `architecture.md`).
- `test:wasm`, `parity:industry-reference`, and `test:evidence` were not run:
  this change is UI structural only and does not touch engine/WASM/parity code.
