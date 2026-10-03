# Phase 20M.1 — Worker Agreement, Topology/Certificate, Product (SPEC ONLY)

Status: **DESIGN PROPOSAL. No `src/` change.** Nothing in this file is
implemented, wired, or added to any code list. Failure codes in §1.4 are
proposed names for a future 20M.2 batch, not existing constants. Authorities
and line numbers: `forensics.md`.

---

## 1. Worker agreement basis (proposed)

### 1.1 Outside the transition interval — member native law, proposed independent check

Every daylight vertex whose source station lies outside any transition
interval belongs to exactly one member's native law. That law is
target-free analytic for all three admitted families, so
`validateDaylightAgainstTarget` (target-mesh query,
`src/workers/surfaceGradingCompute.ts:232`) does NOT apply to it — §1.1
previously claiming so was wrong. Current worker authority for such
vertices is only the source-boundary endpoint check
(`validateGradingSourceBoundary`, `:265-280`: first/last boundary equals
the Feature Line at persisted stations under `coordinateAgreementTol`);
there is NO per-vertex native-analytic validation in the worker today.

Proposed (20M.2, not existing): the worker independently re-resolves each
outside vertex against its own member's native analytic criterion — refs
through canonical member criteria plus source Z at that vertex's station
`s` via the `resolveAnalyticCriterionAt` path — under the SAME shared
tolerances, no widening. Until that lands, outside-interval agreement rests
on the engine solve plus the endpoint source-boundary gate, and no claim
beyond that is made here.

### 1.2 Inside the transition interval — NEW criterion, evaluated at the station

An interior daylight vertex is NOT checked against either member law and
NOT against any target mesh — all three admitted families are target-free
analytic (Distance/RelativeElevation/flat-Elevation carry scalar targets,
not a target surface), so `validateDaylightAgainstTarget` (target-mesh
query, `surfaceGradingCompute.ts:232`) does not apply. It is checked by
INDEPENDENT RE-EVALUATION of the legislated transition criterion at that
source station `s`:

- The worker must be able to reproduce the interior value **independently**
  of the engine. Station mapping (joint-local, source-line meters): `s=0`
  at the joint, `s<0` into the left member, `s>0` into the right, interior
  interval `[-W/2,+W/2]`. The per-vertex `s` comes from snapshot persisted
  stations; the worker never infers a station or a law.
- Carried data: the request/snapshot
  (`GradingGroupComputeRequest`, `src/workers/surfaceWorkerHandler.ts:518`)
  MUST carry, in addition to `memberCriteria` (`:528`), the transition
  object's `lawKind`/`lawVersion`/`criterionFamily`/`width`, the endpoint
  member refs, the pinned endpoint scalars AND gradeRatios as EVIDENCE at
  the recorded `ggrev1:`, and the joint station origin
  (`persisted-model.md` §1). `toGroupSolveInput`
  (`:543`) forwards the refs and evidence; the worker never treats pinned
  scalars as geometric input. Instead it independently re-resolves the
  native endpoint values from the refs through the canonical member
  criteria plus source Z, compares re-resolved values against the pinned
  evidence AND the recorded `ggrev1:` against the live revision, and fails
  closed on any mismatch (§1.4 code 6, STALE). No circularity: the revision
  hash inputs are law/width/refs plus canonical member criteria and source
  geometry — the recorded `ggrev1:` string and the pinned evidence
  snapshots are hash OUTPUTS compared at check time, never hash inputs. GradeRatios are carried
  because the production predicate requires exact equality — the worker
  re-checks `gL===gR` from the re-resolved criteria, never from a
  snapshot.
- Agreement is evaluated per vertex at its own station `s` — a
  station-indexed check, not a mesh-sample check — so a discretization
  change cannot move the goalposts.
