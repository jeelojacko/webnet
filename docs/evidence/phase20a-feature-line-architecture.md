# Phase 20A — 3D Feature Lines Architecture Audit

Branch: `feat/cad-3d-feature-lines`
Baseline: `364169209119b161ee26e379fb6544c0d82d648e`
Status: audit only. No production code changed by this document.
Recon: read-only pass over the baseline tree; references are `file:line` and
verified by reading the source. Every claim below is evidence-backed.

## 0. Verdict summary

1. **No 3D/feature-line construct exists anywhere in `src/`.** Feature lines,
   3D polylines, grading, daylight, draping, and grade-to-surface have **zero
   implementation hits** (§9). Phase 20A starts from a clean slate.
2. The entire engine is **2D-planimetric**. The single persistent coordinate
   record is `CadDisplayPoint { x, y }` (`cadDisplayTypes.ts:3`). Z exists only
   on `CadSurveyPointEntity.z?` (`cadTypes.ts:260`) and on surface/TIN payloads.
3. **Existing `CadPolylineEntity` is NOT sufficient** as a feature line: no Z
   per vertex, no elevation source, no arc/bulge, and its `vertexLabels` are
   used only as *weak breakline references into survey points*. Details §10.1.
4. The one reusable **arc-without-center** representation is the Phase 19C
   **endpoint + signed bulge** convention (`b = tan(sweep/4)`), which is XY-only
   today but is the natural place to hang Z (or to leave Z to per-vertex
   elevations). §2.
5. The **surface query contracts already exist** and are the correct
   dependency surface for a future grade-to-surface engine (§11): barycentric
   XY→Z (`getSurfaceElevationAt`, `queryMeshElevation`), slope/aspect
   (`queryMeshSlope`), station→elevation (`queryProfileElevationAt`), and
   direct band inquiry (`queryAnalysisAt`). None of them take a Z argument.
6. **Transforms, bounds, snapping, hit-testing, DXF, SVG, PDF, and the LandXML
   entity adapter are all XY-only by construction.** A new Z-bearing entity
   touches ~20 `switch (entity.type)` sites plus two exhaustive
   `Record<CadEntity['type'], …>` maps. §6, §5.4.

## 1. Current entity Z support

### 1.1 The persistent point type has no Z

```ts
// src/engine/cad/cadDisplayTypes.ts:3
export interface CadDisplayPoint { x: number; y: number; }
```

Every vertex-ring entity stores `CadDisplayPoint[]`, so its Z channel is
structurally absent:

| Entity | File:line | Z support |
| --- | --- | --- |
| `CadSurveyPointEntity` | `cadTypes.ts:260` | **Yes** — `z?: number` (+ `pointClass`, `source`, `errorEllipse`) |
| `CadLineEntity` | `cadTypes.ts:281` | **No** — `fromX/Y`, `toX/Y`; endpoints are *station refs* (`fromStationId`/`toStationId`), so ΔZ is resolvable at read time |
| `CadPolylineEntity` | `cadTypes.ts:292` | **No** — `vertices: CadDisplayPoint[]`, `vertexLabels: string[]`, `closed: boolean` |
| `CadArcEntity` | `cadTypes.ts:299` | **No** — `centerX/Y`, `radius`, `startAngleDeg`, `endAngleDeg` (plan arc, no Z) |
| `CadPolygonEntity` | `cadTypes.ts:~350` | **No** — same `CadDisplayPoint[]` / `vertexLabels` |
| `CadParcelEntity` | `cadTypes.ts:390` | **No** — `vertices`, `vertexLabels`, `courseIds?`, `courseGeometry?` (bulge, XY), cached area/perimeter/closure |
| `CadAlignmentEntity` | `cadTypes.ts:~325` | **No** — `elements` are `{kind:'line'\|'arc'}` over `CadDisplayPoint`; Z lives in *profile* samples, not the alignment |
| `CadErrorEllipseEntity` | `cadTypes.ts:~470` | No (2D confidence ellipse) |

`CadEntity` (the union, `cadTypes.ts:676`) has **14 members**; none carry Z
other than `survey-point`.

### 1.2 The display/primitive layer has no Z

`CadDisplayPrimitive` (`cadDisplayTypes.ts:72`) is
`point | line | arc | text | ellipse`, each with 2-D coordinates only.
`CadDisplayScene` (`cadDisplayTypes.ts:79`) carries `bounds: CadBounds | null`
where `CadBounds` (`cadTypes.ts:31`) is `{minX, minY, maxX, maxY}` — **2D
bounds, no minZ/maxZ**. Derived surface/volume/profile/section layers hang off
the same scene but are separate aggregated paths.

### 1.3 Where Z *does* exist

- Survey points: `z?: number`, surfaced in properties only for the `line` ΔZ
  row (`cadProperties.ts:443-448`) and consumed by surface builds.
- TIN topology: `CadSurfaceBuildResult.points: CadSurfaceSourcePoint[]`
  (`cadSurfaces.ts:59,86`) carry `{x, y, z}`; `ImportedTinPayload.vertices`
  is `[x,y,z, …]` (`cadTypes.ts`); `SelfContained` grid cells store no Z (Z is
  on the points).
- Profiles/sections/volumes: derived elevation samples
  (`ProfileSample.elevation`, `profileExtraction.ts:36`) and analytic stats.
- LandXML adapter points: `CadLandXmlPoint.z?: number`
  (`landxmlCadTypes.ts`).

**Verdict:** Z is a *point/derived-mesh* concept in WebNet, never an
entity-geometry concept. A first-class 3D feature line introduces the first
entity that owns a per-vertex vertical channel.

## 2. Phase 19C bulge helpers (the one reusable arc convention)

Convention is documented on the type itself:

```ts
// src/engine/cad/cadTypes.ts:352
export type CadParcelCourseGeometry = { kind: 'line' } | { kind: 'arc'; bulge: number };
// signed CAD-standard bulge b = tan(sweepRad/4): sign carries left/right
// (positive = CCW = center-left), |b| > 1 = major arc.
```

Single seam file: **`src/engine/cad/cadParcelArcGeometry.ts`** (the module
explicitly states it is the ONE endpoint+bulge → arc-metrics seam).

