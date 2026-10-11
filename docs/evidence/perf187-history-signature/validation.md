# PERF-187 — Validation: history canonical-serialization reduction

Base: `origin/main` `897ba8865fd53d92087a5ef1b89cebb721bdb954`.
Branch: `perf/issue187-cad-history-canonical-comparison` (unmerged).
Reviewer: independent read-only reviewer, **APPROVE** (5 rounds; details below).

## Measured baseline → after (deterministic counts, no timing gates)

| Workload | Before | After |
|---|---|---|
| Mount, same project identity | 2 stable-signature calls | **0 calls** (same-ref fast path) |
| CAD commit → parent drawing-sync clone (blank project) | 2 full canonical traversals + 2 × 15,013 B serializations | **0 `JSON.stringify` calls, 0 bytes** (spy-measured) |
| Equal clone, 1k-entity project ×5 fresh clones | 2 calls + 1,823,480 B | **0 calls, 0 bytes** |
| Equal clone, 10k-entity project ×3 fresh clones | 2 calls + 10,466,106 B | **0 calls, 0 bytes** |
| Genuine deep external edit | 2 full serializations | 2 lightweight walks, 0 bytes, adopt/reset correct |
| Exotic input (toJSON/species/cycle/bigint) | 2 serializations | 2 serializations (fallback — same as before, fail-closed) |

Bytes for the old path are derived from the real oracle strings
(`realStable(a).length + realStable(b).length`); new-path zeros are observed
via tight `JSON.stringify`-spy windows around exactly one synchronous helper
call, with a fallback-window sensitivity proof (calls > 0) ruling out a dead
spy. Elapsed ms is logged only, never asserted.

## Tests

- New `tests/cad_history_stable_signature_perf187.test.tsx`: **39/39** under
  both default and agent configs (~2.4 s, agent-tier, no sleeps/time gates,
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
  - F1/F2/F3 + G1/G2/G3 + H1/H2/H3 + J1/J2/J3 + K1/K2: negative controls and
    oracle-parity cases — naive reference/raw-stringify divergence, shared
    cycles (both throw), same-ref cyclic contract (helper true, oracle
    throws, documented), exotic-beside-difference (both throw / agree false),
    accessors, map/species overrides. Every regression test in this family
    was verified fail-without-fix.
  - Oracle parity (18+ shapes): helper vs `realStable(a) === realStable(b)`
    on key order, undefined-vs-missing, function/symbol, array order/holes,
    null/NaN/Infinity, −0, TIN/block/F2F/surface payloads, edit stacks.
- Existing `tests/landxml_import_undo_history_18m.test.tsx`: 2/2.
- Neighbor batch (surveyCadWorkspace ×52, cadCommandHistory, f2f_sync,
  blank persistence, sheet history, extraction): 67 files, 238 pass + 1 skip.
- Full `npm run test:agent`: 1061 files passed, 3 failed — all three are the
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

## Residual costs and caveats

- Distinct-ref comparisons always pay a full domain walk per side; no
  sublinear-traversal claim is made.
- Exotic inputs pay the original double serialization (production-unreachable).
- Same-reference cyclic input returns `true` while the oracle throws
  (documented contract; unreachable — persistence would throw first).
- `cadProjectState.ts` grew to ≈565 lines (under the 600 warning limit);
  kept same-file deliberately for dependency-graph neutrality.
- 14 user stashes preserved in original order; `.pi/lsp.json` untouched;
  no issue state changed (`Refs #187` only — controller decides closure).
