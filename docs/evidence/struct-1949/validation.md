# STRUCT-194.9 — validation

Branch: `refactor/issue194-cad-analysis-f2f-viewport-state`
Baseline: `bef47869f7c18ad96c2290b4c2150cf7f014d638` (exact origin/main = PR
#223 merge). Final HEAD remains the baseline (work left uncommitted for parent
audit). Refs #194 remains **OPEN** — severity not marked solved. No branch
switch, no stash mutation; the 14 pre-existing stashes are preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| LSP diagnostics | every new + edited file | clean |
| Production build | `npm run build` | clean, `✓ built in 11.76s` |
| Portable paths | `npm run check:portable-paths` | 6263 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites (agent tier, fast/deterministic)

| Suite | Result | What it pins |
| --- | ---: | --- |
| `tests/cad_viewport_lifecycle_1949.test.tsx` | **6/6** | Lazy `cloneCadBounds` init (source mutation never leaks); no `viewBounds` reinit on rerender; generation bumps exactly once per `applyViewport` incl. no-op and pan-only; stable `useCallback` identity; drawing-switch reset + bounds re-clone + stale-generation rejection; zero state churn on an unrelated rerender; StrictMode mount/transform. |
| `tests/cad_analysis_presentation_1949.test.tsx` | **7/7** | Real hook + real engine builders/control plane with deterministic builder counters: unrelated rerender preserves all four references and invokes no builder (no PERF-184 churn); in-place cache clear is invisible until the version bump (then UNBUILT → recalc CURRENT); `surfaceMeshSessions` identity refresh; appearance-only edit repaints with an unchanged `arev1:` revision; export input tracks CALLER units + consumes the exact `analysisSnapshot` reference; `exportCivilSources` stable until a cache identity changes; StrictMode mount. |
| `tests/cad_f2f_catalog_lifecycle_1949.test.tsx` | **8/8** | MISSING_LEGACY with a stable, never-auto-persisted starter clone; fail-closed MISSING_LEGACY when F2F content exists without a catalog; READY when the drawing owns one; classification against the current ref with exactly one transaction and ref-before-commit; no stale ref across undo + drawing switch; provenance-only GENERATED counts; shallow-copied settings preserving aliases; StrictMode mount. |

Total new focused tests: **3 files, 21/21**.

## Focused regression batches

1. `#194.1`–`#194.8` extraction suites + the three new suites → **17 files,
   176 passed** (1941, 1942, 1943 ×2, 1944 ×2, 1945 ×2, 1946 ×3, 1947 ×3,
   1948 ×3, 1949 ×3).
2. Neighbours: `#183` culling/perf/dedupe/seed, `#184` snapshot memo, `#185`
   revision cache/source-revision memo/contour race, `#186` viewport filter
   (unit + root), `#191` point cap, `18U` analysis UI/service/export/input, F2F
   `18c`/`18e`/sync/stale-banner, profile/section/volume UI, grading-group shell
   → **25 files, 231 passed**.
3. `tests/surveyCadWorkspace/` → **52 files, 144 passed / 1 skipped**.

No genuine regressions.

## Agent tier (single run)

`npm run test:agent` → **3 failed | 1023 passed (1026 files)**, 9705 passed + 1
skipped. The 3 failures are the known **pre-existing study-desktop real-data**
trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same `sourcePackageId` drift class as the 194.1–194.8 baselines. No CAD test
failed; the 3 new suites account for the file-count increase (1023 vs 1948's
1020).

## Browser QA (real headless Chromium `/cad`)

### New spec — `tests-browser/cad-analysis-f2f-viewport-1949.spec.ts` **2/2**

- **1949-A** — zooming hard culls rendered geometry; a drawing switch (new
  drawing id) resets zoom/pan through the extracted viewport lifecycle and
  restores the full rendered set; zero errors.
- **1949-B** — a drawing that carries F2F-generated content but no owned catalog
  surfaces the `[data-f2f-legacy-block]` MISSING_LEGACY block from the Survey
  ribbon's F2F entry; zero errors.

