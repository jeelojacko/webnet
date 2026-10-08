# Per-Tool Deep Dive (baseline main 5478ccf4, all file:line)

## 1. POINT — USABLE_BUT_INCOMPLETE (HIGH)
Ribbon `COGO_POINT` EN (`CadRibbonHomeTab.tsx:100`); plain POINT registry-only
(`cadCommandRegistry.ts:170`). Real sessions + starters
(`useSurveyCadCommandStarters.ts:47,50`). Creates `CadSurveyPointEntity` +
anchored `CadTextEntity` (`cadTypes.ts:262`; factory
`cadTransactionsEntityFactories.ts:93-153`) — a survey point, not a bare dot.
Tx `cadTransactions.ts:277,310` (+COGO report). Hit/render via spatial index
(`cadSpatialIndex.ts:212`) and marker (`cadRenderer.ts:1324`); no grips
(transforms default `[]`); props in `cadProperties.ts`. Snaps: point-node/
endpoint; typed input 2D-only (`parseAbsolutePoint`,
`useSurveyCadCommandPointParsing.ts:23-35`). Transforms/clipboard/DXF
point+text (`dxfExportModel.ts:271`) all work. Missing: Z entry (schema has
`z`, never set), symbol-at-creation (style/ByLayer only). Tests:
`cadCommandHistory.02`, browser `cad-annotation-18p.spec.ts:394`.

## 2. LINE — USABLE_BUT_INCOMPLETE (HIGH)
Split family, only Create Line runnable, 16 Civil rows planned
(`cadRibbonToolFamilies.ts:93-115`). Single-segment session, two picks commit
(`useSurveyCadConsumePoint.ts:318-346`); no chain. Typed bearing/dist
(`parseRelativeBearingDistance`, pointParsing:82-118). `CadLineEntity` XY-only
(`cadTypes.ts:283`), distinct from 2-vertex polyline; planar preview, no Z.
Tx `:381`, render `:1358`, index `:114`; start/end grips (transforms:244,336);
props azimuth/length. Snaps endpoint/midpoint/intersection/perpendicular/
nearest/extension. Trim/extend target + boundary (`cadTransactionsTrim.ts:140,
260,:42-85`). DXF LINE (`:312`). Missing: chaining, Z, by-range variants.
Tests: `cadCommandHistory.01:86`, render standards `:346`,
`surveyCadWorkspace.02/03`, browser `cad-shell-compact-ribbon-21a:429`.

## 3. TRAVERSE — USABLE_BUT_INCOMPLETE (MED-HIGH)
Dedicated Draw button (`:104`) + live draft panel
(`SurveyCadTraverseDraftPanel` via `SurveyCadWorkspaceSurface.tsx:271`).
Rich session (points/legs/mode/close/sideshots/adjustment); leg edit/insert/
nudge/rewind/close (`useSurveyCadTraverseDraftActions.ts:67,108,308,363`).
Commits survey-points + sideshot lines + one `CadPolylineEntity`
(`cadTransactionsTraverseCommand.ts:14-237`), one undoable tx + COGO
provenance. Legs typed bearing-distance; closure dE/dN/ratio (`:99-104`);
sideshot occupy/backsight stored (`:130-175`); adjustments angular/bowditch/
transit (`cadCogoSummaries.ts:32,205`). Backsight metadata-only; no LSQ, no
field-book import, no network object type. Placement in Draw is deliberate
(survey-numeric workflow with panel editor). Tests: `surveyCadWorkspace.23/24/
25`, `cadCommandHistory.06/07`, `cad_renderer_labels:74`.

## 4. POLYLINE — USABLE_BUT_INCOMPLETE (HIGH)
Button `:102`; vertex-accumulation session, Enter commits, Esc cancels
(starters:60; consumePoint:127-169; lifecycle:44-53). `CadPolylineEntity`
(`:294`); Close/backstep delivered in C1, per-course bulge/arc legs +
centred band width in C2, and count-changing vertex insert/delete in C3
(pure topology `cadPolylineTopology.ts`; transactions
`POLYLINE_INSERT_VERTEX`/`POLYLINE_DELETE_VERTEX`; per-course secondary
insert grips + Properties Delete/Insert actions + typed
`PLINEINSERTVERTEX`/`PLINEDELETEVERTEX` sessions). Tx `:558`, render `:1378`,
per-segment snaps, transform, trim pieces (`:175,306`), surface-boundary
source. Grips per-vertex + per-course insert; props vertex XY + segment rows
+ vertex/course actions (`cadProperties.ts:257,367`). DXF polyline (`:326`).
Missing: Z, line chaining, right-click finish, command repeat, raw
bulge-entry UI, width grips, destructive arc↔line conversion, full
mixed-segment trim/extend/fillet, general DXF import. Tests:
`surveyCadWorkspace.12:261/.14`, `cadCommandHistory.01:121/.02:257`,
`cad_polyline_vertex_topology_c3*`, `cad_polyline_vertex_editing_c3*`,
browser `cad-shell-compact-ribbon-21a:338` + `cad-draw-polyline-c3`.

