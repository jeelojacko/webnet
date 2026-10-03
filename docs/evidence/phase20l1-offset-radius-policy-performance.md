# Phase 20L.1 Task 5 — policy performance (STUDY)

Generator `scripts/phase20l1PolicyCorpus.ts`: 186 policy rows + ladder
(5 fixtures × 4 bounds) + invariance (5 fixtures × 7 transforms, each a
fresh `decide` with normalized-geometry comparison) + per-row independent
candidacy audits, single `tsx` run, ~2 s wall-clock (classifier-only; no
meshes, no WASM, no giant fixtures — largest synthetic is one 300 m line
+ 180° arc).

## Scaling notes (study-size, honest ceilings)

- Corpus cost is `fixtures × families` classifier calls (186, each now with
  a candidacy audit of ≤N candidates) + 55 transform/ladder re-evaluations
  (each itself a full decide+audit); linear, no combinatorial blowup.
- Production-corner cost is one `classifyOffsetJoin` per corner (unchanged
  20L join core) plus O(1) P0 gates — no per-station sampling anywhere
  (sampling was explicitly de-authorized as circularity evidence).
- `ponytail:` ceiling — corpus kept to analytic joins; a production mesh
  build would dominate. Re-measure on first real P0 mesh before quoting
  20L.2 budgets.

Zero `src/` changes; performance work ends here until 20L.2 wires P0.
