# Phase 20Q.1 — Topology certificate: 1/1/1 pre-mesh + gtop2

## Pre-mesh expectation

`deriveTransitionExpectation` (`gradingTopologyExpectation.ts`) declares the
expected topology **before** meshing. A singular admitted transition resolves
to `declaredMergedStrip()`: `scope: 'group'`, `closed: false`,
`positiveWidthRegions: 1` → **1 component / 1 boundary cycle / 1 region**
(the group "1/1/1"). The measured count is never fed back into the
expectation (the 20N circularity fix is preserved).

## Gate before certificate

In `gradingGroupCompute.ts` the measured positive-width region count must
equal the declared expectation (`measured === expected`) before `gtop2`;
mismatch fails closed with
`GRADING_AGREEMENT_TRANSITION_MESH: positive-width region mismatch …`.
Only then does `buildGradingTopologyCertificateExact` run, and a nonempty
merged mesh without a valid `gtop2` certificate fails closed
(`GROUP_NON_MANIFOLD` / `GRADING_TOPOLOGY_CERTIFICATE_MISSING`).

`gtop2` (`GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION`) is unchanged and
strictly revalidated: the builder and its exact reader are untouched. Legacy
single-transition/flat certificates are byte-identical.

## Sloped certificate result

The robust suite runs the real production kernel
(`computeGradingGroupFromSnapshots` → worker mesh agreement → result
certificate) across the full slope sweep and transforms, asserting
`result.topologyCertificate?.version === 'gtop2'` and a present singular leg:

- all slope tags × 3 families (elevation ±15%/±50% excepted, member-plane
  gate) — `gtop2` certified, worker clean;
- XY translate 1e6/1e8, Z shift +1e6, mirror, true traversal reversal —
  `gtop2` certified, geometry preserved.

## Negatives pinned

- **Joint-discontinuous sloped pair** rejects before meshing — pinned at
  `CORNER_INVERTED` in `cad_grading_transition_mesh_20m2.test.ts` (the same
  pre-existing corner gate that rejects flat steps).
- **Non-collinear / arc / closed / Surface / mixed-family** reject at
  admission, so they never reach a certificate
  (`cad_grading_transition_robust_20q1.test.ts`).
- **Joint-step J1/J3/J4**: nonzero-step rows refuse `gtop2` (`gtop2-refused`,
  code recorded, 1/1/1 never asserted) — `cad_grading_transition_step_20q.test.ts`,
  20Q study 70/70.
- **Wrong-budget / tied-split** from the 20N.1 gate remain regression-pinned
  (unchanged by 20Q.1).
- **Plural sloped**: whole-group rejected before any tiling, so no certificate
  is emitted.

## What this is not

- **A per-leg certificate**: the singular route still produces one merged
  open strip certified as a unit.
- **A widened certificate**: `gtop2` bytes, scope, and reader are unchanged.
- **20Q study proof**: study gtop2 expectations were harness-side; 20Q.1
  wires the admitted sloped geometry through the production certificate.
