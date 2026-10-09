# STRUCT-194.7 — validation

Branch: `refactor/issue194-cad-shell-registry-snapshots`
Baseline: `7d97568b3a6b8b4dcee2838b24022614f65ffc1b` (exact origin/main, = PR
#221 merge). Committed and pushed to the phase branch. No branch switch, no
stash mutation; the 14 pre-existing stashes are preserved (identifiers, order,
and contents untouched). Refs #194 remains **OPEN**.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| LSP diagnostics | every new + edited file | clean |
| Production build | `npm run build` | clean, `✓ built in 11.94s` |
| Portable paths | `npm run check:portable-paths` | 6242 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites (agent tier, fast/deterministic)

| Suite | Result | What it pins |
| --- | ---: | --- |
| `tests/cad_shell_command_starters_1947.test.ts` | **7/7** | Full 122-key insertion order (literal array); `SURVEYTABLE: undefined`; fresh object per call; direct-entry + `startLineL1Command` wrapper routing; `PARCELSHAREDEDIT` wrapper; PASTE undefined while the clipboard is empty and forwarding the captured ids once non-empty. |
| `tests/cad_shell_snapshot_build_1947.test.ts` | **3/3** | The twelve sub-builders fire in the exact former order (`survey → surveyTable → parcel → featureLine → grading → gradingGroups → blocks → f2f → surface → volume → profile → section`) via production builder mocks; scalar/snapshot/`availableCommands` identity pass-through; `snapStatusText` / null analysis / annotation / empty preview. |
| `tests/cad_shell_registry_snapshot_1947.test.tsx` | **5/5** | Real-root: `availableCommands` equals the literal 120-entry available order with the SURVEYTABLE/PASTE gaps; known key true, `SURVEYTABLE` false, unknown key false; PASTE gated on clipboard (empty → disabled, Ctrl+C → enabled) and routes to a live PASTE session; `availableCommands` memo reference + snapshot identity stable across an unrelated rerender; StrictMode mount keeps the 97-handler channel. |

Total new focused tests: **3 files, 15/15**.

## Focused regression batches

1. All `#194.1`–`#194.7` extraction suites (1941, 1942, 1943, 1944, 1945,
   1946, 1947) → **14 files, 156 passed**.
2. Neighbours: `#183` pointer culling/perf/seed/dedupe, `#184` snapshot
   memo/registry/contract/layout/panels/parcel report, `#185` revision
   cache/contour race/source-revision memo, `#186` viewport filter
   (unit/root), `#191` point cap, shell chrome, grading group shell `20f3`,
   `tests/surveyCadWorkspace/` → **70 files, 348 passed / 1 skipped**.

No genuine regressions.

## Agent tier (single run, frozen source)

`npm run test:agent` → **3 failed | 1017 passed (1020 files)**, 9664 passed +
1 skipped. The 3 failures are the known **pre-existing study-desktop real-data**
trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same class as the 194.1–194.6 baselines (frozen `sourcePackageId` drift). No CAD
test failed.

## Browser QA (real headless Chromium /cad, dev server)

### New spec — `tests-browser/cad-shell-registry-snapshot-1947.spec.ts` **3/3**

- **1947-A** — LINE, ARC_3PT, CIRCLE, CURVE_BETWEEN_TWO_LINES, COGO_POINT,
  PLINE, TRAVERSE ribbon buttons are enabled and each opens the command dock
  (proving the extracted starters route), Escape cancels; zero errors.
- **1947-B** — with an empty clipboard the PASTE button is disabled; select-all
  + Ctrl+C enables it; launching PASTE and picking a point commits one
  transaction (`entityCount` grows and the selection equals exactly the newly
  added entities); zero errors.
- **1947-C** — an unknown dock command (`NOTACOMMAND` + Enter) is a safe no-op
  (`entityCount` unchanged), the selection round-trip through the shell registry
  works, and idle pointer moves leave the drawing unchanged; zero errors.

### Reused specs (all green, zero page/console errors)

| Spec | Result |
| --- | --- |
| `cad-shell-actions-1942.spec.ts` | 4/4 |
| `cad-drawing-lifecycle-1943.spec.ts` | 3/3 |
| `cad-compose-picks-1946.spec.ts` | 4/4 |
| `cad-pointer-perf-183.spec.ts` | 2/2 |
| `cad-surface-revision-185.spec.ts` | 1/1 |

### Known pre-existing failure (not caused here, not retargeted)

- `tests-browser/cad-shell-compact-ribbon-21a.spec.ts` — the three
  resolution-sweep viewport-height assertions differ by a constant 94 px at
  1366×768 / 1920×1080 / 2560×1440. **Reproduced on the exact baseline HEAD
  (before this slice)** with the phase changes reverted, so it is an
  environment/ribbon-layout baseline issue, unrelated to the starter registry or
  the snapshot builder. Not retargeted.

## Preserved pins

- `#183` pointer channel/cull, `#184` shell-snapshot memo + point cap, `#185`
  surface-revision memo + contour race, `#186` viewport filter, `#189` selection
  retirement, `#191` point cap — green.
- `#194.1`–`#194.6` extractions untouched.
- Both `shellLink` registration effects (per-render `actions` assignment with no
  dep array; `notifyActions()` only on mount/unmount), the `shellSnapshot`
  publish effect `[shellLink, shellSnapshot]`, the LandXML / compose / late
  deletion lifecycles, and the 97-key action channel keep their exact positions
  and dependency arrays.
- The `shellAvailableCommands` memo keeps deps
  `[copiedEntityIds.length, activeDrawing.drawingId]` verbatim; the
  `shellSnapshot` memo keeps its exact original dependency array (verified
  byte-identical against HEAD).

## Limitations (reported honestly)

- Root remains 1461 lines, above the repo 900-line guidance; this is the seventh
  #194 slice and the root is smaller (−139), not larger. The
  `buildCadWorkspaceShellActions` call-site context assembly and the remaining
  geometry/snapshot handlers are queued for `#194.8`.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign: this
  is a UI structural change touching no engine / WASM / worker-protocol /
  parity-math code.
- `test:full` was not run; `test:agent` is the pre-push gate and exact-head CI
  is authoritative.

## Doc correction (1946)

`docs/evidence/struct-1946/validation.md` carried one stale line asserting
that the phase branch had not opened a pull request. That phase actually landed
via **PR #221**, MERGED at `7d97568b3a6b8b4dcee2838b24022614f65ffc1b` with 5/5
exact CI green. The line is corrected in place; all 1946 test evidence is
preserved unchanged.
