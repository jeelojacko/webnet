# Phase 19D — Parcel Network Architecture Audit (plan designation / Parcel Schedule / Shared Boundary)

**Branch:** `feat/cad-parcel-network-production`
**Baseline:** `origin/main b553161e814d7ee1ab3a477bc62d93dea68d05cf`
**Status:** audit only. No production code changed by this document.
**Method:** read-only source inspection; all references `file:line`.
**Phase 19D scope:** plan designation/roles, Parcel Schedule, and a Shared Boundary relationship layer keyed on `parcelId` + `courseId`. **No full parcel-fabric migration.**

---

## 1. Existing parcel model, seam, and operation locations

### 1.1 Entity + data model

| Concern | Location |
|---|---|
| `CadParcelEntity` | `src/engine/cad/cadTypes.ts:354-374` |
| `courseIds?: string[]` (stable course identity, `length === vertices.length`) | `src/engine/cad/cadTypes.ts:363` (comment `:355-362`) |
| `courseGeometry?: CadParcelCourseGeometry[]` | `src/engine/cad/cadTypes.ts:372` |
| `CadParcelCourseGeometry = {kind:'line'}\|{kind:'arc';bulge}` | `src/engine/cad/cadTypes.ts:352` |
| `CadBaseEntity` + `metadata?: Record<string, unknown>` | `src/engine/cad/cadTypes.ts` (`CadBaseEntity`, `metadata` field) |
| Layer role union incl. `'parcels'` / `'planning'` | `src/engine/cad/cadTypes.ts:86-87` |
| Default Parcels layer | `src/engine/cad/cadLayers.ts:105-116` |
| Default `'Parcel'` style | `src/engine/cad/cadStyles.ts:80` |

### 1.2 Course identity + resolver (single seam)

All in `src/engine/cad/cadParcelCourses.ts`:

- `CadParcelCourseBase` / `CadParcelLineCourse` / `CadParcelArcCourse` / `CadParcelCourse` — `:23,:34,:44,:63`
- `buildParcelCourseId` `:66`, `buildParcelCourseIds` `:70`
- `ensureParcelCourseIds` (deterministic legacy backfill) `:84`
- `buildParcelRing` (adjacent-dup sanitize + explicit close) `:102`
- **`resolveCadParcelCourses`** (authoritative, ring order preserved, fails closed on invalid geometry) `:130`
- `insertParcelCourseVertex` (retire 1 id, mint 2) `:202`
- `deleteParcelCourseVertex` (retire 2, mint 1; blocks mixed-curvature / arc-mismatch / <3 verts) `:287`
- `reverseCadParcelCourse` `:401`, `reverseCadParcelCourses` `:455`, `rotateParcelCoursesToStart` `:472`
- `buildParcelCourseReportSummary` `:491`

> ⚠️ **Unwired:** `insertParcelCourseVertex` (`:202`) and `deleteParcelCourseVertex` (`:287`) have **no caller in `src/`** — referenced only by `tests/cad_parcel_curved_transform_19c.test.ts`, `tests/cad_survey_course_identity_19a.test.ts`, `tests-browser/cad-survey-plan-production-19a.spec.ts`. No command or grip path performs parcel vertex insert/delete.

### 1.3 Line/arc metrics

`src/engine/cad/cadParcelArcGeometry.ts`: `CadParcelArcMetrics:27`, `parcelCourseCanonicalKind:100`, `describeParcelArcCourse:119`, `parcelBulgeFromArcDefinition:218`, `validateParcelCourseGeometry:278`, `buildParcelCourseTopology:382` + `validateParcelBoundaryTopology:425` (single-parcel ring topology), `checkParcelCourseTangency:503`, `mirrorParcelCourseGeometry:534`, `splitParcelArcCourse:561`, `parcelArcBoundsPoints:604`.

Closure/report math: `cadBuildParcelClosureSummary` `src/engine/cad/cadCogoParcelGeometrySummaries.ts:210`, `cadBuildParcelReportSummary` `:306`.

