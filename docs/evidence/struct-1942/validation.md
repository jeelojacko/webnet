# STRUCT-194.2 — validation

Branch: `refactor/issue194-cad-shell-actions-control-plane`
Baseline: `e781d269b85999d08aa842cd1d81e7674ea6b0af` (origin/main)
Working tree only — **not committed** (parent inspects + commits). No branch
switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean (exit 0) |
| LSP diagnostics | `lsp_diagnostics` on every new/edited file | clean |
| Lint (touched) | `npx eslint src/components/SurveyCadWorkspace.tsx src/components/surveyCad/cadWorkspaceShellActions*.ts src/components/surveyCad/cadWorkspaceSectionViewLayout.ts` | 0 errors |
| Portable paths | `npm run check:portable-paths` | 6203 tracked paths, 0 violations |
| Production build | `npm run build` | clean, `✓ built in 10.07s` |

## Focused tests

| Suite | Result |
| --- | --- |
| `tests/cad_shell_actions_extraction_1942.test.tsx` (new) | 21/21 |
| `cad_workspace_extraction_1941`, `cad_shell_snapshot_memo_184`, `cad_app_controller`, `cad_shell_snapshot_contract`, `cad_shell_panels`, `cad_surface_contour_race_185`, `cad_surface_revision_cache_185`, `cad_viewport_filter_root_186`, `cad_viewport_filter_186`, `cad_viewport_filter_186_instrument`, `cad_pointer_perf_183`, `cad_pointer_culling_183`, `cad_survey_snapshot_cap_191`, `cad_command_dock_b2`, `cad_grading_calc_notice_20f2`, `cad_grading_edit_flows_20f1`, `cad_grading_group_shell_20f3`, `cad_grading_ui_20b`, `cad_profile_ui`, `cad_section_ui`, `volume_surface_revision`, `volume_surface_service`, `volume_surface_status`, `volume_surface_transactions`, `volume_surface_wncad` | 25 files, 333/333 |
| `tests/surveyCadWorkspace/` + `cad_sheet_history_19b`, `cad_best_fit_sessions_c1`, `cad_dock_polygon_mode_v1`, `cad_dock_polyline_close_c1` | 56 files, 171 pass / 1 skip |

## Full agent tier

`npm run test:agent` → **1005 passed / 3 failed (1008 files)**, 9546 passed +
1 skipped tests. The 3 failures are the known pre-existing `study-desktop`
real-data calibration/preflight failures (frozen `sourcePackageId` drift,
unrelated to CAD and untouched by this phase). No CAD test failed.

## Browser QA (real Chromium, Playwright)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-shell-actions-1942.spec.ts` (new) | 4/4 — selection/erase/undo/redo via ribbon actions; ribbon LINE launch + command-dock Enter/Escape; Layer Manager + Export Center open/close; New Drawing + drawing open/switch remount. Zero page/console/unhandled errors per test. |
| `tests-browser/cad-drawing-18c.spec.ts` | 11/11 (layer manager, visibility/freeze, locked layer, colors, linetype, LWT, Properties+undo, WNCAD save/reopen, no-plot export) |
| `tests-browser/cad-dependency-17e.spec.ts` | 1/1 (import CURRENT → STALE → refresh, F2F sync, ownership, parcel, gates, round-trip) |

## What the new tests pin

`tests/cad_shell_actions_extraction_1942.test.tsx` drives the real
`SurveyCadWorkspace` with a real `createCadShellLink`:

- **Keyset / signatures** — every one of the 97 `CadShellActions` keys is
  present after mount, compared against a frozen baseline list.
- **Action channel** — `actions` non-null after mount; `getActionsVersion()`
  is unchanged on a same-link parent rerender (while `link.actions` is a fresh
  object); unmount nulls `actions` and notifies once; `startCommand` returns
  `true`/`false` for present/missing starters; undo/redo and real layer
  transactions work; StrictMode mount stays non-null with the full keyset.
- **Closure freshness** — a block-reference selection made after mount is seen
  by the re-registered `explodeSelectedBlocks` closure (no stale alert), which
  would fail if the literal were captured once.
- **Managers / dock** — `openSurveyManager('point-groups')` mounts the overlay;
  `cancelCommand`/`confirmCommandInput` never throw; the command-dock buffer is
  replaced through `setSessionInputValue`. Dock Enter/text precedence is pinned
  through the extracted core dispatch closure: a live point session consumes
  submitted text first, then bulk edit, else the regular command; empty Enter
  confirms point → bulk edit → bulk selection → active command in order, with
  the command fallback only when every session declines.
- **Grading current/stale + group-vs-single** (factory-level with a stubbed
  session service so no worker is needed): non-extractable rows return their
  verbatim `extractNotice`/`bakeNotice` and never call `runLayerCommand`;
  extractable-but-not-current returns the "needs a CURRENT calculated result"
  message with no dispatch; a current row dispatches
  `GRADINGEXTRACTDAYLIGHT`/`GRADINGBAKE` with `expectedRevision` and
  `sessionCurrent: true`; group fallbacks are verbatim; Calculate routes through
  `requestGrading`/`requestGroupGrading` and bumps the version; both
  definition command families route through `runLayerCommand`.
- **Compose safety** — same-surface and missing-surface previews return `null`
  (no stale promotion); real-workspace grading fallback notices are exact.
- **Section layout** — the pure `planSectionViewLayout` reports missing groups,
  fully-built groups (`already-exist` with the verbatim message) distinct from
  partial builds (`placements` for the missing lines only), and stacks new
  frames deterministically below every cross-group frame (null cache ⇒ 80 px
  frame, 100 px clearance, origin -200); the extracted `createSectionViews`
  action returns the group-missing message.

## Identity / lifecycle notes validated

- Hook order and count unchanged (109 root hook-call sites before and after);
  no conditional hooks, no hook inside a factory.
- The two `shellLink` effects are byte-identical: per-render
  `shellLink.actions = shellActions` with no dependency array, and
  `notifyActions` only on the `[shellLink]` mount/unmount transition. No
  per-render notify.
- The action object is rebuilt every render from the current context (no
  `useMemo([])`, no stale refs, no global registry), so closures read live
  project/caches/selection/snapshots/services/edit sessions.
- No engine geometry/schema/hash/worker-protocol/drawing-serialization change;
  `#183` pointer channel, `#184` snapshot memo + 500 cap, `#185` contour race,
  `#186` viewport filter, `#189` selection retirement, and `#191` point cap
  pins all stayed green.
- StrictMode mount/double-effect is exercised in the new suite and stays
  non-null/complete.

## Limitations (reported honestly)

- Browser QA for this phase is the new 4-flow action-channel spec plus the
  reused `cad-drawing-18c` (managers/save/export) and `cad-dependency-17e`
  specs. Surface/contour/profile/section/grading manager toggles are covered by
  the existing per-feature browser suites and the extracted action tests, but
  were not re-run in this batch (their behavior is untouched; the action
  literal was moved verbatim).
- The grading current/stale + group-vs-single matrix is tested at the factory
  level with a stubbed grading service (worker-free, deterministic). Real
  worker paths are covered by the pre-existing grading suites.
- `test:wasm`, `parity:industry-reference`, and `test:evidence` were not run:
  this change is UI structural only.
- The root remains over the repo's 900-line guidance (2378 lines); the net
  reduction is 484 lines and the root is smaller, not larger.