- The comparison reuses the SAME shared components, without copies and
  without widened constants:
  - `coordinateAgreementTol` (`gradingGroupSectors.ts:270`) for plan,
  - `elevationAgreementTol` (`:304`) / `anchoredElevationAgreementTol`
    (`:253`, called with the transition law's own leverage — no target
    plane) for Z,
  - `AGREEMENT_OPS=32` (`:211`), `AGREEMENT_FLOOR=1e-9` (`:221`),
  - the global classification floor `zeroDelta`
    (`src/engine/cad/surfaces/volume/zero.ts:17`) — classification only,
    never the gate.
- No new epsilon is introduced anywhere. The transition law is a law; it
  does not get a looser tolerance than the members it joins.

### 1.3 Source-boundary half — unchanged

The strip source boundary still equals the Feature Line at persisted
stations under `validateGradingSourceBoundary`
(`surfaceGradingCompute.ts:265`, `coordinateAgreementTol`). A transition
does not change source geometry (20M decision §3(a)).

### 1.4 Bounded failure codes to add in 20M.2 (LIST ONLY — do not add now)

Proposed names, mirroring the existing `GRADING_AGREEMENT_*` vocabulary:

1. `GRADING_AGREEMENT_TRANSITION_MALFORMED` — request carries an
   inconsistent/incomplete transition object (missing law, width, refs).
2. `GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN` — `lawKind`/`lawVersion`
   not registered by this build.
3. `GRADING_AGREEMENT_TRANSITION_WIDE` — `W/2` exceeds available member
   length.
4. `GRADING_AGREEMENT_TRANSITION_OVERLAP` — intervals share positive
   interior.
5. `GRADING_AGREEMENT_TRANSITION_OFF_LAW` — interior vertex disagrees with
   the transition criterion at its station beyond the shared tolerance.
6. `GRADING_AGREEMENT_TRANSITION_STALE` — recorded revision no longer
   matches the group `ggrev1:`.

These are additions for the future batch; the present code contains none of
them (`forensics.md` §6).

---

## 2. Topology / certificate (proposed)

### 2.1 Pre-mesh declaration first

A transition must be **declared** before it can be validated. The expected
topology comes from `deriveGradingTopologyExpectation`
(`src/engine/cad/grading/gradingTopologyExpectation.ts:78`, policy
`'20k3.1'` at `:22`) and the run counter
`countPositiveWidthStationRuns` (`:31`). For an open line-line transition inside a group, the expected shape is
declared on the **group-scoped** certificate (`scope: 'group'`): the
transitioned open route contributes 1 component / 1 boundary cycle to the
group expectation derived for the open/split table — never a separate
standalone-strip certificate. (An earlier draft said "standalone open
strip"; that scope was wrong for a group transition and is corrected
here.) That declaration is made by the policy, not read off the mesh.

### 2.2 gtop2 machinery unchanged

Certification stays `buildGradingTopologyCertificateExact`
(`src/engine/cad/grading/gradingTopologyCertificate.ts:525`), version
`gtop2` (`:24`), gated on `GTOP2_POLICY` (`:529`, `:601`) — proposed reuse
for 20M.2, unevidenced in 20M.1 (no implementation, no measured
certificate; no production transition mesh exists yet). No new
certificate version, no relaxed policy check. The production/product error
paths (`:343`, `:353`) and missing-certificate codes (`:258`, `:597`)
remain the only reject vocabulary. Certification is NOT evidence of policy
admission and has not been demonstrated on a transition mesh: 20M.2 must
implement the transition expectation + mesh and prove the declared
expectation/certificate with RED/green tests before production enablement
(group scope kept; no revert to standalone).

### 2.3 Pins

- **Component pin:** expected components must equal observed; a transition
  does not get to change the component count silently.
- **Cycle pin:** expected 1 boundary cycle for an open strip; a second cycle
  or a merged annulus is a topology change and must be rejected (this is
  why closed-route transitions are out of scope).
- **Positive-width-run pin:** runs are derived from source/daylight pairs
  (`gradingTopologyExpectation.ts:31`); a transition that produces a
  zero-width pair breaks a run and must be declared as such, not hidden.