| Function | Line | Role |
| --- | --- | --- |
| `CAD_PARCEL_BULGE_LINE_FLOOR` | `:59` | `1e-12`; `\|b\|` below = line |
| `CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE` | `:63` | `1e-9` |
| `CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG` | `:69` | `360 − 1e-6` |
| `parcelCourseCanonicalKind(geometry)` | `:100` | absent/sub-floor → `'line'` |
| `describeParcelArcCourse(from, to, bulge)` | `:119` | bulge → full `CadParcelArcMetrics` (`sweepRad = 4·atan(b)`) |
| `parcelSubArcGeometry(arc, from, to)` | `:189` | on-circle sub-arc → bulge |
| `parcelBulgeFromArcDefinition({from,to,center,radius,signedSweepDeg})` | `:218` | exact inverse `b = tan(sweepRad/4)` |
| `mirrorParcelCourseGeometry(geometry)` | `:534` | reflection flips bulge sign, lines pass through |
| `parcelArcBoundsPoints(from, to, bulge)` | `:604` | in-sweep quadrant extrema outside chord box |

`CadParcelArcMetrics` (`:27`) already carries: `center`, `radius`,
`signedSweepDeg`, `deltaDeg`, `direction`, `arcLength`, `chordLength`,
`chordAzimuthDeg/Bearing`, `startAngleDeg`, `endAngleDeg`, `midpoint` (true
curve midpoint), start/end tangents. **All 2-D.** No 3-D point, no elevation
parameter.

Other bulge call sites (consumers that already understand the convention):
`cadParcelCourses.ts:143,261,294,353,379,428,455` (split/merge/reverse),
`cadTransactionsParcelCourseCommands.ts:106-115`,
`cadCogoParcelGeometrySourceDraft.ts:166-187`,
`cadCogoParcelGeometrySummaries.ts:145,356`,
`cadRenderer.ts:350`, `cadTransactionsEntityTransforms.ts:126`,
`cadTransactionsClipboardCommands.ts:111`, `cadPersistence.ts:65-77`.

**Extension point:** a `feature-line` vertex could reuse
`describeParcelArcCourse` verbatim for its plan arc, with Z supplied
separately per vertex (or per arc as constant/linear grade). Do **not** invent
a second bulge convention.

## 3. Arc geometry helpers (center/radius/sweep, bounds, point-at-angle)

Core file **`src/engine/cad/cadGeometry.ts`** (barrel `cadGeometryCurves.ts`
re-exports the arc modules):

- `CadWorldPoint { x, y }` (`:6`), `CadArcDefinition` (`:24`),
  `CadCurveMetrics` (`:17`).
- `cadDistance`, `cadMidpoint`, `cadClosestPointOnSegment` (`:35`)
- `cadPointOnInfiniteLine`, `cadProjectPointOntoInfiniteLine` (`:60`)
- **`cadPointOnCircle(center, radius, angleDeg)`** (`:83`) — point-at-angle
- `cadSegmentIntersection`, `cadInfiniteLineIntersection` (`:88,128`)
- `cadAzimuthDeg`, `cadPointFromAzimuthDistance` (`:139,147`)
- `cadNormalizeAngleDeg`, `cadSignedSweepDeg`, `cadAngleDegFromCenter` (`:154-172`)
- `cadParseDmsDegrees`, `cadParseBearingDegrees` (`:184,215`)

`src/engine/cad/cadGeometryArcPrimitives.ts`:
- `cadArcStartPoint`, `cadArcEndPoint` (`:11,18`)
- `cadIsAngleOnArcSweep` (`:25`), `cadArcMidpoint` (`:42`)
- `cadClosestPointOnArc` (`:52`), `cadProjectPointOntoCircle` (`:65`)
- `cadBuildArcFromThreePoints` (`:100`), `cadArcEndTangentAzimuthDeg` (`:152`)

`src/engine/cad/cadGeometryCurveCore.ts`:
- `cadCounterClockwiseDeltaDeg` (`:9`)
- `cadCreateCurveMetrics` (`:14`) + FromRadiusDelta / ArcLength / ChordLength /
  TangentLength metric builders (`:30-90`)
- `cadBuildArcFromCenterAngles` (`:75`), `cadBuildArcFromCenterSweep` (`:90`)

**Bounds extrema of an arc** for spatial/prepared bounds: `cadSpatialIndex.ts`
uses a conservative full-circle box `arcBounds` (`:150`) and, for curved
parcels, exact in-sweep quadrant extrema via `parcelArcBoundsPoints`
(`cadSpatialIndex.ts:113-127`, `cadParcelArcGeometry.ts:604`). `buildCadBounds`
(`cadSpatialBounds.ts`) computes XY-only entity bounds (`case 'polyline'` `:188`).

`@turf`-style 3-D helpers do not exist. There is no `pointAtAngleZ`,
`arcZ`, `gradeAlongArc`, or TIN/arc intersection helper.

## 4. Entity renderer + SVG scene

### 4.1 Scene build

`src/engine/cad/cadRenderer.ts`:
- `toPrimitives(project, ctx, entity)` (`:1198`) — the single
  `switch (entity.type)` that turns every entity into primitives.
  - `'survey-point'` → `kind:'point'` (Z ignored)
  - `'line'` → `kind:'line'` from `fromX/Y`→`toX/Y`
  - `'polyline'` (`:1258`) → `buildVertexPrimitives` (`:182`) — emits one
    `kind:'line'` per segment (planimetric), plus `buildTraverseLabelPrimitives`
    (`:255`) bearing/distance labels
  - `'arc'` → native `kind:'arc'` `{center, radius, startAngleDeg, endAngleDeg}`
  - `'parcel'` → curved path `buildParcelCoursePrimitives` (`:324`) using
    `kind:'arc'` primitives; legacy all-line falls back to
    `buildVertexPrimitives`
  - `'alignment'` → per-element `line`/`arc` primitives
- `buildCadDisplayScene(project, options)` (`:1423`) — filters `visible`,
  flat-maps primitives, and attaches derived `surfaceLayers`/`volumeLayers`.
  **No layer-visibility filter here** (viewport filters later).

### 4.2 SVG viewport + export

- Interactive viewport: `src/components/surveyCad/SurveyCadPreviewPrimitive.tsx`
  `renderPrimitive({primitive, …})` — one `<g>` per primitive with an
  invisible **fat hit-target** (`strokeWidth = max(16, width+14)`) plus the
  visible element. Arc rendered via `arcPathFromPrimitive`
  (`SurveyCadPreview.geometry.ts`).
- Export scene: `src/engine/cad/cadExportScene.ts` — `ExportItem` union
  (`:50-57`): `line | polyline | rect | circle | ellipse | arc | text`.
  `buildExportSheetSceneWithResult` (`:770`).
- Export serializers: `cadSvgSerializer.ts` (`case 'arc'` `:52` → single SVG
  `A` path command, no tessellation), `cadPdfExport.ts` (`case 'polyline'` `:192`).

