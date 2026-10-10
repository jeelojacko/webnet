# STRUCT-195.9 Validation

## Commits

- Baseline: origin/main `658f4c7eb42f583723b7222e6b6f927fb6c30717` (PR #232 merge)
- Branch: `refactor/issue1959-surface-edit-dxf-type-pairs` (PR head recorded at PR time)

## Graph (scripts/cadTypeImportGraph.mjs, scope src/engine/cad + src/engine/fieldToFinish)

| metric | baseline 658f4c7e | after | delta |
|---|---|---|---|
| nodes | 476 | 478 | +2 leaves |
| edges | 2383 | 2387 | +4 leaf wiring |
| VALUE SCC / nodes / largest | 4 / 18 / 7 | 4 / 18 / 7 | 0 |
| TYPE SCC / nodes / largest | 5 / 10 / 2 | 3 / 6 / 2 | −2 pairs gone |
| VALUE pairs SHA256 | `2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f` | identical | membership byte-identical |
| VALUE edges / unique pairs | 1579 / 1561 | 1579 / 1561 | 0 |
| leaf out-edges | n/a | 0 / 0 | no back path |

Dissolved: `cadSurfaceEditMesh <-> cadSurfaceEdits`,
`dxfBlockExport <-> dxfExportModel` (all four now TYPE singletons).
Remaining TYPE SCCs: projectTransform pair, surfaceRevision pair,
profileExtraction pair (untouched, listed in architecture.md).

## Fidelity / legacy exports

- Reason leaf: exact 17 literals in original order (AST pin); no synonym/partial.
- DXF leaf: `DxfPoint` required x/y, vertex `extends DxfPoint` + three `?`
  metadata fields (AST + heritage + typecheck pins); C2 comment verbatim.
- `DxfPoint3D` stays in `dxfExportModel` (pinned present, absent from leaf).
- Legacy `from './cadSurfaceEdits'` / `from './dxfExportModel'` type imports
  still compile via hub re-exports (bidirectional expectTypeOf old<->leaf).

## Emitted JS parity

All four modified runtime modules byte-identical under
`esbuild --format=esm` (md5 match vs `git show HEAD:<path>`).
Note: bare `esbuild <file>` vs stdin emits a `"use strict";` preamble
difference for files whose only imports are type-erased — an esbuild
auto-format artifact of the invocation, not a code change (identical with
explicit `--format=esm` both sides).

## Tests

- NEW `tests/cad_surface_edit_dxf_type_cycle_1959.test.ts`: 35/35
  (dual-leaf presence, baseline pins both directions, AST order/`?`/
  heritage pins, hub re-exports, purity, repoints, graph guard incl.
  exact 3/6 + value fingerprint, 5 negative controls).
- Focused neighbours (surface edits 18s/persist/bulk/move/transactions,
  export DXF, blocks mirror, export 18c, draft DXF layout): 9 files, 130/130.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors
  (9 pre-existing warnings elsewhere). `npm run build`: clean, 15.37s.
- `npm run check:portable-paths`: 6319 paths, 0 violations.
- `npm run test:agent`: 1037 files passed / 9952 tests passed + 1 skip;
  3 failed files are ALL pre-existing local study-desktop real-data
  fixture failures (`study_ai_unit_calibration`, `calibration_v5`,
  `preflight`) — unrelated, study-content untouched. Exact-head CI
  authoritative for final green.

## Limitations

- Test pins VALUE membership via pair multiset (pair-preserving rewrites
  invisible — same residual risk as 195.7/195.8 guards).
- No Playwright smoke: no CAD export UI behavior changed (type-only).
- One mid-phase test fix by parent: `BaseDxfPolylineVertex` changed from
  intersection alias to `interface extends` — vitest `toEqualTypeOf` is
  strict about interface-vs-intersection identity.

## Stashes / hygiene

14 pre-existing user stashes preserved untouched (count verified 14
before and after). No force push, no unrelated cleanups.
