# PERF-188.2 — Validation: certified-normalized persistence sync

- Baseline: `92ba37e15f4e47ce1853e86bb3359b139975e64a`.
- Branch: `perf/issue1882-certified-normalized-sync` (unmerged; the parent owns
  PR creation, exact-head CI, and issue state).
- Counters are module-level `vi.mock` wrappers around
  `cloneCadDrawingDocument` and `cloneCadProject` that intercept the hooks'
  real imports, so every number below is a real production clone call.

## Clone counts per path (`cloneCadDrawingDocument` calls)

| Path | Before (PERF-188 corrected) | After (certified) |
|---|---|---|
| (a) canonical controlled mount | 1 | **1** |
| (b) controlled successful commit (`LAYER_RENAME`) | 2 | **1** |
| (c) undo | 2 | **1** |
| (d) redo | 2 | **1** |
| (e) selection-only / rejected command | 0 | **0** |
| (f) persistence re-run, equal content (no certificate) | 1 | **1** |
| (g) genuine external adopt | 1 (post-adoption re-sync may add 1) | **1–2 (same)** |
| (k) LandXML imported-TIN commit / undo / redo | 2 / 2 / 2 | **1 / 1 / 1** |
| (l) draft `plotFrame:false` commit | 2 | **1** |
| (l) `parcelLayout` value propagation | 1 | **1** |
| (l) `showParcelLabels` value propagation | 1 | **1** |
| (i) legacy `onPersistedStateChange` commit | 3 | **3 first commit / 2 steady-state (honest residual)** |
| (m) controlled legacy `pointGroupId` surface mount | 2 | **2** |
| (n) controlled key-reordered imported-TIN mount | 1 | **2 with sanitized purpose / 1 without** |
| two commits batched in one `act` | 3 (2 wrapper + 1 sync) | **2 (2 wrapper + certified skip)** |
| StrictMode commit (dev replay only) | — | **≤ 4 / commit, never a persistence clone** |

The certificate removes exactly the persistence normalization clone on
provenance-certified commits/undo/redo; every non-certified path is byte-for-byte
the pre-change clone-first behavior. Mount normalization and the legacy residual
are unchanged.

## Behaviour coverage (`tests/cad_transaction_certified_sync_perf1882.test.tsx`, 26 tests)

- **A** canonical commit/undo/redo clone once; the published project is a
  distinct reference from the history project yet value-equal; pre-commit
  snapshots are untouched.
- **B** rapid sequential commits (each one undo entry, one clone), a StrictMode
  run (newest state published, no stale overwrite, no duplicate undo, bounded
  dev replay), two commits batched in one `act` (newest project, 2 clones), and
  failed/selection-only updates at 0 clones.
- **C** controlled legacy `pointGroupId` and key-reordered imported-TIN +
  unknown purpose still normalize on mount, idempotently, keeping real
  commit/undo; `plotFrame:false` is preserved.
- **D** an external nested project update (adopted, sanitized) normalizes and
  never certifies; a stale wrapper callback after a drawing switch writes
  nothing; a layout change after a switch normalizes the new drawing rather
  than carrying the old certificate.
- **E** the legacy `onPersistedStateChange` fallback records the honest residual
  of 3 (never a raw-equality skip); LandXML imported-TIN commit/undo/redo is
  certified (1 clone each) and keeps its `landxml-import` provenance.
  Neighbouring F2F suites are run separately (see commands).
- **F** `plotFrame:false` survives a commit and save/reopen parity holds;
  layout/label changes normalize once each; a same-project new draft reference
  publishes without aliasing the history snapshot; a cleared (`null`) history
  draft is published as a blank draft (not the sticky previous draft).
  **P2-1**: a real `PROJECTTRANSFORM` commit (two identity Helmert pairs) seeds
  the live draft into history, then `replaceCadProject` publishes a draft-less
  snapshot; the wrapper must publish a blank draft (not the sticky prior
  sheet), with 1 certified clone. Verified to fail with the pre-fix falsy test.
  **P2-2**: `useCadNormalizedSyncCertificate` clears on a reset-key change even
  when the parent hands back the identical drawing reference (hook-level pin,
  fails with identity-only hygiene), and a workspace reset-key change does not
  carry the stale certificate.