**Tessellation path:** there is deliberately **no general curve tessellator**.
Curves stay analytic (SVG arc / DXF `ARC`) everywhere. Only *approximations
that must fit a flat representation* are faceted:
`dxfExportModel.ts` error-ellipse → 36-gon (`:114-121`), LandXML arc → chord
(`landxmlCadProject.ts:~276` `'arc … approximated as chord (radius dropped)'`),
DXF annotation arrowheads. **A 3-D feature line has no analytic SVG/DXF 3-D
path today**, so either a tessellator or a documented approximation is required.

## 5. Hit testing, snapping, spatial indexes

### 5.1 Entity picking (hit testing)

Picking is **SVG pointer-event based**, not geometric. Each rendered primitive
emits a transparent fat stroke with `data-survey-cad-hit-target="true"` and
`data-survey-cad-entity-id` (`SurveyCadPreviewPrimitive.tsx:88-140` for lines;
analogous per kind through the file). `onEntityClick` /
`onPrimitiveClickIntercept` dispatch to the workspace. There is **no
`hitTest(project, x, y)` engine function for model geometry** (the only
`hitTestPaper` is paper-space sheet chrome, `SheetWorkspace.utils.ts:201`).
Adding Z does not change picking (picking is planimetric) but a 3-D entity's
grips/vertex editing do need a plan-projected handle (see §6.5).

### 5.2 Snapping + spatial index

`src/engine/cad/cadSpatialIndex.ts`:
- `buildCadSpatialIndex(project)` (`:169`) returns `CadSpatialIndex`
  (`cadSpatialIndexTypes.ts`) with `querySnapCandidates` (`:278,600`) and
  `queryNearestSnap` (`:601`).
- `isSnapGeometry` (`:105`) admits **`line | polyline | polygon | parcel |
  arc` only** — this is the entity-type gate a new feature line must join.
- Prepared bounds are XY (`PreparedEntry/Segment/Arc/Block`), arcs use
  `arcBounds` (`:150`) or exact `parcelArcBoundsPoints`.
- `CadSnapCandidate` / `CadSnapKind` (`cadTypes.ts:919-960`) are XY-only.
- Dedicated indexes: `cadEditPointLocationIndex.ts`, `cadEditEdgeSpatialIndex.ts`
  (surface-edit picking), `cadSpatialBlockSnaps.ts`, `cadSpatialSnapConstants.ts`.

**Snap kinds available** (`cadTypes.ts:CadSnapKind`): point-node, endpoint,
midpoint, center, arc-midpoint, quadrant, intersection, apparent-intersection,
extension, perpendicular, parallel, direction, tangent, nearest. All XY.

### 5.3 Surface-edit picking (nearest existing model for a Z-aware picker)

`cadSurfaceEditPicking.ts`, `useSurveyCadSurfacePointEditSessions.ts`
pick a TIN vertex and stage add/delete/move/set-elevation. This is the closest
existing pattern for "pick a 3D point" (`SURFMOVEPOINT` is explicitly
`Z unchanged`, `useSurveyCadSurfacePointEditSessions.ts:65`).

### 5.4 Extension points for a Z entity

Adding `feature-line` to `CadEntity['type']` must cover:
- `CadEntity` union (`cadTypes.ts:676`)
- `CAD_ENTITY_TYPE_LABELS` / `CAD_ENTITY_TYPE_SINGULAR_LABELS`
  (`cadPropertiesModel.ts:68,87`) — **exhaustive `Record` maps, compile-forced**
- `getCadEntityEditableName` / `getCadEntityDisplayLabel`
  (`cadEntityNames.ts:58,71`)
- `toPrimitives` (`cadRenderer.ts:1198`), `buildCadBounds`
  (`cadSpatialBounds.ts:180-200`), `isSnapGeometry` + prepared refs
  (`cadSpatialIndex.ts:105`), `cadSpatialEntityCandidates.ts:404`,
  `cadEntityNames.ts:79`
- transforms: `cadTransformGeometry.ts:38,123`, grip model
  `cadTransactionsEntityTransforms.ts:38,244,307`
- clipboard `cadTransactionsClipboardCommands.ts:84`
- persistence clone `cadPersistence.ts:225`, `cadProjectState.ts:84`
- block sources `cadBlocks.ts:176,280`, `cadBlockSources.ts:28,74`,
  `cadBlockPersistence.ts:35`, `cadSpatialBlockSnaps.ts:78`
- exporters: `dxfExportModel.ts:290`, `dxfBlockExport.ts:141`,
  `dxfLayoutExport.ts:203`, `landxmlCadProject.ts:236`, `cadPdfExport.ts:192`,
  `cadExportScene.ts` (primitives), `SheetWorkspace.exportItem.tsx:11`,
  `cadMlightcadAdapter.ts:37`
- UI previews: `cadBlockPreview.tsx:38`, `cadBlockSelectionGeometry.ts:35`

(~25 files; the two `Record<CadEntity['type']>` maps make it fail-closed at
compile time.)

## 6. Properties, Toolspace, commands, history, transforms, schema, exports

### 6.1 Properties

- `cadProperties.ts` — per-type row builders (`case 'polyline'` `:452`
  emits name/vertices/closed/total-length/segment rows/vertex rows;
  `case 'line'` emits the only Z-aware row, `delta-z` `:443-448`).
- `cadPropertiesModel.ts` — `CadEntityPropertyRow`, `CadEntityPropertyEditField`
  (`:19`, includes `polyline-vertex-x/-y`), exhaustive type-label records (`:68,87`).
- UI: `src/cad-app/shell/CadPropertiesPalette.tsx`.

### 6.2 Toolspace / manager

- `src/cad-app/shell/CadToolspace.tsx`, `src/components/SurveyCadWorkspace.tsx`
  (survey manager), and dedicated managers:
  `CadSurfaceManager.tsx`, `CadSurfaceDefinitionEditor.tsx` +
  `CadSurfaceBreaklineSection.tsx` / `CadSurfaceBoundarySection.tsx` /
  `CadSurfaceBreaklineChainEditor.tsx` (Phase 18W), `CadParcelToolspace.tsx`,
  `CadSurveyTableToolspace.tsx`, `CadSurfaceEditTable.tsx`.
- Shell boundary types snapshot in `cadShellTypes.ts`
  (e.g. Phase 18W breakline chain detail `:365-412`).

### 6.3 Command registry

- Named command registry: `CAD_COMMAND_REGISTRY: Record<CadCommandKey,
  CadCommandDefinition<CadCommand>>` (`cadTransactions.ts:546`); dispatch via
  `executeCadCommand` (`:739`). `CadCommandKey` is a typed union
  (`cadTransactions.types.ts`), so adding `FEATURELINE` is compile-forced.
