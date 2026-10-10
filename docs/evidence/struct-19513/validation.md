# STRUCT-195.13 — Break COGO arc/polyline runtime import cycle: validation

## Graph (parent-measured)

- Baseline at exact `origin/main` `92bd31012d4e1e6242602739f21725ad19419a7b`
  (PR #236 merge): 482 nodes / 2400 edges / value|mixed 1584 /
  pairs 1566 / SHA `0feb1dc8…` (recomputed with guard canonicalization —
  exact match) / VALUE 2 SCC-12 nodes / TYPE 0.
- Final (integrated): counts unchanged; SHA `76838237…`; exactly 1 removed +
  1 added VALUE edge (`cadParcelArcGeometry.ts`: `cadCogoMath.ts` ->
  `cadCogoSummaries.ts`); VALUE 1 SCC/7 (geometry group only), TYPE 0.
  Workers A and B derived the post-change fingerprint independently
  (A from worktree, B in-memory + worktree) — identical.
- Negative control: in-memory revert of the specifier to `./cadCogoMath`
  fails the 1/7 assertion and recreates the exact historical 5-node SCC.

## Fidelity / parity

- Production diff: exactly ONE line (the import specifier). All other `src/`
  files byte-identical, verified via `git diff`.
- Facade compatibility: `cadCogoMath.ts` still `export *`s
  `./cadCogoSummaries`; tests pin `===` identity of both helpers across the
  direct and facade paths plus a frozen 8-name runtime export surface.
- Behavior oracles in the new 19513 suite (fixed hand-checked values, no
  reimplementation): inverse/bearing quadrant boundaries + float carry,
  parcel bulge + signed sweep, chord/tangent azimuth/bearings, true arc
  midpoints, split paths, fail-closed near-degenerates, polyline
  resolved-course geometry + width preservation + malformed-metadata
  fail-closed, line/arc intersections, no in-place input mutation.

## Tests (parent-run unless noted)

- New 19513 suite + 7 rolled guards: 8 files / 224 tests pass.
- Behaviour neighbours (`cadCogo.01/.02`, parcel curved 19c ×4, polyline
  bulge/vertex ×5, survey export legal 19a): 12 files / 271 pass.
- Worker A pre-correction batch: 26 files / 566 pass (new 25 + neighbours +
  guards). Worker B guard batch: 7 files / 199 pass.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors (9 pre-existing
  warnings elsewhere); the 3 new-file errors were corrected in-phase by
  Worker A and re-verified clean.
- `npm run build`: clean (11.82s). `npm run check:portable-paths`: 6338/0.
- `npm run test:agent`: 1041 files pass, 10068 tests pass + 1 skip; the only
  3 failures are the known pre-existing gitignored Study Desktop real-data
  suites (calibration, cal80v5, preflight), untouched here. Exact-head CI
  authoritative.
- Known-unrelated (do not touch): 3 gitignored Study Desktop real-data
  failures seen in prior phases; occasional `cad_ribbon_controls` scroll flake
  — no ribbon changes here.

## Review / PR

- Independent reviewer (`openai-codex/gpt-6-sol` per role policy) on the exact
  integrated diff: APPROVE — one-line production diff confirmed, DAG/TDZ
  safe, graph rebuilt independently (482/2400/1584/1566, SHA 76838237…,
  VALUE 1/7, TYPE 0), frozen fixtures intact, 8 suites re-run 224/224.
  Lint correction verified in-phase before review.
- ONE PR `refactor/issue19513-cogo-arc-summaries-import-cycle` vs exact
  `origin/main` `92bd3101`, body uses `Refs #195` only. Never merged here;
  issue #195 stays OPEN for the remaining seven-member geometry VALUE SCC.
