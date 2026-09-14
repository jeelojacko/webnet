# Phase 13A — Post-GNSS product audit

Branch `feat/post-gnss-roadmap-audit` · Baseline `c1b60f2f` (origin/main = PR #63 merge).
Phase 12J TERMINAL, remains closed. No production behavior changed in this phase (docs + reports only).
Evidence: 5 read-only scout sweeps + parent verification greps (2026-09-14). Every classification cites repo evidence.

## 1. Executive summary

WebNet is no longer "an adjustment package with GNSS coming". It is a production adjustment system
(TS-dense + bounded default-ON native routes), a production static-GNSS system (imported baselines,
GVX, free-network opt-in, raw review/export-only with ANTEX-subset sessions), a production CRS stack
(Canada + US SPCS catalog wired into solve gates), a production terrestrial project system, and —
the largest surprise — a production **Survey CAD core** (`src/engine/cad/`, 130 modules; 30 surveyCad
components; 52 surveyCad hooks) covering COGO, parcels, curves, alignments, and traverse adjustment.

Consequences:

- The mission's preferred next phase (**COGO + parcel/boundary foundation**) is **largely SUPERSEDED
  as a foundation**: inverse, bearing-distance creation, intersections, offsets, curves, traverse
  closure/adjustment, area, station/offset, parcel create/split/layout/diagnostics all ship.
- The old roadmap pointers most likely to mislead are **12E0 GVX prep** (GVX is production intake),
  **12I.1 free-network MVP** (production opt-in), **"add multi-file support"** (terrestrial projects
  are production), and **"basic CRS infrastructure"** (catalog + solve wiring ship).
- One correction to prior claims found during audit: multi-file **GNSS composition is engine-complete
  but product-unwired** — `runGnssMultifileProjectSolve` has zero production callers outside
  `src/engine/gnssMultifile*` (tests only — the evidence script drives the composer + adjustment directly, not the project API). Docs saying named-project runs compose
  automatically (`CURRENT_BEHAVIOR.md:110`, `STATIC_GNSS_WORKFLOW.md:38`) overstate.
- Recommended next major phase: **13B Survey drafting + deliverable output** (labels-for-all, sheets,
  title blocks, SVG/PDF export, DXF export via isolated adapter, CAD point/line tables). Rationale §13.

## 2. Current capability matrix

| # | Area | Class | Evidence (one cite each) |
|---|---|---|---|
| A | Terrestrial LSA | PRODUCTION | `src/engine/adjust.ts:57` `LSAEngine`; `tests/adjust/adjust.01–09` |
| B | 2D/3D solver | PRODUCTION | `buildSolveParameterIndex(is2D)` (`adjustmentPreprocessing.ts:183`); 3D native full-Qxx ≤768 default ON |
| C | Sparse/native/WASM | PRODUCTION (bounded, fail-closed) | default-ON routes `adjustmentSparseAutoRoute.ts:65`, `preanalysisSparseAutoRoute.ts:83`, `adjustmentNativeFullQxxAutoRoute.ts:74`, `gnssBaselineNativeR2BRoute.ts:87`; docs calling it experimental are STALE (see §3) |
| D | Statistics/QC | PRODUCTION | SEUW/χ² (`adjustmentStatisticalMath.ts`), standardized residuals + MDB (`adjustStatisticsStandardizedResiduals.ts:346`), localTest 3.29 |
| E | Preanalysis | PRODUCTION | 8A.7 hook enabled (`CURRENT_BEHAVIOR.md:15`); `tests/phase8a7_preanalysis_production` |
| F | Blunder detection | PRODUCTION (bounded: 3 cycles, \|t\|≥3, deweight ×4, no removal) | `adjustRunModeWorkflows.ts:23` |
| G | Robust | PARTIAL (Huber production; IGG/Danish ABSENT — no hits in `src/`) | `adjustmentHuberLoop.ts:70`; `RobustMode='none'\|'huber'` |
| H | Terrestrial parsers | PRODUCTION; terrestrial CSV import ABSENT | DAT families (`parseConventional*`, `parseTraverseRecords`, direction sets); importers DBX/JobXML/RW5/TDS/FieldGenius/OPUS; CSV exists for GNSS baselines only |
| I | GNSS baseline adjustment | PRODUCTION | `gnssBaselineAdjust.ts` + workspace (`AppShell.tsx:153`), native R2B default ON, constrained default |
| J | Static multi-file GNSS | PARTIAL — engine PRODUCTION, product wiring ABSENT | engine+flag+tests (`gnssMultifileProject.ts`, `gnssMultifileDefaultOn.test.ts`, 12H.2 browser E2E) BUT zero `src/` callers outside engine (verified); single-session UI (`GnssWorkspacePanel.tsx:113`) |
| K | Free-network GNSS | PRODUCTION (opt-in, TS-dense only, cap 250) | `gnssFreeNetwork.ts`, Datum Handling selector, 12I.2 E2E 13/13 |
| L | GVX/TBC | GVX PRODUCTION; TBC parity PARTIAL (1/4, gates F/I FAIL); T01/DAT ABSENT | `gnssGvx*.ts`; `reports/gnss/phase12e-tbc-commercial-parity.md` |
| M | Raw RINEX | PRODUCTION review/export-only | `gnssRawRnx2rtkp.ts` (pin `rnx2rtkp 2.5.1 @62d4677`, GPS-only), STAR/MST/MANUAL (`gnssRawSessionGraph.ts:16`), `FORMAL_UNCALIBRATED`, no BL export, DIRECT_INGEST NO |
| N | ANTEX | PRODUCTION on session path; single-baseline path ABSENT | `gnssAntexSubset.ts` + 63/63 parity (12J.10); `GnssRawBaselinePanel` has no ANTEX input |
| O | CRS/geodesy | PRODUCTION catalog + workflow; narrow gaps (§5) | `crsCatalog.ts:16`, `geodesyProjection.ts` (proj4), Canada UTM/MTM/provincial incl. NB stereo EPSG:2953, grid/ground + factors, geoid loader, CRS picker UI |
| P | Project/multi-file | Terrestrial PRODUCTION; GNSS composition unwired (see J) | `projectWorkspace.ts` (checked files, manifest order), includes, aliases, persistence (IndexedDB/OPFS), portability |
| Q | Map/graphics | Map + CAD renderer PRODUCTION; layers/symbols/line-labels PARTIAL | `mapView/`, `cadRenderer.ts`, `cadSpatialIndex.ts`; 2 linetypes, radius-only point symbols, no GNSS-vector symbology |
| R | COGO | Mostly PRODUCTION (§8) | inverse, intersections, curves, traverse+adjustment, alignments, batch deed parser; ABSENT: resection, best-fit, point groups, rotate/scale/mirror/Helmert |
| S | Parcel/boundary | Geometric parcel PRODUCTION; legal model ABSENT (§9) | create/split/layout/overlap-gap diagnostics; ABSENT: lots/blocks taxonomy, easements/ROW, monuments, record-vs-measured, provenance |
| T | Drafting/output | CAD model/persistence PRODUCTION; plan deliverables ABSENT (§10) | `.wncad` native save, COGO reports, adjustment exports; ABSENT: sheets, title blocks, north arrow, scale bar, PDF/SVG/DXF export |
| U | Import/export interop | Mixed (§11) | JobXML/JXL, RW5, FieldGenius, DBX, OPUS, report-HTML implemented; LandXML/GeoJSON export-only; DXF spike-only; Trimble CSV/SHP/GPKG planned-only |
| V | Field-data workflows | PARTIAL | per-importer point codes/descriptions; CAD `featureCode` declared+displayed but never assigned (dead field); no linework-code system |

## 3. Completed-but-stale backlog

Full list with anchors: `reports/roadmap/phase13a-todo-reconciliation.md`. Headlines:

- 6 stale open checkboxes (12J.6, 12I.1, 12F.2 ×2, 12E0, 12A) + 12J.9 (merged as 58d7cbed) + 12J.10 text ("PR #63 open", merged as `c1b60f2f`).
- Superseded: 12E0 TBC checklist (closed by 12E.2/12E.3 evidence); 12I.0 "design only" §§22/33/39 (implemented); GVX prep framing (production intake); session-path ANTEX deferral (12J.10 closed it).
- Contradictions: native routes described as experimental (`CURRENT_BEHAVIOR.md:11,208`, `ARCHITECTURE.md:117`, `cpp/README.md:5`, `CPP_WASM_ENGINE.md:224`); CAD seams called "planned" (130 modules shipped); multifile-GNSS auto-compose claim (unwired).
- Duplicates/ordering: two 12F.2 entries, 12I.2-before-12I.1, `TODO.md:951` placeholder.

## 4. Genuine open backlog

- GNSS product wiring (multifile UI/persistence), TBC parity gates F/I, calibrated raw covariance (frozen REVIEW_ONLY), PPP/PPK/RTK, T01/DAT, multi-GNSS widening, single-baseline ANTEX input.
- Terrestrial CSV import; LandXML/DXF import; SHP/GPKG; Trimble Access CSV; linework/feature-code pipeline (incl. dead `featureCode`).
- Drafting deliverables (§10); legal parcel model (§9); COGO transforms/resection/best-fit/point groups (§8).
- Custom CRS / epoch propagation / vertical-datum binding to CRS; IGG/Danish robust; native-route doc refresh.

## 5. CRS/geodesy state

Catalog + workflow both ship: Canada+US-SPCS registry, proj4 fwd/inverse, datum ops, grid/ground reductions wired into pre-solve gates and listing factor blocks, geoid/GTX/BYN loading, CRS picker UI. "Catalog exists" vs "workflow exists" is not the gap — both exist. Genuine gaps only: (1) closed catalog, no custom/raw-proj4 CRS; (2) no realization/epoch selection or ECEF↔CRS epoch propagation (`datumRealization` inert; GNSS frame/epoch separate); (3) vertical datum not bound to CRS; (4) no geocentric display for terrestrial jobs. No new CRS phase recommended before 13B.

## 6. Project/multi-file state

Terrestrial named projects are production end-to-end (checked-file run set, manifest order, aliases, shared stations, `.INCLUDE`, duplicate skips, one combined adjustment, IndexedDB/OPFS persistence, portability). "Add multi-file support" would be redundant. GNSS composition engine is frozen/tested/flag-ON but has no product caller — remaining work is *wiring* (multi-source picker, per-source enable, provenance UI, save-path portability enforcement), a small scoped phase, not architecture.

## 7. GNSS frozen state

PRODUCTION: imported static baselines; GVX/native baseline workflows; controlled adjustment; free-network opt-in (TS-only, cap 250); raw RINEX review/processing (baseline + STAR/MST/MANUAL sessions); deterministic ANTEX-subset sessions (63/63 parity). PARTIAL: multifile composition (engine only); TBC parity 1/4; ANTEX single-baseline. RESTRICTED (frozen): `FORMAL_UNCALIBRATED`; review/export only; DIRECT_INGEST NO; raw covariance policy untouched. ABSENT/DEFERRED: calibrated survey covariance, PPP, PPK, RTK/kinematic, T01/DAT decoding, production multi-GNSS widening. Phase 12J stays TERMINAL.

## 8. COGO state

PRODUCTION: inverse/multi-inverse, bearing-distance creation, turned/deflection angles, along-line/fraction/extend/offset/parallel/perpendicular, all major intersections incl. arc-line/arc-arc, traverse editor + closure + angular/Bowditch/transit adjustment, full curve geometry (PI-radius-delta, reverse/compound, tangent, subdivision), station/offset + alignments + stakeout labels, area/closure, point create/edit/grips, linework, batch deed-call parser. PARTIAL: transforms (translation only). ABSENT: resection, best-fit line/arc, LSQ→CAD handoff (one-way: Import Adjusted Points only), point groups, rotate/scale/mirror/Helmert/affine, Crandall. The foundation the mission hypothesized as "next" already ships; only the transform/resection/best-fit deltas remain.

## 9. Parcel/boundary state

Geometric parcel ships (entity, closure, area/perimeter/units, create-from-chain, overlap/gap diagnostics, split by line/bearing/area/slide/swing, frontage subdivision/auto-layout). Legal/boundary model is ABSENT: no lots/blocks taxonomy, easements, ROW, monuments, record-vs-measured, deed/plan provenance (only free-form COGO provenance + batch legal-call parser), no LandXML parcels. Survey-network observations vs legal parcel geometry are correctly separable today — reuse the geometric core, add an evidence model later.

## 10. Drafting state

Renderer, selection/snapping, `.wncad` persistence, COGO reports, adjustment exports all production. Deliverable drafting is ABSENT: no sheets/plan space, title blocks, north arrow, scale bar, legend, viewports, plot preview, PDF export, SVG export (in-app render only), DXF export (spike test only), DWG (ADR pending). Labels PARTIAL: curve/parcel/alignment labels ship; generic line bearing/distance labels are traverse-only; point symbols radius-only; 2 linetypes; no layer-management UI. This is the largest shippable gap sitting on top of the most complete substrate.

## 11. Field-to-finish state

Implemented: JobXML/JXL (points+measurements), STAR*NET DAT (native), Carlson RW5/TDS, FieldGenius, DBX, OPUS, survey-report HTML, `.snproj` settings adapter. Partial: generic CSV (GNSS only), terrestrial CSV absent. Export-only: LandXML, GeoJSON. Spike-only: DXF (mlightcad adapter; ADR 0002 no-go for shipping runtime in core). Planned-only: Trimble Access CSV, SHP/GPKG/FlatGeobuf. Codes: per-importer point code/description; CAD `featureCode` dead (never assigned); no linework-code system. Plan docs (`field-to-finish.md`, `file-io.md` items 3–10, master-plan Phases 5–10) are plan-only.

## 12. Prioritized candidate table

1–5 each: USER VALUE / COMPLEXITY (5 = simplest) / RISK (5 = safest) / DEPENDENCY READINESS / TESTABILITY / FIT.

| Candidate | UV | CX | RK | DR | AB | FT | Σ | Note |
|---|---|---|---|---|---|---|---|---|
| B1 Survey drafting + deliverable output | 5 | 4 | 5 | 5 | 5 | 5 | 29 | Geometry exists, nothing can leave the app; zero numerical risk; golden-file tests |
| B2 GNSS multifile product wiring | 3 | 4 | 4 | 5 | 4 | 4 | 24 | Engine done; small scoped UI/persistence work |
| B3 Field-to-finish code pipeline | 4 | 3 | 4 | 3 | 4 | 4 | 22 | Dead `featureCode` is the seam; needs importer unification |
| B4 Exchange widening (DXF/LandXML-in/Trimble CSV) | 4 | 3 | 4 | 3 | 4 | 3 | 21 | ADR-0002 boundary must hold for DXF runtime |
| B5 Parcel legal-evidence model | 4 | 2 | 2 | 4 | 3 | 4 | 19 | High legal risk; needs opinion-vs-geometry separation by design |
| B6 COGO delta (transforms, resection, best-fit) | 3 | 3 | 4 | 5 | 4 | 4 | 23 | Genuine but smaller than drafting gap |
| B7 CRS remaining (custom CRS, epochs) | 2 | 3 | 3 | 4 | 3 | 3 | 18 | Narrow gaps; no prerequisite status |
| B8 GNSS deferred (TBC parity, cal. covariance, PPP/PPK/RTK) | 2 | 1 | 1 | 2 | 2 | 2 | 10 | Explicitly NOT next: 12J terminal, policy frozen |
| B9 Reporting/export polish | 3 | 4 | 5 | 4 | 4 | 4 | 24 | Partly folds into B1 tables scope |

## 13. Recommended next phase

**13B: Survey drafting + deliverable output.** WebNet can compute, close, subdivide, and persist survey
geometry but cannot produce a plan sheet from it — every other substrate (adjustment, GNSS, CAD, CRS)
is blocked at the last mile. It is also the safest major phase available: no solver/math/tolerance/
covariance changes, deterministic golden-file testing, and it reuses the shipped renderer, `.wncad`
model, and COGO provenance.

## 14. Proposed architecture for 13B (design only, no implementation)

- **Label engine generalization**: bearing/distance labels for ALL line entities (today traverse-only,
  `cadRenderer.ts` `buildTraverseLabelPrimitives`), point labels for survey points (today separate text
  entities), curve-label extension, label collision/thinning rules from `mapView2dDerived.ts`.
- **Layer management**: user-visible layer model on `cadLayers.ts` (create/rename/visibility/lock UI;
  today `visible` never toggled by UI), linetype extension beyond 2 presets, plot-style lineweight rules.
- **Sheet model**: paper space + viewports + scale + north arrow + scale bar + legend + title blocks;
  new entity family alongside model entities, persisted in `.wncad` with migration + deterministic IDs.
- **Exporters**: SVG serializer (from `cadRenderer.ts` primitives — golden-file tests), PDF export
  (print-pipeline, smoke + reference PDFs), DXF export through an **isolated adapter** per ADR 0002
  (never ship GPL-touched runtime in core), CAD point/line/course tables (CSV/MD reusing `cadCogoReports.ts`).
- **Survey integration**: labels show measured/computed values with source tags from `CadCogoProvenance`;
  adjusted coordinates remain the immutable import source (`cadAdjustedPointsImport.ts` one-way);
  units/CRS annotation from project CRS (display-only, no transform changes).
- **Legal separation**: geometry ≠ opinion — no boundary-opinion fields; record-vs-measured stays in the
  deferred B5 evidence model.
- **Undo/redo + deterministic IDs**: extend `cadTransactions.ts` command pattern; sheet/export entities
  use `createStableRuntimeId`-style IDs; export byte-determinism (sorted entities, fixed float formatting).
- **Testing**: SVG golden files, PDF smoke + page-count/media-box asserts, DXF round-trip via spike
  runtime (test-only), layer/sheet persistence round-trips, agent-tier suites; no evidence-tier needed.

## 15. Explicit areas NOT recommended next

- **COGO+parcel foundation as a "new" phase**: already ships (§8–9); only deltas remain (B6/B5).
- **Any GNSS numerics/covariance/ingestion work** (B8): 12J terminal; `FORMAL_UNCALIBRATED`, REVIEW_ONLY,
  DIRECT_INGEST NO all frozen.
- **New CRS infrastructure**: catalog + workflow ship; remaining gaps narrow (B7).
- **"Add multi-file support"**: terrestrial ships; GNSS needs wiring only (B2).
- **Solver/parser/math changes of any kind**: out of scope for a drafting phase by construction.