### 1.4 Transform paths

| Path | Location |
|---|---|
| MOVE (`translateEntity`, parcel case) | `src/engine/cad/cadTransactionsEntityTransforms.ts:21`, parcel `:39` |
| ROTATE/SCALE/MIRROR geometry (parcel case; `GENERAL_AFFINE` curved → BLOCK `:147`; reflection → `mirrorParcelCourseGeometry` `:151`) | `src/engine/cad/cadTransformGeometry.ts:131-176` |
| Transform preflight / apply / commit | `src/engine/cad/cadTransformApply.ts:85,265,362` (commit default key `EDIT_ENTITY` `:365`) |
| MOVE/COPY/ROTATE/SCALE/MIRROR/GRIDGROUND/PROJECTTRANSFORM registry | `src/engine/cad/cadTransactions.ts:565-573` |
| Project Transform non-uniform BLOCK | `src/engine/cad/cadProjectTransform.ts` (affine reject `:161-162`) |
| Grid/Ground uniform-about-origin | `src/engine/cad/cadProjectTransform.ts:150` |

### 1.5 Vertex grips

- `updateEntityFromGrip` parcel case (vertex moves ONLY; bulge untouched, metrics recomputed) — `src/engine/cad/cadTransactionsEntityTransforms.ts:220`, parcel `:254`
- `rebuildParcelMetrics` `:129`
- `buildCadGripHandles` (parcel shares polyline/polygon `vertex` handles) `:287`, parcel `:308`
- `applyCadGripEdit` `:373`

### 1.6 Course conversion (line ⇄ arc)

`src/engine/cad/cadTransactionsParcelCourseCommands.ts`: `locateCourse` `:43`, `withUpdatedGeometry` `:60`, `parcelCourseArcCommand` (PARCELCOURSEARC, adopt arc, same `courseId`) `:79`, `parcelCourseLineCommand` (PARCELCOURSELINE, retire arc to chord, same `courseId`, explicit warning) `:135`. `PARCELCOURSE3P` intentionally not registered.

### 1.7 Splits + Slide/Swing

| Command | Location |
|---|---|
| `PARCEL_CREATE` | `src/engine/cad/cadTransactionsParcelBasicCommands.ts:30` |
| `PARCEL_SPLIT` (by line) | `src/engine/cad/cadTransactionsParcelBasicCommands.ts:153`; kernel `cadBuildParcelSplitByLineDraft` `src/engine/cad/cadCogoParcelSplit.ts:293` (`...Detailed:225`) |
| `PARCEL_SPLIT_BEARING` | `src/engine/cad/cadTransactionsParcelSplitCommands.ts:19`; kernel `:298` |
| `PARCEL_SPLIT_AREA` | `src/engine/cad/cadTransactionsParcelSplitCommands.ts:185`; kernel `:420` |
| `PARCEL_SPLIT_SLIDE` | `src/engine/cad/cadTransactionsParcelSplitLayoutCommands.ts:15`; kernel `src/engine/cad/cadCogoParcelLayoutSlide.ts:151`/`:65`/`:20` |
| `PARCEL_SPLIT_SWING` | `src/engine/cad/cadTransactionsParcelSplitLayoutCommands.ts:106`; kernel `src/engine/cad/cadCogoParcelLayoutSwing.ts:271`/`:188`/`:80` |
| `PARCEL_LAYOUT_AUTO` | `src/engine/cad/cadTransactionsParcelAutoLayoutCommand.ts` |
| Split child commit (`role: 'Child'`) | `src/engine/cad/cadTransactionsParcelSplitCommit.ts:165,172` |

Split children receive **fresh `parcelId` + fresh `courseIds`** (`buildParcelCourseIds`) — `cadTransactionsParcelBasicCommands.ts:236`, `cadTransactionsParcelSplitCommands.ts:108,274`, `cadTransactionsParcelSplitCommit.ts:104,122`, `cadTransactionsParcelAutoLayoutCommand.ts:112`. Parent entity is **removed**; only `metadata.cogo.parentParcelId` records lineage.

