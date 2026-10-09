# STRUCT-194.3 — validation

Branch: `refactor/issue194-cad-drawing-lifecycle-extraction`
Baseline: `025c0d75273385453c727d3aea879a7dcae45529` (origin/main)
Committed and pushed to PR #218 (branch `refactor/issue194-cad-drawing-lifecycle-extraction`), **not merged**. HEAD `b15ed31a6e7f18e6966da3689b89ea934eef1856` at the time of the implementation commit; this closeout docs commit records that metadata. No branch switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean (exit 0) |
| LSP diagnostics | every new/edited file | clean |
| Lint (whole `src`) | `npx eslint src` | 0 errors / 0 warnings (baseline restored) |
| Portable paths | `npm run check:portable-paths` | 6213 tracked paths, 0 violations |
| Production build | `npm run build` | clean, `✓ built in 10.44s` |
| Tier manifest | `tests/test_tier_manifest.test.ts` | 11/11 |

## Focused tests

| Suite | Result |
| --- | --- |
| `tests/cad_drawing_file_lifecycle_1943.test.tsx` (new) | 19/19 |
| `tests/cad_landxml_lifecycle_1943.test.tsx` (new) | 13/13 |
| `cad_workspace_extraction_1941`, `cad_shell_actions_extraction_1942`, `cad_command_pointer_seed_183`, `cad_pointer_culling_183`, `cad_pointer_perf_183`, `cad_shell_snapshot_memo_184`, `cad_surface_contour_race_185`, `cad_surface_revision_cache_185`, `cad_surface_source_revision_memo_185`, `cad_viewport_filter_186`, `cad_viewport_filter_root_186`, `cad_survey_snapshot_cap_191`, `cad_sheet_history_19b`, `cad_adjustment_dependency`, `cad_dependency_gates`, `landxml_import_undo_history_18m`, `landxml_import_build_glue_18m`, `cad_drawing_file` | 18 files, 162/162 |
| `tests/surveyCadWorkspace/` + LandXML/civil/persistence neighbours | 62 files, 218 pass / 1 skip |

## Full agent tier

`npm run test:agent` → **1007 passed / 3 failed (1010 files)**, 9580 passed +
1 skipped tests. The 3 failures are the known pre-existing `study-desktop`
real-data calibration/preflight failures (frozen `sourcePackageId` drift,
unrelated to CAD and untouched by this phase). The two new suites are included
and green; no CAD test failed.

## Browser QA (real Chromium, Playwright)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-drawing-lifecycle-1943.spec.ts` (new) | 3/3 — cancel → re-stage; commit → imported TIN schedules + settles CURRENT; drawing switch wipes staged and re-stages. Zero page/console errors. |
| `tests-browser/cad-shell-actions-1942.spec.ts` | 4/4 (action channel: select/erase/undo/redo, ribbon+dock, managers, drawing switch/remount) |
| `tests-browser/cad-drawing-18c.spec.ts` | 11/11 (layer manager, visibility/freeze, colors, linetype, LWT, Properties+undo, WNCAD save/reopen, no-plot export) |
| `tests-browser/cad-landxml-18m.spec.ts` | 14 passed / 1 skipped (18M-F `fixme`) / 1 failed (18M-G) |

The single `cad-landxml-18m.spec.ts` 18M-G failure is **pre-existing and
unrelated**: the test clicks `[data-cad-surface="elevation"]`, an attribute
that does not exist anywhere on this baseline (`git grep HEAD -- src` shows
only `data-cad-surface={row.id}` in `CadToolspace.tsx`, keyed by real surface
id). The command-family selector went stale before this phase and cannot have
been affected by moving drawing-file/LandXML handlers. Every commit/scheduling
landxml flow (18M-A…E, H…N, large-commit) passed.

## Coverage map (new suites)

`tests/cad_drawing_file_lifecycle_1943.test.tsx` drives the real production
hook + component:

- `replaceActiveDrawing` emission order `emit → project → status`.
- New in `m`/`ft` units, blank entities, fresh drawing, `cad-created`.
- Save success (file name, serialized bytes, exact `CAD_DRAWING_FILE_TYPES`,
  status + `cad-saved` once) vs picker cancel (no status, no event).