- Ribbon/registry surface: `src/cad-app/shell/cadCommandRegistry.ts`
  (surface-definition focus `:1-60`, boundary/breakline `:350`).
- Interactive command sessions/help: `src/hooks/surveyCad/*`
  (`useSurveyCadCommandTypes.ts`, `...CommandSession.ts`, `...HelpText.ts`,
  `...CommandText.ts`, `...CommandPreview.ts`). `PLINE` factory:
  `cadTransactionsPolylineCommand.ts` (vertices are `{x,y,label}` only).

### 6.4 History / undo

`src/engine/cad/cadUndoRedo.ts`:
- `CadHistoryState` = `{present, undoStack, redoStack, nextSequence, commandState}`
  where each entry stores **full `before`/`after` `CadWorkspaceSnapshot`
  (`project` object)** (`:11-23,58-79`).
- `runCadCommand` / `undoCadHistory` / `redoCadHistory` (`:58,89,105`).

**Implication:** any new Z field is automatically undoable/redoable — history
is whole-snapshot, so no Z-specific history work is required.

### 6.5 Transforms — MOVE / ROTATE / MIRROR / SCALE semantics

- Kernel: `src/engine/cad/cadTransform2D.ts` — `CadTransform2D
  {a,b,c,d,tx,ty}`, `x' = a·x + c·y + tx`, `y' = b·x + d·y + ty`; factories
  `translation` (`:31`), `rotationAbout` (`:35`), `uniformScaleAbout` (`:45`),
  `reflectionAboutLine` (`:50`), `compose` (`:64`), `applyPoint`/`applyVector`
  (`:84,89`), `classifyTransform` (`:107`).
  **There is no `tz` and no 3-D apply.**
- Per-entity: `src/engine/cad/cadTransformGeometry.ts`
  `transformCadEntityGeometry` (`:77`) — `survey-point` moves `{x,y}` and
  **leaves `z` untouched**; `polyline/polygon` maps `applyPoint` per vertex;
  `parcel` reuses bulge (unchanged under similarity, sign-flipped under
  reflection, **blocked under `GENERAL_AFFINE`** for curved);
  `arc` blocked under `GENERAL_AFFINE`; `alignment` scale-dependency blocked
  unless `allowAlignmentScale`.
- Apply/UI: `cadTransformApply.ts`, `cadTransformPreview.ts`,
  `cadTransactionsTransformCommands.ts`, `cadTransactionsEntityTransforms.ts`
  (grips), `cadProjectTransform*.ts` (MOVE/ROTATE/MIRROR/SCALE project-scope).
- Classification kinds (`cadTransform2D.ts:18`):
  `RIGID_ORIENTATION_PRESERVING | RIGID_REFLECTION | SIMILARITY |
  SIMILARITY_REFLECTION | GENERAL_AFFINE`.

**Current Z handling under transforms is "drop/no-op":** `survey-point` keeps
its stored `z` verbatim; every vertex-ring entity has no z to transform. A
MOVE with a Z component cannot even be expressed. See §10.2 for the
recommendation.

### 6.6 WNCAD schema

- `CadDrawingDocument` (`cadTypes.ts`): `{kind:'webnet-cad-drawing',
  schemaVersion: 1|2, drawingId, name, units, project, imports?, draft?}`;
  file extension `.wncad` (`cadDrawingFile.ts:62`), `schemaVersion: 2`
  (`:171`).
- `CadProject.version: 1 | 2`, trailing optional tables added phase-by-phase
  (surfaces, profileViews, blockDefinitions, analysisMaps, surveyTableStyles,
  sharedParcelBoundaries, …). Key order is signature-sensitive
  (`JSON.stringify`) — **new trailing keys must be appended last**.
- Persistence: `cadPersistence.ts` `cloneCadEntity` (`:123`, `case 'polyline'`
  `:225`), `cloneCadProject` (`:250`, forces `version: 2`),
  `sanitizeSurveyCadPersistedState` (`:411`).
- Load/migrate: `cadDrawingFile.ts` `migrateV1ToV2` (`:258`),
  `parseCadDrawingFile` (`:474`).
- Drawing-scoped state: `CadProjectState`.

### 6.7 DXF writer (R12 + R2000)

- Model: `src/engine/cad/dxf/dxfExportModel.ts` — `DxfPoint {x,y}` (`:51`),
  `polylines: {vertices: DxfPoint[]}` (`:79`), `arcs: {center, radius,
  startDeg, endDeg}`. `case 'polyline'` `:290`.
- Serializer: `src/engine/cad/dxf/dxfSerializer.ts` — `$ACADVER AC1009` (R12)
  (`:110`); entity emission **hard-codes group 30 = `'0'`** for every
  `LINE`/`ARC`/`POINT`/text/insert (`:136-215`).
- Polylines are written as **`LWPOLYLINE`** (`:142,185`) with `90` count,
  `70` closed bit and only `10/20` per vertex — **no DXF `POLYLINE`/`VERTEX`/
  `SEQEND` 3-D form exists**, and no `38` elevation / `42` bulge output.
- Layout/paper path: `dxfLayoutExport.ts` (`case 'polyline'` `:203`,
  `$MEASUREMENT` `:617`). Blocks: `dxfBlockExport.ts` (`case 'polyline'` `:141`).

**Verdict:** DXF output is 2-D-only today. There is no 3-D polyline path, no
Z group-30 value, and no arc-bulge (`42`) emission.

### 6.8 LandXML writer

- Types: `src/engine/landxmlCadTypes.ts` — `CadLandXmlPoint` **has `z?: number`**
  (optional); `CadLandXmlLine {from,to}` is endpoint-id only;
  `CadLandXmlCurve {start,end,radiusM,rot:'cw'|'ccw'}`; `CadLandXmlParcel`
  (+ optional exact `segments` line/curve);
  `CadLandXmlAlignment {lines, curves, startStation?, stationEquations?,
  profiles?, crossSections?}`; `CadLandXmlSurface {points:{x,y,z}[], faces}`.
  Coordinate order is LandXML's **NORTHING EASTING [ELEVATION]**; internal
  metres are scaled to file units (`UNIT_SCALE`).
- Adapter: `src/engine/landxmlCadProject.ts` — `convertEntities` (`:180`);
  `registerPoint` (`:74`) writes `z` **only when `z !== 0`**;
  `case 'survey-point'` propagates `entity.z ?? 0` and rejects non-finite;
  `case 'polyline'` (`:236`) registers each vertex as `CgPoint
  ${entity.id}:v${index}` with **no z** and emits either a `Parcel` ring
  (closed) or chained `<Line>` refs (open), warning
  `approximated as Parcel ring` for closed polylines; `case 'arc'` emits a
  **chord** + warning `radius dropped`; curved parcels emit exact
  Line/Curve `segments` (`buildParcelSegments` `:172`).