### 1.8 Tables / PARCELDESC / report

| Concern | Location |
|---|---|
| `CadSurveyTableKind` incl. `'parcel-course' \| 'parcel-summary'` | `src/engine/cad/cadTypes.ts:559` |
| Row source refs `{kind:'parcel-course';parcelId;courseId}` / `{kind:'parcel';parcelId}` | `src/engine/cad/cadTypes.ts:564-565` |
| Kind labels + columns (incl. arc columns) | `src/engine/cad/cadSurveyTables.ts:122-143`, `CAD_SURVEY_PARCEL_COURSE_ARC_COLUMNS:174` |
| Rows bound by `parcelId`+`courseId` (never raw index) | `src/engine/cad/cadSurveyTables.ts:265-281` |
| `resolveParcelSummaryRow` / `resolveParcelCourseRow` (BROKEN_REFERENCE on stale id) | `src/engine/cad/cadSurveyTables.ts:420,446` |
| Table derive (`deriveParcelCourseTable` / `deriveParcelSummaryTable`) | `src/engine/cad/cadSurveyExportTables.ts:342,362`, dispatch `:443` |
| Table commands (PARCELTABLE / PARCELREPORT / PARCELDESC) | `src/engine/cad/cadTransactionsSurveyTable.ts:191,209,214` |
| Table persistence — dangling refs kept, resolve-time BROKEN | `src/engine/cad/cadSurveyTablePersistence.ts` |
| PARCELDESC drafting (legal description, currently straight/unwired) | `src/engine/cad/cadParcelLegalDescription.ts:1` |

### 1.9 Export architecture

| Format | Parcel handling |
|---|---|
| SVG/PDF | via renderer/export scene primitives (exact arcs automatic); dispatch `src/engine/cad/cadExportScene.ts` (`:142` arc sweep note) |
| DXF | `src/engine/cad/dxf/dxfExportModel.ts:325-364` — curved → native LINE + ARC (R12-safe); straight → closed LWPOLYLINE `src/engine/cad/dxf/dxfSerializer.ts:9`; always warned "geometric only, no legal parcel meaning" |
| LandXML | `src/engine/landxmlCadProject.ts` — `<Parcel>` ring `:259-272`, `buildParcelSegments` (courseGeometry-aware, uses canonical resolver) `:169-180`; count summary `src/engine/cad/landxmlExportSummary.ts:34,103` |
| WNCAD | `src/engine/cad/cadPersistence.ts` clone parcel `:223-240` (courseIds value-copied `:231`, courseGeometry deep-copied `:238`) |
| Format registry | `src/engine/cad/exportCenter.ts:49,151,161,193,501` |

### 1.10 COGO provenance / metadata

- `CadBaseEntity.metadata` — `src/engine/cad/cadTypes.ts` (`CadBaseEntity`)
- `CadCogoProvenance` `src/engine/cad/cadCogoTypes.ts:59-68`; `buildCadCogoEntityMetadata` (writes `metadata.cogo.{toolKey,provenanceId,inputs,parameters,sourceEntityIds,sourcePointIds,resultSummary,createdAtIso}`) `:93`
- `createCogoProvenance` + `appendCogoComputation` — `src/engine/cad/cadTransactionsCogoReports.ts`
- Parcel create metadata `src/engine/cad/cadTransactionsParcelBasicCommands.ts:101`; split children `:119,144`, `cadTransactionsParcelSplitCommit.ts:115,136`

### 1.11 Migration / sanitization

- Clone: `src/engine/cad/cadPersistence.ts:229-240`; courseGeometry persistence validation (throws on malformed) `:66-79`
- Load backfill `ensureParcelCourseIds`: `src/engine/cad/cadPersistence.ts:427-430`; `src/engine/cad/cadDrawingFile.ts:318-319` and `:411-413`
- Sanitizer is additive/trailing-key (key-order-sensitive persistence)

