# B0 decision — CAD circle representation

- Branch: `research/cad-circle-representation-decision`, baseline `50a5c720`.
- Method: study/evidence/policy ONLY. Zero `src/` changes.
- Inputs: `forensics.md`, `arc-full-sweep-study.md`, `circle-entity-study.md`,
  `snaps-intersections.md`, `dxf-transform-persistence.md`, corpus
  `docs/evidence/cad-circle-representation/corpus.json` (sha256
  `5cbb97b06606e8f5c1a91c5a4b7551afaf10b8f8a132034a13e6c35eed22806f`; fields
  `forensics.representationVerdict` / `b1FullSweepArcAssessment` /
  `aFirstClassCircleAssessment` are verdict-aligned), study
  scripts `scripts/cadCircle{StudySweep,StudyAdapter,StudyModes,StudyExecution,CorpusRegen}.ts`,
  pins `tests/cad_circle_study_sweep_b1b2b3.test.ts` +
  `tests/cad_circle_study_robust_snap.test.ts` +
  `tests/cad_circle_study_execution.test.ts` (**28/28 green**).

## Verdict (exactly one)

**GO_FIRST_CLASS_CAD_CIRCLE_ENTITY.**

Persisted law: `{type:'circle', centerX:number, centerY:number,
radius:number}` — finite center, finite radius above the existing CAD
geometric floor, no start/end/sweep fields, no implicit conversion
from/to `CadArcEntity`. Full-sweep arc representation is explicitly
rejected (below). No automatic legacy-arc migration: no production
fixture, example, or corpus file contains an intentional 0/360 drafting
circle (only test synthetics, which stay arcs). Circle B1 construction
scope = Center/Radius + Center/Diameter; 2-Point/3-Point and tangent
modes deferred. Advanced edit commands may explicitly refuse until later.
Native DXF CIRCLE export required. Circle stays disabled until B1
implementation lands.

## 1. GO gate: 10 criteria

GO requires all 10. `PASS` = proven by this study; `PASSΔ` = pass via a
named, bounded, parameter-free delta specified in `circle-entity-study.md`
§6 / `dxf-transform-persistence.md` (implementation work, not unresolved
policy — a criterion may PASS when its delta is fully specified even though
not implemented). `FAIL` = contradicted. Global missing model-space DXF
import is NOT_APPLICABLE to a Circle GO (the dxf/ directory is export-only;
no general CAD import path exists for any entity).

