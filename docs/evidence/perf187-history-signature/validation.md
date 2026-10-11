# PERF-187 — Validation: history canonical-serialization reduction

Base: `origin/main` `897ba8865fd53d92087a5ef1b89cebb721bdb954`.
Branch: `perf/issue187-cad-history-canonical-comparison` (unmerged).
Reviewer: independent read-only reviewer — APPROVE (5 rounds) for the
superseded structural-walk revision; raw-filter redesign re-reviews below.

## Measured baseline → after (real CAD medians, 15 rounds, performance.now; no timing gates)

| Workload | Before | After |
|---|---|---|
| Mount, same project identity | 2 stable-signature calls | **0 calls**, 0.00 ms |
| CAD commit → parent drawing-sync clone, 10k entities | 2 full canonical traversals, 22.55 ms | **2 native stringify, 0 canonical rebuild, 5.73 ms (~3.9x)** |
| Same, 1k entities | 2.5 ms range | **~4x faster** (ratio 0.25) |
| Key-reordered (TIN-normalized) clone, 10k | 21.30 ms | 28.73 ms (~1.35x slower — rare path, stated) |
| Genuine deep external change, 10k | 23.16 ms | 28.93 ms (~1.25x — rare path, stated) |
| Exotic/throwing inputs | 2 serializations | raw attempt + full fallback (counts by shape; see text) |

Controller independently reproduced the ORIGINAL structural-walk design as
~3.4x SLOWER than the old serializer on synthetic equal objects in isolated
V8 (equal 10k: old 67–74 ms vs new 233–255 ms; phase-2 alone ~107 ms), plus a
literally-false '0 allocations' doc claim. Both corrected here: the
reflection-heavy walk was deleted in favor of the raw filter (the only
construct that measured faster), and allocation wording is exact (two raw
strings on the common path; no canonical trees). Old-path byte totals remain
as scale context: 1,823,480 B (1k) / 10,466,106 B (10k) per comparison pair.

Branch-observability proofs in-suite (deterministic, no ms assertions): plain
equal path = exactly 2 `JSON.stringify` calls whose first arguments ARE the
input refs (raw fast path, zero canonical rebuild); fallback paths = raw
miss + oracle pair; same-ref = 0 calls; fallback sensitivity proven by
toJSON windows with calls > 0.

## Tests

- New `tests/cad_history_stable_signature_perf187.test.tsx`: **43/43** under
  both default and agent configs (~2.5 s, agent-tier, no sleeps/time gates,
  no disk/git/fixture mutation):
  - A: mount + repeated same-identity renders — 0 calls, no adopt.
  - B: LandXML import commit + drawing-sync TIN clone — depth stays 1, undo
    removes import, redo restores, 0 calls.
  - C: repeated clone-equal external identities incl. key reorder — no
    adopt/wipe; old-style double-call control records exactly 2 (budget
    sensitivity).
  - D/D2: genuine geometry/surface-style/F2F-settings/metadata edits —
    adopt/reset with fresh history + correct selection.
  - E: selection-only updates, undo/redo, atomic resetKey switch, rapid
    batched edits — no mixing/loops; same-ref mutation documented out of
    scope (effect deps are identity-based).
  - R1/R2/R3 + K1/K2 + L1: raw-branch battery — order-preserved clone takes the
    raw branch (ref-args proof), toJSON-constant raw-equal pair agrees true,
    reordered clone takes fallback yet true (TIN safety net), species-subclass
    K1 documents helper-true vs oracle-false as a safe-direction exclusion
    (G2 precedent; production-impossible; err-toward-keep-history only).
    Every regression test in this family was verified fail-without-fix.
  - Oracle parity (18+ shapes): helper vs `realStable(a) === realStable(b)`
    on key order, undefined-vs-missing, function/symbol, array order/holes,
    null/NaN/Infinity, −0, TIN/block/F2F/surface payloads, edit stacks.
- Existing `tests/landxml_import_undo_history_18m.test.tsx`: 2/2.
- Neighbor batch (surveyCadWorkspace ×52, cadCommandHistory, f2f_sync,
  blank persistence, sheet history, extraction): 67 files, 238 pass + 1 skip.
- Full `npm run test:agent`: 1063 files passed, 3 failed (43-test suite included; 45 targeted with 18M) — all three are the
  known pre-existing ignored/private Study Desktop real-data failures
  (`study_ai_unit_calibration`, `calibration_v5`, `preflight`); they import
  only `study-desktop/src` + real-data fixtures and no changed module.
  Fixtures untouched.
- `tsc --noEmit`: exit 0. `eslint` on touched files: clean (0 errors; 9
  pre-existing warnings elsewhere). `check:portable-paths`: 6433 paths,
  0 violations. `npm run build`: clean (14.94 s).

## Review history

1. Round 1 P1 (nested/top-level identity bypasses exotic fallback) → fixed
   (primitives-only nested shortcut; documented same-ref contract).
2. Round 2 P1 (traversal-order dependence: early false masks later exotic)
   → fixed (two-phase: domain walk before any mismatch).
3. Round 3 P1 (stateful getters) + P2 (Array `map` override) + P3 (stale
   comments) → fixed (descriptor probing without invocation; map-identity
   guard; two-phase wording).
4. Round 4 P2-partial (`Symbol.species`) + proxy documentation → fixed
   (strict `Array.prototype` guard alongside map check; lying-trap proxies
   stated out-of-domain). Residual own-`constructor`-species shape explicitly
   non-blocking/unreachable.
5. Round 5 P2 (export spy blind to module-local fallback; hard-coded bytes;
   K2 misframed) → fixed test-only (JSON-spy methodology, derived bytes,
   sensitivity proof, K2 as equality parity). **APPROVE.**
6. Controller P1 correction (same phase): structural walk measured
   parity-or-slower (synthetic ~3.4x slower; real-CAD ~1.0-1.2x) and '0
   allocations' false → walk deleted; raw-JSON positive filter + oracle
   fallback; K1 reframed as safe-direction exclusion (raw path errs only
   toward keep-history on inert data; stateful-accessor L1 exclusion added).
   Controller P1 redesign reviews: round 6 found two contract-precision P2s
   (accessor counterexample + stale structural comments — remediated);
   round 7 found two more P2s (unqualified false-direction claim in arch/
   hook docs + stale validation record — remediated this revision);
   round 8 closing review PENDING.

## Residual costs and caveats

- Order-preserved path: two native stringify + string compare (only large
  allocs are the two raw strings). Rare reordered/genuine-change paths pay
  the wasted raw pair plus the full oracle (~1.25-1.35x slower than old on
  those branches; stated plainly above). No sublinear-traversal claim.
- Exotic inputs cost the raw attempt (possibly partial) plus the full oracle
  fallback (production-unreachable).
- Same-reference cyclic input returns `true` while the oracle throws
  (documented contract; unreachable — persistence would throw first).
- `cadProjectState.ts` is back to ~307 lines (structural walk deleted);
  kept same-file deliberately for dependency-graph neutrality.
- 14 user stashes preserved in original order; `.pi/lsp.json` untouched;
  no issue state changed (`Refs #187` only — controller decides closure).
