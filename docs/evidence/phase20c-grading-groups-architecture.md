# Phase 20C — Grading Groups + Miter Corners: Architecture Audit

Baseline: `origin/main a14f9f7f` (PR #123 merge, fetch-verified exact match, no advance).
Branch: `feat/cad-grading-groups-corners`.
Status: AUDIT ONLY — no production code. This document is the §2 gate.

Baseline validation on `a14f9f7f`: lint 0e/2w (pre-existing), typecheck clean,
agent 6278 pass + 3 pre-existing study-desktop calibration fails (carried),
wasm 74/74, parity 25/25, build clean, portable-paths 4732 paths 0 violations.
Prior-art grep: zero implementation hits for grading-group/miter/corner/pad
(all `miter` hits are `delimiter` substrings; 20B doc explicitly defers corners/groups to 20C).

---

## 1. Current one-course grading contract (20B, frozen)

`CadGrading` (`src/engine/cad/grading/gradingTypes.ts`, frozen 2026-09-27) persists
**definition only**: `{id, name, sourceFeatureLineId, sourceCourse:{vertexAId,vertexBId},
targetSurfaceId, side, criterion, maxSearchDistance, curveChordTolerance, layerId?, styleId?}`.
One definition grades ONE physical course on ONE side. `CadGradingResult` is session-only.

Solve pipeline (`src/workers/surfaceGradingCompute.ts`, pure + synchronous):
`computeGradingFromSnapshots(GradingComputeRequest): GradingComputeOutcome` (L774–920)
takes ONE `source: ResolvedGradingSource` + flat target snapshot
`{points:number[]; triangles:number[]}` and returns one result or
`{ok:false, code, detail?}`. Internals (module-private): `buildTargetQuery` (L92,
grid + full-scan fallback), `candidateTriangles` (L129, grid bbox over swept strip),
`clipRect` (L181, Sutherland–Hodgman to `(u,d)` strip rect), `solveSpan` (L236,
clip → `extractZeroSegments` → nearest envelope), `solveStraightChord` (L395, 228 lines),
`assembleGradingResult` (L644). Arc path: `linearizeGradingArc` → one full
`solveStraightChord` per chord with affine station mapping, stitched with `seamEquals`
(L757). GO gate: `validateGradingResultAgainstTarget` (L973–994) re-queries the
retained TIN; every zero classification uses 18I `zeroDelta` (`surfaces/volume/zero.ts:17`).

Grading-plane math (`gradingStraightSolve.ts`, pure, no sibling imports):
`Zg(u,d) = Z0 + gs·u + g·d`, `targetPlaneCoeffs`, `solveDaylightDistance`
`d = Δ/(g − ∇T·N)` with zeroDelta-parallel / behind-source / beyond-search fail-closed,
`classifyPlaneRelation`. Course identity/frames (`gradingCourseFrame.ts`):
`gradingSideNormal` (Nleft=(−ty,tx)), `toLocalFrame`/`fromLocalFrame`,
`resolveGradingSourceCourse` (either-order A/B match, adjacency+uniqueness check,
reoriented flag, arc sweep negation; insert→non-adjacent→null→BROKEN_REFERENCE).
Revision `grev1:<fnv1a>` (`gradingRevision.ts`, 1e-9 quantization, arc params folded in).
Status precedence (`gradingStatus.ts`):
BROKEN_REFERENCE > BUILDING > UNBUILT > SOURCE_NOT_CURRENT > NEEDS_RECALC > CURRENT.

Worker path: `SurfaceGradingService.requestGrading` → `resolveGradingInputs` →
`tinCache.get` → `toTargetSnapshot` (flat arrays ONLY, grid NOT sent) →
`SurfaceWorkerClient.deriveGrading` → worker `handleGrading` → `computeGradingResultFromRequest`
→ `complete` (+ `agreementReject` re-query) → `gradingCache.set` (current + ≤1 stale,
key `scopeId::gradingId@revision`). Latest-wins keys are per-`gradingId` at all three
layers. Persistence: trailing optional `project.gradings` inside schema v2 (no bump),
`withoutGradingsKey` key-order discipline, `sanitizeCadGradings` round-trips each entry
through `createGradingDefinition` (requires A≠B, non-empty source/target ids, side ∈ {L,R}).

## 2. Why naive mesh union is insufficient (§23)

Two adjacent independent strips share only the source corner V. Relative to the grading
side the joint is either GAP (convex: strips diverge, uncovered wedge between the
end-normal edge of course 1 and the start-normal edge of course 2) or OVERLAP (concave:
strips cover the same plan region twice with DIFFERENT elevations, since each lies on
its own grading plane). Hence `memberMesh1 ∪ memberMesh2` is either non-covering or
double-valued — never a professional grading surface. Corner resolution must add exact
planar patch geometry (gap) or clip both members to a shared seam (overlap).

## 3. Why independent daylight endpoint connection is geometrically false (§35)

Member daylight endpoints Q1, Q2 each lie on the true target∩grading-plane-1 and
target∩grading-plane-2 loci respectively. The segments Q1→QM and QM→Q2 (QM = miter tie)
lie in vertical planes over plan segments that cross target triangles with their own
slopes — they satisfy neither grading plane nor target except at endpoints (on a
multi-plane target they cut through air/ground). Corner daylight MUST be derived from
target-TIN intersection inside each half-sector (§36–39). Grep audit for
`Q1→QM` triangles is a mandatory review item (§134).

## 4. Group source identity, ordering, direction, side (§4–6)

`CadGradingGroup` (definition only, new trailing `project.gradingGroups` key — it CANNOT
live in `gradings[]` because the sanitizer requires single-course shape):

```ts
{
  id, name,
  sourceFeatureLineId: string,
  sourceCourses: Array<{ vertexAId: string; vertexBId: string }>, // ordered, persisted
  targetSurfaceId: string,
  side: 'left' | 'right',
  criterion: GradingCriterion,          // ONE common criterion (fixed OR cut/fill)
  maxSearchDistance: number,            // ONE common value
  curveChordTolerance: number,          // ONE common value
  cornerMode: 'miter',                  // persisted though sole 20C mode
  closed?: boolean,
  layerId?: string; styleId?: string;
}
```

Persist definitions ONLY — never member results, seams, daylight, mesh, triangle ids,
status, cached results, or corner classifications. `sourceCourses` order is the
authoritative traversal: `course[i].B == course[i+1].A`, and `last.B == first.A` when
closed. Each pair resolves via the existing `resolveGradingSourceCourse` (either order,
reoriented to persisted A→B); insert-between or endpoint-delete ⇒ BROKEN_REFERENCE, no
index fallback. Creation accepts only a contiguous open chain or a complete/explicitly
closed cycle: no disconnects, no repeats, no branches, single Feature Line. Closed
source must additionally be finite, non-self-intersecting, no zero-plan-length courses
(analytic line/arc rules — never grade a self-crossing pad). LEFT/RIGHT are relative to
persisted traversal; Feature Line REVERSE reorients geometry (side enum never flips);
MIRROR follows the 20B persisted-direction convention. No `outward` semantic is stored;
UI "Suggest Exterior Side" may compute ring orientation and propose L/R, but commits L/R.

## 5. Corner classification (§24, §30)

Joint `i`: incoming `A→V`, outgoing `V→B`, shared XYZ V (Z continuity required by
Feature Line topology, else invalid source). Unit tangents T1, T2; side normals
N1 = sideNormal(T1), N2 = sideNormal(T2) (existing helper). Side sign s = +1 left, −1 right;
turn cross = T1.x·T2.y − T1.y·T2.x. Operational rule: **OVERLAP iff s·cross > 0,
GAP iff s·cross < 0, TANGENT iff zeroDelta-zero**. (Left-side grading turning left =
inside = overlap; turning right = outside = gap; mirrored for right.) TANGENT with
coincident grading planes ⇒ NO CORNER PATCH, merge continuously (after proving tangent
compatibility + no inconsistent overlap); else CORNER_COINCIDENT_PLANES.

## 6. Grading-plane construction + plane–plane miter seam (§25–29)

Generalize (do NOT duplicate) the 20B local-frame plane helper: course plane in world XY
is `P1(Q) = Zv + gs1·((Q−V)·T1) + g1·((Q−V)·N1)` with gradient `∇P1 = gs1·T1 + g1·N1`
(active cross-slope from the common criterion; cut/fill picks ONE side at V from the
single scalar `target(V)−source(V)`: positive→CUT both sides, negative→FILL both,
zero→tied; absent-but-required coverage ⇒ corner fails). Same for P2. Both pass through V.

If `∇P1 ≠ ∇P2` (zeroDelta-conditioned): equality locus `{Q : (∇P1−∇P2)·(Q−V) = 0}` is a
straight line through V; miter direction `M ⊥ (∇P1−∇P2)`. If equal: coincident (§28).
Ray selection (no screen heuristics): candidate ray R (unit) is valid iff
`R·N1 ≥ 0 AND R·N2 ≥ 0` (lies in both strips' grading-side half-planes). Exactly one of
±M valid ⇒ miter ray; both ⇒ CORNER_AMBIGUOUS; neither ⇒ inverted/invalid ⇒ fail closed.
Miter extent (§31, analytic, no `2×maxDistance` hacks): `Q(t) = V + t·M̂`, t ≥ 0;
`t ≤ maxSearchDistance / (M̂·N1)` and `t ≤ maxSearchDistance / (M̂·N2)`
(normal distances to each course must each satisfy `0 ≤ d ≤ maxSearchDistance`);
`tMax` = min of the applicable bounds. Miter target solve (§32–34): closed-form 1D root
per candidate triangle crossed by ray segment `[0, tMax]` (affine — NOT stepping,
NOT station sampling), nearest valid outward root wins, count recorded; discontinuous /
void-blocked nearest branch ⇒ CORNER_TARGET_GAP / CORNER_BRANCH_DISCONTINUITY, no jump.

## 7. Target-aware corner daylight (§36–39)

Miter splits the corner into two planar half-sectors. Sector i = strip half-planes
(`d_i ≥ 0`, station inside course span) ∩ half-plane of the directed miter line
containing the Ni ray (operational containment rule; linear boundaries: source corner,
course-normal edge, miter edge, max-distance wall). Inside each sector clip candidate
target triangles (existing grid/bbox discovery + Sutherland–Hodgman + `zeroDelta` +
`extractZeroSegments` — same machinery as `solveSpan`, no second solver) and build the
deterministic local daylight graph. Valid sector result: EXACTLY ONE continuous
target∩grading path from member daylight boundary endpoint to miter target point.
Zero / multiple / disconnected / self-crossing ⇒ FAIL CORNER, no guessing.
Gap patch (§40): two planar polygons `V → member daylight boundary → sector daylight
path → miter target → V`, one per grading plane, triangulated deterministically (no
Delaunay). Overlap trim (§41–42): clip both member meshes to the miter seam (exact
linear XY clip, Z interpolated on the owning grading plane); trim daylight to the same
corner path; no doubled surface remains. All corner Z: source V exact (§43); seam Z from
ONE canonical plane after agreement proof, `|Zplane1 − Zplane2|` within conditioning
(§44); every corner daylight vertex passes the 20B target-agreement gate (§45).

## 8. Unified mesh topology + daylight continuity (§46–50)

Merge trimmed member meshes + corner patches into ONE group mesh: deduplicate exact
shared XYZ, canonical deterministic face order, then the NORMAL `validateExplicitTinPayload`
(no relaxed validator). GO gate: finite XYZ, CCW, no dup faces, no illegal XY crossings,
no T-junctions, manifold internal edges, correct source + daylight boundaries — else
GROUP_NON_MANIFOLD, no partial CURRENT. Open group: one continuous daylight path
first-member → corners → last-member, exposed ends keep ordinary 20B normal boundaries
(§52). Closed group: one closed simple non-self-crossing daylight ring (canonicalized
first/last, no doubled closing vertex unless closed-Feature-Line extraction encoding
requires it); self-intersecting ring ⇒ FAIL, no bow-tie bake, no snap/hull self-heal
(§140). Zero-width: ALREADY_TIED member contributes no area (allowed iff topology stays
continuous); tied-at-V corner contributes no patch, neighbor paths meet at V (§53–54).
Cut/fill transitions inside members reuse 20B exactly; exact-tie corners keep a
zero-width hinge, never a blended slope, else fail with diagnostic (§55–56).

## 9. Curved-source / curved-corner approximation (§57–60)

20C uses the SAME linearized member source the 20B engine consumes (same tolerance,
same chord geometry — never re-linearize for corners). Any adjacent curved course ⇒
corner uses terminal linearized chords actually solved, result accuracy
CURVE_APPROXIMATED + CURVE_CORNER_APPROXIMATED diagnostic; still exact TIN intersection
against approximating planes; never claim true circular-corner exactness. Convergence
gate: coarse/medium/fine tolerance ⇒ sagitta respected, planes/daylight/area/volume
converge. Radial/conical styles: DEFERRED (documented future only, no disabled fake UI).

## 10. Worker ownership, revision, status, cache (§17–20, §63, §70–71)

`ggrev1:` hashes source id + ordered A/B pairs + oriented XYZ/arc content + target id +
target source revision + side + criterion + maxSearch + curve tolerance + corner mode +
closed/open. Excludes name/layer/color/opacity/flags (appearance never recalcs).
Lifecycle: source edit→NEEDS_RECALC; target edit→SOURCE_NOT_CURRENT;
target rebuild→NEEDS_RECALC; adjacency break→BROKEN_REFERENCE; definition edit→NEEDS_RECALC;
no auto-calculate. Status derived only (BUILDING … CURRENT + group diagnostics:
MEMBER_NO_SOLUTION / MEMBER_TARGET_GAP / CORNER_NO_SOLUTION / CORNER_AMBIGUOUS /
CORNER_INVERTED / CORNER_COINCIDENT_PLANES / CORNER_BRANCH_DISCONTINUITY /
CORNER_TARGET_GAP / CORNER_MAX_DISTANCE / GROUP_SELF_INTERSECTION / GROUP_NON_MANIFOLD /
CURVE_CORNER_APPROXIMATED). Session-only cache keyed `drawingId|groupId@ggrev`
(current + ≤1 stale; never persist; never show stale as current). ONE worker request per
Calculate: flat source-span snapshot + target CURRENT TIN ONCE + criterion/side/limits/
tolerance/mode; one target snapshot, one candidate structure reused across ALL members
and corners (§106 — N TIN transfers is the primary perf failure mode to avoid).
Stale worker: drawingId+groupId+revision+requestId ownership, late results discarded.

## 11. Strategy evaluation (§2: A vs B vs C)

**C. Naive independent-strip union — REJECTED.** §2/§3 above: provably leaves gaps on
convex joints and double-valued overlaps on concave joints; connecting daylight
endpoints with straight segments is geometrically false on multi-plane targets. No
evidence can rescue it — it contradicts the TIN intersection math 20B proved.

**A. Exact mitered piecewise-planar corner treatment — ADOPTED.** Every joint of two
straight courses with differing grading planes has an analytic miter seam (§6); each
half-sector is exactly one grading plane so the 20B clip→zero-locus→envelope pipeline
applies unchanged; gap patches and overlap trims are planar constructions on proven
planes. Collinear/tangent joints merge with no patch. Failure modes are enumerable and
fail closed (ambiguous/inverted/coincident/void/discontinuity). Cost: one batched worker
request, one target index, O(members + corners) sector solves.

**B. Radial/conical approximation — DOCUMENTED FUTURE ONLY.** A radial corner (cone apex
at V or arc-swept cross-slope) is a different grading MODEL, not an approximation of
miter: it changes design intent (slope varies around the corner) and needs its own
criterion semantics, TIN intersection derivation, and oracles. Nothing in 20C precludes
adding `cornerMode:'radial'` later behind the persisted mode field; 20C proves the
plumbing (sectors, seams, graphs, group worker) that a radial style would reuse.

## 12. Child-grading persistence decision (§ARCH: transient wins)

No architecture evidence supports persisted member `CadGrading`s: the kernel is pure and
callable with synthetic ids; caches/services key generically; groups need ordered
A/B chains and common target/side/criterion authority that per-child definitions would
contradict (child criteria vs group criteria, child status vs group status, N hidden
definitions per group, delete/group lifecycle ambiguity). DECISION: transient member
solves only (synthetic `groupId::courseIndex` identity inside one worker request, group-level
complete/agreement path). Standalone `CadGrading` behavior stays numerically identical
(member-equivalence oracle §103 pins it).

## 13. Refactor + layering prerequisites (from scout §8, binding on implementers)

1. `surfaceGradingCompute.ts` (~994 lines, >900 threshold) MUST be split before extension
   (AGENTS.md rule): extract `solveStraightChord` → `grading/solveStraightChord.ts`,
   shared clip → `grading/frameClip.ts`, arc driver → `grading/arcSolve.ts`; move the pure
   pipeline to `src/engine/cad/grading/` (worker-side location inverts engine→workers).
2. New batch request `GradingGroupComputeRequest {members[], target-once}` + group key
   (`drawingId|groupId@ggrev`) + group well-formedness guard; service/client/handler each
   need the group path alongside the single-course path.
3. New trailing `gradingGroups` project key + validator + backfill + key-order discipline
   (`cadPersistence.ts`, `cadDrawingFile.ts`); additive WNCAD key, no schema bump unless proven.
4. Export/unexported helpers needed by corners: `clipHalfPlane` (18U `scalarClip.ts:50`),
   `clipTrianglePair` (18I `overlap.ts:67`), `clipHalf` (18I `integrate.ts:99`) — wrap or
   export; no bisector/miter/orientation helper exists (write once in group engine).

## 14. Top numerical risks (carried openly, not hidden)

R1 (BIGGEST): interior-node 1e-12 snap vs 4ε agreement-gate floor trips
GRADING_DAYLIGHT_DISAGREE on fractional nodes (20B cases D/F fail at every scale) —
miter/corner nodes are GENERICALLY fractional. Mitigation path: corner-stitched nodes go
through the SAME gate; failures are honest CORNER_* diagnostics, never silent. If oracles
show systematic (not sporadic) corner failure, the gate/snap policy needs its own
evidence-backed fix — 20C does not loosen tolerances to pass.
R2: kink-joint crossover `BRANCH_DISCONTINUITY` (~1 ulp) — corners manufacture kinked
loci by construction (20B case C fails at every scale); sector graphs must expect and
classify these, not crash.
R3: axis-aligned graze ⇒ BRANCH (benchmarks need jitter); square-pad oracle edges are
axis-aligned by construction — prove it passes or document the jitter-free fix.
R4: 20B F-leg `~6.4s @100k, exponent ~1.45–1.48` is a disclosed restriction 20C inherits;
fix only with evidence, never by tolerance loosening.
R5: grid rebuilt per call (2× single, per-chord for arcs) — the group worker MUST build
the index ONCE and reuse it (§106); this is where the 20C perf win comes from.

## 15. Performance plan (§106–110)

One request / one TIN / one index (§10). Benchmark matrix: targets 1k/10k/50k/100k ×
groups 4/20/100(/1000) × cases A–G (§107); ACTUAL 100k runs for 4/20/100-course groups
with candidate counts recorded (§108); report prep/index/member/corner/locus/clip/merge/
validate/total + output sizes (§110). No extrapolation-only evidence.

---

## 16. Implementation wave map (for orchestrator dispatch, in order)

1. **Engine kernel**: split `surfaceGradingCompute.ts` per §13.1 with zero numerical change
   (20B suites must stay bit-identical); expose pure batch kernel.
2. **Group model**: types + authoring validators (contiguity, closed-cycle, common everything)
   + `ggrev1` + status + session cache + group corner-math module (planes/seam/ray/extent/
   classification per §5–6) with analytic oracle tests (square-pad §80 geometry pre-proved here).
3. **Group compute + worker**: sector clip/locus/graph, gap patch, overlap trim, mesh merge,
   daylight assembly, batched worker op + service path, agreement gate.
4. **Project integration**: persistence/WNCAD/transactions (GRADEGROUP/GG + group commands)/
   revision lifecycle/reverse-mirror oracles.
5. **UI + export**: manager/Toolspace/ribbon/properties/side-preview/corner ghosts/inquiry-CSV/
   display/export seams (SVG/PDF/DXF/LandXML/WNCAD dispositions)/Extract/Bake/provenance.
6. **Evidence**: full oracle battery (§80–105), 100k perf, browser QA, 3-resolution visual QA,
   reviewer gate, PR (NO merge).
