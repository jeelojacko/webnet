# Phase 19C Curved-Parcel Architecture Audit (§2)

Branch: `feat/cad-curved-parcel-courses`
Baseline: `e017c47f` (= origin/main at mission creation, PR #119 merge — exact match, no advance).
Status: audit only. No production code changed by this document.
Recon: read-only scout pass over `e017c47f` tree; all references `file:line`.

## 1. Current parcel model (straight-only, proven)

- `CadParcelEntity` — `src/engine/cad/cadTypes.ts:344-356`: `vertices`, `vertexLabels`,
  `parcelName`, `courseIds?` (`courseIds.length === vertices.length`), cached
  `areaSquareMeters?`, `perimeterMeters?`, `closureDeltaX/Y?`, `closureDistanceMeters?`.
  **No curve/bulge/courseGeometry field exists.**
- `src/engine/cad/cadParcelCourses.ts` (210 lines) is the single course seam:
  `buildParcelCourseId(s)` (`:33,:37`), `hasValidCourseIds` (`:40`),
  `ensureParcelCourseIds` (`:51`, deterministic trailing-key backfill),
  `isSameVertex` 1e-9 (`:59`), `buildParcelRing` (`:69`, adjacent-dup sanitize +
  explicit close), `resolveCadParcelCourses` (`:94`, straight inverse per adjacent
  vertex pair), `insertParcelCourseVertex` (`:128`, retires old id, mints two —
  **exported but unwired in `src/`**, only referenced by
  `tests/cad_survey_course_identity_19a.test.ts`), `buildParcelCourseReportSummary` (`:183`).
- Naming collision (pre-existing): a second exported `resolveCadParcelCourses` in
  `src/engine/cad/cadSurveyExportTables.ts:212` wraps the canonical one and attaches
  `curve` markers. 19C must not widen this collision; the generalized resolver lives
  in `cadParcelCourses.ts` and the adapter re-maps.
- Only curve-awareness in tree: `curvedMarkersFor` / `parcelHasCurvedCourses`
  (`cadSurveyExportTables.ts:171,190`) read `parcel.elements[].kind==='arc'` through an
  unsafe cast (no such field on the type), consumed solely by
  `cadParcelLegalDescription.ts:145` → `{ok:false, "curved courses … deferred"}`.
  Fail-closed legal text only. Nothing else knows about curves.

## 2. Direct `parcel.vertices` consumers (all assume vertex-pair = straight course)

Course seam: `cadParcelCourses.ts:42,55,71,186`. Split/layout kernels:
`cadTransactionsParcelAutoLayoutCommand.ts:97,109,112`, `cadCogoParcelSplit.ts:34,136,237`,
`cadCogoParcelLayoutSlide.ts:43,160`, `cadCogoParcelLayoutSwing.ts:23,61,209`,
`cadCogoParcelFrontage.ts:118-119`, `cadCogoParcelCornerGeometry.ts:37,73,94,124`,
`cadCogoParcelAutoLayoutSingle.ts:74,87`, `.../Helpers.ts:14`, `.../Sequence.ts:54,104,154`,
`cadCogoParcelFrontagePathAutoLayout.ts:64`,
`cadCogoParcelFrontageReferenceAutoLayout.ts:56`,
`cadCogoParcelFrontageReferenceCornerInfill.ts:76,228`,
`cadCogoParcelLayoutConstraints.ts:211-224`, `cadCogoParcelLayoutDrafts.ts:48,101,138,296`,
`cadCogoParcelLayoutEvaluation.ts:33-43,76-91,205`,
`cadCogoParcelLayoutGeneratedPrimitives.ts:140,182,236,273,308`,
`cadCogoParcelLayoutPath.ts:51`, `cadCogoParcelLayoutSharedPrimitives.ts:118,225`.
Transforms/clipboard: `cadTransactionsEntityTransforms.ts:39,247,301`,
`cadTransactionsClipboardCommands.ts:92,99`, `cadTransformGeometry.ts:126-127`.
Render/bounds: `cadSpatialBounds.ts:159-166`, `cadRenderer.ts:185-191,1159`.
Tables/reports: `cadSurveyTables.ts:416`, `cadSurveyExportTables.ts:323`,
`cadSurveyTableDerive.ts` (tag anchor), `cadParcelLegalDescription.ts:153`,
`cadProperties.ts:252,369`. Validation: `cadCogoParcelClosedBoundary.ts:24,36`,
`cadCogoParcelDiagnostics.ts:63,90,91`. Surface: `cadSurfaceRevision.ts:61,69`
(ring source). Preview: `useSurveyCadCommandPreview.ts:166`,
`surveyCadWorkspaceParcelLayout.ts:167,170`.

## 3. Area / perimeter / closure (straight-only)

- `cadBuildParcelClosureSummary(vertices)` — `cadCogoParcelGeometrySummaries.ts:60-105`:
  shoelace `signedDoubleArea`, `perimeterMeters += cadDistance` straight legs, centroid,
  closure delta. `cadBuildParcelReportSummary` (`:135-197`): per-leg inverse bearings/distances.
- Primitives: `cadPolygonSignedAreaDouble` / `cadPolygonAreaSquareMeters` /
  `cadPointInPolygon` (ray-cast even-odd, edge-hit = inside) /
  `cadPointStrictlyInPolygon` / `normalizeParcelPolygonVertices` —
  all `cadCogoParcelGeometryPrimitives.ts:55-137`.
- **No arc-segment area/perimeter path exists.** Perimeter is purely chord-summed.
- 19C plan: keep shoelace chord-polygon term, add exact signed circular-segment
  contributions per arc course: `segment = 0.5·R²·(sweepRad − sin(sweepRad))` with the
  sign of traversal; perimeter uses `|arc length|`. Reuse Neumaier/compensated
  summation where the tree already does (to be pinned at implementation).

## 4. Split engines (retain, generalize kernels — NOT new features)

- `PARCEL_SPLIT` — `cadTransactionsParcelBasicCommands.ts:138-296`; kernel
  `cadBuildParcelSplitByLineDraft` (`cadCogoParcelSplit.ts:30`, requires exactly 2
  `cadSegmentIntersection` hits `:47-84`); children `:227`.
- `PARCEL_SPLIT_BEARING` — `cadTransactionsParcelSplitCommands.ts:19-180`; kernel
  `cadBuildParcelSplitByBearingDraft` (`:121`); ids `:108,130`.
- `PARCEL_SPLIT_AREA` — `cadTransactionsParcelSplitCommands.ts:185-340`; kernel
  `cadBuildParcelSplitByAreaDraft` (`:231`, 1° sweep + 3 refinement passes, areas from
  closure summary, `cadPointInPolygon` at `:246`); ids `:274,296`.
- `PARCEL_SPLIT_SLIDE` — `cadTransactionsParcelSplitLayoutCommands.ts:19-100`; kernels
  `cadBuildParcelSplitBySlideDraft` (`cadCogoParcelLayoutSlide.ts:151`),
  `solveParcelSlideDraft` (`:65`), `evaluateParcelSlideAtFrontageDistance` (`:20`).
  **Current semantics (preserved): cut line is perpendicular to the frontage edge at a
  distance along the frontage; solver bisects that distance to hit target area.**
- `PARCEL_SPLIT_SWING` — `cadTransactionsParcelSplitLayoutCommands.ts:100-183`; kernels
  `cadBuildParcelSplitBySwingDraft` (`cadCogoParcelLayoutSwing.ts:200`),
  `solveParcelSwingDraft` (`:117`), `cadBuildSwingBoundarySamples` (`:18`),
  `cadEvaluateParcelSwingAtBoundaryDistance` (`:54`). **Current semantics (preserved):
  hinge on one frontage endpoint, cut point sweeps along the parcel boundary perimeter;
  solver bisects distance-along-path.**
- `PARCEL_LAYOUT_AUTO` (fill-parent/remainder): `cadTransactionsParcelAutoLayoutCommand.ts:29-250`,
  orchestrator `cadCogoParcelAutoLayoutSequence.ts:34`, single-lot `:11` in
  `cadCogoParcelAutoLayoutSingle.ts`, preferred `cadCogoParcelFrontageReferenceAutoLayout.ts:356`,
  fallback `cadCogoParcelFrontagePathAutoLayout.ts:18`, remainders `:83` in
  `...FrontageReferenceRemainders.ts`, corner infill `...CornerInfill.ts`; child ids `:112`.

## 5. Frontage audit (straight-only today → explicit 19C policy)

- `cadBuildParcelLayoutFrontageReference` (`cadCogoParcelFrontage.ts:78`) reduces
  polyline → first→last chord and **arc → start/end chord**; `createFrontageReferenceLine`
  (`:35`). Parcel-segment variant `...FromParcelSegments` (`:114`) builds
  `${parcel.id}#${rawIndex}` segments. Resolved by `resolveParcelLayoutFrontageSource`
  (`cadTransactionsParcelLayoutFrontage.ts:17`).
- **Calling a chord length "curved frontage" is therefore the live hazard: it already
  happens inside the frontage builder.** 19C policy:
  - Curved parent boundaries: SUPPORTED in all five split modes (analytic intersections,
    exact child areas).
  - Curved frontage source: SUPPORTED only via an ordered boundary path with arc-length
    stationing (position + tangent analytic). If the implementation pass cannot prove
    slide/swing on a curved frontage path with oracles, it FAILS CLOSED with
    `CURVED_FRONTAGE_UNSUPPORTED` — never chord substitution.
  - `minFrontageMeters` means actual boundary length (line lengths + arc lengths) wherever
    a curved path is admitted.

## 6. Point-in-parcel, rendering, bounds, hit-test, grips, snaps

- Point-in-parcel: `cadPointInPolygon` only (split-area `:246`, side selection
  `...SharedPrimitives.ts:191`, diagnostics `:94-95,266`). 19C must generalize to an
  analytic line/arc winding test; tessellated polygons are NOT authoritative.
- Renderer: ring outline (`cadRenderer.ts:184-215`), area/perimeter label at shoelace
  centroid (`:308-330`), dispatch (`:1159-1163`). Arc courses render as native arc
  primitives; fill (if any) may use bounded display-only approximation.
- Bounds: straight closed ring (`cadSpatialBounds.ts:159-166`); arc bounds helper exists
  for arcs (`:52`) — reuse for arc extrema (0/90/180/270 inside signed sweep).
- Hit testing: no engine entity hit test; box-selection via screen primitives
  (`SurveyCadPreviewCanvas.tsx:296`, `SurveyCadPreview.geometry.ts:130`) and paper
  (`SheetWorkspace.utils.ts:201`). Edge hit must use arc distance + sweep containment,
  never the hidden chord.
- Grips: `buildCadGripHandles` (`cadTransactionsEntityTransforms.ts:280`, parcel `:301`),
  `updateEntityFromGrip` (`:247`), `applyCadGripEdit` (`:366`); boundary guard
  (`cadBoundaryCandidateValidation.ts:188`). Grip contract: endpoint move under stored
  endpoint-relative (bulge) definition — sweep constant, radius/center derived.
- Snaps: parcel routes to per-straight-segment candidates
  (`cadSpatialEntityCandidates.ts:334` → `buildSegmentEntitySnapCandidates` `:35`;
  index `cadSpatialIndex.ts:147,357`). Curved courses expose existing arc snap types
  (endpoint / arc-midpoint / center / quadrant / nearest) through the existing engine —
  no parcel-only snap math.

## 7. Transforms (safe foundation, one rule to add)

- MOVE `translateEntity` (`:21`, parcel `:39-44`); ROTATE/SCALE/MIRROR via
  `transformCadEntityGeometry` (parcel `:126-157`, metrics recomputed) applied by
  `cadTransformApply.ts:108`; SCALE uniform-only (`uniformScaleAbout`,
  `cadTransactionsTransformCommands.ts:82-95`); MIRROR `:103`; Project Transform
  `cadProjectTransform.ts:480`; Grid/Ground uniform-about-origin (`:150`).
- **Non-uniform (`GENERAL_AFFINE`) is already BLOCKED** (`cadProjectTransform.ts:161-162`,
  arc-affine blocked `cadTransformGeometry.ts:159`). 19C adds: any non-uniform transform
  applied to a curved parcel BLOCKS (circle would become ellipse) — fail closed, no
  silent deformation. Mirror flips signed curvature (left↔right).

## 8. Course-ID lifecycle (19A authority preserved)

- Minted: PARCEL_CREATE (`cadTransactionsParcelBasicCommands.ts:79`), SPLIT children
  (`:227`), BEARING (`:108,130`), AREA (`:274,296`), SLIDE/SWING commit
  (`cadTransactionsParcelSplitCommit.ts:104,122`), AUTO (`:112`), COPY (`:106`).
- Backfilled: `cadPersistence.ts:397` (+serialize `:205-206`), `cadDrawingFile.ts:318,413`.
- Retire/mint on vertex insert exists only as unwired `cadParcelCourses.ts:162-163`;
  GRIP vertex edit preserves ids; ERASE drops the entity.
- Consumers key on exact id: table derive (`cadSurveyExportTables.ts:290-300`), row
  resolve (`cadSurveyTables.ts:428-450`, BROKEN_REFERENCE on miss), tag anchor
  (`cadSurveyTableDerive.ts:296`), legal description (`:159`), overlay
  (`useSurveyCadSelectionDerivations.ts:127`).
- 19C identity rules: geometry kind never determines identity. Same endpoints +
  explicit geometry change ⇒ same course ID (C7 stays C7). Arc split by
  insertion/intersection ⇒ old ID retires, fresh IDs for sub-arcs. Split children are
  fresh identity per 19A (no invented lineage).

## 9. Arc primitives available for reuse (no new curve math files)

- `CadArcEntity` (`cadTypes.ts:299-306`): center/radius/start/end angles. No bulge
  convention anywhere (`bulge` only in ARC help text; `CadPolylineEntity` is straight-only).
- `cadSignedSweepDeg(start,end)` (`cadGeometry.ts:175-180`): `end−start` normalized to
  (−360,360]; **positive = CCW**. `cadAzimuthDeg` (`:150`), `cadPointFromAzimuthDistance`
  (`:158`), `cadNormalizeAngleDeg` (`:170`).
- `cadGeometryArcPrimitives.ts`: start/end point, `cadIsAngleOnArcSweep`, midpoint,
  closest-point, project-onto-circle, `cadBuildArcFromThreePoints`, end-tangent azimuth.
- `cadCogoCurveMetrics.ts`: `cadSolveCurveMetrics`, radius/delta summary builders.
- Intersections (`cadGeometryCurveIntersections.ts`): segment-circle/arc, infinite
  line-circle/arc, circle-circle, **arc-arc** (`:147`), tangents, offset/parallel/
  perpendicular-foot.
- Trim/extend: `cadTransactionsTrim.ts:260,342`, `cadTransactionsExtend.ts:272,296`.

## 10. Data-model decision (additive bulge, endpoint-owned)

- `CadParcelEntity` gains optional `courseGeometry?: CadParcelCourseGeometry[]` with
  `CadParcelCourseGeometry = { kind:'line' } | { kind:'arc'; bulge:number }`.
  Contract: when present, `length === vertices.length`; absent = all-line (legacy
  byte-compatible, no migration write).
- Signed CAD-standard bulge `b = tan(sweepRad/4)`: sign carries left/right, magnitude
  carries minor/major (180° has deterministic center-side semantics from the sign —
  pinned by oracle); translation/rotation/uniform-scale/project-similarity leave it
  unchanged; reflection flips sign; no stale center/radius after vertex transforms.
- Rejected alternative: storing center/radius per course (stale-duplication hazard under
  every vertex transform — exactly what §4 warns against).
- Full-circle single course: UNSUPPORTED/BLOCKED (identical start/end cannot address a
  circle in a ring; use ≥2 arc courses). Near-zero bulge canonicalizes to LINE only
  under an explicit machine floor, never a survey-distance tolerance. Validation rejects
  non-finite geometry, zero chord + arc, ~360°/invalid sweep, non-finite derived
  center/radius, zero radius.
- One authoritative endpoint+bulge → arc-metrics seam feeds the generalized
  `resolveCadParcelCourses` (discriminated line/arc result), Curve Label, Curve Table,
  COGO inquiry, Course Table, reports, description. **No `parcelArcMath.ts` /
  `tableArcMath.ts` / `descriptionArcMath.ts` duplicates.**
- WNCAD persists only the authoritative `courseGeometry` (additive v2); legacy files
  unchanged. Malformed curve definition fails safe (invalid/broken course marking or
  load reject per sanitizer contract) — never silent line conversion.

## 11. Tables / reports / description / exports (current straight assumption)

- Parcel Course Table `deriveParcelCourseTable` (`cadSurveyExportTables.ts:290`, cols
  Course/From/To/Bearing/Distance `:373`; entity variant `cadSurveyTables.ts:248,428`).
  19C: add Type + Radius/Delta/Arc Length/Chord/Chord Bearing/Direction; line
  Bearing/Distance stay truthful; arc rows never show chord values under line headings.
- Curve Table (`cadTransactionsSurveyTable.ts:189`, cols `:370`, resolve `:360-380`
  with `cadSignedSweepDeg` abs); Curve Label (`cadSurveyLabels.ts:190`); Parcel Report
  (`:209`, `parcel-summary`, derive `:312`).
- `PARCELDESC` (`cadTransactionsSurveyTable.ts:214`) is a parcel-course table, not legal
  text; `buildCadParcelLegalDescription` (`cadParcelLegalDescription.ts:141`) is
  straight-only and **unreferenced by any command/UI in `src/`** — 19C lifts its curved
  block and wires curve calls (shared resolver math, no tangent claims unless proven,
  reverse traversal reverses sweep/left-right/chord bearing).
- SVG/PDF derive from renderer primitives (exact arcs automatic). DXF parcel is a closed
  LWPOLYLINE approximation, always warned, no bulge (`dxfExportModel.ts:304-330`) → 19C
  exports LINE+ARC (R12) / LINE+ARC or bulged LWPOLYLINE (R2000) where the writer safely
  supports it, warning retained for parcel semantics. LandXML `<Parcel>` is a straight
  point-ref ring (`landxmlCadProject.ts:228-239`, `:150-168` in serialize) → exact if
  schema supports, else APPROXIMATED_WITH_WARNING / UNSUPPORTED_WITH_WARNING, never
  silent chord. Tags anchor arc courses at true arc midpoint, course ID still authoritative.
- Creation from chain: `cadBuildParcelSourceDraft` (`cadCogoParcelGeometrySourceDraft.ts:118`,
  line/polyline sources; command `:27-135` in `cadTransactionsParcelBasicCommands.ts`) →
  19C accepts closed connected Line+Arc chains (deterministic traversal, no branches /
  self-crossing, sweep preserved, sources untouched, fresh IDs, snapshot ownership).
  Start-course rotation (`cadParcelLegalDescription.ts:86`) and reverse (`:66`) generalize
  to mixed order. Area label (`cadRenderer.ts:308`) and inquiry (`cadProperties.ts:369-390`,
  overlay `SurveyCadParcelReportOverlay.tsx:19-70`) consume exact curved metrics.

## 12. Caller classification (A curve-safe · B generalized resolver · C exact line/arc · D unsupported)

| Caller | Class | Reason |
|---|---|---|
| `buildParcelCourseId(s)`; `buildParcelRing`; `curvedMarkersFor`/`parcelHasCurvedCourses`; id mint sites (split/bearing/area/commit/auto/copy); WNCAD persist; `translateEntity`; surface bulk test | A | endpoint-only / id minting / opaque round-trip |
| `ensureParcelCourseIds`; both `resolveCadParcelCourses`; `insertParcelCourseVertex`; report summary; bearing draft; split commit; grip handles/edit; rigid `transformCadEntityGeometry` + project transform; renderer ring/label + bounds; snaps; properties; table derives + tag anchor; previews | B | derive course identity/geometry from vertex pairs — must use generalized resolver |
| closure summary (area/perimeter); line + area split kernels; slide/swing kernels; frontage reference + resolve; layout shared prims; all auto-layout solvers; point-in-polygon (needs arc-aware successor) | C | exact line/arc geometry required |
| legal description (until 19C lifts it); DXF parcel polyline; LandXML parcel ring | D | explicitly straight-only today; 19C upgrades or honest warn/block per §§73-75 |

Cross-cutting pins for implementation: no tessellation as authority (grep-gated);
no curve inference (arcs exist only by explicit authoring/import/split-preservation);
no live source association (snapshot ownership); LINE + CIRCULAR ARC only (no
spiral/ellipse/spline); parcel stays horizontal plan geometry; PARCELDESC stays DRAFT.
Numerical policy: machine-conditioning epsilon ≠ topology decision ≠ user tolerances ≠
solver tolerance — no single magic 1e-6 (existing `isSameVertex` 1e-9 is a coordinate
comparison, not a topology decider).
