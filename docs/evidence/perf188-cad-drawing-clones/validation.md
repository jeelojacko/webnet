# PERF-188 — Validation: redundant CAD drawing-document clone optimization

- Baseline: `origin/main 76415916adc87795305b7a7896dc59b098d3b054`.
- Branch: `perf/issue188-cad-history-drawing-clone-optimization` (unmerged; the
  parent owns PR creation, exact-head CI, and issue state).
- **P1/P2 correction** (post-review of PR #262): the persistence pre-clone
  early return was removed as unsound. The wrapper no-op guard is retained.
  Clone counts below are the corrected post-fix values; the "before" column is
  the pre-#262 baseline.
- Negative controls: the new `(m)` legacy-`pointGroupId` and `(n)`
  key-reordered imported-TIN tests fail if the unsafe early return is
  reintroduced (verified by re-applying the pre-correction hook: 13 tests
  fail, including both). The counters are module-level `vi.mock` wrappers
  around `cloneCadDrawingDocument` and `cloneCadProject` that intercept the
  hook's real imports.

## Clone counts per path (deterministic; `cloneCadDrawingDocument` calls)

| Path | Before (#262 baseline) | Buggy early return | Corrected |
|---|---|---|---|
| (a) mount, canonical drawing | 1 | 0 (vacuous assert) | **1** |
| (b) successful order-preserved commit (`LAYER_RENAME`) | 2 (wrapper + normalization sync) | 1 | **2** |
| (c) undo | 2 | 1 | **2** |
| (d) redo | 2 | 1 | **2** |
| (e) selection-only update | 1 (wrapper) | 0 | **0** |
| (e) rejected command (`current` returned) | 1 (wrapper) | 0 | **0** |
| (f) persistence effect re-run, canonical equal content | 1 | 0 | **1** |
| (g) genuine external project update + adopt | 1 | 0 | **1** |
| (h) stale callback after drawing switch (new-history reject) | 0 | 0 | **0** |
| (i) legacy `onPersistedStateChange` commit | 3 | 2 | **3** |
| (j) controlled-mode commit | 2 | 1 | **2** |
| (k) LandXML imported-TIN commit | 2 | 2 | **2** |
| (k) undo after LandXML import | 2 | 1 | **2** |
| (k) redo after LandXML import | 2 | 2 | **2** |
| (l) draft/`plotFrame:false` preserving commit | 2 | 1 | **2** |
| (l) parcelLayout value propagation | 1 | 1 | **1** |
| (l) showParcelLabels value propagation | 1 | 1 | **1** |
| (m) controlled legacy `pointGroupId` surface mount | 1 publish (normalized) | 0 (legacy leaked) | **2** (normalization publish + post-adoption re-sync) |
| (n) controlled key-reordered imported-TIN mount | 1 publish (normalized) | 0 (raw order leaked) | **1** (normalization publish) |

Net: the retained optimization is the **wrapper reference-based no-op guard**:
selection-only and rejected-command updates drop from `1` to `0` clones, and
no-op/idempotent syncs never clone. A genuine order-preserved
commit/undo/redo still pays the wrapper clone **and** the persistence
normalization sync (`2`, the pre-#262 baseline), because raw equality cannot
prove the target is normalization-stable — see `architecture.md` "Precise
safe-precheck domain". Mount on a controlled drawing similarly pays exactly
one normalization clone (`1` drawing, `1` nested project), matching the
pre-#262 baseline.

The `(m)`/`(n)` counts also pin correctness: a controlled drawing carrying a
supported legacy `pointGroupId` (or a non-canonical key-order imported TIN)
must be published in normalized form, and the `(m)` normalization is
idempotent (no further publish on rerender) with no history wipe (a subsequent
commit keeps its single undo entry).

## Elapsed medians (counts are deterministic; times are logged, never gated)

Fixtures prebuilt outside every timed window; medians over the iteration set.
Because the persistence micro-optimization was removed, the corrected median
for commit/undo/redo matches the pre-#262 path; the no-op win remains. Times
are machine/JIT-noise dominated and are not asserted.

| Fixture | Path | Clones/iter (corrected) | Clones/iter (pre-#262) |
|---|---|---|---|
| 1k lines, 5 iters | commit | 2 | 2 |
| 1k lines, 5 iters | undo | 2 | 2 |
| 1k lines, 5 iters | redo | 2 | 2 |
| 1k lines, 5 iters | no-op | 0 | 1 |
| 10k lines, 2 iters | commit | 2 | 2 |
| 10k lines, 2 iters | undo | 2 | 2 |
| 10k lines, 2 iters | redo | 2 | 2 |
| 10k lines, 2 iters | no-op | 0 | 1 |

## Residual clones and caveats

- The persistence normalization sync is retained in full: on any change to
  `cadProject`/layout/labels the effect clones first and compares the clone,
  discarding it when equal. This is required because the clone performs real
  normalization (`version: 2`, `cogoComputations` default, legacy surface
  point-source migration, surface-purpose sanitize, nested key order) that a
  raw signature compare cannot detect.
- The only sound short-circuit is the wrapper's reference-based no-op guard;
  it observes the history updater's own references and cannot misjudge a
  normalization shape.
- Candidate 3 (reuse `next.present.project` and skip the wrapper clone too)
  was **not** taken: the residual clone is the ownership boundary that
  publishes an independent drawing document, and removing it risks
  history-snapshot alias corruption across multi-edit/undo/redo/F2F/reopen.

## Behaviour/invariant coverage (`tests/cad_transaction_clone_perf188.test.tsx`)

19 tests: (a)-(n) above plus deep-value snapshot isolation (multi-edit +
undo/redo preserves every historical snapshot, drawing and history project
stay value-equal after every commit) and budget-sensitivity negative
controls. The suite pins: mount counters with the spy armed **before** mount
(no post-mount reset), draft `plotFrame:false` survives a commit;
`parcelLayout.open` and `showParcelLabels` propagate; controlled mode never
mutates the parent document; the LandXML transaction depth/undo/redo survives
the normalization sync; a controlled legacy `pointGroupId` surface is
published as canonical `pointGroupIds` and stays idempotent with no history
wipe; a key-reordered imported-TIN is republished in canonical key order.

## Commands run

- New suite `tests/cad_transaction_clone_perf188.test.tsx`: **19/19 pass**
  (agent config), against the corrected source. Re-applying the pre-correction
  hook fails 13/19, including `(m)` and `(n)`.
- Focused regression batch (24 files): `cad_transaction_clone_perf188`,
  `landxml_import_undo_history_18m`, `cad_history_stable_signature_perf187`,
  `cad_spike_scene_laziness_perf190`, `cad_drawing_file_lifecycle_1943`,
  `cad_drawing_file`, `cad_drawing_file_legacy_migration_18f` (legacy
  `.wncad`/sidecar migration), `cad_f2f_sync`, `cad_f2f_rerun_sync_scale`,
  `cad_parcel_save_reopen_19d`, `cad_annotation_persistence`,
  `cad_surface_bulk_persist_18v`, `cad_surface_edit_persist_18s`,
  `cad_sheet_history_19b`, `cad_draft_sheet_layout_19b`,
  `cad_polyline_vertex_editing_c3_grips`, `cad_dependency_gates`,
  `cad_alignment_parcel_construction_command_type_leaves_24113`,
  `cad_workspace_extraction_1941`, `cad_shell_actions_extraction_1942`.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the touched source + test: 0 errors.
- `npm run check:portable-paths`: 0 violations.
- `npm run build`: clean.
- `npm run test:agent`: see PR #262 exact-head CI; the only known failures are
  the three pre-existing ignored/private Study Desktop real-data suites.
