# Phase 20P decision — sparse/clustered multiple collinear transition sets

- Branch: `research/phase20p-sparse-collinear-transition-set-decision`, baseline `797026215364da1ea90ffa2063b7cc3d0a4be38d` (PR #164 merge).
- Method: study-only. Zero `src/` changes (`git diff --stat -- src` empty, test-pinned).
- Inputs: `forensics.md` (14-site REUSE/EXTEND/NEW inventory), `sparse-set-geometry.md`
  (station-rule sufficiency + 20N.1 reduction + touch boundary + j-vs-j+2 proof),
  `topology-worker-provenance.md` (pre-mesh 1/1/1 + cert + worker/provenance),
  `production-delta.md` (PROPOSED-NOT-IMPLEMENTED bounded delta),
  study `scripts/phase20pSparseTransitionSetStudy.ts` + `scripts/phase20pCorpusRegen.ts`,
  corpus `docs/evidence/phase20p/corpus.json` (73 rows, sha256 `3ee1321e…`),
  `tests/cad_grading_transition_sparse_20p.test.ts` (30),
  `tests/helpers/sparseTransitionFixtures.ts` (study harness, production imports only).
- Prior verdict context: Phase 20N Candidate A `PARTIAL_GO_MULTIPLE_COLLINEAR_TRANSITIONS`;
  Phase 20N.1 production narrowing "consecutive joints only for N > 1 (sparse sets rejected
  whole-group)" recorded as IMPLEMENTATION NARROWING, not geometric law;
  Phase 20O `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW` (Candidate B stays blocked, untouched here).

## Verdict (exactly one, bounded)

**A. GO_SPARSE_COLLINEAR_TRANSITION_SETS.** Enough evidence exists to authorize a future
Phase 20P.1 production implementation. No new transition law, topology law, tolerance,
persistence schema, or hidden default is required. The bounded predicate is specified below.
Phase 20N.1 production remains consecutive-only until that implementation lands;
Phase 20O non-collinear `POLICY_REQUIRED` remains frozen.

## 1. GO gate: all 12 criteria, checked one by one

GO requires every criterion met. All 12 hold.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Strictly-increasing non-consecutive persisted order unambiguous; no sort/repair | PASS | Predicate pins: duplicates / out-of-order / malformed ids reject; harness never sorts (sparse 30/30; corpus negatives) |
| 2 | Global station interval rule sufficient; reduces to 20N.1 rule for consecutive joints | PASS | `Wi/2+Wj/2 < S(j)−S(i)` exact `<`; k=j+1 collapses bit-for-bit to shared-member rule (geometry §2; consecutive-reduction pin) |
| 3 | Real sparse + mixed-cluster full-group geometry tiles; no duplicate ownership, no missing native runs | PASS | 73-row corpus: 52 positives tiled via maximal-consecutive-cluster composition + joint mesh; skipped joints tile native (`nativeStations > 0`, C0 residuals 0) |
| 4 | Per-joint TRANSITION_LINEAR_V1 math unchanged | PASS | `src/` diff empty; per-joint `admitGradingTransition` + V1 evaluator called directly |
| 5 | Skipped joints retain native/corner authority; never auto-transitioned | PASS | Non-transition joints stay native; deflected-skip case documents `NATIVE_CORNER_OWNED` fail-closed, never auto-insert |
| 6 | Independent pre-mesh 1/1/1 matches actual mesh + gtop2 | PASS | 1/1/1 declared from structure (ordered joints + trp1 + strict separation + native-valid skips), fed as budget to production expectation; measured == declared; gtop2 1/1 + exact/production revalidation; wrong-budget-2 + tied-split controls refuse |
| 7 | Worker validators independently validate every sparse leg/checkpoint | PASS | Per-transition agreement + `validateTransitionResultMesh` + `validateGroupTransitionLegsMesh` accept across gaps; one stale/tampered/missing/reversed leg fails whole set; skipped joints own no checkpoints |
| 8 | Positional provenance/citations truthful | PASS | `ggrev1` deterministic + order-sensitive; citations == intent count; leg[i]<->intent[i] across gaps; forged leg blocks Extract/Bake; roundtrip preserves ids/order/width precision |
| 9 | Mirror / large-coordinate / true reversal coherent | PASS | Mirror exact; 1e6/1e8 translate stable; true traversal reversal (rebuilt order, reversed endpoint ids, reindexed joints, mapped widths) coherent; ggrev1 equality across reversal not claimed |
| 10 | No new epsilon / default / schema / law / non-collinear authority | PASS | Exact `<`, no epsilon; `src/` diff empty; trp1 untouched (`NON_COLLINEAR`, `WIDTH_INVALID` pins); ordinary analytic corner documented-omit, not weakened |
| 11 | Touching / overlap / one-bad-intent fail whole-group closed | PASS | Exact-touch `TOUCHING_NOT_AUTHORIZED`; overlap `OVERLAP_REJECTED`; one bad among valid peers fails set (corpus 21 negatives at production codes) |
| 12 | Bounded production delta nameable without inventing geometry | PASS | `production-delta.md`: consecutive→strict-increasing + station-gap separation authority; generalized gap calc; ordered station/gap expectation inputs; service/worker de-narrowing; authoring/UI sparse add/edit; persistence/law/gtop2/singular/provenance REUSE |

## 2. Tested candidate predicate (authorized for Phase 20P.1)

For an OPEN group with transition intents in persisted array order:
per-joint full 20M.2 trp1 (`transitionCount:1`); canonical STRICTLY INCREASING joint ids
(gaps allowed; duplicates/out-of-order/malformed reject; never sort/repair);
`S(j) = sum(lengths m=0..j)`; `I = [S−W/2, S+W/2]`; neighboring intent pairs in
transition-intent order satisfy `Wi/2+Wj/2 < S(j)−S(i)` exact `<`; one invalid/stale/
touching/overlapping transition fails the WHOLE set, no partial solve; canonical order kept;
`TRANSITION_LINEAR_V1` per transition; non-transition joints never auto-transitioned;
every actual transition joint exactly collinear (Candidate B still blocked).

## 3. What GO does NOT authorize

No production code change (this PR is study-only); no consecutive-rule relaxation before
Phase 20P.1 implements the delta; no UI/authoring change; no non-collinear reconsideration;
no new tolerance, default, schema, or law kind/version.