- Public barrel: `landxmlCad.ts`; civil adapter `landxmlCivilSource.ts`
  (profiles/cross-sections/surfaces from Phase 18J/18K/18L).
- Export Center disposition: `exportCenter.ts` (`'landxml'` format, per-class
  dispositions), `landxmlExportSummary.ts`.

**Verdict:** LandXML is the *only* existing format that can already carry a
per-point Z (optional on `CadLandXmlPoint`), but the *CAD entity adapter never
fills it for vertex-ring entities*, and `<Line>`/`<Curve>` are straight/planar
segment semantics. See §10.3.

## 7. Surfaces, breaklines, revision propagation, worker

### 7.1 Definition model (`cadTypes.ts`)

```ts
CadSurfaceDefinition {
  pointSource: {kind:'point-group'; pointGroupIds?} | {kind:'points'; pointEntityIds[]}
  breaklines?: CadSurfaceBreakline[]      // {id, source, type:'standard', name?}
  boundaries?: CadSurfaceBoundary[]       // {type:'outer'|'void', sourceEntityId}
  buildOptions?: {maxEdgeLength?}
  edits?: CadSurfaceEdit[]                // Phase 18S/T/V, ordered
  sourceKind?: 'native'|'imported-tin'|'explicit-tin'
  importedTin?: ImportedTinPayload        // [x,y,z,…] + faces + provenance
}

CadSurfaceBreaklineSource =
  | { kind: 'point-chain'; pointEntityIds: CadEntityId[] }
  | { kind: 'entity';      entityId: CadEntityId }
```

(`cadTypes.ts:992-1017`, `CadSurfaceDefinition` `:1128`.)

### 7.2 Breakline source resolution (Phase 18W entity-backed handling)

`src/engine/cad/cadSurfaceRevision.ts`:
- **`breaklineEntityRefs(entity)` (`:53`)** — the canonical entity→ref
  resolution used in production:
  - `metadata.sourcePointIds` (string[]) is always prepended;
  - `line` → `[fromStationId, toStationId]`;
  - `polyline | polygon | parcel` → `vertexLabels`;
  - anything else → metadata only.
  **Arc entity has no vertex labels → not resolvable as an entity breakline.**
- `boundaryRingOf(entity)` (`:67`) — polyline/polygon/parcel vertices XY only.
- `collectSources(project, surface)` (`:93`) — the single source resolver:
  points (missing-Z **skipped**, never defaulted to 0), exact XY dedupe,
  breakline chains where **every ref must resolve to a Survey Point with a
  finite Z** (explicit fallback `resolveRefId` by entity id then station id);
  unresolvable → `SURFACE_BREAKLINE_MISSING_Z` (whole chain blocked);
  resolvable new points are *appended* to the TIN;
  identical XY + different Z → `SURFACE_DUPLICATE_XY_CONFLICT`.
- `computeCadSurfaceSourceRevision(project, surface)` (`:~310`) — geometry-only
  `srev1:` content hash over resolved `entityId@x,y,z`, group ids, breakline
  chains, rings, options, broken refs, and serialized edits (via
  `describeEditForRevision`). Display styling excluded.
- Reason codes on `CadSurfaceReasonCode` (`cadSurfaces.ts:~45`):
  `SURFACE_POINT_MISSING_Z`, `SURFACE_BREAKLINE_MISSING_Z`,
  `SURFACE_BOUNDARY_INVALID`, `SURFACE_VOID_INVALID`, `SURFACE_REFERENCE_MISSING`, etc.

UI/validation helpers: `cadSurfaceView.ts` `classifyBreaklineChainZ` (`:476`)
(requires `metadata.sourcePointIds.length === vertex count` for polyline
chains), `describeSelectedBreaklineEntity` (`:554`),
`describeSelectedBoundaryEntity` (`:530`), `validateBoundaryEntity` (`:604`);
`cadBreaklineChainValidation.ts`; `cadBoundaryCandidateValidation.ts`;
`cadSurfaceDefinitionReferences.ts` (who-references-this-entity inventory, for
source-change propagation); `CadSurfaceBreaklineUtils.ts`.

Architecture doc: `docs/evidence/phase18w-boundary-breakline-architecture.md`
(§3 is the authoritative statement of the entity-ref rules above).

**Critical constraint for Phase 20A:** an entity-backed breakline's Z is
resolved **only through survey-point refs**. A polyline's own geometry never
contributes Z. Therefore a 3D feature line used as a breakline would need
either (a) its own Z channel consumed directly by `collectSources` (new
leg/rule), or (b) conversion to a point chain.

### 7.3 Status / revision propagation

- `deriveSurfaceStatus(surface, collected, …)` (`cadSurfaces.ts:505`) →
  `CadSurfaceStatus` (`cadTypes.ts`: `UNBUILT | CURRENT | NEEDS_REBUILD |
  BUILDING | FAILED | BROKEN_REFERENCE | INSUFFICIENT_DATA`).
- `cachedRevision` is geometry-only and **never trusted across reopen**
  (`clearSurfaceBuildCacheOnLoad`, `cadSurfaceTypes.ts`).
- Display status: `cadSurfaceView.ts` `surfaceStatusText` (`:46`),
  `resolveSurfaceDisplayStatus` (`:141`), `findSurfaceBrokenRefs` (`:69`).
- Hash: `cadRevisionHash.ts` `fnv1a`.

### 7.4 Build worker

- Request/response types: `src/engine/cad/cadSurfaceTypes.ts`
  `SurfaceBuildRequest` (`:145`, includes `points: SurfacePointSnapshot[]` with
  `z?: number|null`, `extraEntities: CadEntity[]` = referenced breakline/boundary
  entities, `pointGroups?`, `definition`, opaque `revision`, `drawingId?`).
- Request builder: `buildSurfaceBuildRequest(project, surfaceId, revision)`
  (`cadSurfaceTypes.ts:~175`) — collects referenced breakline/boundary entities
  only; omits all survey points for explicit-topology TINs.
- Engine: `buildCadSurface(project, surface)` (`cadSurfaces.ts:240`) →
  `CadSurfaceBuildResult` (`:86`) `{outcome, revision, reasonCodes, points,
  triangles, adjacency, edgeKinds, stats, grid}` (all points carry `z`; grid is
  XY-uniform).
