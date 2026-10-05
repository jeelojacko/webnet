# B0 decision — CAD circle representation

- Branch: `research/cad-circle-representation-decision`, baseline `50a5c720`.
- Method: study/evidence/policy ONLY. Zero `src/` changes.
- Inputs: `forensics.md`, `arc-full-sweep-study.md`, `circle-entity-study.md`,
  `snaps-intersections.md`, `dxf-transform-persistence.md`, corpus
  `docs/evidence/cad-circle-representation/corpus.json` (sha256
  `e7bde6fa4ea4ff7aae00ef75fcf9562d60dc3ca4ad6ee2f0076f606460b1c1d9`; fields
  `forensics.representationVerdict` / `b1FullSweepArcAssessment` /
  `aFirstClassCircleAssessment` are verdict-aligned), study
  scripts `scripts/cadCircle{StudySweep,StudyAdapter,StudyModes,StudyExecution,CorpusRegen}.ts`,
  pins `tests/cad_circle_study_sweep_b1b2b3.test.ts` +
  `tests/cad_circle_study_robust_snap.test.ts` +
  `tests/cad_circle_study_execution.test.ts` (**28/28 green**).

## Verdict (exactly one)

**POLICY_REQUIRED_CIRCLE_REPRESENTATION.**

No candidate satisfies the GO gate. The persisted circle identity — a
full-sweep `CadArcEntity` (B1) versus a first-class `circle` kind (A) — and
its snap/consumer/persistence contract are unresolved policy inputs. B1 is
geometrically feedable but not unambiguous everywhere; A is semantically
clean but its identity/consumer/schema delta is large and unspecified. A
representation policy is required before any B1 implementation.

## 1. GO gate: 10 criteria

GO requires all 10. `PASS` = proven by this study; `PASSΔ` = pass only via a
named but unimplemented delta; `FAIL` = not proven / contradicted.

| # | Criterion | B1 (0/360 arc) | A (circle kind) |
|---|---|---|---|
| G1 | Single unambiguous persisted identity | **FAIL** (persisted `0/360`, but block expansion normalizes the child to `0/0` — measured; identity not preserved through blocks) | PASS (`{cx,cy,r}`; block-expansion arm unstudied) |
| G2 | Parameter/sweep semantics unambiguous incl. degenerate | **FAIL** (block child `0/360`→`0/0`; 30°→`30/30`; sweep lost) | PASS (no sweep) |
| G3 | Bounds/topology agreement across spatial paths | **FAIL** (a `0/0` block child takes B3's zero-sweep path, under which a degenerate point claims the full-circle box — worse than point-like: extent lies, plus degenerate SVG) | PASS (center±r; block arm unstudied) |
| G4 | Snap/handle semantics: no circle-meaningless kinds leak | **FAIL** (entity emits 2 coincident `endpoint` [1 observable after dedupe] + 1 observable `arc-midpoint`; grips emit 3, 2 coincident `arc-start`/`arc-end` leak, no grip dedupe) | PASS (center/quadrant/nearest/tangent/perp only) |
| G5 | Intersection/tangency kernels complete + sweep-independent | PASS | PASS |
| G6 | Transform semantics: similarity-closed, affine refused, deterministic | **FAIL** (block route mean-scales `50`→`75` for `scaleX=2,scaleY=1`, no refusal; entity route refuses affine but `refusalCoversBlockRoute=false`) | PASSΔ (direct entity similarity-closed; block route shares the gap and is unstudied) |
| G7 | Interchange (DXF) exact + round-trippable | **FAIL** (executed bytes: ARC `50=0`/`51=360`, no `CIRCLE`; host normalization UNEXECUTED) | **FAIL** (no model `CIRCLE` emitter/re-import; `dxfExportModel.ts:99` has no `circles`) |
| G8 | Render/SVG exactly one correct full-ring path | PASS (executed: B1/B2 two-180° A segments; B3 degenerate single) | PASSΔ (trivial; emit circle) |
| G9 | Downstream consumer surface bounded, enumerated, no silent arc assumptions | **FAIL** (snap subsystem + endpoint-based trim/extend/fillet/reverse/offset untested on `start==end`) | **FAIL** (26 `switch(entity.type)` inventory + 33 arc-case files + fillet/trim/reverse/offset/parcel/tables unstudied) |
| G10 | No new epsilon/hidden default/unspecified schema; bounded delta nameable | PASS (no schema change) | **FAIL** (new persisted kind + schema/round-trip/revision unstudied) |

B1 fails **G1, G2, G3, G4, G6, G7, G9**. A fails **G7, G9, G10**. B2 fails additionally G2/G7
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

Because satisfying the invariant needs these scattered special-cases, the
mission's rule applies: choose A or POLICY_REQUIRED.

## 3. Why A is not yet GO

A removes the degeneracy by construction (clean snap set, trivial bounds,
similarity-closed, no sweep ambiguity) and its `{cx,cy,r}` adapter matches B1
outputs — the geometry is proven and needs no new kernels. But:

- there is **no persisted `circle` kind**: adding one touches an **inventory**
  of **26 `switch (entity.type)` sites** (21 files) and **33 files with
  `case 'arc'`** (27 in `src/engine/cad`), plus engine-scope consumer greps
  naming fillet 11 / trim 72 / reverse 29 / offset 93 files. These are
  candidate consumer surfaces, **untested — an inventory, not a list of
  failures**;
- there is **no model-space DXF `CIRCLE`** emitter or re-import;
- a new persisted kind means a schema/round-trip/revision/undo/clipboard
  delta and an equivalence rule against a legacy 0/360 arc;
- none of that is specified or tested by this study.

A is the semantically correct identity, but its identity/consumer/schema
delta is a large, enumerated-in-principle, **unspecified** surface — not a
named bounded delta. It therefore fails G7/G9/G10.

## 4. Unresolved policy/design inputs (the decision to make)

1. **Persisted identity** — adopt a first-class `circle` kind (A) or keep
   full-sweep arcs (B1)? This fixes the schema/migration and legacy-arc
   canonicalization question.
2. **Full-sweep snap/handle + block contract** — the complete set of sites
   where `endpoint`/`midpoint`/`arc-midpoint`/grips are suppressed for a
   circle, **and** the block-route contract (expansion must preserve or refuse
   a lost sweep; non-uniform block scale must fail closed or convert) if B1 is
   chosen. Annotation/dimension anchor behavior on a full-sweep arc is
   UNEXECUTED.
3. **First-class circle consumer contract** — per-site arm-or-refusal for the
   26 switches and the trim/fillet/reverse/offset/parcel/table/DXF/spatial/
   properties paths, plus the DXF `CIRCLE` emitter/re-import round-trip, if A
   is chosen.
4. **Construction modes for B1** — the slice itself is already bounded
   (Center/Radius + Center/Diameter); TTR/TTT deferred.

## 5. What is authorized now

- The **B1 slice scope** (Center/Radius + Center/Diameter) is settled and
  recorded in `phase-b1-plan.md`.
- **No** representation is authorized for implementation. Circle stays
  disabled until the policy above is decided and B1 lands.
- No production `src/`, no schema, no tolerance, and no default is changed by
  this phase.