### Reused specs (all green, zero page/console errors)

| Spec | Result |
| --- | --- |
| `cad-derived-scene-retirement-1948.spec.ts` | 3/3 |
| `cad-drawing-lifecycle-1943.spec.ts` | 3/3 |
| `cad-pointer-perf-183.spec.ts` | 2/2 |
| `cad-shell-actions-1942.spec.ts` | 4/4 |
| `cad-shell-registry-snapshot-1947.spec.ts` | 3/3 |
| `cad-surface-revision-185.spec.ts` | 1/1 |

Reused total: **16/16**; with the new spec, **18/18**.

### Analysis CURRENT / export reuse

`tests-browser/cad-surface-analysis-18u.spec.ts` was run to reuse the
analysis-CURRENT + Export Center coverage: **18U-A (elevation Calculate → CURRENT
+ colors), 18U-C (legend + save/reopen) and 18U-D (SVG/PDF include map+legend,
DXF explicit) passed**. **18U-B failed on a pre-existing strict-mode selector
ambiguity** unrelated to this phase — the spec's
`getByRole('button', { name: /^Calculate|Recalculate$/ })` resolves both the
disabled `Calculate Volume` and `Calculate` buttons in the Surface manager. The
extracted hooks do not touch the volume manager or its buttons; this is a stale
existing spec selector, not a regression from 1949.

### Flows covered vs not covered (honest report)

- Covered by the new spec: viewport zoom/pan reset on a drawing switch; the
  MISSING_LEGACY block for a catalog-less legacy drawing.
- Covered by reused specs: dock undo/redo + Enter/Escape, drawing lifecycle,
  derived-scene/cursor/hotkey, pointer culling + idle stability, surface
  revision lifecycle, registry/snapshot, and (18U) analysis CURRENT + export.
- Not exercised by a new browser flow (covered deterministically instead):
  analysis epoch/version recompute and `exportCivilSources` identity (pinned by
  `cad_analysis_presentation_1949`), catalog classification/undo/ref and
  provenance counts (pinned by `cad_f2f_catalog_lifecycle_1949`), and the
  viewport generation semantics (pinned by `cad_viewport_lifecycle_1949`).

## Known pre-existing baselines (not retargeted)

- Study-desktop `sourcePackageId` trio (above).
- `cad-surface-analysis-18u.spec.ts` 18U-B strict-mode selector ambiguity
  (above).
- `18M-G` / `18Y-10` / `18I-A` / `18q` stale selectors, `L1-B2` flake, and
  `cad-shell-compact-ribbon-21a` viewport-height delta were not run in this
  phase.

## Preserved pins

- `#183`, `#184`, `#185`, `#186`, `#189`, `#191` — green where run.
- `#194.1`–`#194.8` extractions untouched.
- React hook order preserved: each hook is called unconditionally at its former
  seam and calls only its own internal primitives; all retained dependency
  arrays are byte-identical. 97-action shell channel, 122 starters, 12 snapshot
  builders, both `shellLink` effects, the keyboard hook, and the JSX tree keep
  their exact positions.

## Limitations (reported honestly)

- Root is 1176 lines (≤ 1200 target, above the repo 900-line guidance); this is
  the ninth #194 slice and the root is smaller (−82), not larger.
- No new `scripts/testTiers.ts` entry: the three new suites are fast,
  deterministic, and by construction stay in the agent tier (agent tier is
  `FULL minus excluded`; nothing was added to the exclusions). No
  `tests/evidence/` or WASM-tier file was added.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign: this
  is a UI structural change touching no engine / WASM / worker-protocol /
  parity-math code.
- `test:full` was not run; `test:agent` is the pre-push gate and exact-head CI
  is authoritative.
- Work is left **uncommitted** at baseline HEAD `bef47869f7c18ad96c2290b4c2150cf7f014d638`
  for parent audit; no commit/push/PR/merge was performed.