- Worker: `src/workers/surfaceWorker.ts`, `surfaceWorkerHandler.ts`
  (also contours/volume/profile/sections/analysis/compose),
  `surfaceWorkerClient.ts` (typed client, `PendingSurfaceBuild` etc.).
  Service/caches: `cadSurfaceCache.ts`, `surfaceVolumeCache.ts`, `profileCache.ts`, `sectionCache.ts`,
  `surfaceAnalysisCache.ts`.
- Staleness: revision is stamped on send and checked on completion, so any
  source-geometry change → different `srev1:` → `NEEDS_REBUILD`.

## 8. Survey points, point groups, alignments, profiles, unit conventions

- **Survey points:** `CadSurveyPointEntity` (`cadTypes.ts:260`) — string
  `stationId`, `x`, `y`, `z?`, `pointClass`, `source` (`adjustment-result |
  parsed-input`), `description`, `featureCode`, `errorEllipse`, Phase 18D
  point-style/label-style refs. Missing Z is **never defaulted** (see
  `SURFACE_POINT_MISSING_Z`).
- **Point groups:** `CadPointGroup` / `CadPointGroupQuery` (`cadTypes.ts:148`)
  with `elevationMin/elevationMax` (Z-aware query, `:158-159`);
  `evaluatePointGroupMembership` (`cadPointGroups.ts:110`),
  `validatePointGroupQuery` (`:31`). Membership is display/organization only.
- **Alignment stationing:** `cadAlignmentTypes.ts`, `cadAlignment.ts`
  (`cadPointAtAlignmentStation` `:53`, `cadPointAtAlignmentStationOffset` `:98`),
  `cadAlignmentStationing.ts` (`cadAlignmentLength` `:23`,
  `getAlignmentStartStation` `:31`, `cadAlignmentEndStation` `:83`,
  `formatCadStation` `:96`, `cadAlignmentRawStationToDisplayStation` `:105`,
  `cadAlignmentDisplayStationToRawStation` `:131`), `cadAlignmentElements.ts`,
  `cadAlignmentOffset.ts`.
- **Profiles:** `cadProfileTypes.ts` / `CadSurfaceProfile` (`cadTypes.ts`),
  `cadProfileView.ts`, `cadProfileRevision.ts`, `cadProfileStatus.ts`,
  `profiles/profileExtraction.ts` (`extractSurfaceProfile` `:84`,
  `ProfileSample {rawChainage, displayStation, x, y, elevation,…}` `:36`),
  `profiles/profileSampling.ts` (`walkLine` `:163`, `walkArc` `:279`,
  `extractTinAlongSegment` `:112`), `profiles/profileMeshLocate.ts`,
  `profiles/profileInquiry.ts`, `profiles/profileStats.ts`.
