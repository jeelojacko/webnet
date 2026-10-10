# STRUCT-241.5 Validation

Branch: `refactor/issue2415-cad-annotation-survey-table-type-leaves` at
`707b8b26d5426164d232c17d6f2e6d72484f6a8c` (exact main, ff-only, no
reset/force; 14 stashes preserved; `.pi/lsp.json` untouched).

## Source/AST and emit parity

- 12/12 + 7/7 leaf declarations verbatim vs hub (worker brace-matched
  checks, independently repeated post-integration by the 92-test suite).
- Hub retains grouped `import type` + `export type` of all 19; zero leftover
  original declarations (`grep export interface/type` for the 19: empty).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion preserved (tsc clean, suite-pinned).
- Leaf emits: header comment + `export {};` only (both). Hub emit:
  byte-identical (`esbuild` sha256 `75444be3…59439a`, 778 bytes;
  transpileModule-stripped 680 bytes sha256 `37445357…1936` — same as the
  241.4 baseline pin).
- No value-graph edges changed; no consumer rewritten.

## Graphs (measured, not guessed)

- CAD+F2F: 489/2416 -> 491/2424. Full src: 1661/7527 -> 1663/7535.
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/2414 counts + 2413
  foundation-fan-in allowlist + hub line count + 19511/19514 delta consts +
  1957 hub->anchor repoint), each with a documented 2415 allowlist.

## Tests

- NEW `tests/cad_annotation_survey_table_type_leaves_2415.test.ts`: 92/92.
  Covers AST/property/optional/alias/discriminant/union-branch-order pins
  for all 19, declaration order per leaf, bidirectional facade-vs-leaf
  `expectTypeOf` for all 19, 19 old-path exports, union orders, hub/leaf
  emit, graph SCC/edge membership for both leaves, 13 in-memory negative
  controls. No git at runtime; graph-build caching + narrow timeouts
  (30 s scoped cold, 120 s full cold).
- Rolled-forward guards: 2412 + 2413 (65/65) + 2414 + 19511 + 19514 + 2411:
  green; 1957 guard green after documented hub->anchor repoint roll-forward.
- Neighbours: annotation (export/persistence/renderer/single-anchor) +
  survey-table-19a + blocks/drawing/serialization suites green.
- `npx tsc --noEmit`: clean (exit 0). `npx eslint` on touched files: clean.
  `npm run check:portable-paths`: 6369 paths, 0 violations.
- `npm run build`, `npm run test:agent`: see PR body for results. Known
  unrelated local-only Study Desktop real-data fixture failures (3)
  distinguished, not modified or weakened.

## Reviewer

Independent read-only reviewer examined the full final diff + revisions;
APPROVE required before PR (see PR body for verdict + rounds).

## Risks

- Guard roll-forwards transcribe new totals; a future leaf addition must
  re-roll the same files (documented pattern, no weakening).
- Hub line-count pin (1549) is cosmetic; semantic pins are the re-export +
  union-order + emit checks.
- #241 stays OPEN (controller decides whether cohesion continues); #195/#240
  CLOSED. Never merge self; never force-push.
