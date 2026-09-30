# Phase 20K — hybrid arc×arc grading groups: architecture

Status: STUDY / EVIDENCE ONLY. Branch
`research/phase20k-hybrid-arc-pair-feasibility`, baseline
`e8bece3d0c05d12e9cc82e81a9c368fc92c41089` (PR #140 merge; base
`ffa89282c8e15e41ab959726b9ab3bc4415422aa`). ZERO `src/` changes. Nothing
here routes production: a genuine arc×arc hybrid joint still fails closed in
`computeGradingGroupFromSnapshots` with
`CORNER_NO_SOLUTION / GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`.

## 1. The question

Phase 20J shipped hybrid surface↔analytic groups for joints where at most one
adjacent member is a curved source. `solveHybridCorner` explicitly refuses a
joint whose two adjacent members are BOTH arcs
(`inIsArc && outIsArc`). Phase 20I had already measured that an arc×arc
hybrid is "only ~29 % exact" in a stress harness and recommended a
chord/tangent restriction rather than productisation. Phase 20K asks, with
genuine arc geometry and the production member/merge helpers:

1. does an honest terminal **frame model** produce an exact common tie for an
   arc×arc joint? (§6 models)
2. if the tie is exact, is the resulting **group** buildable — continuous
   boundary, valid mesh, no overlap, one component? (§26–§29)
3. is there a control (all-Distance / all-Surface / mixed-analytic) that
   reproduces the hybrid geometry where semantics match? (§27)

## 2. §6 terminal models (source / chord / true-tangent)

An arc member has three distinct notions of "terminal geometry":

| model | source samples | terminal direction at a joint | grade | tolerance-dependent |
|---|---|---|---|---|
| **source** | exact circle samples (`linearizeGradingArc`) | — (the strip is the source) | exact | no |
| **chord** | same exact samples | direction of the first/last linearized chord — what production `chordDir(chords[0/last])` feeds `solveHybridCorner` | terminal chord `ΔZ/\|chord\|` (exactly the production `gradingGroupCompute` grade) | yes |
| **true-tangent** | same exact samples | exact circle tangent at the joint, `dir·(−sinθ, cosθ)` | arc-length `ΔZ/L` (the honest physical grade) | no |

All three share the SAME source samples; only the frame a corner consults
differs. The chord model is what every shipped arc path already uses; the
true-tangent model is the physically faithful direction and is
tolerance-independent.

`solveHybridCorner` is deliberately frame-driven: it consumes `inT/inN/inGs`
and `outT/outN/outGs`. The ONLY reason a genuine arc×arc joint is blocked is
its explicit arc-pair guard, not a numeric limitation. The study therefore
supplies honest frames directly and clears the arc flags
(`phase20kHybridArcPairCore.resolveArcPairCorner`), so the production helper
still owns every acceptance gate (seam ray, nearest surface root, XY/Z/seam
agreement, side half-planes, miter extent, GAP/OVERLAP mesh build).

### Coordination note — core file