| # | Criterion | B1 (0/360 arc) | A (circle kind) |
|---|---|---|---|
| G1 | Single unambiguous persisted identity | **FAIL** (persisted `0/360`, but block expansion normalizes the child to `0/0` — measured; identity not preserved through blocks) | PASS (`{cx,cy,r}`; block nesting allowed with fail-closed non-uniform scale) |
| G2 | Parameter/sweep semantics unambiguous incl. degenerate | **FAIL** (block child `0/360`→`0/0`; 30°→`30/30`; sweep lost) | PASS (no sweep) |
| G3 | Bounds/topology agreement across spatial paths | **FAIL** (a `0/0` block child takes B3's zero-sweep path, under which a degenerate point claims the full-circle box — worse than point-like: extent lies, plus degenerate SVG) | PASS (center±r single-valued everywhere incl. blocks) |
| G4 | Snap/handle semantics: no circle-meaningless kinds leak | **FAIL** (entity emits 2 coincident `endpoint` [1 observable after dedupe] + 1 observable `arc-midpoint`; grips emit 3, 2 coincident `arc-start`/`arc-end` leak, no grip dedupe) | PASS (center/quadrant/nearest/tangent/perp only) |
| G5 | Intersection/tangency kernels complete + sweep-independent | PASS | PASS |
| G6 | Transform semantics: similarity-closed, affine refused, deterministic | **FAIL** (block route mean-scales `50`→`75` for `scaleX=2,scaleY=1`, no refusal; entity route refuses affine but `refusalCoversBlockRoute=false`) | PASSΔ (direct entity similarity-closed; block contract settled: circle may nest, non-uniform block scale fails closed — specified, not silent) |
| G7 | Interchange (DXF) exact | **FAIL** (correct ARC bytes but host normalization UNEXECUTED; pretending it is just-an-arc outsources circle semantics to the host) | **PASSΔ** (native model-space `CIRCLE` emitter specified: `model.circles` + groups 10/20/30/40 reusing the paper writer; general DXF import is globally absent → NOT_APPLICABLE, not a Circle blocker) |
| G8 | Render/SVG exactly one correct full-ring path | PASS (executed: B1/B2 two-180° A segments; B3 degenerate single) | PASSΔ (trivial; emit circle) |
| G9 | Downstream consumer surface bounded, enumerated, no silent arc assumptions | **FAIL** (snap subsystem + endpoint-based trim/extend/fillet/reverse/offset untested on `start==end`) | PASSΔ (all 32 dispatch sites classified SUPPORT/GENERIC/REFUSAL/N-A in `circle-entity-study.md` §6; grep inventories collapsed to semantic sites; refusals deterministic) |
| G10 | No new epsilon/hidden default/unspecified schema; bounded delta nameable | PASS (no schema change) | PASSΔ (additive v2 kind, no version bump, no migration — specified in `dxf-transform-persistence.md` §4-5; no new epsilon) |

B1 fails **G1, G2, G3, G4, G6, G7, G9** and is explicitly rejected: the
sweep identity does not survive blocks, snaps/grips leak circle-meaningless
kinds, endpoint commands need scattered special cases, and DXF correctness
depends on host interpretation. A passes all 10 (G6/G7/G9/G10 via the
specified deltas). B2 fails additionally G2/G7
(emits un-normalized 390); B3 fails G2/G3/G4/G7/G8 (zero-sweep all-true
predicate, full box for a point, SVG empty vs sheet/PDF full circle).

## 2. Why B1 is not unambiguous everywhere

The B-choice burden is "name the exact encoding and prove it unambiguous
everywhere including the B3 bounds surprise and SVG collapse". B1 clears the
**direct-entity** sweep/bounds/SVG parts (all executed this round):

- encoding is exactly `startAngleDeg=0, endAngleDeg=360`;
- `cadSignedSweepDeg(0,360)=360`; on-sweep is all-true (correct full ring);
- both bounds paths return the correct full box for the direct entity; the B3
  surprise does not apply to a direct B1 entity (B3 is a separate, rejected
  encoding);
- SVG already renders the full ring via the executed two-180°-arc branch
  (`arcPath` B1 `arcSegments=2`; `SurveyCadPreview.geometry.ts:236-263`).

But B1 is **not** unambiguous everywhere: the block route breaks it, and the
snap/consumer gaps remain.

1. **Block expansion loses the sweep (measured).** `expandBlockReference` on a
   `0/360` child returns `0/0` (`cadNormalizeAngleDeg(360)=0`); a 30° insert
   returns `30/30`. The persisted identity therefore is not preserved through
   blocks (G1/G2/G3 fail), and a `0/0` block child then exhibits B3's
   zero-sweep behavior. Separately, a non-uniform block scale
   (`scaleX=2,scaleY=1`) silently mean-scales the radius `50`→`75` with no
   refusal (`blockRoute.applied=true`, `refused=false`), while the entity
   route refuses `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` — the refusal does not
   cover the block route (`refusalCoversBlockRoute=false`, G6 fail). The exact
   requirement is fail-closed or convert-to-ellipse on the block route; an
   ellipse is not persistable in A or B1.
2. **Snap/handle leak (executed emitted-vs-observable).** A full-sweep entity
   emits 2 coincident `endpoint` candidates (1 observable after
   `dedupeCandidates`) + 1 observable `arc-midpoint`, center 1, quadrant 4,
   nearest 1; block refs emit ≥2 endpoints merged by dedupe; grips emit 3 with
   **2 coincident `arc-start`/`arc-end` leaked** (no grip dedupe).
   `arc-midpoint` stays observable. Suppressing the circle-meaningless kinds
   for every full-sweep arc means editing the snap subsystem, annotation
   anchoring, labels, and grips — a cross-cutting change, not one bounded site.
   The mission invariant "endpoint/midpoint must never leak for circles" is
   violated today even after real snap dedupe.
3. **DXF.** Executed bytes are `ARC 50=0`/`51=360`, no `CIRCLE`; treating
   `0/360` as a valid circle relies on host normalization that remains
   UNEXECUTED.
4. **Endpoint-based commands.** trim/extend/fillet/reverse/offset operate on
   arc endpoints; their behavior on a `start==end` arc is UNEXECUTED, as is
   annotation/dimension anchor (arc-center/arc-endpoint) association.

Because a full-sweep arc needs these scattered special-cases to behave as
a circle, B1 is rejected and the first-class kind is authorized.

## 3. Why A is GO (delta specified, not unstudied)

A removes the degeneracy by construction (clean snap set, trivial bounds,
similarity-closed, no sweep ambiguity) and its `{cx,cy,r}` adapter matches B1
outputs — the geometry is proven and needs no new kernels. The former
objections are each closed by a specified delta (not by implementation):

- **Consumer surface**: all 32 dispatch sites classified per-site
  (SUPPORT/GENERIC/REFUSAL/N-A) in `circle-entity-study.md` §6; grep
  inventories collapsed to semantic sites. Deterministic refusals (TRIM/
  EXTEND/FILLET/REVERSE/OFFSET/parcel/feature conversion, curve tables)
  are valid bounded contracts, not gaps.
- **DXF**: native model-space `CIRCLE` emitter specified (`model.circles` +
  groups 10/20/30/40, reusing the paper-space writer); general DXF import
  is globally absent and NOT_APPLICABLE.
- **Schema**: additive `circle` kind inside project version 2, no version
  bump, no migration (no intentional 0/360 drafting circle exists in any
  production fixture, example, or corpus file — only test synthetics, which
  stay arcs). Validators enumerate kinds and get explicit arms
  (`dxf-transform-persistence.md` §4).
- **Blocks**: circle may nest as a block child; uniform/rotation/mirror/
  translation supported; non-uniform block scale fails closed (no silent
  mean-scale, no ellipse conversion in B1).

What was 'large and unspecified' is now an enumerated, bounded delta.

## 4. Formerly unresolved inputs — all closed

1. **Persisted identity** — decided: first-class `circle` kind (this
   verdict). Additive inside version 2; no migration; test synthetics with
   0/360 arcs stay arcs.
2. **Full-sweep snap/handle + block contract** — closed for B1 by rejection;
   for A there is no sweep to preserve and no endpoint/midpoint to suppress
   (never emitted). Block contract: nest allowed, non-uniform fails closed.
   Annotation/dimension anchors: center + rim point (specified in
   `snaps-intersections.md`).
3. **First-class consumer contract** — enumerated per site in
   `circle-entity-study.md` §6 (no silent arc treatment anywhere).
4. **Construction modes for B1** — Center/Radius + Center/Diameter (unchanged).

No remaining semantic choice requires further policy. What remains is
implementation, review, and tests — the B1 plan in `phase-b1-plan.md`.

## 5. What is authorized now

- The **B1 slice scope** (Center/Radius + Center/Diameter) is settled and
  recorded in `phase-b1-plan.md` — now implementable against the
  first-class circle contract.
- **Authorized**: first-class `CadCircleEntity` production implementation
  per `phase-b1-plan.md` (a future phase; this study changes no `src/`).
- Circle stays disabled until B1 lands. No production `src/`, no schema
  version change, no tolerance, and no default is changed by this phase.