- Open valid (parse, replace, `cad-opened`, input reset) / malformed JSON /
  size limit (read never called) / read rejection.
- Import-adjusted: bridge snapshot wins over a live result; unit-mismatched
  snapshot fails closed with the engine message; legacy gate routes the exact
  `{document, identity, result, sourceName:'Current adjustment'}` args; the
  three blocked gates (no result / stale gate off / missing identity) emit the
  verbatim blocked text; `hasAdjustmentSource` truth table.
- Component: New parity between a controlled and a persisted host; Save button
  once; `shellLink.actions.newDrawing/saveDrawing/openDrawingFile`; StrictMode
  mount/unmount keeps the action channel usable.

`tests/cad_landxml_lifecycle_1943.test.tsx` covers the handler layer (mock
setters/service) and the effect layer (real React state + fake build service):

- Stage awaits the read, builds the preview, binds to the live drawing, exact
  review status; malformed XML clears + exact `LandXML import failed:` text;
  in-flight drawing switch cancels without binding (deferred promise, no
  timers); selection functional update keeps `null` null.
- Commit schedules only committed surfaces, watches them, releases staging;
  rejected/duplicate and unavailable-seam commits mutate nothing; a payload for
  another drawing is rejected before the history seam.
- Effects: schedule once; materialization failure notice once and then retired;
  staged/watched/pending wiped on drawing switch.
- Component: modal stage/cancel/commit; commit schedules real surfaces and
  closes; drawing switch drops the staged review.

## Race matrix

| Scenario | Expected | Evidence |
| --- | --- | --- |
| Drawing switch during the LandXML file read | Cancel status; no staged binding | `cad_landxml_lifecycle_1943` "in-flight drawing switch" (deferred promise) |
| Commit payload whose `drawingId` no longer matches | Rejected before `runLandXmlImport` | `cad_landxml_lifecycle_1943` stale-payload test |
| Cancel / close review | No entity or history mutation | component + browser 1943-A |
| All-duplicate / empty commit | "Nothing new to import.", no schedule | `cad_landxml_lifecycle_1943` rejected-commit test |
| Commit success | One deferred transaction; schedule once, one render later | node `landxml_import_undo_history_18m` + browser 1943-B |
| Worker materialization failure | Notice once, watched id retired, definition stays | `cad_landxml_lifecycle_1943` diagnostics-once test |
| Drawing switch | Staged / watched / pending wiped; no worker recreation (service memo keyed on `drawingId`) | `cad_landxml_lifecycle_1943` wipe test + browser 1943-C |
| New drawing units | Current units, blank project | `cad_drawing_file_lifecycle_1943` unit variants |

## Preserved pins

- `#183` pointer channel / cull (`cad_pointer_*`) green.
- `#184` 7-field shell-snapshot memo (`cad_shell_snapshot_memo_184`) green.
- `#185` weak revision + contour latest-wins race green.
- `#186` 4→1 scan + LAST-WINS + ANY-HIDDEN green.
- `#191` point cap green.
- `194.2` 97 shell actions + two `shellLink` effects **byte-identical** — the
  diff touches neither effect line (verified with `git diff`).
- `194.1` drawing source / diagnostics / presenters untouched.

## Limitations (reported honestly)

- Browser QA is the new 3-flow spec plus re-run 1942 + 18c + 18m. The 18m-G
  failure is a pre-existing stale selector (see above); no new failure.
- `test:wasm`, `parity:industry-reference`, and `test:evidence` were not run:
  this change is UI structural only and touches no engine/WASM/parity code.
- The root remains above the repo 900-line guidance (2234 lines); this is the
  third #194 slice and the root is smaller, not larger.

## #194.4 roadmap

1. Extract the surface/profile/section/contour/volume/analysis/grading service
   lifecycles (~350–980, the largest remaining block).
2. Extract the `SurveyCadWorkspaceSurface` drawing/pick handler bodies.
3. Consider the snapshot builders' read sources once the service lifecycles
   move.
