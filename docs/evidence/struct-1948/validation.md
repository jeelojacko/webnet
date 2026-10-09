# STRUCT-194.8 — validation

Branch: `refactor/issue194-cad-effects-derived-scene-extraction`
Baseline: `b7fdf2302cbff76c2b2136622a11af0f4a9bfac7` (exact origin/main, = PR
#222 merge). Refs #194 remains **OPEN**. No branch switch, no stash mutation;
the 14 pre-existing stashes are preserved (identifiers, order, contents
untouched).

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| LSP diagnostics | every new + edited file | clean |
| Production build | `npm run build` | clean, `✓ built in 11.56s` |
| Portable paths | `npm run check:portable-paths` | 6263 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites (agent tier, fast/deterministic)

| Suite | Result | What it pins |
| --- | ---: | --- |
| `tests/cad_derived_scene_lifecycle_1948.test.tsx` | **7/7** | Real `useSurveyCadPreGradingDerivedScene` / `useSurveyCadGradingEditOverlayScene`: stable output references on unrelated rerender; parcel-label toggle strips only `:parcel-label` text and re-derives the primitive list; cache-version epoch recompute; source-id preservation; reported-computation filter; zero-preview base reference preserved; nonzero previews appended in edit → point → bulkSelection → bulkEdit order. |
| `tests/cad_shell_cursor_hotkeys_1948.test.tsx` | **6/6** | Real `useSurveyCadShellCursorAndInsertKeyEffects` / `useSurveyCadSurfaceEditHotkeys`: Escape disarms block INSERT only for a non-typing target; cursor publishes snapped → 3-decimal raw → null through the imperative channel with no idle-render publish; Escape cancel order edit→point→bulkSelection→bulkEdit + one notice; Enter priority point→bulkEdit→bulkSelection→edit with fall-through; typing targets ignored; StrictMode install/remove of the capture listener. |
| `tests/cad_civil_retirement_1948.test.tsx` | **7/7** | Real retirement hooks with fake services: exact `handle…Deleted` call for each removed analysis map / volume / profile / sample-line group; selected-id clears (including the paired group+line clear); no double eviction on repeated renders; no spurious cancel on same-id edits; drawing-switch retirement once per previously-known id; surface updater invalidates + contour-cancels only retired ids and returns the previous record reference when nothing was deleted; undo restoration does not re-add or mis-cancel. |

Total new focused tests: **3 files, 20/20**.

## Focused regression batches

1. All `#194.1`–`#194.7` extraction suites (1941, 1942, 1943, 1944, 1945,
   1946, 1947) → **14 files, 156 passed**.
2. Neighbours: `#183` culling/perf/seed/dedupe, `#184` snapshot memo, `#185`
   revision cache/source-revision memo/contour race, `#186` viewport filter
   (unit + root), `#191` point cap, 18S/18T/18V edit/session suites →
   **15 files, 157 passed**.
3. `tests/surveyCadWorkspace/` → **52 files, 144 passed / 1 skipped**.
4. Civil UI freshness/delete: `cad_analysis_ui_18u`, `cad_analysis_service_18u`,
   `cad_profile_ui`, `cad_section_ui`, `cad_volume_ui`,
   `cad_grading_group_shell_20f3` → **6 files, 80 passed**.

No genuine regressions.

## Agent tier (single run, frozen source)

`npm run test:agent` → **3 failed | 1020 passed (1023 files)**, 9684 passed + 1
skipped. The 3 failures are the known **pre-existing study-desktop real-data**
trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same class as the 194.1–194.7 baselines (frozen `sourcePackageId` drift). No CAD
test failed. A first, back-to-back run (immediately after the focused batches)
reported a transient 4th failure that did not reproduce on the confirming run
above; the three study-desktop files account for every reproducible failure.

## Browser QA (real headless Chromium /cad)

### New spec — `tests-browser/cad-derived-scene-retirement-1948.spec.ts` **3/3**

- **1948-A** — the shell status-bar cursor readout (driven by the extracted
  `useSurveyCadShellCursorAndInsertKeyEffects` imperative channel) moves from
  `E —  N —` to live coordinates on pointer move and stays live across idle
  moves; zero errors.
- **1948-B** — a dock typing target keeps its own Escape after the extracted
  capture listeners install (LINE session, no entity change), and the cursor
  channel still publishes afterwards; zero errors.
- **1948-C** — the parcel-label toggle flips its state class and back without
  mutating the drawing; zero errors. (The label-text removal is pinned
  deterministically in the unit suite because the 19A seed carries no stored
  parcel closure metrics, so no `:parcel-label` primitives render in this flow.)

### Reused specs (all green, zero page/console errors)

| Spec | Result |
| --- | --- |
| `cad-shell-actions-1942.spec.ts` | 4/4 (selection/erase/undo/redo + dock Enter/Escape + managers + remount) |
| `cad-drawing-lifecycle-1943.spec.ts` | 3/3 (LandXML cancel/re-stage, committed import CURRENT, drawing switch) |
| `cad-compose-picks-1946.spec.ts` | 4/4 (surface/volume picks, compose copy undo, block INSERT repeat) |
| `cad-pointer-perf-183.spec.ts` | 2/2 (idle moves static, box-select/pan/zoom culling) |
| `cad-surface-revision-185.spec.ts` | 1/1 (one derive per eligible set, live-correct) |
| `cad-shell-registry-snapshot-1947.spec.ts` | 3/3 (re-run unchanged) |

Total browser flows exercised this phase: **20/20**.

### Flows covered vs not covered (honest report)

- Covered by the new spec: shell cursor + snap readout through the imperative
  channel; dock typing Escape safety; parcel-label toggle state.
- Covered by reused specs: undo/redo, block INSERT repeat (and its one-shot
  arming), surface revision lifecycle, pointer culling, registry/snapshot,
  draw/curve/circle/COGO/line/traverse starters.
- Not exercised by a new browser flow (covered by unit/agent tests instead):
  block-INSERT **Escape disarm** (pinned by `cad_shell_cursor_hotkeys_1948`);
  TIN edit Enter/Escape (18S/18T unit suites + service tests); deletion of
  analysis/volume/profile/section/surface via the manager followed by
  switch/undo/redo (pinned by `cad_civil_retirement_1948` + the civil UI
  suites). No fixture provides a CURRENT surface/volume/profile without a real
  worker, so those flows were intentionally left to the deterministic unit
  coverage rather than a flaky browser setup.

### Known pre-existing baselines (not retargeted)

- Study-desktop `sourcePackageId` trio (above).
- `18M-G` / `18Y-10` / `18I-A` / `18q` stale selectors, `L1-B2` flake, and
  `cad-shell-compact-ribbon-21a` 94 px viewport-height delta (documented
  environment/layout baselines) were **not run** in this phase.

## Preserved pins

- `#183`, `#184`, `#185`, `#186`, `#189`, `#191` — green where run.
- `#194.1`–`#194.7` extractions untouched.
- React hook order preserved: each hook is called unconditionally at its former
  seam and calls only its own internal hooks; all retained dependency arrays are
  byte-identical. 97-action shell channel, 122 starters, 12 snapshot builders,
  both `shellLink` effects, and the JSX tree keep their exact positions.
- No base-scene refilter (hook 2 returns the grading-stage reference unchanged
  with zero previews); no publish on idle pointer.

## Limitations (reported honestly)

- Root remains 1258 lines, above the repo 900-line guidance; this is the eighth
  #194 slice and the root is smaller (−203), not larger.
- No new `scripts/testTiers.ts` entry: the three new suites are fast,
  deterministic, and by construction stay in the agent tier (the agent tier is
  `FULL minus excluded`, and nothing was added to the exclusions). No
  `tests/evidence/` or WASM-tier file was added.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign: this
  is a UI structural change touching no engine / WASM / worker-protocol /
  parity-math code.
- `test:full` was not run; `test:agent` is the pre-push gate and exact-head CI
  is authoritative.

## Head

Baseline `b7fdf2302cbff76c2b2136622a11af0f4a9bfac7`. Implementation + initial
evidence: `956ab2126becb637ef80291f44ae97db0616dbde`. This page is refreshed in
a docs-only closeout commit on top of that head; the final branch head is
the closeout commit.
