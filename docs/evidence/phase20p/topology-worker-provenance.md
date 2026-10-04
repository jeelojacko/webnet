# Phase 20P — topology, worker, and provenance evidence (sparse collinear transition sets)

- Branch: `research/phase20p-sparse-collinear-transition-set-decision`, baseline `797026215364da1ea90ffa2063b7cc3d0a4be38d`.
- Scope: **STUDY ONLY. Zero `src/` changes.** This document records measured
  evidence for sparse (`[0,2]`, `[0,2,4]`) and mixed-cluster (`[0,1,3]`,
  `[0,2,3,5]`) collinear transition sets over minimal honest full-group
  fixtures. All authorities are production imports read-only; the study
  harness only adds the generalized station-gap arithmetic production does
  not yet own (`tests/helpers/sparseTransitionFixtures.ts`).
- Test: `tests/cad_grading_transition_sparse_20p.test.ts` (30 tests, agent
  tier, deterministic).
- Sibling boundary: geometry/corpus forensics live in `forensics.md` /
  `sparse-set-geometry.md` / `corpus.json`; this file owns topology, worker,
  and provenance.

## 1. Pre-mesh expectation declared BEFORE meshing

The 1/1/1 merged-open-strip shape is declared from **structure only**
(ordered sparse joints + per-joint `trp1` admission + strict global
station-interval separation + native-valid skipped joints), then fed to
production `deriveGradingTopologyExpectation({ scope:'group', closed:false,
positiveWidthRegions: 1 })`. No produced source/daylight array is read before
the declaration; the measured count is only consulted afterwards. The helper
`meshSparseGroup` throws when measured != declared, so a measured count can
never re-define the expectation.

| fixture | family | joints | joint stations (m) | widths W | skipped joints | predicate |
| --- | --- | --- | --- | --- | --- | --- |
| sparse2 | distance | [0,2] | [40, 94] | [8,6] | [1] | OK |
| sparse3 | distance | [0,2,4] | [30, 82, 138] | [8,6,4] | [1,3] | OK |
| mixed2 | distance | [0,1,3] | [30, 54, 108] | [8,6,4] | [2] | OK |
| mixed3 | distance | [0,2,3,5] | [30, 82, 108, 170] | [8,6,4,5] | [1,4] | OK |
| wideGap | distance | [0,2] | [100, 205] | [10,190] | [1] | OK |

Declared for each: **regions 1 / components 1 / boundary cycles 1**
(`shape: open-strip`, `closed: false`). Relative-elevation and flat-elevation
variants of `sparse2` declare and measure the same 1/1/1.

## 2. Post-mesh measured vs expected + gtop2 certificate

`countPositiveWidthRegions` (production, measured) equals the declaration for
every row; `buildGradingStripMesh` succeeds; the exact gtop2 certificate
carries `components 1 / boundaryCycles 1`; `gradingTopologyCertificateExactError`
and `gradingTopologyCertificateProductionError` both return `null`. Vertex /
triangle counts are measured from the study tiling.

| fixture | measured | cert c/cyc | verts | tris | exact / prod revalidation | `ggrev1` | citations | `checkGroupTransitionPlansAgreement` | per-joint agreement | `validateGroupTransitionLegsMesh` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse2 | 1 | 1/1 | 34 | 32 | null / null | `ggrev1:bf717d3a` | 2 | MALFORMED | ok, ok | null |
| sparse3 | 1 | 1/1 | 50 | 48 | null / null | `ggrev1:585d88e3` | 3 | MALFORMED | ok, ok, ok | null |
| mixed2 | 1 | 1/1 | 46 | 44 | null / null | `ggrev1:0bd28df4` | 3 | MALFORMED | ok, ok, ok | null |
| mixed3 | 1 | 1/1 | 62 | 60 | null / null | `ggrev1:6417e2c3` | 4 | MALFORMED | ok, ok, ok, ok | null |
| wideGap | 1 | 1/1 | 30 | 28 | null / null | `ggrev1:57843804` | 2 | MALFORMED | ok, ok | null |

