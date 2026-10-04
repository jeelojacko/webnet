# Phase 20P.1 — Topology, worker, and provenance (sparse production)

- Branch: `feat/phase20p1-sparse-collinear-transitions`, baseline main
  `f786f76ba21818d863dc39a6c35f70697968c70e`.
- Companion: Phase 20P study evidence
  `docs/evidence/phase20p/topology-worker-provenance.md` proved the topology /
  worker / provenance contracts on a study harness. This document records the
  production authorities that now own them, with the sparse gates in place.

## 1. Pre-mesh 1/1/1 declaration is structure-only

`planTransitionGroup` (after the strict-increasing + station-gap gates) calls
`deriveGroupTransitionExpectation(joints, gaps)` → `deriveTransitionExpectation`
→ `deriveTransitionSetExpectation(base, intents, stationGaps)`. On success that
returns `declaredMergedStrip()`:
`deriveGradingTopologyExpectation({ scope:'group', closed:false,
positiveWidthRegions:1 })` — one merged open strip, 1 positive-width region,
1 component, 1 boundary cycle.

- The declaration is derived from **structure only**: ordered sparse joints,
  per-joint `trp1` admission, strict global station-interval separation, and
  native-valid skipped joints. It never reads generated source/daylight, the
  measured region count, triangle counts, or the certificate.
- In `gradingGroupCompute.ts` the measured-vs-declared gate runs **after**
  declaration: `countPositiveWidthRegions(measured)` must equal
  `expectation.positiveWidthRegionCount`, else
  `GRADING_AGREEMENT_TRANSITION_MESH` fails before any certificate. A measured
  count can never redefine the expectation.
- Both sparse (`[0,2]`, `[0,2,4]`, `[0,3]`, `[1,4]`) and mixed-cluster
  (`[0,1,3]`, `[0,2,3]`, `[0,1,3,4]`, `[0,2,3,5]`) shapes declare the same
  1/1/1 strip; the consecutive path reduces to the 20N.1 rule (architecture §5).

## 2. gtop2 certificate and revalidation

Unchanged authority: `buildGradingTopologyCertificateExact` builds the session
`gtop2` certificate (mesh digest over Float64 bits + uint32 indices,
components, boundary cycles/edges, tied-split coords, positive-width region
count, source/grading boundary digests). `gradingTopologyCertificateExactError`
and `gradingTopologyCertificateProductionError` revalidate it for Extract/Bake;
a stale/forged/uncertified or multi-region mesh yields a null command with zero
mutation. Sparse transition sets certify **1 component / 1 boundary cycle**;
skipped joints carry no certificate artifact.

## 3. Worker pre/post validators across gaps

- PRE-solve `checkGroupTransitionPlansAgreement` (`surfaceGradingCompute.ts`):
  strict-increasing plan order (`index <= prev` rejects, no sort), each plan
  re-admitted via `checkGroupTransitionAgreement` against worker-resolved
  member views, and separation from the **authoritative request stations**
  (`plans[i+1].jointStation - plans[i].jointStation`, finite `> 0`) through the
  same `checkGroupTransitionSeparation`. Whole set fail-closed.
- Post-solve `validateGroupTransitionLegsMesh`: every result-owned leg is
  matched positionally (`legs[i] ↔ plans[i]`) and validated against its own
  plan/pinned checkpoint; `validateTransitionResultMesh` owns single-leg
  checkpoint agreement. Both are gap-agnostic — they were already reused
  unchanged in the study.
- `checkGroupTransitionAgreement` accepts each sparse joint per-transition
  (production admission re-run on real member views).
- One stale / tampered / missing / reversed leg fails the whole set
  (`GRADING_AGREEMENT_TRANSITION_STALE` / `_OFF_LAW`); the product gate then
  marks Extract/Bake unavailable.

## 4. Positional provenance

- `surfaceWorkerHandler.ts` keeps ordered plan arrays and one member-view pair
  per sparse plan (`transitionPlansOf`, `resolveGroupTransitionMemberViews`) —
  no rematching, no sorting, no skipped-joint view.
- Result legs stay in canonical persisted intent order.
- `transitionResultBakeCitations` returns exactly one citation per
  result-owned leg, so citation count == intent count; skipped joints are never
  cited. GROUPBAKE / GROUPEXTRACTDAYLIGHT keep their positional leg↔intent
  bijection and refuse a mismatched or citation-less transitioned bake.
- `buildGroupRevision` (`ggrev1:`) hashes the transition array in order and is
  order-sensitive; sparse ids/order/widths roundtrip byte-exactly.

## 5. No skipped-joint artifacts

A skipped joint is native by construction: it is not a transition member, so it
owns no plan, no result leg, no checkpoint, and no citation. Its native/corner
authority is untouched, and a sparse set never auto-transitions it.

## 6. Negative controls still refuse

- **Wrong budget:** a 2-region expectation fed to
  `buildGradingTopologyCertificateExact` over a known one-strip sparse mesh
  returns `null` — the certificate is not vacuous.
- **Tied / split must not launder to 1:** tying an interior tiling cell
  (contiguous zero-width run) makes the measured region count 2, so the
  measured-vs-declared gate fails before any certificate is built.
- **Touch / overlap fail before cert:** the station-gap mode rejects `==`
  (`TOUCHING_NOT_AUTHORIZED`) and `>` (`OVERLAP_REJECTED`) with no expectation,
  no mesh, no certificate.
- **Order/state:** duplicate, out-of-order, malformed ids, stale refs, stale
  revision, and one-bad-among-valid all reject fail-closed without sorting.
- **`trp1` untouched:** a bent ACTUAL transition joint still fails
  `NON_COLLINEAR`; zero/negative/NaN/Infinity/just-over-max widths still reject.
