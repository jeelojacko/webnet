# Phase 20E Architecture Audit — per-course criteria + planar pads

Baseline: `500928c20a6f8e40fe0339a85176f6d920fa5cd4` (= mission SHA, no advance).
Branch: `feat/cad-grading-per-course-planar-pads`.

## 1. Current common-criterion authority

- `CadGradingGroup.criterion` (`src/engine/cad/grading/gradingGroupTypes.ts:32-48`) is the single group value.
- Validated at creation (`gradingGroupAuthoring.ts:135-149`), edited via `editGroupCriteria` + `groupEditCriteriaCommand` (`cadTransactionsGradingGroupCommands.ts:137-164`).
- `GradingCriterion` (`gradingTypes.ts:14-16`): `{fixed gradeRatio} | {cut-fill cutGradeRatio, fillGradeRatio}`. Unchanged in 20E.

## 2. Every consumer of group.criterion (12)

Engine/worker: `surfaceGradingService.ts:285`, `surfaceWorkerHandler.ts:526,545`,
`gradingGroupResolve.ts:185`, `gradingGroupRevision.ts:84` (via `criterionText`),
`gradingGroupCompute.ts:250,292,362`, `gradingGroupPersistence.ts:17`,
`gradingGroupAuthoring.ts:125,141,151-155`, `cadTransactionsGradingGroupCommands.ts:104,142-150`.
UI/report: `cadGradingGroupSnapshot.ts:199`, `cadGradingGroupReport.ts:53,137`,
`CadGradingGroupProperties.tsx:20`, `CadGradingGroupToolspace.tsx:27`,
`CadGradingGroupManager.tsx:387,448`, `cadGradingGroupDisplay.ts:283,416-420` (ghost seam, fixed only).

## 3. Transient member flow

`GroupSolveInput.criterion` threaded verbatim into each chord solve
(`gradingGroupCompute.ts:292-296` → `solveStraightChord`). No `CadGrading` children
materialized. 20E: resolve per-member effective criterion in `gradingGroupResolve`,
pass per-member into compute; `solveStraightChord` already takes criterion per chord.

## 4. Corner planes + hidden same-g assumption — CONFIRMED

- `gradingPlaneGradient(src, side, gCross, gsLong)` (`gradingCornerMath.ts:67-86`) is
  already `gCross`-parameterized; `miterSeam` operates on ∇P1, ∇P2 with no equal-slope
  assumption.
- Caller collapses: `crossGradeAtV` (`gradingGroupCompute.ts:230-238`) computes ONE
  `gCross` at V, passed to BOTH planes (`:362-365`).
- Secondary mismatch: member strip classifies cut/fill at mid-span
  (`solveStraightChord.ts:186-197`) but corner classifies at V (`:232-237`).
- 20E fix is caller-local: two `gCross` values (one per adjacent effective criterion),
  each classified at V per §15. `miterSeam`/`selectMiterRay`/`miterExtent` unchanged.
- Collinear different-criteria courses (§76): currently `TANGENT` → no patch; with
  different planes must derive seam or fail closed — explicit handling required.

## 5. Cut/fill classification

`cutFillSideAtCorner` (`gradingCornerMath.ts:181-190`): target−source >0 CUT, <0 FILL,
zeroDelta TIED. Same scalar sign serves both members at V (§16). Fixed members need
no classification (§15). Tied (d=0) reuses zero-width logic (§17).

## 6. Revision architecture

`buildGroupRevision` → `ggrev1:<fnv1a>` (`gradingGroupRevision.ts:78-92`) over source
courses (A>B + oriented XYZ/arc), target id@rev, side, criterion, search, chord,
corner mode, open/closed; 1e-9 quantization. Appearance excluded.
20E: include canonical sparse overrides (sourceCourses order) in hash; keep hash
byte-identical when overrides absent (legacy compat).

## 7. Source-course identity

`GradingGroupCourse {vertexAId, vertexBId}`; `resolveGradingSourceCourse`
(`gradingCourseFrame.ts:214-260`) matches either order, reorients to persisted A→B.
Insert mints new id → `BROKEN_REFERENCE` (no migration, §32). Reverse rides ids
along → ggrev1-invariant (§33). Copy mints fresh ids.

## 8. WNCAD implications

Additive optional `project.gradingGroups` key, document schema v2, no 20C/20D bump.
20E: additive optional `courseCriteria` array; sanitizer drops orphans/duplicates with
diagnostic; legacy absent field valid. No expanded effective copies, no derived
results persisted. LandXML: groups `NOT_APPLICABLE`/`SKIPPED_ENTITY` — unchanged.

## 9. Current 20D ring re-derivation + drift

