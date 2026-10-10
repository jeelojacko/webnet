# STRUCT-241.6 Validation

Branch: `refactor/issue2416-linear-design-parcel-entity-type-leaves` at
`818579e4d58d5ac1262c3f45d72d051651b808ee` (exact main, ff-only, no
reset/force; 14 stashes preserved; `.pi/lsp.json` untouched).

## Source/AST and emit parity

- 6/6 + 6/6 leaf declarations verbatim vs hub (Worker A diff proof +
  independently repeated post-integration by the 93-test suite, incl. JSDoc
  parity markers for Phase 20A/19C/19D/19A bodies).
- Hub retains grouped `import type` + `export type` of all 12; zero leftover
  original declarations (`grep export interface/type` for the 12: empty).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion preserved (tsc clean, suite-pinned).
- Leaf stripped emits: `export {};` (both). Hub emit byte-identical:
  transpileModule-stripped 680 bytes sha256 `37445357…1936` — same as the
  241.5 baseline pin.
- No value-graph edges changed; no consumer rewritten.

## Graphs (measured, not guessed)

- CAD+F2F: 491/2424 -> 493/2433. Full src: 1663/7535 -> 1665/7544.
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/2414/2415 counts +
  2413 foundation-fan-in allowlist + hub line count 1440 + 19511/19512/19514
  delta consts), each with a documented 2416 allowlist (+2 nodes / +9 edges:
  linear 3 out + hub import/export, parcel 2 out + hub import/export).

## Tests

- NEW `tests/cad_linear_design_parcel_entity_type_leaves_2416.test.ts`:
  93/93. Covers AST/property/optional/alias/discriminant/union-branch-order
  pins for all 12, declaration order per leaf, JSDoc parity markers,
  bidirectional facade-vs-leaf `expectTypeOf` for all 12, 12 old-path
  exports, union orders, hub/leaf emit, graph SCC/edge membership for both
  leaves, 15 in-memory negative controls. No git at runtime; graph-build
  caching + narrow timeouts (30 s scoped cold, 120 s full cold).
- Rolled-forward guards: 2412 + 2413 (65/65) + 2414 + 2415 + 19511 + 19512 +
  19514 (85/85 across the trio) + 2411 + 1957 (67/67 across the pair): green.
- Neighbours: feature-line 20A (5 suites) + parcel curved/network/boundary/
  plan/save (5 suites) + drawing/persistence/DXF/command payloads: 121 + 87
  green.
- `npx tsc --noEmit`: clean (exit 0). `npm run lint`: 0 errors (9
  pre-existing warnings). `npm run check:portable-paths`: 6374 paths, 0
  violations. `npm run build`: clean (11.63 s).
- `npm run test:agent`: 10497 passed + 1 skipped, 3 failed — all 3 are the
  known pre-existing local-only Study Desktop real-data fixture trio
  (calibration, calibration_v5, preflight), unrelated private ignored
  fixtures, not modified or weakened. CI is authoritative.

## Reviewer

Independent read-only reviewer examined the full final diff + revisions;
APPROVE required before PR (see PR body for verdict + rounds).

## Risks

- Guard roll-forwards transcribe new totals; a future leaf addition must
  re-roll the same files (documented pattern, no weakening).
- Hub line-count pin (1440) is cosmetic; semantic pins are the re-export +
  union-order + emit checks.
- #241 stays OPEN (controller decides whether cohesion continues); #195/#240
  CLOSED. Never merge self; never force-push.
