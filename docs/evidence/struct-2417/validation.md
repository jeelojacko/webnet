# STRUCT-241.7 Validation

Branch: `refactor/issue2417-cad-layout-grip-snap-types` at
`cbc130247d61e3f2aed7f92e1c2204c59bb5c38f` (exact main, ff-only, no
reset/force; 14 stashes preserved; `.pi/lsp.json` untouched).

## Source/AST and emit parity

- 5/5 + 6/6 leaf declarations verbatim vs hub (Worker A + Worker B diff
  proofs, parent re-verified post-integration: PAR_MATCH True, GRIP_MATCH
  True; 88-test suite pins shapes, orders, and JSDoc positions incl. the
  inline polyline-insert comment).
- Hub retains grouped `import type` + `export type` of all 11; zero leftover
  original declarations (`grep export interface/type` for the 11: empty).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion preserved (tsc clean, suite-pinned).
- Leaf stripped emits: `export {};` (both). Hub emit byte-identical:
  transpileModule-stripped 680 bytes sha256
  `3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454` —
  same as the 241.6 baseline pin (independently recomputed pre- and
  post-change with `removeComments: true`).
- No value-graph edges changed; no consumer rewritten.

## Graphs (measured, not guessed)

- CAD+F2F: 493/2433 -> 495/2440 (+2 nodes / +7 type edges: layout 1 out +
  hub import + hub export; grip 2 out + hub import + hub export; no retired
  hub edge). Full src: 1665/7544 -> 1667/7551 (same allowlist; every 241.7
  edge resolves inside `src`).
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0/0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/2414/2415/2416 counts,
  2413 hub line count 1340, 19511/19512/19514 delta consts), each with a
  documented 241.7 allowlist. No weakening/deletion/skip.

## Test evidence (observed, not fabricated)

- New suite: 88/88 pass (one initial negative-control expectation corrected:
  grip value-import control yields `['./cadDisplayTypes']` only; rerun green).
- STRUCT-241.1–241.6 + 195.7/11/12/14 graph/contract suites: 433 + 152 pass
  after roll-forward (11 + 3 guard failures pre-roll-forward, all count-only).
- Behavioral neighbours: parcel (plan/shared/save/network/command), C3
  polyline grips, snap scale-stamp/dedupe, tangent, drawing/persist suites:
  130/130 pass.
- `npx tsc --noEmit`: exit 0. `npm run lint`: 0 errors (9 pre-existing
  warnings). `npm run check:portable-paths`: 6379 paths, 0 violations.
- `npm run build`: clean, 11.51 s.
- `npm run test:agent`: run once pre-PR (see PR body for observed counts).
- Known unrelated local-only failures may occur (THREE private Study Desktop
  real-data calibration/preflight); fixtures untouched; GitHub CI is final
  authority.

## Independent review

Reviewer: independent read-only reviewer on the exact final integrated diff
(per current role/model routing). Round 1 verdict BLOCKED on one P2 (facade
re-export positive pin searched the whole hub, so withdrawing only the
export-type entry could not fail it); remediated in-phase by scoping both
facade pins to the export-block text and asserting the positive pin throws
on the mutated hub (88/88 green). Round 2 FRESH re-review of head
a9892464: APPROVE, no actionable findings, nothing merged.

## Remaining risks

- `import type { CadDisplayPoint }` in the hub is now locally unused (only
  the re-export block uses it); kept deliberately to minimize diff, same as
  prior phases' unused-import hints (tsc hint-only, lint clean).
- Exact-head CI is authoritative; local `test:agent` may differ on the
  private-fixture suites noted above.