### 1.12 UI surface

| Concern | Location |
|---|---|
| Toolspace Parcel node (Courses/Reports/Description actions) | `src/cad-app/shell/CadSurveyTableToolspace.tsx:87`; mounted `src/cad-app/shell/CadToolspace.tsx:225` |
| Command registry (engine) | `src/engine/cad/cadTransactions.ts:551-579`; command keys `src/engine/cad/cadTransactions.types.ts:93-107` |
| Command registry (UI groups/labels) | `src/cad-app/shell/cadCommandRegistry.ts:224-233` |
| Ribbon Parcel group | `src/cad-app/shell/CadRibbon.tsx:481-484` |
| Properties (engine model; parcel rows + course/curve inquiry) | `src/engine/cad/cadProperties.ts:399-413`, `parcelInquiryRows:259-278` |
| Properties panel UI | `src/components/surveyCad/SurveyCadPropertiesPanel.tsx` (`:187` parcel report) |
| Property edits via `EDIT_ENTITY` | `src/hooks/surveyCad/surveyCadPropertiesEdit.ts` (entity-layer/entity-appearance, `:283,292`) |
| `EDIT_ENTITY` name → `parcelName` | `src/engine/cad/cadTransactionsEditCommands.ts:94-120` (parcel branch `:106`) |
| `EDIT_ENTITY` vertex edits **exclude** parcel | `src/engine/cad/cadTransactionsEditCommands.ts:229-231` (`isRingEditable = polyline \| polygon`) |
| Parcel layout panel / workflow | `src/components/surveyCad/SurveyCadLayoutPanel*` (parcel layout), `src/components/useSurveyCadParcelLayoutWorkflow.ts` |
| Parcel report overlay | `src/components/surveyCad/SurveyCadParcelReportOverlay.tsx:19-70` |

### 1.13 Undo/redo

- Whole-snapshot `before`/`after` only: `runCadCommand` `src/engine/cad/cadUndoRedo.ts:58`, `undoCadHistory:89`, `redoCadHistory:105`. One command = one transaction entry. No per-entity diff, no cascade cleanup on undo (snapshots restore relationships verbatim).

---

## 2. Existing implementations: adjacency / shared boundary / network / easement / ROW / lot number / Parcel Schedule

### 2.1 Confirmed ABSENT (no production construct)

| Concept | Result |
|---|---|
| parcel adjacency / adjacency edge / neighbour parcel | **ABSENT** |
| shared-boundary relationship layer / shared edge | **ABSENT** |
| parcel network / parcel fabric | **ABSENT** |
| easement entity | **ABSENT** in `src/` |
| ROW / right-of-way entity | **ABSENT** in `src/` |
| lot-number field | **ABSENT** in `src/` |
| Parcel Schedule | **ABSENT** |

Case-sensitive searches over `src/` for `easement|rightOfWay|lotNumber|parcelSchedule|sharedBoundary|parcelAdjacency|parcelNetwork|relationship|adjacencyEdge|sharedEdge|neighborParcel|parcelPair` returned **zero** parcel-relationship hits (`adjacency` hits are all TIN/surface topology, unrelated).

### 2.2 Nearest-existing artifacts (ad-hoc, NOT persistent relationships)

| Item | Location | Nature |
|---|---|---|
| Parcel pair overlap diagnostics | `src/engine/cad/cadCogoParcelDiagnostics.ts:83` (`CadParcelOverlapPairDiagnostic:28`, `pairCount:38`) | on-demand, selected parcels |
| Parcel gap-loop diagnostics (coverage) | `src/engine/cad/cadCogoParcelDiagnostics.ts:143` (`CadParcelGapLoopDiagnostic:43`) | on-demand |
| Polygonal overlap area between two parcels | `src/engine/cad/cadCogoParcelGeometryOverlap.ts:136` | on-demand |
| Boundary point classification (multi-parcel) | `src/engine/cad/cadParcelContainment.ts:112,143,154,158` | on-demand |
| Workspace wrappers for the above | `src/hooks/surveyCad/surveyCadWorkspaceParcelReports.ts:20,75,118` (`PARCEL_GAP`/`PARCEL_CHECK`/`PARCEL_OVERLAP` computations) | report-only |
| Auto-layout draft `role: 'lot' \| 'remainder'` | `src/engine/cad/cadCogoParcelLayoutTypes.ts:50` | transient draft role, **not persisted**, no entity field |
| `Easement` / `RightOfWay` | `docs/webnet-survey-cad-attached-high-level-plan.md:500` | *planned entities list only* — never implemented |

