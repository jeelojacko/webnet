# STRUCT-195.8 — Validation (Workstream C evidence)

## Test file

`tests/cad_export_scene_type_cycle_1958.test.ts` — the ONLY test/src file
touched (plus this directory). No other test or source file modified.

Coverage, per the workstream requirements:

1. Hand-transcribed `BaseExportBase` + full 7-branch `BaseExportItem`
   (from baseline `cadExportScene.ts` at HEAD; no leaf imports on the
   expected side). Bidirectional `expectTypeOf` old-path ↔ baseline-pin,
   leaf ↔ baseline-pin, and old-path ↔ leaf.
2. AST/exact-shape pins: exact branch order, exact keys per branch (2-D
   pin incl. `?`), verbatim member-text pins (incl. the text branch's
   trailing-`;}` trivia), ExportBase property pin — any missing `?`,
   changed literal/number type, or changed nested point-array shape fails.
3. Discriminant/optional probes: all seven kind literals, required
   `layer: string`, optional `clipId`/`widthMm`/`opacity`/`anchor`/
   `rotationDeg` as `T | undefined`, number fields, `points:
   Array<{x;y}>`, `close: boolean`.
4. Legacy `ExportWarning`: hub type `= toEqualTypeOf` exportResult type
   both directions + hub source still re-exports the warning surface.
5. Leaf purity: zero `import` statements (AST + `^\s*import` regex) and zero
   runtime value exports (AST: no value declarations, every export
   declaration type-only).
6. Consumer repoint: each of the four consumers imports from
   `./cadExportItemTypes` and none imports `ExportItem` from
   `./cadExportScene`; hub imports `ExportItem` from the leaf.
7. Graph (via `scripts/cadTypeImportGraph.mjs`, in-process, no
   subprocesses): no single TYPE component holds all five modules; each of
   the five is a TYPE singleton; leaf has no edge of any kind back to the
   five; VALUE membership pinned by hash + both counts.
8. Four negative controls on mutated IN-MEMORY copies (no tree mutations,
   nothing left behind, no snapshots touched):
   - control 1: smuggled value import AND smuggled `import type` each make
     the zero-import scan return 1 hit (even a type-only import violates
     the zero-import contract).
   - control 2: appended `export const …` and appended value re-export
     each make the value-export scan non-empty.
   - control 3: `clipId?: string` → `clipId: string` in a copy fails the
     ExportBase property pin.
   - control 4: swapping the line/polyline branches in a copy fails both
     the kind-order pin and the member-text pin.

## Test results (personally observed)

- `npx vitest run tests/cad_export_scene_type_cycle_1958.test.ts`:
  **1 file passed, 27 tests passed, 0 failed** (~2.4 s total, tests ~39 ms;
  the graph build is in-process parsing, no hundreds of subprocesses).
- TypeScript LSP diagnostics on the new test file: clean.
- The suite was written against the BASELINE shapes first (hand pins from
  `git show HEAD:src/engine/cad/cadExportScene.ts`, when the leaf had not
  landed), then re-verified against the final disk state: leaf, hub, and
  all four consumers re-read after the parallel workers landed; all
  assertions pass on the integrated tree.
- `git status` after the run: only the new test file, the two new evidence
  docs, pre-existing worktree modifications (leaf/hub/consumers/TODO.md by
  others), no snapshot or fixture modifications. No evidence of modified
  snapshots: no `--update` flag used, no snapshot files touched.

## What was NOT done (honest limitations)

- Full `test:agent` NOT run (parent owns that per the workstream brief).
- CI status NOT claimed: no commit was made (per instructions) and no CI
  run was observed. Exact-head CI remains authoritative.
- `expectTypeOf` bidirectional assertions are compile-time: they are
  enforced by the repo's project typecheck (Husky/CI), not by the vitest
  runtime pass. The runtime AST pins are what fail under plain vitest on
  shape drift; both layers are present by design (same pattern as 195.7).
- The VALUE-graph baseline pin reuses the 195.7 constants. This is valid
  ONLY because (a) the canonicalization is identical (same GRAPH_DIRS,
  same pair-string scheme — verified by reading the 195.7 test), and
  (b) it was verified empirically: the HEAD-snapshot graph (475 nodes)
  and the integrated worktree graph (476 nodes) both yield 1561 pairs /
  1579 edges / SHA256 `2bf1817d…6323f`. Residual limitation inherited from
  195.7: a change preserving the from→to pair multiset (e.g. one value
  edge swapped 1:1 for another on the SAME pair) is invisible to the
  hash; the edge-count pin only catches pair collapsing/merging.
- Baseline graph facts in architecture.md were measured with a throwaway
  scratch script (`/tmp/fp1958.mjs`, since removed from the repo — it
  lived outside the tree) using `git show HEAD:<path>`; the committed
  test contains NO historical-git commands (shallow-CI safe).
- The five remaining 2-node TYPE SCCs and four VALUE SCCs listed in
  architecture.md are pre-existing and out of scope; they were byte-identical
  before/after (member lists compared in the scratch run).
- Worker-reported (not independently audited): that the leaf text is
  verbatim from the baseline and that no consumer logic changed. The
  parity pins + zero value-edge delta corroborate this, but a semantic
  diff review of the worker diffs remains the parent's integration call.

## Pre-existing observations (personally measured, unchanged by this work)

- Unresolved specifiers in the graph scope: 94 before and after (bare /
  alias specifiers outside the curated `src/engine/cad` +
  `src/engine/fieldToFinish` universe; same set, not investigated further).
- The refactor adds exactly 3 TYPE edges (hub import + hub re-export +
  cadSheetScene split import) and 1 node (the leaf); value/mixed edges
  identical (1330 / 249 both sides).
