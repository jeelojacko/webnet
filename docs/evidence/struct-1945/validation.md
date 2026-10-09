# STRUCT-194.5 — validation

Branch: `refactor/issue194-cad-civil-services-lifecycle`
Baseline: `26a5cebeb9eb740393c84b6ac28ae354ac224e22` (origin/main).
No branch switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck / diagnostics | LSP diagnostics on `SurveyCadWorkspace.tsx` + both new hook modules | clean |
| Production build | `npm run build` | clean, `✓ built in 10.03s` |
| Worker chunk | `ls dist/assets | grep -i surfaceWorker` | one chunk `surfaceWorker-YQANEhD9.js` (same hash as 194.4) |
| Portable paths | `npm run check:portable-paths` | 6227 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites

| Suite | Result | What it pins |
| --- | --- | --- |
| `tests/cad_volume_grading_analysis_lifecycle_1945.test.tsx` | **7/7** | service/snapshot-input identity across unrelated rerenders with zero worker requests (manual-only); fresh services + disposal on a drawing switch; volume + grading + analysis all construct `src/workers/surfaceWorker.ts`; `Worker`-undefined fallback (analysis sync fallback computes, volume reports worker unavailable, no transport); the grading reconciliation sweep fires on a project-identity edit and never on an unrelated rerender; a stale volume worker result is never promoted CURRENT and a source rebuild cancels in-flight work without auto-starting; `analysisPlane.notifySourceRebuilt` retires in-flight work without a new request. |
| `tests/cad_profile_section_lifecycle_1945.test.tsx` | **7/7** | service/snapshot-input identity across unrelated rerenders with zero worker requests; fresh services + disposal on a drawing switch; mesh revisions notify each service exactly once per NEW revision and never on an unrelated rerender; alignment notifies only when the `JSON.stringify(entity)` digest changes (first observation silent); both worker paths resolve `src/workers/surfaceWorker.ts`; `Worker`-undefined fallback blocks profile + section; exact snapshot-input shapes backed by the live caches. |

Both suites mount the REAL production hooks with the REAL production services
and mock only worker transport through the existing `src/workers/surfaceWorkerClient`
module seam (the same seam the #185 / #194.4 suites use). Fast/deterministic;
agent tier.

## Focused regression batches

1. Prior #194 extraction suites + the two new suites:
   `cad_surface_build_lifecycle_1944`, `cad_contour_lifecycle_1944`,
   `cad_drawing_file_lifecycle_1943`, `cad_landxml_lifecycle_1943`,
   `cad_shell_actions_extraction_1942`, `cad_workspace_extraction_1941`,
   plus the two 194.5 suites → **8 files, 99 passed**.
2. `tests/surveyCadWorkspace/` (52 files) + volume/profile/section/analysis
   service suites + grading worker/reconcile/UI suites + `cad_analysis_ui_18u`
   → **61 files, 241 passed / 1 skipped**.

No genuine regressions introduced. `#194.4` surface-build + contour suites
(including both contour A→B delivery orders) stay green; the #194.1-#194.3
extractions are untouched.

## A→B / revision-race proof (in the new suites)

- Volume: a request is issued for the CURRENT source revision; resolving the
  hold-open request with `revision: 'vrev1:stale'` leaves
  `statusOf('vol-1')` NOT `CURRENT` and drains `buildingVolumeIds`; a subsequent
  `notifyMeshBuilt` cancels in-flight work and issues no new request.
- Analysis: `requestCalculate` is the only entry point; `notifySourceRebuilt`
  retires in-flight work with no additional request.
- Profile / section: a mesh-revision change notifies once; a repeated render
  with the same sessions object notifies zero times; an alignment digest change
  notifies once; an unchanged project render notifies zero times.

## Agent tier (single run, frozen source)

`npm run test:agent` → **1011 passed / 3 failed (1014 files)**, 9607 passed +
1 skipped (9611 tests). The 3 failures are the known **pre-existing
study-desktop real-data** trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same class as the 194.1/194.2/194.3/194.4 baselines (frozen `sourcePackageId`
drift: v4 `nb-sit-statute-corpus-2026-08-29` vs expected
`nb-sit-statute-corpus-2026-09-11`).

## Known-unchanged failures (not caused here, not retargeted)

- `tests-browser/cad-surface-18h.spec.ts` `18H-E` — `NEEDS_REBUILD` vs
  `CURRENT` after a source MOVE; reproduced on the 194.4 baseline, recorded
  there as pre-existing. Not run this phase.
- `tests-browser/cad-landxml-18m.spec.ts` `18M-G` — stale
  `[data-cad-surface="elevation"]` selector; pre-existing, not retargeted.

## Preserved pins

- `#183` pointer channel/cull, `#184` shell-snapshot memo + point cap,
  `#185` surface-revision memo + contour race, `#186` viewport filter,
  `#189` selection, `#191` point cap — unchanged source, green in the focused
  batches above.
- Both `shellLink` registration effects and the `shellActions` composition
  position are unchanged; the LandXML lifecycle, the late surface-deletion
  effects, the `notifiedMeshRevisionsRef` effect + `surfaceVolumeInputs` memo,
  and the compose control plane keep their exact positions and dependency
  arrays in the root.

## Limitations (reported honestly)

- Root remains 1812 lines, above the repo 900-line guidance; this is the fifth
  #194 slice and the root is smaller (-247), not larger.
- No new browser spec and no Chromium run this phase: the change is a jsdom
  structural extraction touching no engine / WASM / worker-protocol / parity
  code and no new real-browser gap.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign.
- The 3 agent-tier failures (study-desktop real-data) and the recorded browser
  failures are pre-existing and classified as such.

## #194.5 roadmap

1. Compose control plane (`SurfaceComposeService`) — distinct 194.6 issue.
2. `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Snapshot builders' read sources after the service lifecycles move.