### 2.3 Reusable precedents for a 19D relationship layer

1. **Persistent relationship + derived cache** — `CadVolumeSurface` (`src/engine/cad/cadTypes.ts:1353-1364`): holds only `baseSurfaceId` + `comparisonSurfaceId` + display binding; **all derived geometry is never serialized**. Exactly the shape a Shared Boundary record should take (`parcelAId/courseAId` ↔ `parcelBId/courseBId`, no cached geometry).
2. **Resolve-time reference integrity** — survey-table rows (`src/engine/cad/cadSurveyTables.ts:446-490`) bind by stable `parcelId` + `courseId` and surface **BROKEN_REFERENCE** instead of rebinding or dropping. Persistence keeps dangling refs (`cadSurveyTablePersistence.ts`). This is the exact contract a 19D relationship keyed on `parcelId`+`courseId` must inherit.
3. **Provenance chain** — `metadata.cogo` (`cadCogoTypes.ts:93`) records `toolKey`, `sourceEntityIds`, `sourcePointIds`, `parameters`; usable for relationship provenance without new fields.
4. **Deterministic id minting** — `buildParcelCourseId`/`buildParcelCourseIds` (`cadParcelCourses.ts:66,70`), `createStableRuntimeId` (`src/engine/id`) — no randomness; a shared-boundary id scheme can stay deterministic.
5. **Trailing-key persistence discipline** — `cloneCadProject` (`cadPersistence.ts:246`) + `sanitizeSurveyCadPersistedState` (`:402`); new project-level collections must be appended trailing and backfilled with a dedicated `backfill*`/`ensure*`.

---

## 3. Mutation matrix

Legend: **Can alter linked course?** = does the op change the geometry/identity of a `courseId` that a relationship could reference. **Propagate safely?** = can derived relationship state be recomputed without inventing data. **Should synchronize?** = must recompute derived metrics/state. **Should BLOCK?** = must fail closed. **Should unlink explicitly?** = must drop/retire relationship refs rather than silently rebind.