### 2.4 Failure cases (must fail closed)

| Case | Meaning | Disposition |
|---|---|---|
| Foldover | transition strip crosses itself | reject (`GROUP_NON_MANIFOLD`, `gradingGroupCompute.ts:816`) |
| Overlap | two intervals claim the same station | reject before mesh (§1.4 code 4) |
| Zero | `W == 0` or a zero-width run | reject; zero width is NOT a tie |
| Touching | boundary shared with a sibling interval | occupancy-only; first 20M.2 production authorizes exactly one transition per group, so sibling-interval gap rules are future-multiple evidence only (`persisted-model.md` §2.4) |
| Short | `W/2 > available` | reject (§1.4 code 3) |

### 2.5 Certification validates; it never admits

`gradingTopologyCertificateProductionError`
(`gradingTopologyCertificate.ts:343`) checks the observed mesh against the
legislated expectation. A green certificate means the build matches the
law; it does NOT mean the law is admissible. This mirrors 20M decision
§7/§11: "certify the strip and call it admissible" is rejected.

---

## 3. Product / provenance (proposed)

### 3.1 What provenance must carry

`sourceBoundary`/daylight provenance for a transition must record:
transition law `lawKind`/`lawVersion`, the explicit `width` and its measure,
the source interval, both member identities + their effective criteria, and
the residual/decision metadata from the producing build
(`persisted-model.md` §5). None of these fields exist today (20M decision
§8).

### 3.2 Extract

Extract eligibility stays behind `deriveGradingProductCapabilities`
(`src/engine/cad/grading/gradingProductCapabilities.ts:220`) and the
CURRENT gate (`:223`, `notCurrent` `:86`). For a transition the boundary
representation must expose the transition interval and its stations
explicitly (`GradingProductCapabilityResult.sourceBoundaryPoints`
`:65`, `daylightPoints` `:66`) — a client must be able to see that an
interval is transition-owned. Multi-region export stays refused
(`GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`,
`gradingTopologyCertificate.ts:315`).

### 3.3 Bake

Bake remains an explicit-TIN bake with provenance
(`deriveBake`, `gradingProductCapabilities.ts:130`), rejecting empty
(`:134`), model-limit (`:141`), and certificate failures (`:143`). The
baked model must cite the transition law so the produced TIN cannot be
mistaken for member-law geometry.

### 3.4 Design Patch — stays unavailable for the open transition route

`deriveDesignPatch` (`gradingProductCapabilities.ts:148`) requires
`closed === true` (`:153`) AND `components === 1 && boundaryCycles === 2`
(`:166`). An open transition strip fails the closed precondition outright.
**Do not widen to a closed-annulus transition route to make Design Patch
available** — that is a topology-contract change (annulus
re-certification) explicitly deferred by 20M decision §10.6 and out of
scope.

### 3.5 Current / Failed / revision after edits

- The result is CURRENT only at the recorded `ggrev1:`/`grev1:` revision
  (`persisted-model.md` §4; staleness contract
  `src/workers/surfaceGradingService.ts:324`,`:379`) — proposed semantics
  for 20M.2, unevidenced in 20M.1 (no revision writer/reader exists yet).
- After a member/source/criterion edit the revision changes, the transition
  is invalidated, and the group recomputes; the product gate returns
  `GRADING_PRODUCT_NOT_CURRENT` (`gradingProductCapabilities.ts:32`,`:88`)
  until recalculated.
- A transition failure surfaces as a bounded agreement/topology code (§1.4,
  §2.4) and the group is FAILED/NOT_CURRENT — never a silently degraded
  naive connector.

### 3.6 Minimum editor control (sketch, no implementation)

Two user-owned inputs, per `persisted-model.md` §7: **explicit width**
(finite, `> 0`, source-line meters, feasibility-checked) and **law pick**
(single selector over registered `lawKind`). Everything else is read-only
inherited context. No auto-fit, no implicit default, no per-joint magic.
