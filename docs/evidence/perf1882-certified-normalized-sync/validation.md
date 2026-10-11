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

## Behaviour coverage (`tests/cad_transaction_certified_sync_perf1882.test.tsx`, 33 tests)

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
- **H** certified no-op equivalence proof (7 tests): re-running the exact
  would-be persistence clone-then-compare (`cloneCadDrawingDocument` +
  `buildCadProjectSignature` + layout/labels) against each certified publish
  (ordinary commit, undo, redo, LandXML imported-TIN, draft `plotFrame:false`)
  discards the clone (signatures/layout/labels equal, deep project equality
  with the published doc). Legacy `pointGroupId` and key-reordered-TIN
  controls prove falsifiability: the same assertion FAILS pre-normalization
  (`sigSame === false`, `discarded === false`) and the certified assertion
  helper throws on those inputs.

`tests/cad_transaction_clone_perf188.test.tsx` was updated narrowly for the
2 -> 1 counts (titles/comments/assertions); its 19 tests stay green and keep
covering mount, no-op, external adopt, drawing switch, legacy residual,
draft/layout/labels, non-canonical mounts, snapshot isolation, and budget
liveness. No graph goldens changed.

## Benchmark (paired BEFORE vs AFTER, logged only, no CI thresholds)

Method: one identical harness (the suite's `buildProjectWithEntities` +
`createControlledHarness` + `renameLayer` pattern) was run against two source
trees on the same machine, Node v26.10.0, and toolchain — BEFORE = pinned
`92ba37e1` (clone-twice persistence normalization), AFTER = HEAD `dc5a1d2a`
(certified skip). Fixtures are built outside every timed window; 2 warmup
rounds are excluded; each run performs 15 measured CAD commit/undo/redo rounds;
5 BEFORE/AFTER runs were interleaved (75 timed rounds per side per entity
count). The timed loop (acts, order, rounds, warmup) is byte-identical on both
sides; only the source tree under test changes. Clone counts are real
production `cloneCadDrawingDocument` calls intercepted at the hooks' import
boundary; times are logged only and never asserted.

### Observed medians (pooled: 5 runs x 15 rounds = 75 samples)

| Entities | Path | BEFORE median ms | AFTER median ms | Delta ms | Delta % |
|---|---|---|---|---|---|
| 1,000 | commit | 3.49 | 2.23 | -1.26 | -36.2% |
| 1,000 | undo | 2.79 | 2.07 | -0.72 | -25.7% |
| 1,000 | redo | 2.68 | 2.00 | -0.69 | -25.6% |
| 10,000 | commit | 29.71 | 15.98 | -13.72 | -46.2% |
| 10,000 | undo | 20.79 | 13.38 | -7.40 | -35.6% |
| 10,000 | redo | 20.57 | 13.53 | -7.03 | -34.2% |

### Variance (pooled per-round p25 / median / p75; observed min–max)

| Entities | Path | BEFORE p25/med/p75 (min–max) | AFTER p25/med/p75 (min–max) |
|---|---|---|---|
| 1,000 | commit | 2.78 / 3.49 / 3.86 (2.56–7.58) | 2.03 / 2.23 / 2.41 (1.83–6.22) |
| 1,000 | undo | 2.58 / 2.79 / 3.51 (2.44–9.27) | 1.88 / 2.07 / 3.11 (1.74–6.76) |
| 1,000 | redo | 2.58 / 2.68 / 3.10 (2.45–4.47) | 1.86 / 2.00 / 2.17 (1.76–4.22) |
| 10,000 | commit | 28.41 / 29.71 / 30.45 (20.26–62.22) | 14.39 / 15.98 / 16.77 (12.88–39.65) |
| 10,000 | undo | 19.69 / 20.79 / 21.47 (18.57–22.81) | 12.92 / 13.38 / 14.78 (10.49–15.64) |
| 10,000 | redo | 19.46 / 20.57 / 20.98 (18.47–31.66) | 12.81 / 13.53 / 14.61 (11.33–34.89) |

