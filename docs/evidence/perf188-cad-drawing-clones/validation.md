# PERF-188 — Validation: redundant CAD drawing-document clone optimization

- Baseline: `origin/main 76415916adc87795305b7a7896dc59b098d3b054`.
- Branch: `perf/issue188-cad-history-drawing-clone-optimization` (unmerged; the
  parent owns PR creation, exact-head CI, and issue state).
- Negative controls: every zero-clone assertion fails on the pre-fix source
  (11 of 17 new tests failed against `HEAD` source, including the no-op,
  selection-only, persistence-no-change, external-adopt, legacy, and perf
  budgets). The counters are module-level `vi.mock` wrappers around
  `cloneCadDrawingDocument` and `cloneCadProject` that intercept the hook's
  real imports.

## Clone counts per path (deterministic; `cloneCadDrawingDocument` calls)

| Path | Before | After |
|---|---|---|
| (a) mount | 0 | 0 |
| (b) successful order-preserved commit (`LAYER_RENAME`) | 2 (wrapper + discarded sync) | **1** (wrapper) |
| (c) undo | 2 | **1** |
| (d) redo | 2 | **1** |
| (e) selection-only update | 1 (wrapper) | **0** |
| (e) rejected command (`current` returned) | 1 (wrapper) | **0** |
| (f) persistence effect re-run, equal content | 1 (discarded) | **0** |
| (g) genuine external project update + adopt | 1 (discarded) | **0** |
| (h) stale callback after drawing switch (new-history reject) | 0 | 0 |
| (i) legacy `onPersistedStateChange` commit | 3 | **2** |
| (j) controlled-mode commit | 2 | **1** |
| (k) LandXML imported-TIN commit | 2 | 2 (residual, see below) |
| (k) undo after LandXML import | 2 | **1** |
| (k) redo after LandXML import | 2 | 2 (residual) |
| (l) draft/`plotFrame:false` preserving commit | 2 | **1** |
| (l) parcelLayout value propagation | 1 | 1 |
| (l) showParcelLabels value propagation | 1 | 1 |

Net: **one full-project deep clone removed from every real order-preserved
commit / undo / redo**, and the no-op / selection-only / equal-content /
external-adopt paths go to zero.

## Elapsed medians (counts are deterministic; times are logged, never gated)

Fixtures prebuilt outside every timed window; medians over the iteration set.

| Fixture | Path | Clones before | Clones after | Median before | Median after |
|---|---|---|---|---|---|
| 1k lines, 5 iters | commit | 10 | 5 | 4.70 ms | 3.97 ms |
| 1k lines, 5 iters | undo | 10 | 5 | 6.17 ms | 3.61 ms |
| 1k lines, 5 iters | redo | 10 | 5 | 4.14 ms | 3.93 ms |
| 1k lines, 5 iters | no-op | 1 | 0 | 1.55 ms | 0.06 ms |
| 10k lines, 2 iters | commit | 4 | 2 | 38.18 ms | 36.96 ms |
| 10k lines, 2 iters | undo | 4 | 2 | 37.70 ms | 32.92 ms |
| 10k lines, 2 iters | redo | 4 | 2 | 34.04 ms | 33.48 ms |
| 10k lines, 2 iters | no-op | 1 | 0 | 12.70 ms | 0.03 ms |

The commit/undo/redo medians are dominated by the remaining wrapper clone and
by JIT/browser noise in CI; the deterministic win is the halved clone count
and the effectively removed no-op cost. No time thresholds are asserted.

## Residual clones and caveats

- **Imported-TIN key-order fall-through** (`LANDXML_IMPORT`, and the legacy
  migrated project): `cloneCadSurfaceDefinition` normalizes surface key order,
  so the raw `buildCadProjectSignature` precheck sees the drawing's canonical
  project and the raw history project as different and conservatively falls
  through to the unchanged clone (which is then discarded). Commit/redo of an
  imported-TIN drawing therefore keep one redundant sync clone.
- **Legacy key-order fall-through**: the migrated legacy drawing project is
  key-order-different from the raw history project, so the persistence
  precheck still clones once (3 -> 2, not 3 -> 1). Legacy round-trips also
  reset the workspace history baseline; that is pre-existing behaviour,
  independent of this change.
- Candidate 3 (reuse `next.present.project` and skip the wrapper clone too)
  was **not** taken: the residual clone is the ownership boundary that
  publishes an independent drawing document, and removing it risks
  history-snapshot alias corruption across multi-edit/undo/redo/F2F/reopen.
- The precheck adds one `buildCadProjectSignature(cadProject)` stringify on
  the fall-through path; it removes a full deep clone + draft re-sanitize.

## Behaviour/invariant coverage (`tests/cad_transaction_clone_perf188.test.tsx`)

17 tests: (a)-(l) above plus deep-value snapshot isolation (multi-edit +
undo/redo preserves every historical snapshot, drawing and history project
stay value-equal after every commit) and budget-sensitivity negative
controls. The suite also pins: draft `plotFrame:false` survives a commit;
`parcelLayout.open` and `showParcelLabels` propagate; controlled mode never
mutates the parent document; the LandXML transaction depth/undo/redo survives
the imported-TIN sync clone.

## Commands run

- New suite `tests/cad_transaction_clone_perf188.test.tsx`: **17/17 pass**
  (agent config), against the fixed source.
- Focused regression batch (19 files, **279 tests pass**):
  `cad_transaction_clone_perf188`, `landxml_import_undo_history_18m`,
  `cad_history_stable_signature_perf187`, `cad_spike_scene_laziness_perf190`,
  `cad_drawing_file_lifecycle_1943`, `cad_drawing_file`,
  `cad_f2f_sync`, `cad_f2f_rerun_sync_scale`, `cad_parcel_save_reopen_19d`,
  `cad_annotation_persistence`, `cad_surface_bulk_persist_18v`,
  `cad_surface_edit_persist_18s`, `cad_sheet_history_19b`,
  `cad_draft_sheet_layout_19b`, `cad_polyline_vertex_editing_c3_grips`,
  `cad_dependency_gates`, `cad_alignment_parcel_construction_command_type_leaves_24113`
  (graph guard), `cad_workspace_extraction_1941`, `cad_shell_actions_extraction_1942`.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the two touched source files + the new test: **0 errors**.
- `npm run check:portable-paths`: 6436 paths, **0 violations**.
- `npm run build`: clean (14.79 s).
- Graph guards (no new module or edge; unchanged): CAD+F2F 513 nodes / 2486
  edges with VALUE/TYPE SCC 0/0; full `src` 1685 nodes / 7597 edges with
  VALUE SCC 0 and TYPE SCC 7 / 38 modules; VALUE/MIXED digests
  `0bc9bae1…` / `415f97f0…` unchanged. No strict guard was weakened or
  rolled forward.
- `npm run test:agent`: **1062 files passed / 3 failed; 11388 tests passed,
  3 failed, 1 skipped**. The only failures are the three pre-existing
  ignored/private Study Desktop real-data suites (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`); fixtures
  untouched and no changed module is imported by them.

## Issue-closure verdict

`Refs #188` only. The change removes one full-project deep clone from the real
successful commit/undo/redo path (2 -> 1 for order-preserved projects) and
drives the no-op/selection-only/equal-sync paths to zero, with the residual
TIN/legacy key-order sync clone quantified above. Per the closure criterion
this is a genuine reduction with a stated residual; the parent/controller owns
the final close decision and CI.