## 5. ARC — PRODUCTION_READY (HIGH)
Split, 11 runnable rows incl. default 3-Point (families:57-92; starters
workspace:1493-1503). Builders `cadGeometryArcBuilders.ts` (SCE/SCA/SCL/SEA/
SED/SER/tangent/continued) + 3-point (`cadGeometryArcPrimitives.ts:113`);
Ctrl-flip CW/CCW via signed sweep (`cadGeometryCurveCore.ts:99`); every
builder fail-closed → null (collinear ≤1e-12, zero radius/chord, |Δ|≥360).
Schema center/radius/angles (`:301`), no bulge. BC/MP/EC/R support entities
(`cadTransactionsArcSupportEntities.ts:24-173`). Tx via ARC_3PT/ARC_CREATE
(curveCommands:21,108); render `:1399`; snaps center/quadrant/arc-mid/tangent
(candidates:308); grips start/end/radius; props radius/chord; trim pieces
(`:230,313`); DXF arc (`:442`). Missing only: Z, standalone bulge round-trip.
Tests: `cadCommandHistory.02:118/.04:181/.11:162`, `surveyCadWorkspace.10/11/
12`, browser `cad-annotation-18o:227`.

## 6. CIRCLE — PLACEHOLDER_ONLY (HIGH)
All 6 rows planned, no key (families:131-136); no registry/`ActiveCommandKey`
/starter (only Measure `LINE_CIRCLE_INTX`). No entity (union :720-737), no
display primitive (union has point/line/arc/text/ellipse), no hit-test.
DXF CIRCLE only in paper layout (`dxfLayoutExport.ts:218-225`), never model
space. Full-circle-as-arc explicitly blocked (`CAD_PARCEL_ARC_FULL_CIRCLE_
SWEEP_DEG = 360-1e-6`, `cadParcelArcGeometry.ts:70,327-329`). v1:
`CadCircleEntity{cx,cy,r}` (or sweep-guard policy decision) +
CIRCLE_CENTER_RADIUS + 0-360 arc-primitive render + DXF CIRCLE.

## 7. BEST FIT — PLACEHOLDER_ONLY (MEDIUM)
Labels "Create Best Fit Line/Arc/Parabola", hints "least-squares …"
(families:145-147; Civil source `docs/evidence/phase21b-civil-icon-audit.md:
86`). No task/design doc; zero fit functions in `src/engine`
(`fitLine|bestFit|regression` → no hits; only Helmert `cadHelmert2D.ts` +
`LSAEngine` `adjust.ts:57`). Inputs undefined (selected points? vertices?
picked polyline?). `CadLineEntity` requires station/observation ids
(`:283-292`) so a fit cannot be a line entity as-is; parabola has no type.
Verdict: POLICY/DESIGN_REQUIRED before any code. v1 sketch: fit line over ≥2
selected survey points → 2-vertex polyline + COGO residual report.

## 8. CURVES — USABLE_BUT_INCOMPLETE (HIGH)
Split dropdown of survey circular-curve tools, not splines
(`CadRibbonHomeTab.tsx:104`; manifest:100-136). 6 planned Civil rows; 10
runnable: CURVE_SOLVER (report-only, `useSurveyCadCurveSubmit.ts:243`),
TANGENT/PI/CHORD_BEARING/REVERSE/COMPOUND/POINT_ON/SUBDIVIDE/OFFSET_CURVE +
LINE_CIRCLE_INTX (registered as Measure, registry:219-228). Engine all
circular arcs (`cadCogoCurveMath.ts:111-298`); commit via `arcCreateCommand`
(`useSurveyCadCommands.ts:223`). No spline/NURBS/clothoid/Bezier anywhere
(orphan `draw-spline` icon; LandXML spirals rejected
`landxmlAlignmentImport.ts:261`). v1: wire `curves-between-two-lines` to
`cadBuildTangentCurve` between two picked lines.

