# Phase 18L — LandXML civil interchange support matrix

Baseline: origin/main `43033433794de964543e458521709670d3b5816f` (PR #101 merge).
Branch: `feat/cad-landxml-civil-interchange`.

GO scope: TIN surfaces + horizontal alignments (line/arc) + start station +
station equations, both directions. Secondary bounded export: current Surface
Profiles and Cross Sections as sampled LandXML geometry, only when lossless
and schema-honest. No fake import models for sampled data.

Legend: SUPPORTED / BOUNDED / NOT_SUPPORTED / NOT_APPLICABLE. No "partial".

## Matrix

| Object | IMPORT | EXPORT | Reason |
|---|---|---|---|
| Units | SUPPORTED | SUPPORTED | m + international foot (0.3048 m exact) + USSurveyFoot. Unknown linearUnit BLOCKS import before geometry commit. No locale/filename inference. |
| CoordinateSystem | BOUNDED | BOUNDED | Metadata-only, never a transform (Phase 17D). Import: opaque metadata surfaced in preview; conflict with drawing CRS warns/blocks per coordinate-context policy. Export: EXPLICIT provenance only. |
| CgPoints | SUPPORTED | SUPPORTED | Pre-existing behavior, unchanged. N-E-elevation order, 6-dec export. |
| Parcels | BOUNDED | BOUNDED | Geometric rings only, no legal meaning. Import: curves stored as chord endpoints + warning; empty CoordGeom skipped + warning. Export: closed rings only, always flagged approximated. |
| Plan geometry (Line/Curve) | SUPPORTED | BOUNDED | Import: Line + circular Curve via shared N/E parser. Export: Line exact; Arc exported as chord approximation (radius dropped, flagged approximated) — pre-existing limitation, unchanged. |
| Horizontal Alignments | SUPPORTED | SUPPORTED | Line + circular Curve only, native CadAlignmentEntity preserved (no segment flattening). One unsupported element blocks the whole alignment (no truncation). |
| Station Equations | SUPPORTED | SUPPORTED | Mapped to native CadStationEquation[] (backStation/aheadStation/rawStation). STA/STA PT/profiles/sample lines consume identically post-import. |
| Spirals | NOT_SUPPORTED | NOT_APPLICABLE | No native spiral element. Any Spiral blocks its alignment import with LANDXML_ALIGNMENT_SPIRAL_UNSUPPORTED. No arc/segment approximation (would corrupt stationing). Nothing to export. |
| TIN Surfaces | SUPPORTED | SUPPORTED | Core GO. Import preserves explicit Pnts/Faces topology (never re-Delaunay). Export emits current retained mesh (post breakline/boundary/void) as deterministic Pnts/Faces. Stale (UNBUILT/NEEDS_REBUILD/FAILED/BROKEN_REFERENCE) surfaces block/omit, never export stale triangles. |
| GRID Surfaces | NOT_SUPPORTED | NOT_SUPPORTED | No native grid model. Never silently triangulated. Reason: LANDXML_SURFACE_GRID_UNSUPPORTED. |
| Volume Surfaces | NOT_SUPPORTED | NOT_SUPPORTED | Import: no trustworthy Base/Comparison relationship semantics verified — no fake volume relationship. Export: deferred, no verified mapping. |
| Breakline SourceData | BOUNDED | NOT_SUPPORTED | Import: face topology already preserves the TIN; SourceData import optional metadata/reference only, never required, never inferred from constrained-looking edges. Export: no SourceData emission; Faces carry topology. |
| Surface Profiles | NOT_SUPPORTED | BOUNDED | Import: CadSurfaceProfile means live TIN relationship; arbitrary PntList2D has none — LANDXML_PROFILE_IMPORT_UNSUPPORTED. Export: allowed only when profile CURRENT + lossless mapping proven; gaps only via multiple PntList2D else LANDXML_PROFILE_GAP_UNREPRESENTABLE; presentation (grid/exaggeration/datum/colors) never emitted. |
| Design Profiles | NOT_SUPPORTED | NOT_SUPPORTED | No native PVI/vertical-curve/design-profile model. Never imported as Surface Profiles (sampled vs design distinction preserved). |
| Cross Sections | NOT_SUPPORTED | BOUNDED | Import: native 18K section means sample-line + live TIN source; sampled CrossSectSurf alone provides none — no fake source. Export: allowed only when CURRENT + lossless; offset sign converted (WebNet left-positive to LandXML right-positive); gaps block unless representable; no Section View presentation. |
| Section Views | NOT_APPLICABLE | NOT_APPLICABLE | Pure WebNet presentation (scales, bands, sheets). No LandXML semantics. |
| Roadways | NOT_SUPPORTED | NOT_SUPPORTED | No native roadway model. |
| Pipe Networks | NOT_SUPPORTED | NOT_SUPPORTED | No native pipe-network model. |

## Cross-object invariants (all SUPPORTED/BOUNDED cells)

- One authoritative LandXML N/E coordinate parser shared by CgPoints,
  Surface P, and Alignment Start/End (oracle: same coordinate resolves to
  same WebNet E/N everywhere).
- Unit conversion shared with existing geometry (17C factors); civil objects
  obey identical conversion.
- CRS metadata honest and non-transforming (17D).
- Every parsed civil object gets IMPORTABLE / WARNING / UNSUPPORTED / BLOCKED
  with stable reason codes; no silent drops.
- Commit is atomic (all selected objects or drawing unchanged) on the CAD
  history seam (one undoable transaction where practical).
