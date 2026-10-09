# STRUCT-194.4 — validation

Branch: `refactor/issue194-cad-surface-contour-service-lifecycle`
Baseline: `a958ba028e4c2e7893a1cd4bb984c24512ecdf14` (origin/main, PR #218 merge).
No branch switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck / diagnostics | LSP diagnostics on all new + edited files | clean |
| Production build | `npm run build` | clean, `✓ built in 10.13s` |
| Worker chunk | `ls dist/assets | grep surfaceWorker` | one chunk `surfaceWorker-YQANEhD9.js` |
| Portable paths | `npm run check:portable-paths` | 6221 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites

| Suite | Result | What it pins |
| --- | --- | --- |
| `tests/cad_surface_build_lifecycle_1944.test.tsx` | **7/7** | cache / revision-index / service identity across unrelated rerenders; live refs mirror the latest project/drawing/sessions; drawing switch creates a new cache + service and disposes the old; bounded revision history (current + ≤1 previous); build inputs refresh on service state change; `Worker`-undefined bounded sync fallback (no crash); worker URL resolves `/src/workers/surfaceWorker.ts`. |
| `tests/cad_contour_lifecycle_1944.test.tsx` | **6/6** | auto-derive once, converges, no re-trigger on `contourVersion` bump; A→B supersession under a pending request with late A discarded (A-then-B and B-first-then-late-A delivery orders); CURRENT when the TIN is fresh and newest retained stale set when the source revision moved without a rebuilt TIN; scene-input identity stable + dispose on unmount; duplicate style ids first-wins. |

Both mock only the worker transport through the existing
`src/workers/surfaceWorkerClient` module seam used by the #185 suites. They are
fast/deterministic and stay in the agent tier.

## A→B supersession (test data + result)

Fixture: a 4-point contour-styled surface in a real `CadProject`, TIN seeded
into a real `CadSurfaceCache` at the current source revision. Fake transport
holds contour requests open.

1. Mount → auto-derive requests interval A (geometry revision `GA`) for source
   revision `R`.
2. Rerender with the style patched to interval 2 (same surface id, same source
   revision `R`, new immutable project) while A is pending → the revision-aware
   gate falls through and requests B (`GB ≠ GA`); A is cancelled.
3. Deliver A after B → A is discarded: `pendingContourRequest` still equals
   `{ revision: R, geometryRevision: GB }`, `contourCache.get(R, GA)` is
   `undefined`.
4. Deliver B → B converges: pending is `null`, `contourCache.get(R, GB)` is
   defined, `get(R, GA)` stays `undefined`.

Reverse delivery order (B completes before stale A): after step 2 cancels A
and requests B, resolving B first makes `pendingContourRequest` `null` with
`contourCache.get(R, GB)` defined; resolving stale A afterwards is discarded
(pending stays `null`, B remains CURRENT, `get(R, GA)` stays `undefined`), and
an unrelated render via a dedicated counter (all hook inputs including
`surfaceBuildVersion` stable) issues no extra request — 2 requests
total, converged.

Additional CURRENT/STALE case: after A is CURRENT at `R`, a point edit moves the
surface content revision to `R2` with no rebuilt TIN → the sweep issues no
request and the scene falls back to the retained stale A set. Seeding a TIN at
`R2` and bumping `surfaceBuildVersion` issues B for `R2`, which then becomes
CURRENT while A is retained as stale.

## Focused regression batch

`node scripts/runVitest.mjs run <62 CAD suites> tests/surveyCadWorkspace` →
**114 files, 872 passed / 1 skipped**. Includes:

- #185 revision memo + contour race + source-revision memo,
  surface build/worker latest-result, contour UI/worker,
- #194.3 drawing-file + LandXML lifecycle, #194.2 shell-action extraction,
  #194.1 workspace extraction,
- #183 pointer seed/culling/perf, #184 shell-snapshot memo + contract,
  #186 viewport filter (unit + root), #189 selection neighbours,
  #191 point cap, render standards, grading/analysis/volume/profile/section UI,
  dependency gates.

No genuine regressions introduced.

## Agent tier (single run, frozen source)

`npm run test:agent` → **1009 passed / 3 failed (1012 files)**, 9592 passed +
1 skipped (9596 tests). The 3 failures are the known **pre-existing
study-desktop real-data** trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same class as the 194.1/194.2/194.3 baselines (frozen `sourcePackageId` drift).

## Browser QA (real Chromium, Playwright, dev server)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-surface-revision-185.spec.ts` | 1/1 (live-correct through rebuild/edit/undo/switch; real worker path in dev) |
| `tests-browser/cad-drawing-lifecycle-1943.spec.ts` | 3/3 (LandXML cancel/re-stage, commit → TIN CURRENT, drawing switch wipe) |
| `tests-browser/cad-shell-actions-1942.spec.ts` | 4/4 |
| `tests-browser/cad-drawing-18c.spec.ts` | 11/11 |
| `tests-browser/cad-surface-18h.spec.ts` | 9/10 — `18H-E` fails expecting `NEEDS_REBUILD` after a source MOVE |

`18H-E` is **pre-existing, not a regression**: with the root temporarily
restored to baseline `a958ba02` (and the new hooks unused), the same test fails
identically (`Expected "NEEDS_REBUILD"`, received `"CURRENT"`); the working tree
was then restored byte-for-byte from a SHA-verified backup. This spec was not
listed among the specs run by the 194.3 closeout, so it was never previously
certified. No new browser spec was authored: `18H-K` already covers Chromium
contour A-then-B supersession, `185` covers TIN/contour rebuild correctness,
and `1943` covers drawing NEW/Open — there is no new real gap this structural
extraction introduces.

Known unchanged failure: `cad-landxml-18m.spec.ts` `18M-G` (stale
`[data-cad-surface="elevation"]` selector) was **not run or retargeted** this
phase and remains the pre-existing failure recorded by 194.3.

## Preserved pins

- #183 pointer channel/cull, #184 shell-snapshot memo, #185 revision + contour
  race, #186 viewport filter, #189 selection, #191 point cap — green.
- #194.1/#194.2/#194.3 extractions untouched.
- Both `shellLink` registration effects and the `shellActions` composition
  position are unchanged; the LandXML hook still receives
  `getLiveDrawingId: () => drawingIdForBuildsRef.current` and the same
  `surfaceBuildService` identity per drawing.
- The late surface-deletion effect stays in the root with the exact dependency
  array and calls.

## Limitations (reported honestly)

- Root remains 2058 lines, above the repo 900-line guidance; this is the fourth
  #194 slice and the root is smaller (-176), not larger.
- No new browser spec; browser evidence reuses the existing specs above.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign: this
  is a UI structural change touching no engine/WASM/worker-protocol/parity code.
- The 3 agent-tier failures (study-desktop real-data) and the `18H-E` browser
  failure are pre-existing and classified as such; neither is caused by this
  change.

## #194.4 roadmap

1. Extract the remaining volume / grading / analysis / profile / section /
   compose service lifecycles with the same two-hook pattern.
2. Extract the `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Revisit the snapshot builders' read sources once the service lifecycles
   move.