| # | Operation | Can alter linked course? | Propagate safely? | Should synchronize? | Should BLOCK? | Should unlink explicitly? |
|---|---|---|---|---|---|---|
| 1 | **Grip endpoint move** (`GRIP_EDIT vertex` on parcel; `cadTransactionsEntityTransforms.ts:254`) | **YES** — coord of 1 vertex ⇒ 2 adjacent courses change; `courseIds` preserved; `courseGeometry`/bulge preserved (arc re-curves) | **YES** — resolver derives new endpoints/metrics deterministically | **YES** — `rebuildParcelMetrics:129`; any Shared Boundary length/bearing derived from the course | No | No (same `courseId`; relationship stays valid, values change) |
| 2 | **Course conversion** (PARCELCOURSEARC `:79` / PARCELCOURSELINE `:135`) | **YES** — geometry kind of one course; **`courseId` preserved**; blocks on endpoint/sweep mismatch (null) | **YES** — arc metrics from endpoints+bulge | **YES** — curve metrics + tables/description | Already blocks on geometric mismatch | No (identity preserved) |
| 3 | **Vertex insert** (`insertParcelCourseVertex:202`) | **YES** — old `courseId` **RETIRES**, two fresh ids minted; vertex count +1 | Not automatically — refs to the retired id become unresolvable | YES (metrics + id set) | n/a (pure seam; unwired) | **YES** — any relationship referencing the retired `courseId` must be retired/`BROKEN`, never rebound by index |
| 4 | **Vertex delete** (`deleteParcelCourseVertex:287`) | **YES** — two ids retire, one merges; blocks mixed line/arc, arc mismatch, <3 verts, degenerate closure | Not automatically | YES | YES (already fail-closed via `{ok:false, reason}`) | **YES** — relationships on either retired `courseId` must be retired/`BROKEN` |
| 5 | **Parcel split** (all 5 modes + auto; e.g. `cadTransactionsParcelBasicCommands.ts:153`) | **YES** — parent entity **removed**; two children with **fresh `parcelId` + fresh `courseIds`**; no id lineage | Not automatically — all parent `parcelId` refs dangle | YES (children metrics/tables) | No | **YES** — all relationships keyed on the parent `parcelId` (and its `courseId`s) must be invalidated; child↔child shared edge is **new** and must be created fresh if required |
| 6 | **Whole-parcel MOVE / ROTATE / SCALE** (`translateEntity:39`; `cadTransformGeometry.ts:131`) | **YES** — every vertex coordinate changes; **`courseIds` preserved**; bulge unchanged for MOVE/ROTATE/uniform SCALE | **YES** — metrics recomputed from transformed vertices | **YES** — closure/area/perimeter | **YES** for curved parcel under `GENERAL_AFFINE` (`cadTransformGeometry.ts:147`) and non-uniform project transform (`cadProjectTransform.ts:161-162`) | No (identity preserved; geometry is a rigid/similarity change) |
| 7 | **COPY** (`cadTransactionsClipboardCommands.ts:84-120`) | Source **unchanged**. Copy gets new `parcelId` + **fresh deterministic `courseIds`** (`:106`) + deep-copied `courseGeometry` (`:111`) | **YES** — self-contained | YES (copy metrics) | No | **YES (by omission)** — source relationships must **not** be copied onto the clone; clone starts with none |
| 8 | **MIRROR** (in place `cadTransformGeometry.ts:151`; MIRROR_COPY `cadTransformApply.ts:265`) | In place: **`courseIds` preserved**, bulge **sign-flipped** (`mirrorParcelCourseGeometry:534`). MIRROR_COPY: fresh ids | **YES** — left↔right is exact | **YES** — direction/curve metrics | **YES** — curved parcel under non-uniform/affine | In place: No. MIRROR_COPY: **YES** (clone starts with no relationships) |
| 9 | **Project Transform** (`cadProjectTransform`, `cadTransactions.ts:573`) | **YES** — similarity (translation+rotation+uniform scale); `courseIds` preserved, bulge preserved | YES if similarity | YES — metrics | **YES** — non-uniform (`cadProjectTransform.ts:161-162`) | No |
| 10 | **Grid / Ground** (`cadProjectTransform.ts:150`) | YES — uniform about origin; ids preserved, bulge preserved | YES | YES | No (uniform) | No |
| 11 | **DELETE / ERASE** (`cadTransactions.ts:218`) | Entity removed; **no cascade** to survey-table rows (they resolve to BROKEN) | Not applicable | n/a | No | **YES** — relationships referencing the erased `parcelId`/`courseId` must resolve to `BROKEN`/remove; ERASE performs **no** reference cleanup today |
| 12 | **save / reopen (WNCAD)** (`cadPersistence.ts:223-240`; load `:402`, `cadDrawingFile.ts:318,411`) | No mutation — `courseIds` value-copied, `courseGeometry` deep-copied; `ensureParcelCourseIds` backfills legacy | **YES** — deterministic backfill; malformed `courseGeometry` throws at persist (`:66-79`) | YES (backfill + validate) | Load/serialize must fail closed on malformed relationship payload | Legacy drawings have **no** relationships → backfill empty; new collection must be optional + trailing-key |
| 13 | **Generic `EDIT_ENTITY`** | `entity-name` → renames `parcelName` only (`cadTransactionsEditCommands.ts:106`) — **safe**. `polyline-vertex`/`polyline-vertices` **exclude parcel** (`:229-231`) — cannot alter parcel course geometry. `entity-layer`/`entity-appearance` type-agnostic (`:283,292`) — no geometry | YES | No (name/appearance only) | No (name/appearance only) | No |

