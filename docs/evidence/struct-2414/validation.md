# STRUCT-241.4 Validation

Branch: `refactor/issue2414-primitive-geometry-entity-types` at
`526be1780efa7c0d90eb33728869a2591f2219d4` (exact main, ff-only, no
reset/force; 14 stashes preserved; `.pi/lsp.json` untouched).

## Source/AST and emit parity

- 8/8 leaf declarations verbatim vs hub (worker brace-matched check).
- Hub retains grouped `import type` + `export type` of all 8; zero leftover
  original declarations (`grep export interface/type` for the 8: empty).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion preserved (tsc clean, suite-pinned).
- Leaf emit: header comment + `export {};` only. Hub emit: byte-identical
  per `tests/cad_primitive_geometry_entity_type_leaf_2414.test.ts` pin
  (59/59 green).
- No value-graph edges changed; no consumer rewritten.

## Graphs (measured, not guessed)

- CAD+F2F: 488/2412 -> 489/2416. Full src: 1660/7522 -> 1661/7527.
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/19511/19512/19514).

## Tests

- NEW `tests/cad_primitive_geometry_entity_type_leaf_2414.test.ts`: 59/59.
  Covers AST/property/optional/alias/discriminant pins, bidirectional
  facade-vs-leaf `expectTypeOf`, 8 old-path exports, union orders, hub/leaf
  emit, graph SCC/edge membership, 11 in-memory negative controls. No git at
  runtime; graph-build caching + narrow timeouts.
- Rolled-forward guards + 2411: 7-file set 285/285 green
  (`npx vitest run` 2411 + 2412 + 2413 + 2414 + 19511 + 19512 + 19514).
- `npx tsc --noEmit`: clean (exit 0).
- CAD geometry/polyline/circle/parabola/block suites: covered by a SEPARATE
  11-file run, 169/169 green (cad_blocks_engine, cad_blocks_transactions,
  cad_blocks_transform, cad_blocks_wncad, cad_block_value_cycle_1951,
  cad_circle_construction_b2, cad_geometry_shapes_v1, cad_geometry_circle_v1,
  cad_parabola_entity_b1, cad_best_fit_parabola, cad_drawing_file), distinct
  from the 7-file 285/285 guard set above.
- `npm run check:portable-paths`, `npm run lint`, `npm run build`,
  `npm run test:agent`: see PR body for exact-head results. Known unrelated
  local-only Study Desktop real-data fixture failures (3) distinguished, not
  modified or weakened.

## Reviewer

Independent read-only reviewer examined the full final diff + revisions;
APPROVE required before PR (see PR body for verdict + rounds).

## Risks

- Guard roll-forwards transcribe new totals; a future leaf addition must
  re-roll the same 5 files (documented pattern, no weakening).
- Hub line-count pin (1694) is cosmetic; semantic pins are the re-export +
  union-order + emit checks.
- #241 stays OPEN; #195/#240 CLOSED. Never merge self; never force-push.