`ggrev1` hashes are fixture-specific and informational; the pinned fact is
order-sensitivity and determinism (§5), not the literal hex.

## 3. Negative controls (no laundering)

- **Wrong budget:** a 2-region expectation fed to
  `buildGradingTopologyCertificateExact` over a known one-strip sparse mesh
  returns `null` — the certificate is not vacuous.
- **Tied / split must not launder to 1:** tying one interior tiling cell
  (contiguous zero-width run) makes `countPositiveWidthRegions` measure **2**;
  `meshSparseGroup` then throws
  `pre-mesh vs measured topology mismatch: declared 1, measured 2` before any
  certificate is built.
- **Touch / overlap fail before cert:** `touchSparse` (`W0/2 + W2/2 ==
  station gap`) and `touchAdjacent` reject at `TOUCHING_NOT_AUTHORIZED`;
  `overlapAdjacent` rejects at `OVERLAP_REJECTED`. No pre-mesh expectation is
  produced, so no mesh and no certificate exist.
- **Production today still rejects sparse sets fail-closed:** for `[0,2]`,
  `selectGroupTransitions` → `TRANSITION_REJECTED`,
  `deriveTransitionExpectation` → `GRADING_AGREEMENT_TRANSITION_MALFORMED`,
  `deriveGroupTransitionExpectation` → `TRANSITION_MALFORMED`. The
  consecutive control (`[0,1]` from `mixed2`) still declares 1/1/1 unchanged.

## 4. Worker outcomes (per-transition validators already handle gaps)

- `resolveGroupTransitionMemberViews` resolves sparse plans (one view pair per
  plan); `transitionPlansOf` maps the plural array in canonical order.
- `checkGroupTransitionAgreement` accepts every sparse joint per-transition
  (production admission re-run on real member views).
- `validateTransitionResultMesh` is `null` on every result-owned leg.
- `validateGroupTransitionLegsMesh` is `null` for the sparse set: it matches
  legs positionally (`legs[i] ↔ plans[i]`) and does **not** require
  consecutive joints, so it already validates across gaps. This is the
  reusable worker path.
- Whole-set fail-closed on one bad transition/leg: a tampered second-leg
  checkpoint → `GRADING_AGREEMENT_TRANSITION_OFF_LAW`; a stale
  `recordedRevision` → `GRADING_AGREEMENT_TRANSITION_STALE`; a missing leg or a
  reversed `legs` array → `GRADING_AGREEMENT_TRANSITION_STALE`. One mismatch
  blocks the product gate (`extract`/`bake` unavailable).
- Skipped native joints own no checkpoints: `mixed2` skips joint 2 and the
  result carries legs only for joints `[0,1,3]`.
- **Production group pre-solve gate still fails closed on sparse plans:**
  `checkGroupTransitionPlansAgreement` requires consecutive joints and returns
  `GRADING_AGREEMENT_TRANSITION_MALFORMED`. Fixing that gate is a production
  delta (§`production-delta.md`), not a study change.

## 5. Provenance / revision

- `buildGroupRevision` is deterministic (rebuild pin) and **order-sensitive**:
  reversing the transition array changes the hash, dropping the second sparse
  transition changes the hash. No silent sort participates.
- `transitionResultBakeCitations` returns exactly one citation per result-owned
  leg (2 / 3 / 3 / 4 rows above); skipped joints are not cited
  (`mixed2` cites `[joint:0, joint:1, joint:3]`, never `joint:2`).
- `transitionEvidenceMatchesIntent` accepts a clean pinned provenance and
  rejects a width or revision mismatch. Session provenance
  (`buildTransitionProvenance`) reports `widthMeters` / `recordedRevision`.
- Persistence roundtrip (`JSON` through `JSON.parse(JSON.stringify(...))`)
  keeps sparse ids, canonical order, and full-precision widths
  (`8.0000000001` survives and re-hashes differently from `8`).