- **Coordinate/unit conventions:** repo rule is **normalized metres + radians
  internally**, conversion only at parse/override/import/export/display
  boundaries (`AGENTS.md`; `docs/ARCHITECTURE.md:408` "operate on normalized
  internal units"). `CadProjectMetadata.units: UnitsMode` records the source
  unit; `CadBounds`/all geometry is metres; angles are degrees in stored entity
  fields (`startAngleDeg`, `rotationDeg`) but trig is done in radians at the
  call site. **Display text is the only decimal-rounded layer.**
- **Z means north-up planimetric Y.** There is no separate "elevation axis"
  anywhere; Z is a scalar channel parallel to XY. Any 3D feature line must
  follow this convention (x = easting, y = northing, z = elevation).

## 9. Duplication search (must not re-implement)

Case-insensitive search over `src/`, `tests/`, `docs/`, and the repo (excluding
`graft/`, `study-desktop/`, generated output) for:
`feature line`, `feature-line`, `featureLine`, `3d polyline`, `grading`,
`daylight`, `drap`, `grade-to-surface`:

- **`src/` — zero functional hits.** Only incidental substring matches
  ("downgrading", "degrading" in comments) and one nearby concept:
  `cadAnalysisInquiry.ts:93` `'slope-percent'`.
- **`tests/` — zero hits** (only `fixtures/draftGlyphRepertoire.md:47`
  "downgrading").
- **`docs/` — zero hits** for feature line / 3D polyline / daylight /
  grade-to-surface / drape.
- **`docs/webnet-cad-data-model.md`** lists `FeatureFigure` and `Breakline` as
  *candidate entity families* (no implementation); `Breakline` exists only as
  the surface-definition ref type.
- Closest existing machinery to reuse (do **not** duplicate):
  - plan arc + endpoint/bulge: `cadParcelArcGeometry.ts`
  - vertex-ring entity pattern: `CadPolylineEntity` / `CadParcelEntity`
  - Z-bearing vertex pattern: `CadSurfaceSourcePoint` / TIN payloads
  - XY→Z interpolation: `cadSurfaceInterpolation.ts` / `cadSurfaceView.ts`
  - station→elevation: `profiles/profileInquiry.ts`
  - slope/grade math: `surfaceAnalysis.ts` `slopePercentOf` (`:42`)
  - entity-referenced source validation: `cadSurfaceRevision.ts`,
    `cadSurfaceDefinitionReferences.ts`, `cadBreaklineChainValidation.ts`

**Conclusion:** building 3D feature lines does not duplicate an existing
feature. The risk is duplicating the *arc geometry* (use Phase 19C bulge) and
the *surface query* (use the existing interpolation functions).

## 10. Consumer matrix

| consumer | required geometry | XY only? | Z? | plan arcs? | station interpolation? |
| --- | --- | --- | --- | --- | --- |
| Renderer (`cadRenderer.ts`, `SurveyCadPreviewPrimitive.tsx`, `cadExportScene.ts`, `cadSvgSerializer.ts`) | plan polyline of vertices; native arc primitives | **Yes** (plan projection) | No (Z ignored / display-only if added as label) | Yes — must emit native `kind:'arc'` or an explicit approximation | No |
| Inquiry (`DISTANCE_REPORT`, `cadAnalysisInquiry.ts queryAnalysisAt` `:71`) | XY point(s); surface band value | XY for entity distance; XY→Z lookup for surface value | Yes for surface inquiries (`elevation`, `signed-depth`, `slope`) | Plan arc length if measuring a curved course | No (surface XY query) |
| Surface breakline resolver (`cadSurfaceRevision.ts:53 collectSources` `:93`) | ordered chain of **survey-point refs** with finite XYZ | No — needs stable point identity | **Yes, mandatory** (`SURFACE_BREAKLINE_MISSING_Z` on failure) | **No** — bulge/arc is not resolved; arc entity has no resolvable refs | No |
| Station/elevation query (`profiles/profileInquiry.ts queryProfileElevationAt` `:30`, `cadAlignment.cadPointAtAlignmentStation` `:53`) | alignment elements + TIN mesh; raw chainage | XY from alignment; Z from mesh | Yes (interpolated elevation) | Yes (`walkArc` `:279`, element arcs) | **Yes** (raw chainage ↔ display station, equations) |
| Grade reporting (slope/aspect: `surfaceAnalysis.ts slopePercentOf` `:42`, `cadAnalysisInquiry.ts` slope) | local surface plane/gradient at XY | XY query | Yes (slope needs Z) | N/A | N/A unless grade is measured along an alignment |
| Future grading engine (grade-to-surface, daylight, drape) | 3D polyline/feature line with per-vertex Z **or** plan geometry + grade rules; XY→Z surface lookup | No | Yes | Yes (typical feature lines are line+arc in plan) | Optional (if tied to an alignment) |

Reading the matrix: **only the renderer, inquiry, and plan-arc consumers can
work on XY alone.** The breakline resolver, station/elevation query, grade
reporting, and any grading engine require a genuine Z channel. That is exactly
why `CadPolylineEntity` is insufficient.

## 11. Surface query / interpolation contracts found

These are the contracts a future grade-to-surface engine must depend on. All
are pure and deterministic; **none accept or return a 3-D query point beyond
the returned elevation.**

| Contract | File:line | Signature / shape |
| --- | --- | --- |
| `buildSurfaceGrid(points, triangles)` | `cadSurfaceInterpolation.ts:~5` | uniform XY grid index |
| `getSurfaceElevationAt(build, x, y)` | `cadSurfaceInterpolation.ts:~56` | barycentric Z, `null` outside mesh/voids; grid-accelerated with full-scan crack fallback |
| `queryMeshElevation(mesh, x, y)` | `cadSurfaceView.ts:201` | cached `CachedSurfaceMesh` variant |
| `queryMeshSlope(mesh, x, y)` | `cadSurfaceView.ts:232` | `{slopePercent, slopeAngleDeg, aspect}` |
| `queryMeshElevationFullScan` | `cadSurfaceView.ts:239` | deterministic fallback |
| `queryAnalysisAt(def, meshes, x, y)` | `cadAnalysisInquiry.ts:71` | band value (`elevation`, `slope-percent/angle`, `signed-depth` with CUT/FILL/BALANCED) |
| `queryProfileElevationAt(query, rawChainage)` | `profiles/profileInquiry.ts:30` | XY + interpolated elevation, or `{gap:true}` |
| `resolveProfileStationInput(alignment, displayStation)` | `profiles/profileInquiry.ts:~60` | display→raw, `null` on ambiguity |
| `locateProfileElevation` / `planeElevationAt` / `candidateTriangles` | `profiles/profileMeshLocate.ts:68,17,41` | triangle-located interpolation |
| `extractSurfaceProfile(input)` | `profiles/profileExtraction.ts:84` | ordered `ProfileSample[]` segments + gaps |
| `computeVolumeQuantities` | `workers/surfaceVolumeEngine.ts` | cut/fill deltas per triangle |
| `computeCadSurfaceSourceRevision` | `cadSurfaceRevision.ts` | `srev1:` content revision (staleness signal) |

Invariants that matter for grading:
- Z is **never** fabricated: missing source Z → skip/block, never 0.
- Exact-coordinate XY equality (no epsilon snap) for dedupe; identical XY with
  different Z blocks (`SURFACE_DUPLICATE_XY_CONFLICT`).
- Result is only valid for the revision it was built/cached at; stale results
  degrade to `NEEDS_REBUILD` / `SOURCE_NOT_CURRENT`.
- Query returns `null` outside retained triangles — a grade-to-surface solver
  must treat that as "no target", never extrapolate.

## 12. Verdicts and recommendations

### 12.1 Why the existing Polyline is/isn't sufficient

**Insufficient** as a feature line, on four independently blocking grounds:

1. **No Z.** `vertices: CadDisplayPoint[]` → `{x,y}` (`cadDisplayTypes.ts:3`).
   Breaklines, profiles, grading, and grade reporting all require Z; the
   breakline resolver rejects any ref without finite Z.
2. **No vertical ownership or source.** A polyline cannot express "vertex
   elevations", "constant grade between vertices", or "drape onto surface X".
   Its `vertexLabels` are station-id strings used as *breakline refs into
   survey points* (`breaklineEntityRefs`, `cadSurfaceRevision.ts:53`), which is
   the opposite of owning Z.
3. **No plan-arc/curve course.** Only straight segments; the Phase 19C bulge
   convention is parcel-only. A real feature line needs line+arc in plan.
4. **No dependency/revision semantics.** A feature line that grades to a
   surface needs a recorded surface ref + staleness (like `CadSurfaceProfile`
   and `CadSectionView` get `SOURCE_NOT_CURRENT`), which a plain polyline has
   no place for.

What *is* reusable from Polyline: the entity pattern (id/layer/style/
visible/locked/metadata/appearance), the vertex-ring rendering path, bounds,
grips, transform, persistence, and export scaffolding. So Phase 20A should add
a **new entity type** modeled on `CadPolylineEntity` + `CadParcelEntity`
(course geometry) + the surface dependency pattern, rather than overloading
`polyline`.

### 12.2 Transform semantics for Z (recommendation)

The current kernel (`cadTransform2D.ts`) has no Z. Recommended semantics for a
3-D entity's vertical channel, to be carried by a **3-D-aware transform
extension** (never a silent drop):

| Operation | Z rule |
| --- | --- |
| **MOVE** (translation `dx, dy, dz`) | `z' = z + dz`. A 2-D-only move is `dz = 0`. The transform input must gain an explicit `tz`; today it cannot express a vertical move at all. |
| **ROTATE** (about vertical axis through base point) | `z' = z` (unchanged). Rotation is about Z. |
| **MIRROR** (about a vertical plane / plan line) | `z' = z` (unchanged); plan geometry reflects, bulge signs flip (reuse `mirrorParcelCourseGeometry`). No Z negation. |
| **SCALE** (uniform `s` about base point at elevation `z0`) | `z' = z0 + s·(z − z0)`. Non-uniform horizontal scale (`GENERAL_AFFINE`) remains **blocked** with a diagnostic reason code, matching the existing `CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED` / `CAD_TRANSFORM_PARCEL_NON_UNIFORM_CURVED_UNSUPPORTED` precedent — do not shear circles into ellipses or vertical channels into ramps silently. |
| **Any transform with a non-representable Z effect** | Fail closed with a reason code; never drop Z to 0. |

Undo/redo requires no Z-specific work (whole-snapshot history,
`cadUndoRedo.ts:58-79`). Persistence requires appending the new trailing field
and a `cadPersistence.ts` clone case; the `.wncad` schema can stay `version: 2`
(additive optional key) or bump deliberately — the project prefers additive
trailing keys.

> NOTE (Phase 20A decision): mission §§69–73 pin MOVE/ROTATE/MIRROR/SCALE as
> XY-only with Z unchanged (2D CAD plan movement). The table above is the
> audit's general 3-D recommendation; Phase 20A implementation follows the
> mission pin (XY-only, Z unchanged, uniform horizontal scale changes grade
> honestly) and documents the `tz`/vertical-move extension as deferred.

### 12.3 Export representation recommendations

**DXF (R12 + R2000) — honesty for arcs.** The writer currently emits
`LWPOLYLINE` (2-D, `10/20` only) and hard-codes `30 = 0` everywhere
(`dxfSerializer.ts:136-215`). `LWPOLYLINE` cannot carry a Z per vertex.
Therefore a 3-D feature line must be written as the classic 3-D form:
`POLYLINE` with group `70` bit 8 (3-D polyline) + `VERTEX` records with `10/20/30`
+ `SEQEND`. **But a 3-D `POLYLINE` has no reliable arc/bulge semantics**
(plan arc `42` bulge is a 2-D-polyline feature). Recommendation:
- Straight 3-D runs → true `POLYLINE`/`VERTEX` with real `30`, no approximation.
- Plan arcs with varying Z → **tessellate to short `VERTEX` chords** and emit an
  explicit approximation warning (same precedent as the error-ellipse 36-gon
  `dxfExportModel.ts:114-121`); never silently drop the arc or fake a bulge into
  a 3-D polyline.
- Preserve R12 compatibility (R12 supports the 3-D `POLYLINE` form); R2000 can
  additionally use true-color/lineweight groups already implemented.

**LandXML — recommended primary 3-D deliverable.**
- `CadLandXmlPoint` already has `z?: number`, and `registerPoint`
  (`landxmlCadProject.ts:74`) already writes Z when non-zero. So a feature-line
  export is **already representable**: emit ordered `CgPoint`s (one per vertex,
  ids like `${entity.id}:v${index}`) carrying true Z, then reference them.
- For open lines, prefer **`PlanFeature`** (ordered CgPoint refs) over repeated
  `<Line>`s; for closed/hybrid, the existing `CadLandXmlParcel` exact
  `segments` mechanism is the closest mature pattern for line/curve sequences.
- **Arc honesty:** LandXML `<Curve radius rot>` is planar. A plan arc whose
  vertices have differing Z cannot be represented as one Curve. Recommendation:
  export as 3-D `PlanFeature` line segments (tessellated across the arc) with an
  explicit approximation warning, or, when the arc is vertically planar,
  emit `<Curve>` only if all participating vertices have equal Z; otherwise
  fall back to segments. Never emit a Curve that hides a vertical rise.
- Optional richer path: emit the feature line as an **`Alignment`** with plan
  `Line`/`Curve` plus a **`ProfSurf`** profile when the elevation channel is
  regular enough to sample — this is the natural fit if Phase 20A later ties
  feature lines to alignments, and reuses `CadLandXmlAlignment.profiles`
  (already implemented for Phase 18J).

**Other vertices to keep consistent:** PDF (`cadPdfExport.ts`), the export
scene (`cadExportScene.ts`), the Mlight adapter, and block expansion are all
flat — a 3-D feature line must have a defined plan projection and, if desired,
a display-only elevation annotation (like profile views do), not geometry
smuggled into 2-D primitives.

### 12.4 Future Grade-to-Surface needs

Grade-to-surface (and daylight/drape) implies the following capabilities, none
of which exist today:

1. **A 3-D feature-line entity** with per-vertex Z or a per-vertex vertical
   rule (constant grade, set elevation, "from surface", "relative to surface"),
   plus plan line/arc courses (reuse Phase 19C bulge).
2. **A surface reference + dependency tracking** on the entity (surface id +
   revision), mirroring `CadSurfaceProfile`/`CadSectionView`, so a stale
   surface degrades to a `SOURCE_NOT_CURRENT`-style status rather than silently
   using old elevations.
3. **XY→Z sampling along arbitrary geometry** (a "drape" primitive): walk the
   plan geometry segment/arc and call `getSurfaceElevationAt` /
   `queryMeshElevation` at sample points. Today only alignment-based
   `walkLine`/`walkArc` exist (`profiles/profileSampling.ts:163,279`); they are
   alignment-coupled and would need a general geometry entry point.
4. **Grade/delta solving** for "grade to surface" / "daylight": an iterative
   solve where a sloped segment intersects the TIN. No intersection helper
   between a 3-D line/plane and a TIN exists; `surfaceAnalysis` only gives
   local slope/aspect at a point. This is genuinely new math and must be
   deterministic with an explicit failure mode when no intersection exists
   (never extrapolate beyond the mesh — `getSurfaceElevationAt` returns `null`
   outside retained triangles).
5. **Vertical-difference / volume reporting** between a feature line and a
   surface, reusing `computeVolumeQuantities`/`CadVolumeResult` patterns and
   `AnalysisInquiryResult` `signed-depth` semantics.
6. **Missing-Z discipline**: if any feature-line vertex lacks a resolvable Z
   and no rule supplies one, the correct behavior is the established
   fail-closed pattern (reason code, block the dependent build), never Z = 0.

### 12.5 Net Phase 20A scope (recommendation, no code here)

- New persistent entity (likely `feature-line`) with `vertices` (XY), a
  parallel per-vertex Z channel **or** elevation-rule channel, and optional
  per-course bulge (reuse `CadParcelCourseGeometry`).
- New 3-D-aware transform path in `cadTransform2D.ts`/`cadTransformGeometry.ts`
  with the §12.2 semantics and fail-closed diagnostics.
- Extend `collectSources`/`breaklineEntityRefs` so a feature line can act as a
  breakline honestly (either direct Z consumption with validation, or
  conversion to a point chain).
- Export: DXF 3-D `POLYLINE`/`VERTEX` (+ arc tessellation warning), LandXML
  `PlanFeature`/`Alignment` with real Z, plan projection for SVG/PDF/export
  scene.
- Update the ~25 `switch (entity.type)` sites and the two exhaustive
  `Record<CadEntity['type'], …>` maps (compile-forced).
- New evidence/tests must respect the tier rules (`docs/TEST_TIERS.md`): no
  long stress/evidence tests in the agent tier.