`deriveSourceRing` (`designPatchRing.ts:80-119`) re-resolves the Feature Line and
re-calls `linearizeGradingArc`, then `verifyRingAgainstMesh` (`:237-260`) exact-string
compares against the mesh. Two different reconstructions of the same arc
(`center+r·(cosθ,sinθ)` vs `start+t·u`) differ by sub-ulp; exact-string gate then
fails with `DESIGN_PATCH_RING_MESH_MISMATCH`. Axis-aligned pads round-trip exactly;
arcs need not.

## 10. Canonical capture plan

`MemberSolve.chords` / `stitched.sourcePts` (`gradingGroupCompute.ts:83-96,145-180,302-315`)
are the exact source discretization the solver consumed and `mergeGroupTriangles`
interned. Assemble `sourceBoundaryPoints?: number[]` (session-only, never persisted)
at `:318-330` by walking members in order, dropping each member's final point
(next member owns it; closing junction for closed). Design Patch consumes this;
`deriveSourceRing` remains as diagnostic/fallback only. No 20C numeric change:
pure observation/export, candidate order untouched.

## 11. Flat-pad proof (current)

`checkFlatRing` (`:193-206`) strict `!==` Z equality, machine-only. `buildPadInterior`
(`designPatchBuild.ts:54-79`) earClips XY ring, lifts to padZ. `mergePadWithGrading`
(`:177-247`) exact-XYZ interning, boundaryCycleCount 2→1, stock validator.

## 12. Planar-interior proof

If all ring XYZ satisfy z = ax+by+c, any non-crossing triangulation using actual XYZ
lies on the same plane (each triangle's vertices coplanar ⇒ triangle ⊂ plane).
Hence earClip on XY + original XYZ needs no Steiner Z and is diagonal-invariant.
Non-coplanar ⇒ BLOCK (`DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED`); no averaging,
no least-squares, no Coons, no tolerance-based "planar enough".

## 13. Numerical planarity policy

- Deterministic well-conditioned triple: anchor → max-separated second XY vertex →
  third maximizing |plan-area|; derive in LOCAL frame (origin = first ring vertex).
- Machine-only tolerance anchored to local plan extent
  (e.g. `4ε·max(1,|localΔx|,|localΔy|,|z|)`); never 1mm/5mm/0.01ft.
- Works at E≈2M/N≈7M via local origin; persist nothing (plane re-derived).
- Do NOT take first 3 vertices (may be near-collinear); no randomness.

## 14. Transform behavior

2D similarity, Z untouched; ratios dimensionless re-applied to transformed plan
(physical slope changes by 1/scale — honest, document). Results session-only keyed
by ggrev ⇒ transform invalidates to NEEDS_RECALC. Overrides are refs+ratios: no
coordinate transform. Derived plane coefficients never persisted/transformed.

## 15. Provenance compatibility

`interiorPolicy:'flat-source'` sole value; strict-write/read-tolerant. 20E adds
`'planar-source'` as additive union member + normalizer branch; flat patches
byte-identical. No `CadDesignPlane` resource (§94); no coefficients persisted
(recomputable from snapshot).

## 16. Performance risks

- Override lookup: single `Map<"A>B", criterion>` built once per resolve; never
  `.find()` in loops. Pre-existing O(n²): `resolveGradingSourceCourse` filter
  (`gradingCourseFrame.ts:236-239`), `validateClosedGroupLoop`, `validateSourceRing`,
  earClip worst-case. Do not add new quadratic paths.
- Group compute reuses one target query + candidate set; per-course criterion adds
  O(members) corner work only.
- Benchmarks required (§84-88): 4/20/100/1000 courses × 0/25/100% overrides;
  patch 4/20/100/1000 verts; 100k-target workflow; WNCAD bytes/override.

## 17. Decision: A vs B vs C

- **A (group default + sparse overrides): preferred.** Additive, compact, one
  precedence rule, revision-neutral when empty, O(1) lookup via key map.
- **B (fully materialized per-course): rejected.** Loses default-propagation
  semantics; verbose persistence.
- **C (separate CadGrading children): rejected.** Re-litigates 20C §12 (N hidden
  definitions, authority conflicts, lifecycle ambiguity); frozen one-course
  `CadGrading` shape is one-course-only.

## 18. No hidden capability

Searched `courseCriteria`, `grading override`, `planar pad`, `design plane`,
`coplanar`, `plane pad`, `grade override`: all absent (coplanar only in unrelated
surface-compose/analysis). Clean extension point.

## 19. Term search / regression anchors

- 20D flat oracle must stay exact: grading area 9600, patch 19600, Fill 436000/3,
  center 10 (§105). Same-slope square: 20m offset, 20√2 miter, 140×140 daylight (§19).
- Adjustment parity 25/25 untouched (§115). No Grade-to-Distance/Elevation,
  no continuous transitions, no radial corners, no boolean repair (§97-101).