**Matrix invariants for 19D**

1. `courseId` survives every operation that preserves endpoints and topology (grip move, conversion, rigid/similarity transform, mirror-in-place).
2. `courseId` **retires** only on topology change (vertex insert/delete, split, arc split by intersection) — insert/delete are currently **unwired**, so today the only topology-changing paths are the split modes and `PARCEL_CREATE`.
3. `parcelId` is destroyed by split (children are new identity); relationships keyed on it must be invalidated, not migrated.
4. ERASE and table-row resolution are **resolve-time tolerant**; a Shared Boundary layer must follow the same BROKEN-not-rebind rule (`cadSurveyTables.ts:460`).
5. Transforms never re-key identity; they only invalidate **derived** values (metrics, lengths, bearings) — so a Shared Boundary record must store **no cached geometry**, mirroring `CadVolumeSurface`.

---

## 4. Risks and recommendations

1. **Identity-first design.** Store Shared Boundary as refs only (`parcelId` + `courseId` pairs, no coordinates/lengths), with an id minted deterministically. This is the only shape that survives matrix rows 1, 2, 6, 8, 9, 10 without rewrite, and it matches `CadVolumeSurface` (`cadTypes.ts:1353`).
2. **Resolve-time integrity is mandatory.** Copy the survey-table pattern (`cadSurveyTables.ts:446-490` + `cadSurveyTablePersistence.ts`): keep dangling refs on load, render `BROKEN`/`UNLINKED`, never rebind by index or nearest geometry.
3. **Wire inserted/deleted courses before relying on them.** `insertParcelCourseVertex:202` / `deleteParcelCourseVertex:287` are unwired, so a 19D relationship layer cannot yet be exercised by insert/delete. If 19D ships shared-boundary retirement logic, it must also wire or explicitly defer the vertex insert/delete commands, otherwise the retire-on-topology-change path is dead code and untested end to end.
4. **Split is the sharpest edge.** Split removes the parent and mints fresh child identity with no id lineage (`metadata.cogo.parentParcelId` only). Decide explicitly: (a) relationships on a split parent are dropped, or (b) a 19D split commit re-derives child boundaries from geometry. Do not silently inherit.
5. **Naming collision risk.** There are two exported `resolveCadParcelCourses` — canonical `cadParcelCourses.ts:130` and the table adapter `cadSurveyExportTables.ts:213` (which delegates via alias at `:23`). New relationship code must import the canonical one only.
6. **Persistence ordering.** New project-level collections must be appended **trailing** (`cloneCadProject:246`, `sanitizeSurveyCadPersistedState:402`) and backfilled, because persistence signatures are key-order-sensitive (`cadPersistence.ts:285` precedent).
7. **No parcel-fabric migration.** Per scope, do not introduce a global node/edge fabric, lot-number entity, easement/ROW entity, or Parcel Schedule engine. Plan designation/roles and Parcel Schedule, if added, should be additive fields/derived tables over the existing `parcelId` + `courseId` keys, not a new identity system.
8. **Single seams to reuse.** `resolveCadParcelCourses` (course truth), `cadBuildParcelClosureSummary` (metrics), `cadBuildCogoEntityMetadata` (provenance), `buildParcelCourseIds` (identity), the split commit path (`cadTransactionsParcelSplitCommit.ts`) for child creation. **No new curve math, no new resolver, no tessellation as authority.**

---

## 5. Acceptance summary

- Entity locations: §1.
- No-existing-implementation confirmation with exact hits: §2.
- Full mutation matrix: §3.
- Read-only audit; no production code changed by this document.