## 9. ELLIPSE — UI_STUB_ENGINE_PARTIAL (HIGH)
Drafting modes Center/Axis-End/Elliptical-Arc all planned (families:151-159).
Separate proven object: `CadErrorEllipseEntity` (`:472-479`), derived-only
(adjustment→model `cadModel.ts:106`; import `cadAdjustedPointsImport.ts:
127-142`), rendered (`cadRenderer.ts:1491-1507`, pickable, no snap-index
entry), MOVE/PROJECTTRANSFORM support, persisted (`cadPersistence.ts:146`),
DXF model-space 36-gon + warning (`dxfExportModel.ts:156-171,568-570`),
paper-space native ELLIPSE (`dxfLayoutExport.ts:232-245`). v1: generic
ellipse entity (or unbound abstract) + Center command + model-space DXF
ELLIPSE reusing the paper emitter.

## 10. SHAPES — ENGINE_EXISTS_UI_MISSING (HIGH)
Exactly two intended items: `shapes-rectangle` (two-corner),
`shapes-polygon` (inscribed/circumscribed) (families:161-170), both planned,
no keys. `CadPolygonEntity` exists (`:340-345`, implicitly closed); sole
creator is TIN surface-boundary (`cadTransactionsSurfaceBoundaryCommands.ts:
145-158`). Polygon renders (`cadRenderer.ts:1383`), pickable, transforms
(:40-49), props (`cadProperties.ts:465`). No interactive session. v1:
RECTANGLE two-corner → closed polygon (4 vertices); then polygon mode. Zero
new schema.

## 11. HATCH — PLACEHOLDER_ONLY (HIGH)
No `CadHatchEntity`, no boundary extraction, no patterns/scale/angle, no
associativity. Primitives allow `fill` (`cadDisplayTypes.ts:16`) but geometry
is stroke-only — fill used only for point markers (`cadRenderer.ts:1351`).
Section/analysis fills are derived/approximated with warnings
(`cadSectionView.ts:235`; `dxfExportModel.ts:131-138`). DXF: no HATCH
(model or paper). Icons curated (BHATCH/GRADIENT) but rows planned
(families:172-182). Split honestly: solid-fill absent, pattern absent,
associative absent. v1: solid hatch over closed boundary → derived filled
region + DXF SOLID/HATCH-block approximation; patterns/associativity later.

## Addendum — Phase C1 current state (2026-10-06)

Historical baseline above is unchanged. Current-state note for Polyline
(§ items on PLINE/close/backstep): Phase C1 (`feat/cad-polyline-close-backstep-c1`,
baseline `5aa6441`) made PLINE close into the existing
`CadPolylineEntity.closed` flag — schema-free, no duplicate closure vertex —
and added session-local `C`/`CLOSE` and `U`/`UNDO`/`BACKSTEP` backstep. The
closed last→first edge is now real for closed PLINEs in the shared segment
iterator (spatial index/snaps/intersections), renderer, bounds, and
Properties rows; grips stay one-per-vertex. Still deferred: bulge/width/arc,
Z, line-chaining, right-click, repeat, and closed-edge segmenting in
trim/extend/fillet. Evidence:
`docs/evidence/cad-polyline-c1-close-backstep/`.

## Addendum — Phase C2 current state (2026-10-07)

Historical baseline and the C1 addendum above are unchanged. Polyline update
after Phase C2 (branch `feat/cad-polyline-bulge-width-c2`): per-course arc
legs are now SUPPORTED — `A`/`ARC` switches to 3-point legs (pending
through-point, fail-closed degenerate triples) with the signed bulge from the
shared parcel seam — and per-course centred band width is now SUPPORTED via
`W`/`WIDTH` (constant or `start,end` taper, applied to future segments only).
The engine adds additive trailing optional
`CadPolylineEntity.segmentGeometry`/`segmentWidths` (no version bump), one
canonical path normalizer (`sanitizeCadPolylinePath`), and one shared
consumer resolver (`resolveCadPolylineCourses`). Renderer emits native arc
primitives plus one aggregated band primitive, spatial index/snaps/
intersections use true line/arc courses (never the chord), bounds use true arc
extrema + width envelope, Properties reports arc/line rows and true total
length, DXF attaches groups 42/40/41 to the course start vertex, and
rotation/uniform-scale/reflection carry the metadata while non-uniform
transforms over arcs/width fail closed. Still deferred: vertex
insert/delete, Z, line-chaining, right-click finish, command repeat, raw
direct bulge-entry UI, arc-midpoint/width grips, full mixed-segment
trim/extend/fillet, and general DXF import. Evidence:
`docs/evidence/cad-polyline-c2-bulge-width/`.