- Member identity is the real production `courseCriterionKey(Si, Si+1)` chain.

## 6. Transform / reversal coherence notes

- The vitest helper (`tests/helpers/sparseTransitionFixtures.ts`, 30 tests)
  exercises the **forward canonical traversal only** (identity frame). The
  true-traversal-reversal measurement lives in the corpus
  (`sparse02-distance-reversal`, `reversed-traversal`: rebuilt member order,
  reindexed joints, physical widths mapped, `ggrev1` legitimately differs) —
  see `sparse-set-geometry.md` §6. Any future sparse reversal must rebuild
  the member array, reindex joints `joint:0..`, and remap widths to the
  physical joints in reverse encounter order exactly as the 20N study
  established.
- The sparse predicate is defined on canonical `joint:<n>` order (strictly
  increasing, no duplicates, never sorted). It does not depend on consecutive
  indices.

## 7. Adversarial self-review findings (recorded, not hidden)

1. **Gaps-as-automatic-separation (finding).** For any two transitions
   separated by at least one whole member (`j >= i+2`), per-joint feasibility
   `W <= 2*min(incident lengths)` already bounds `Wi/2 <= L_{i+1}` and
   `Wj/2 <= L_j` with `gap = L_{i+1}+...+L_j`, so the strict separation check
   is **non-binding** for gaps >= 2 members: overlap (`>`) cannot occur while
   every transition is independently feasible, and only touch (`==`) is
   reachable at the corner `Wi = 2*min(...)`, `Wj = 2*min(...)`. A deliberately
   infeasible overlap fixture rejects at separation (e.g. the sibling corpus
   `sparse02-distance-overlap`), but it also violates per-joint feasibility —
   the rejection code depends on check order. The generalized station-gap
   check is still required for **correctness** (the consecutive case must
   reduce to the 20N.1 shared-member rule, and the authoring `geometryError`
   currently uses a wrong immediate-member gap) but it adds no rejection power
   beyond per-joint admission for sparse gaps. The delta must not overstate it.
2. **Wrong S(j).** Joint stations are cumulative
   (`station = Σ lengths[0..j]`); `wideGap` measures `205 - 100 = 105`, not the
   immediate member `L1 = 5`. Pinned.
3. **Silent sorting.** `buildSparseGroup` rejects out-of-order/duplicate
   joints; `buildGroupRevision` is order-sensitive; nothing sorts the persisted
   transition set. Pinned.
4. **Skipped joints gaining ownership.** Skipped joints are interval-free and
   produce no checkpoint/leg/citation. Pinned (`mixed2` joint 2).
5. **Topology circularity.** The 1/1/1 declaration is derived from the study
   predicate and production `deriveGradingTopologyExpectation` with a
   STUDY-declared count of 1; `countPositiveWidthRegions` is only called after
   the declaration and equality is enforced. Pinned.
6. **Cluster-local success masking whole-set failure.** One inadmissible
   transition fails the build; one bad leg/checkpoint/revision fails the whole
   worker set. Pinned.
7. **Copied production math self-validating.** The tiling reuses production
   `resolveAnalyticCriterionAt`, `evaluateTransitionLinearV1`,
   `transitionDaylightAt`, `buildGradingStripMesh`, `countPositiveWidthRegions`,
   and the gtop2/worker validators; the only study-owned arithmetic is the
   station set and the generalized station gap, and both are checked against
   production where a production authority exists (consecutive reduction,
   `wideGap` immediate-vs-station gap).
8. **`trp1` widening.** Untouched: exact-zero collinearity still rejects any
   deflection at `NON_COLLINEAR`; zero/negative/NaN/Infinity widths still
   reject at `WIDTH_INVALID`. Pinned.
9. **Deflected skipped joint.** The fixtures keep every skipped joint flat and
   collinear (native-valid). A bent skipped joint belongs to the native corner
   path, not the transition set, and is deliberately not built here; a sparse
   decision must state that deflected skips are native corners, not set
   members (aligned with the sibling `sparse-set-geometry.md` §7).