- **G** negative controls: the ownership-boundary clone is never omitted
  (published project is an independent ref); a source-project mismatch always
  normalizes; a raw-signature bypass cannot leak a legacy shape.

`tests/cad_transaction_clone_perf188.test.tsx` was updated narrowly for the
2 -> 1 counts (titles/comments/assertions); its 19 tests stay green and keep
covering mount, no-op, external adopt, drawing switch, legacy residual,
draft/layout/labels, non-canonical mounts, snapshot isolation, and budget
liveness. No graph goldens changed.

## Benchmark (logged only, no CI thresholds)

1k/10k entities of a real `CadProject` + drawing; fixtures built outside every
timed window; 2 warmup rounds; 10 measured rounds; medians reported.

| Entities | Path | Clones / 10 rounds | Median ms | Skipped clone ms | BEFORE estimate ms |
|---|---|---|---|---|---|
| 1,000 | commit | 10 | 1.93 | 0.10 | ~2.03 |
| 1,000 | undo | 10 | 1.78 | — | ~1.88 |
| 1,000 | redo | 10 | 1.72 | — | ~1.82 |
| 1,000 | no-op | 0 | — | — | — |
| 10,000 | commit | 10 | 15.86 | 0.48 | ~16.34 |
| 10,000 | undo | 10 | 13.87 | — | ~14.35 |
| 10,000 | redo | 10 | 14.49 | — | ~14.97 |
| 10,000 | no-op | 0 | — | — | — |

BEFORE is `AFTER + skipped-clone` (the exact normalization clone the
certificate removes). Counts are deterministic; times are machine/JIT-noise
dominated and are never asserted.

Supplemental path counts on the same 1k fixture (logged): the legacy
`onPersistedStateChange` fallback pays 3 clones on the first commit and 2
steady-state (`perRound=[3,2,2,2,2,2,2,2,2,2]`, legacy median 0.76 ms); a
non-canonical imported-TIN mount and a legacy `pointGroupId` mount each pay 2
normalization clones; a certified commit pays 1; a no-op pays 0.

## Commands run

- New suite `tests/cad_transaction_certified_sync_perf1882.test.tsx`:
  **26/26 pass** (P2-1/P2-2 pins each fail against the pre-fix code).
- Updated suite `tests/cad_transaction_clone_perf188.test.tsx`:
  **19/19 pass**.
- Focused regression batch (11 files): both perf suites +
  `cad_history_stable_signature_perf187`, `landxml_import_undo_history_18m`,
  `cad_f2f_sync`, `cad_f2f_rerun_sync_scale`, `cad_parcel_save_reopen_19d`,
  `cad_sheet_history_19b`, `cad_draft_sheet_layout_19b`,
  `cad_drawing_file_lifecycle_1943`, `cad_drawing_file`: **143/143 pass**.
- Draft/sheet/transform focused batch (7 files, 76 tests: both perf suites +
  `cad_project_transform_draft_18r1`, `cad_draft_sheet_layout_19b`,
  `cad_sheet_history_19b`, `cad_draft_sheets`, `cad_draft_integration`):
  **76/76 pass**.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on both changed source files and both test files: 0 errors.
- `npm run check:portable-paths`: 6439 tracked paths, 0 violations.
- `npm run build`: clean (built in 11.80s).
- `npm run test:agent`: **1063 files passed / 11411 passed / 1 skipped** with
  only the 3 known pre-existing, ignored/private Study Desktop real-data
  failures (`study_ai_unit_calibration_v5`, `study_ai_unit_preflight`, and the
  third frozen-corpus suite). These are unrelated to this change and were not
  touched.

## Residual caveats

- The certificate is intentionally per-workspace-instance and holds one entry;
  no cross-workspace or global reuse is possible.
- The legacy fallback and mount normalization pay their normal clones (no
  shortcut); that is the explicitly honest residual.
- On a non-canonical adopt that triggers a history re-baseline, the persistence
  sync may run twice (normalization + post-adoption re-sync) — the same
  behavior as before this change.
- StrictMode dev replay inflates raw clone counts (discarded updater values);
  this is a development-only artifact and the certificate still suppresses the
  persistence clone.