`scripts/phase20kHybridArcPairCore.ts` is owned by Worker-CORE. It was ABSENT
when the GROUPS worker assembled this branch, so a bounded LOCAL STUB was
written (clearly marked in that file's header) providing the arc-spec,
terminal-frame, chord-linearization, and arc-pair-corner API the GROUPS study
imports. Worker-CORE must replace it with the authoritative core; the
exported surface is the contract the study relies on.

## 3. Study assembler (`scripts/phase20kHybridArcPairGroups.ts`)

Non-routed composition of production helpers; it never claims a production
route.

- **Member strips** — `linearizeGradingArc` (exact-arc chord sampling) +
  `solveStraightChord` (surface criteria) / `solveGradingChord` (analytic
  criteria), stitched exactly like production's `linearizeMember` +
  `stitchChords`, including the `stationBase`/`stationScale` arc-station map.
- **Corners** — `resolveArcPairCorner` (core) → `solveHybridCorner` with the
  arc-pair guard cleared; GAP fans `V→Qs→tie` + `V→tie→Qa`, OVERLAP clips
  both strips to the seam. (GAP/OVERLAP here names the corner patch shape;
  it does not certify a buildable group — buildability is the audit's call.)
- **Merge** — `mergeGroupTriangles` + `validateGroupMesh` (the production
  explicit-TIN validator), `ringIsSimple` for closed daylight.
- **Daily controls** — `productionControl` calls the real
  `computeGradingGroupFromSnapshots` for all-Distance / all-Surface /
  mixed-analytic groups (same-domain, so the hybrid guard never fires).
- **Audit** (`scripts/phase20kHybridArcPairAudit.ts`) — `auditMesh` adds independent checks beyond
  `validateExplicitTinPayload` (§29): finite XYZ, valid indices, positive
  plan area, no duplicate triangle, no interior overlap (O(n²) plan
  intersection), edge incidence ≤ 2, vertex- and edge-connected component
  counts with edgeComponents > 1 failing buildability for open AND closed,
  open-continuous / closed-simple daylight, no bridge/pinch, and
  `sum(triangle plan area) == reported plan area`.
- **Corpus** — `buildCorpus()` writes `docs/evidence/phase20k/corpus.json`
  (39 rows, 0 mismatches, one canonical mesh digest per distinct success).

## 4. Fixtures

- **Primary arc pair** — bottom side `A(0,0,10)→B(100,0,10)`, chord 100,
  sagitta 5, `R=252.5`, shared joint `B=(100,0)`, plus its 90°-rotated
  sibling (the right side).
- **Rounded square** — four genuine side arcs, corners
  `(0,0),(100,0),(100,100),(0,100)`, shared by exact construction so
  production’s `exactXyz` joint-continuity gate holds.
- **Targets** — flat `z=0` TIN spun 10° about `(50,50)` so study rays cut
  edges transversely (the shared interval code fails closed on axis-parallel
  rays; see 20I `record.quirk-*`).

### Spec-literal geometry vs buildable mirror

The task lists the bottom arc centre as `(50,−247.5)` with a minor CW sweep.
That geometry bulges INWARD (toward the centre): all four sides are concave,
and the outward grading offset self-intersects. The production all-distance
control fails `GROUP_SELF_INTERSECTION / GRADING_GROUP_DAYLIGHT_RING`
(`closed.square.literal-concave*` rows), which is the same result for the
literal geometry whether solved by production or the study assembler.

Because §27 requires a simple closed boundary, the study's rounded square
is the outward (convex) mirror: centre `(50,+247.5)`, minor CCW sweep
(`outwardBottomSpec`). The literal concave geometry is retained in the corpus
as a fail-closed control, so the discrepancy is recorded rather than hidden.

## 5. Future seam audit (§33)

Everything below is an audit of what a future arc-pair route would touch.
NONE of it is implemented.

- **Authoring** (`gradingGroupTermination.ts`) — the single authority
  `validateGroupTerminationDomainCriteria` already admits surface+analytic
  mixes post-20J; an arc-pair restriction would belong in the compute/resolve
  path, not authoring.
- **Persistence** (`gradingGroupPersistence.ts`) — arc params already ride
  `ResolvedGradingSource.arc`; no schema change implied for a frame model.
- **Revision** (`gradingGroupRevision.ts`) — `ggrev1:` hashes the sparse
  criterion/target set; an arc-pair frame model is derived, never persisted,
  so revision bytes are unaffected.
- **Resolve / worker** (`gradingGroupResolve.ts`, worker protocol) — no
  target/protocol change; one shared snapshot already flows.
- **Compute** (`gradingGroupCompute.ts`, `gradingGroupHybridCorners.ts`) —
  the real seam. The arc-pair guard is a single boolean branch; removing it
  is trivial, but §27 shows the resulting **mesh** is not production-grade
  (vertex-pinched, audit-failing) without a seam-aware strip stitch. A
  future route must not just delete the guard.
- **Status / commands** (`gradingGroupStatus.ts`) — failure still collapses
  to `null` at the revision gate; no change.
- **Provenance** — a new arc-model marker is unnecessary; `CURVE_APPROXIMATED`
  already covers curved groups.
- **Design Patch** — no new interior policy; warped/transition results stay
  BLOCKED.

## 6. Diagnostics proposal (§34)

The study proposes the following named details for a future arc-pair route,
and evaluates their sufficiency. They are NOT implemented.

| proposed detail | meaning | sufficient? |
|---|---|---|
| `CHORD_DEGENERATE` | terminal chord direction is zero/non-finite | yes — mirrors existing `PLANE_DEGENERATE` paths |
| `OFFSET_COLLAPSE` | two adjacent limit offsets collapse to the same line | yes (maps to existing `TRANSITION_REQUIRED`) |
| `OFFSET_INVERTED` | analytic limit crosses behind the joint vertex | yes (maps to existing side/max gates) |
| `TRANSITION_REQUIRED` | both ties exist but disagree (mismatch family) | already exists (20J) — reuse |
| `MESH` | merged mesh refused by the validator | already exists (`GROUP_NON_MANIFOLD`) |
| `SEAM_MITER_REQUIRED` | **NEW** — arc chord seams pinch the strip (edge-connected components > 1 / discontinuous daylight) so the group cannot be assembled without a seam-aware re-stitch | **needed and missing today** |
| `SEAM_PINCH` | **NEW** — independent audit detects a vertex-pinched seam (informational subset of the above) | **needed** |

Evaluation: the existing `GRADING_SURFACE_ANALYTIC_*` family is necessary but
NOT sufficient for arc pairs. The dominant real failure in this study is a
seam/stitch topology failure, not a tie failure, and no current diagnostic
names it. A future route therefore needs at least a `SEAM_MITER_REQUIRED`
(or equivalent) fail-closed detail before any arc-pair support can be
claimed.