Per-run medians were stable: the spread of the 5 run medians is <=0.22 ms at
1,000 entities and <=1.09 ms at 10,000 (e.g. 10k BEFORE commit 29.01–30.10 ms,
AFTER commit 15.87–16.46 ms). The wide per-round maxima are JIT/GC/descheduling
outliers in the tail and are not used for the deltas. These times are machine
and JIT-noise sensitive; only the clone counts are deterministic.

### Clone counts (deterministic)

| Entities | Path | BEFORE clones / 15-round run | AFTER clones / 15-round run |
|---|---|---|---|
| 1,000 | commit | 30 (2/round) | 15 (1/round) |
| 1,000 | undo | 30 (2/round) | 15 (1/round) |
| 1,000 | redo | 30 (2/round) | 15 (1/round) |
| 1,000 | no-op | 0 | 0 |
| 10,000 | commit | 30 (2/round) | 15 (1/round) |
| 10,000 | undo | 30 (2/round) | 15 (1/round) |
| 10,000 | redo | 30 (2/round) | 15 (1/round) |
| 10,000 | no-op | 0 | 0 |

Counts are conditional on the test layering. The AFTER counts are pinned by the
committed suite (`expect(commitClones).toBe(ROUNDS)` and the undo/redo/no-op
equivalents in `tests/cad_transaction_certified_sync_perf1882.test.tsx`); the
BEFORE 2/round counts are observed on the pinned source and match the
pre-change clone-first path (wrapper ownership clone + persistence
normalization clone). The clone removed by the certificate is the persistence
normalization clone it proves redundant.

### Skipped-clone cost vs measured net operation savings

The exact clone the certificate skips was timed warm in the same loop:
**0.09 ms (1,000)** and **0.33 ms (10,000)** median (0.07–0.31 / 0.31–1.95 ms
observed min–max). A separate micro-benchmark on the same fixtures gives
`buildCadProjectSignature` **0.51 ms (1,000)** / **2.47 ms (10,000)** and a
warm `cloneCadDrawingDocument` **0.12 ms (1,000)** / **0.31 ms (10,000)**.

The measured net operation savings (e.g. -1.26 ms / -13.72 ms commit at
1k/10k) are larger than the standalone skipped-clone cost because the certified
skip also bypasses the surrounding persistence work — two entry
`buildCadProjectSignature` calls, the clone, a third signature on the cloned
result, and the layout/labels comparison — and because the discarded clone's
allocation/GC pressure is not captured by a warm single-clone timing. Report
both: the clone alone is sub-millisecond; the certificate removes the whole
redundant normalization step.

The old estimate rows below assumed `BEFORE = AFTER + skipped-clone`; the
paired run shows that estimate understated the real BEFORE cost (1k commit
estimated ~2.03 ms vs observed 3.49 ms), so those rows are **superseded and not
used**.

| Entities | Path | Superseded BEFORE estimate ms | Observed BEFORE median ms |
|---|---|---|---|
| 1,000 | commit | ~2.03 | 3.49 |
| 1,000 | undo | ~1.88 | 2.79 |
| 1,000 | redo | ~1.82 | 2.68 |
| 10,000 | commit | ~16.34 | 29.71 |
| 10,000 | undo | ~14.35 | 20.79 |
| 10,000 | redo | ~14.97 | 20.57 |

Supplemental path counts on the same 1k fixture (logged): the legacy
`onPersistedStateChange` fallback pays 3 clones on the first commit and 2
steady-state (`perRound=[3,2,2,2,2,2,2,2,2,2]`, legacy median 0.76 ms); a
non-canonical imported-TIN mount and a legacy `pointGroupId` mount each pay 2
normalization clones; a certified commit pays 1; a no-op pays 0.

## Commands run

- New suite `tests/cad_transaction_certified_sync_perf1882.test.tsx`:
  **33/33 pass** (P2-1/P2-2 pins each fail against the pre-fix code; §H
  equivalence proofs fail when project-signature/layout/labels normalization
  diverges — the rerun's discard decision compares exactly those fields, and
  the deep-equality assertions cover project/layout/labels, not draft or
  other drawing fields).
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
- `npm run check:portable-paths`: 6442 tracked paths, 0 violations.
- `npm run build`: clean (built in 14.41s).
- `npm run test:agent`: **1063 files passed / 11423 passed / 1 skipped** with
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
