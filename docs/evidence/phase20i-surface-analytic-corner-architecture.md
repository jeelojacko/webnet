# Phase 20I — surface↔analytic grading corner: architecture and feasibility study

Status: EVIDENCE-ONLY. Branch `research/phase20i-surface-analytic-corner-feasibility`,
baseline `9dd28c94715daa3583c907224a04652d3ae99cc3` (= PR #137 merge).
ZERO production routing changes, ZERO `src/` changes, no UI, no browser QA.
Every "proposal" below is explicitly **NOT implemented**; the current
production contract is still fail-closed for a group that mixes a surface
member and an analytic member.

Numerical results (fixtures, residuals, timings) are owned by the core worker
and recorded in `phase20i-surface-analytic-corner-validation.md`
(`...-performance.md`). This document is source-derived only: every statement
carries a `file:line`/symbol reference.

## 0. Scope and non-goals

- **Question**: can ONE grading group contain both a surface-terminated member
  (fixed / cut-fill, tied to the target TIN) and an analytic member
  (distance / elevation / relative-elevation terminal limit line), joined by
  one exact common corner tie?
- **In scope**: the corner mathematics for the three domain pairings, the
  exact-common-tie candidate, rejected alternatives, and the production-seam
  impact audit.
- **Out of scope**: any change to `src/`, persistence schema, routing, UI, or
  the existing fail-closed gate. The core worker's study is measurement only.

## 1. Termination domains (current contract)

Domain is derived, never persisted (`gradingTerminationDomain`,
`gradingTypes.ts:37-48`): `fixed`/`cut-fill` → `surface`,
`distance`/`elevation`/`relative-elevation` → `analytic`. A single group must
be one domain; a mix fails closed in three places:

| seam | symbol | behavior |
|---|---|---|
| authoring | `validateGroupTerminationDomainCriteria` (`gradingGroupTermination.ts:40-48`) | returns the one error string naming the mix |
| resolve | `resolveGroupInputsWithReason` (`gradingGroupResolve.ts:180-190`) | `GRADING_GROUP_MIXED_TERMINATION_DOMAIN` before target resolution |
| compute | `computeGradingGroupFromSnapshots` (`gradingGroupCompute.ts:272-279`) | `MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN` before any partial solve |

Persistence additionally scrubs an `incompatible-domain` override per record
(`gradingGroupPersistence.ts:118-140`). The mesh builder and validator are
domain-agnostic: `clipTriangleToHalfPlane` / `mergeGroupTriangles` /
`validateGroupMesh` (`gradingGroupMerge.ts:42,91,119`), `meshPlanArea` /
`mesh3dArea` (`gradingMesh.ts:149,153`). The shared numeric floor is
`zeroDelta(baseZ, cmpZ) = 4·ε·max(1,|baseZ|,|cmpZ|)`
(`surfaces/volume/zero.ts:19-20`).

## 2. (A) Surface ↔ Surface — existing, implemented (Phase 20C)

At joint `V = (vx,vy,vz)` each member `m` contributes a grading plane

```
P_m(X,Y) = zAtV_m + ∇P_m · ((X,Y) − (ax_m,ay_m))
∇P_m     = gs_m·T_m + g_m·N_m
```

`gradingPlaneGradient` (`gradingCornerMath.ts:67-85`), evaluation
`planeElevationAt` (`:88-97`). `g_m` is the cross grade: fixed ratio, or the
cut/fill pick from `cutFillSideAtCorner` (`:181-188`) via `crossGradeAtV`
(`gradingGroupCompute.ts:239-254`).

- **Seam** `M = P_in ∩ P_out`: plan direction perpendicular to
  `∇P_in − ∇P_out` (`miterSeam`, `:102-115`); `zeroDelta`-equal gradients ⇒
  `coincident` (no wedge). Ray sign chosen to lie in both grading-side
  half-planes (`selectMiterRay`, `:118-137`); length bounded
  `t ≤ maxSearch/(M·N_i)` (`miterExtent`, `:140-159`).
- **Turn** from the signed cross of unit tangents (`classifyCorner`,
  `:162-178`; left-side left-turn = `OVERLAP`).
- **Tie**: nearest outward `t` along the ray where `P_in(V+tM) = Zt(V+tM)`,
  root-by-root across the candidate TIN triangles, deduped by `zeroDelta`,
  then `P_out` agreement within `zeroDelta` (`solveMiterTie`,
  `gradingGroupSectors.ts:167-220`). Zero roots distinguish target void
  (`CORNER_TARGET_GAP`) from unsolved (`CORNER_NO_SOLUTION`) via probes
  (`:206-211`).
- **Orchestration** `gradingGroupCompute.ts`: domain gate `:272-279`, joint
  continuity `:281-285`, `ztV` `:484`, cut/fill `:485-487`, planes
  `:493-494`, seam `:495-501`, ray `:509-511`, extent `:512-513`, tie
  `:514-516`, plane-2 agreement `:518-521`, sector bounds `:529-546`,
  `OVERLAP` trim `:551-566`, `GAP` fan `:589-609`, splice `:620-625`.

## 3. (B) Analytic ↔ Analytic — existing, implemented (Phase 20F/20H)

Each analytic member contributes one terminal limit line
`La_m = { O_m + s·D_m }` (`analyticTerminalLine`,
`gradingGroupAnalyticCorners.ts:76-134`). `d` and the limit elevation come
from the single resolver `resolveAnalyticCriterionAt`
(`gradingAnalyticCriterion.ts:154-171`; relative-elevation sign/size authority
`resolveRelativeElevationParams` `:45`):

| kind | origin `O` | XY direction | ΔZ / step |
|---|---|---|---|
| distance | `V + N·d`, `oz = Zsrc + g·d` | `T` | `dz = gs` |
| elevation | `V + N·d`, `oz = E` | `T − (gs/g)·N` | `dz = 0` |
| relative | `V + N·d`, `oz = Zsrc + Δ`, `d = Δ/g` | `T` | `dz = gs` |

- **Tie** `T* = La_in ∩ La_out`: `det = cross(D1_xy, D2_xy)`; `|det| ≤
  zeroDelta` ⇒ `linesCoincide` (`:140-151`) → `coincident`, else
  `GRADING_ANALYTIC_CORNER_PARALLEL`.
- **Acceptance** (`solveAnalyticCorner`, `:154-213`): Z agreement
  `|z1 − z2| ≤ zeroDelta(z1,z2)` (`:183-185`) else
  `GRADING_ANALYTIC_CORNER_Z`; side gate on both grading-side half-planes
  within `±zeroDelta` (`:187-191`); extent `> 0` (`:195-198`); extent
  `≤ miterExtent` (`:199-202`). No averaging, no bridging, no interpolation.
- **Compute branch** (`gradingGroupCompute.ts:401-...`): `GAP` fans the wedge
  from `V` (`:407-420`); `OVERLAP` trims both member strips + limit polylines
  to the `V→tie` miter line (`:422-450`).

## 4. (C) Surface ↔ analytic — candidate with an exact common tie

One member `s` is surface-terminated, the adjacent member `a` is analytic
(either storage order). Define the two grading planes at `V` exactly as in §2:

```
Ps(X,Y) = zAtV_s + ∇Ps·((X,Y)−V),   ∇Ps = gs_s·T_s + g_s·N_s
Pa(X,Y) = zAtV_a + ∇Pa·((X,Y)−V),   ∇Pa = gs_a·T_a + g_a·N_a
```

`La` is the analytic terminal line of §3, and by construction `La ⊂ Pa`
(`Pa(O + s·D) = oz + s·dz` for every `s`). The **seam** is the plane-equality
locus

```
M = Ps ∩ Pa   (plan line through V, direction ⊥ (∇Pa − ∇Ps))
```

built with the same `miterSeam(∇Ps, ∇Pa)` primitive (`gradingCornerMath.ts:102-115`).

**Candidate exact common tie (policy A′).** The single tie is

```
T* = M ∩ La   (2-D intersection of two plan lines, since La ⊂ Pa)
```

Parameterize `M(t) = V + t·m̂` and `La(s) = O_a + s·D_a`; solve
`det(m̂, D_a) ≠ 0`, then `T*` has `Z = Ps(T*) = Pa(T*)`. Acceptance:

1. `|det(m̂, D_a)| > zeroDelta` — otherwise `M ∥ La` → `CORNER_HYBRID_NO_COMMON_TIE`
   (proposed code; not implemented).
2. `T*` lies on the selected miter ray inside **both** grading-side
   half-planes and within `miterExtent` — exactly the §2 gates
   (`selectMiterRay`, `miterExtent`).
3. **Target agreement**: `|Ps(T*) − Zt(T*)| ≤ zeroDelta(Ps(T*), Zt(T*))` —
   the surface member must actually reach the target at the tie, else
   `CORNER_HYBRID_TARGET_DISAGREE` (proposed).
4. **Limit agreement** (defensive re-check): `(T* − O_a) × D_a` within
   `zeroDelta` confirms `T* ∈ La`.

Because the surface construct (`Ps`, `Zt`) and the analytic construct
(`Pa`, `La`) are independent, step 3 is **not** guaranteed; it is the exact
residual the core worker must measure. `T*` is exact (rational in the plane
coefficients plus one TIN affine query) when the target is a single affine
triangle under `T*`; branch risk exists only where `M` grazes a triangle edge
or vertex — the same class already handled by `solveMiterTie`'s root dedupe
(`gradingGroupSectors.ts:202-213`).

### Rejected policies

- **Policy B (rejected): two independent ties + a bridging wall.** Compute the
  surface daylight tie `ts` with `solveMiterTie` and the analytic tie `ta`
  with `solveAnalyticCorner`, then join them with a vertical wall, a ruled
  patch, or an averaged Z. Rejected: it fabricates geometry that lies on
  neither limit surface, is Z-discontinuous whenever `ts ≠ ta`, and directly
  contradicts the existing "no walls / no bridging" invariant documented in
  the analytic corner branch (`gradingGroupCompute.ts:400-401`).
- **Policy C (rejected): half-target substitution.** Replace `Zt` with `Pa`
  on the surface side and run the §2 surface miter machinery. Rejected: the
  surface member then no longer terminates on the real TIN, so it passes the
  numeric gates while being wrong on the actual target, and any leakage of the
  substitution would silently alter existing Surface↔Surface results.

## 5. Production-seam audit (proposals only — NOT implemented)

### 5.1 Authoring
`validateGroupTerminationDomainCriteria` (`gradingGroupTermination.ts:40-48`)
is the single authoring authority; the error string at `:47` is what a mixed
group sees today. A future hybrid domain would extend this gate (a `hybrid`
domain or a capability flag) — no parallel validator. No change made.

### 5.2 Persistence
`CadGradingGroup.targetSurfaceId` is already optional
(`gradingGroupTypes.ts:46-72`): surface groups require it, analytic groups
omit it. **An optional `targetSurfaceId` is sufficient** for a hybrid group
because the surface member(s) need the TIN and the analytic member(s) simply
ignore it. `sanitizeCadGradingGroupsDetailed`
(`gradingGroupPersistence.ts:118-140`) scrubs per-override
`incompatible-domain`; a hybrid domain would stop emitting that reason rather
than adding a key. No schema bump is implied if the hybrid domain stays
derived (matching the current 2-way derived domain). No change made.

### 5.3 Revision
`buildGroupRevision` (`gradingGroupRevision.ts:117-140`) already hashes the
default criterion, every canonical override (`overrideText`, `:110-113`), and
the target leg (`tgt:…` for surface, `tgt:none` otherwise). **Additive branch
proposal (no impl)**: set the surface leg from
`gradingCriterionRequiresSurface(default) || any effective override requires
surface`, keeping the `ggrev1:` prefix and every existing byte. Existing
groups keep their domain, so no legacy pin moves.

### 5.4 Resolve / worker
`resolveGroupInputsWithReason` (`gradingGroupResolve.ts:180-199`) derives the
domain set from default + overrides. A hybrid domain would set
`requiresSurface = true` whenever *any* member requires surface and resolve
**one** target snapshot shared by all members — the same snapshot the
Surface↔Surface path uses (analytics never query it). Worker protocol
unchanged. No change made.

### 5.5 Compute dispatch matrix
| default domain | member domains | today (`gradingGroupCompute.ts:272-279`) | hybrid candidate |
|---|---|---|---|
| surface | surface only | Surface↔Surface (`solveMiterTie`) | unchanged |
| analytic | analytic only | Analytic↔Analytic (`solveAnalyticCorner`) | unchanged |
| surface | surface + analytic | `MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN` | per-joint dispatch: S↔S / A↔A as today; mixed joint → policy A′ |
| analytic | surface + analytic | same fail-closed | same |

Existing failure vocabulary stays: `CORNER_NO_SOLUTION`, `CORNER_TARGET_GAP`,
`CORNER_AMBIGUOUS`, `CORNER_INVERTED`, `CORNER_BRANCH_DISCONTINUITY`,
`CORNER_MAX_DISTANCE` (`gradingGroupTypes.ts:88-99`) plus the analytic
`GRADING_ANALYTIC_CORNER_*` details (`gradingGroupAnalyticCorners.ts:154-213`).

### 5.6 Status / commands / exports
- `deriveGroupStatus` (`gradingGroupStatus.ts:22-31`) is domain-agnostic; no
  change needed.
- Group commands collapse a compute failure to `null` at the revision gate
  (`cadTransactionsGradingGroupCommands.ts:395-399`); a hybrid group would be
  `calculable`/`exportable` through the same status path. No change made.
- One Extract / Bake / Design-Patch path per group. A hybrid group would need
  a new `targetKind` (proposal `'surface-analytic'`) alongside `analyticKinds`
  and the existing target fields; `normalizeTinProvenance` currently accepts
  `mixed-analytic` only for group-bake/design-patch (20H architecture §7) and
  would need the new value added to that allowlist. No change made.

### 5.7 Future diagnostic names (proposal)
`CORNER_HYBRID_NO_COMMON_TIE` (M ∥ La), `CORNER_HYBRID_TARGET_DISAGREE`
(residual > `zeroDelta`), `CORNER_HYBRID_ORDER` (defensive: both sides same
domain reached the hybrid branch). No change made.

### 5.8 Future provenance shape (proposal)
Principles: provenance is informational, never legal wording
(`makeDesignPatchProvenance`, `designPatchBuild.ts:321-361`); legacy
absent-`targetKind` reads as `surface`; existing `ggrev1:`/`tgt:` bytes stay
frozen. A hybrid record would carry `targetKind: 'surface-analytic'` plus a
canonical termination-kind list (surface, distance, elevation,
relative-elevation) or the existing `analyticKinds` + a surface-member flag.
`targetSurfaceId`/`targetSurfaceRevision` stay present (a surface member
exists); `criterionDistance`/`targetElevation`/`relativeElevation` stay
singular-only as today. No change made.

### 5.9 Design Patch audit
`resolveDesignPatchInterior` (`designPatchBuild.ts:118-138`) accepts a
**bit-flat** ring (`interiorPolicy: 'flat-source'`, byte-identical legacy pad)
or an **exactly coplanar** ring (`'planar-source'`); anything else fails
closed (`DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED`). `checkFlatRing`
(`designPatchRing.ts:234-246`) requires bit-identical Z; `deriveDesignPatchPlane`
(`designPatchPlane.ts:123-180`) is the single planar authority with no
tolerance-based "planar enough".

Consequence for a hybrid corner: the Design Patch leg is admissible **only**
when the resulting closed result ring passes the existing flat/planar gate
unchanged. A hybrid that produces a warped interior, a transition surface, a
retaining wall, or a fabricated interior must stay **BLOCKED** fail-closed. No
new interior policy is proposed and nothing was implemented.

## 6. Open questions for the core worker

1. Residual distribution of `|Ps(T*) − Zt(T*)|` on exactly-flat, sloped, and
   jittered target triangulations (is step 3 satisfiable within `zeroDelta`?).
2. Root/branch uniqueness when `M` crosses a TIN edge or vertex.
3. GAP vs OVERLAP classification for the mixed joint (which member's turn sign
   governs the wedge?).
4. Arc-adjacent mixed joints (`CURVE_APPROXIMATED` interaction).
5. Large-coordinate conditioning (`E≈2M / N≈7M`, as in the 20H §21-G oracle).
6. Whether the closed-square hybrid pad yields a flat/planar Design Patch ring.
7. Regression proof: Surface↔Surface and Analytic↔Analytic digests must stay
   byte-identical.

## 7. References

- `src/engine/cad/grading/gradingCornerMath.ts:67,88,102,118,140,162,181`
- `src/engine/cad/grading/gradingGroupSectors.ts:42,167,202,233,332`
- `src/engine/cad/grading/gradingGroupAnalyticCorners.ts:76,140,154`
- `src/engine/cad/grading/gradingAnalyticCriterion.ts:45,154`
- `src/engine/cad/grading/gradingGroupCompute.ts:239,272,401,484,493,509,514,529,551,589`
- `src/engine/cad/grading/gradingGroupTermination.ts:40`
- `src/engine/cad/grading/gradingGroupResolve.ts:180`
- `src/engine/cad/grading/gradingGroupPersistence.ts:118`
- `src/engine/cad/grading/gradingGroupRevision.ts:110,117`
- `src/engine/cad/grading/gradingGroupMerge.ts:42,91,119`
- `src/engine/cad/grading/gradingMesh.ts:149,153`
- `src/engine/cad/grading/gradingGroupStatus.ts:22`
- `src/engine/cad/grading/designPatchBuild.ts:118,321`
- `src/engine/cad/grading/designPatchRing.ts:234`
- `src/engine/cad/grading/designPatchPlane.ts:123`
- `src/engine/cad/surfaces/volume/zero.ts:19`
- `src/engine/cad/grading/gradingTypes.ts:37,50,58`
- `docs/evidence/phase20h-mixed-analytic-architecture.md`
- `docs/evidence/phase20h-mixed-analytic-validation.md`
