# STRUCT-241.11 Validation

## Baseline

- origin/main `0ce916c673bb3fc6878ea2f380ca8ed0dc8266ff` verified after
  `git fetch` (local `main` fast-forwarded from `cdf613f5`; previous
  `fix/cad-ribbon-l1b2-raf-timing-guard` head left untouched).
- Clean tree at start; 14 pre-existing user stashes preserved in order;
  no branch collision; `.pi/lsp.json` + role/model routing read.
- Pre-change pins: scoped graph 501/2459, SCC 0/0, VALUE digest `0bc9bae1`;
  hub stripped emit `export {};` (10 B); `CadCommandKey` raw SHA `4ff8cd4a`.

## Implementation

- Worker A (annotation leaf, slot 1) and Worker B (analysis leaf, slot 2)
  ran in parallel with disjoint single-file ownership. Both reported
  byte-level body parity (worker A: exact 76-line match; worker B: raw
  byte comparison SHA `a30ac83d…` both sides), tsc exit 0, inert emit,
  type-only acyclic edges. Parent independently re-read both leaves and the
  hub diff before splicing.
- Parent hub splice: import block + single union replacement (7 edit
  blocks, one call). No other CAD source touched.

## Test evidence (all run on the branch, agent tier)

New suite `tests/cad_annotation_analysis_command_type_leaves_24111.test.ts`
(58 tests) — PASS 58/58:

- Leaf presence/order (11 + 8 keys, no duplicates), Phase 18U comment
  adjacency + hub removal.
- Per-key `Extract<CadCommand>` vs leaf vs hand-transcribed `Base*` (19/19,
  both directions) + never-widening pins.
- AST property/order/comment-count pins + exact JSDoc text (3 fields).
- Optionality pins (required anchors, nullable `textPoint`,
  `deleteLegendsToo?`, patch shapes, legend ids).
- Hub splice: 116/82/27/7 counts, neighbor sentinels, flattened 168 in
  original order, no inline moved keys left.
- `CadCommandKey`: raw SHA + 248/241/7 duplicate shape + both key-run positions.
- Transaction/definition surfaces unchanged; both leaves type-only;
  hub + leaves emit `export {};`.
- Graph pins: scoped 503/2465 + digest; exact 10-edge allowlist; 4 retired
  hub edges absent; no leaf back-edge; full-src 1675/7576, TYPE 7/38, digest.
- 19 in-memory negative controls (dropped/changed/required-flipped fields,
  slot removal, JSDoc removal, comment removal, splice removal, reorder,
  synthetic TYPE back-edge, synthetic VALUE import) + worktree-clean pin.

Historic + neighbour suites (all green after narrow roll-forward):

- 2411 + 2412 (helpers learn new aliases): 76/76.
- 19511/19512/19514 additive guards: 85/85.
- 2410 + 2418: 230/230. 2415 (incoming-edge +1): 92/92.
- 2413/2414/2416/2417/2419: 499/500 then 2415 fix -> all green
  (single failure was the 2415 incoming-edge allowlist, remediated
  same-phase by allowlisting the new command-leaf type edge).
- 1955/1956/1957: green (146-file batch: 137 pass + 9 failures all in
  2411/2412 pre-roll-forward; post-roll-forward 76/76).
- Annotation engine (`cadAnnotationCommands`), persistence, workspace seam;
  analysis 18u model/service/reconciliation/export/export-input/ui;
  `cad_surface_analysis_bands_18u`; shell registry: 7/7 (83 tests) + 4/4
  (48 tests).
- `npx tsc --noEmit` exit 0; ESLint on touched files clean;
  `npm run check:portable-paths` 6400/0; `npm run build` clean (11.55 s).

Three failures observed during iteration were all test-side mistakes, not
source drift: omitted optional in a sample, flatten anchor on a resolved
alias name, and a wrong assumed `CadCommandKey` neighbor (analysis keys
historically sit inside the VOLUME_STYLE run). Each was corrected with the
measured value and re-run green.

## Reviewer

Independent read-only reviewer (round 1): PASS on source parity,
type-only/emit, splice/keys, graph acyclicity, VALUE digests, and scope;
single test-only P2 (synthetic back-edge control compared pristine-file
imports against itself; worktree-clean check reread files). Remediated
same-phase: back-edge control now extracts specifiers from the mutated
in-memory text and rejects the 5th import against the pristine 4;
worktree-clean control adds a static no-filesystem-write assertion with
split probes (no self-match). Suite re-run 58/58. Fresh round-2 re-review:
APPROVE, no actionable findings.

## Remaining risks / notes

- The 3 Study Desktop private real-data fixture failures may recur in
  `test:agent` (ignored fixtures, unrelated); reported if seen.
- Exact-head GitHub CI (5 jobs) is the controller's acceptance gate.
