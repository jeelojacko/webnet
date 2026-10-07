# Dependency Graph + Roadmap (baseline main 5478ccf4)

## Shared infrastructure, ranked by leverage

1. **Closed-polyline draw sessions** (Rectangle + Polygon modes). Unlocks:
   Shapes v1 with ZERO new schema — `CadPolygonEntity` + render/pick/
   transforms/props/persist/DXF-polyline all exist. Only the interactive
   session + 2 flyout wirings are missing.
2. **Generic conic render/hit-test path.** Unlocks drafting Ellipse: the
   error-ellipse pipeline (entity→primitive→pick→persist→DXF-paper-ELLIPSE)
   proves every layer; only a drafting entity + Center command + model-space
   DXF ELLIPSE are missing.
3. **Circle entity decision.** Unlocks Circle: either new `CadCircleEntity`
   (+ render/hit/DXF CIRCLE) or a policy decision relaxing the 360° sweep
   guard (`cadParcelArcGeometry.ts:70`) with full-circle arc semantics.
   Needs a small study/policy note first (sweep semantics, DXF round-trip).
4. **Polyline capability upgrades** (Close, backstep, bulge/arc segments,
   width, vertex insert/delete). Lifts Polyline + Shapes + arc conversion;
   touches command sessions + `CadPolylineEntity` schema (bulge/width) +
   DXF. Medium risk: schema touch.
5. **Line chaining.** Small session addition on existing LINE path. Low risk.
6. **Point Z + symbol-at-creation.** Typed-entry extension (currently 2D-only
   `parseAbsolutePoint`) + style pick wired to existing style system.
7. **BestFit design (policy first).** Inputs (selected survey points?),
   output entity (2-vertex polyline + report?), residual UI, tolerances.
   Only then: least-squares line fit reusing adjustment infra.
8. **Fill/region engine (design first).** Derived filled-region primitive +
   boundary extraction + DXF SOLID approximation for Hatch solid; patterns
   and associativity are separate later phases.

## Cross-cutting global gaps (one fix helps all tools)

- Typed Z / elevation entry (2D everywhere: parsing, preview, schema use).
- Ortho / free polar-angle / grid / tracking snaps (14 2D kinds only).
- Right-click finish + command repeat (absent globally).
- DXF/DWG import (export-only asymmetry affects every entity kind).
- Engine hit-test for viewport picking (currently DOM/SVG pads; engine
  `entityIntersectsBounds` used only by tests/benchmarks).

## Phased roadmap (compare, don't blindly adopt)

- **Phase A (recommended next, LOW risk): Shapes v1.** Rectangle two-corner
  + Polygon inscribed/circumscribed → closed `CadPolygonEntity`. Files:
  one new session module + `cadRibbonToolFamilies.ts` unwire 2 rows +
  registry/starter entries + focused unit + browser spec + PNGs. No schema.
  Acceptance: both modes create closed polygons transactionally with
  undo/redo/persist/DXF-polyline/grips/props; rows enabled; manifest test
  updated; 0 console errors.
- **Phase B (LOW-MEDIUM): Circle v1.** Policy note (entity vs sweep
  relaxation) + center-radius command + render/hit + DXF CIRCLE. Browser QA.
- **Phase C (MEDIUM): Polyline upgrades.** Close/backstep first (no schema),
  then bulge/width (schema + DXF). Arc↔bulge conversion.
- **Phase D (MEDIUM): Ellipse drafting.** Generic entity + Center command +
  model-space DXF ELLIPSE.
- **Phase E (policy first): BestFit line.** Design inputs/outputs/residuals,
  then fit + report.
- **Phase F (design first): Hatch solid.** Boundary extraction + derived
  fill + DXF approximation.
- **Elsewhere (not Draw-scoped):** Line chaining, Point Z/symbols, DXF
  import, ortho/polar/grid, repeat/right-click-finish — small global
  work orders, any phase.

## Risk register (top)

- Schema touches (circle/ellipse/bulge/width) need migration + DXF
  round-trip proof — keep Phase A schema-free.
- Sweep-guard relaxation (if chosen for Circle) interacts with parcel
  arc validation — pin with regression tests.
- DOM-pad hit-testing diverges from engine bounds for empty primitives —
  document, don't fix in tool phases.
- BestFit/Hatch without prior design will repeat the planned-row trap:
  UI first, semantics never. Design docs first.

## Addendum — Phase C1/C2 current state (2026-10-07)

Historical baseline above is unchanged. Item 4 (Polyline capability upgrades)
and Phase C are now largely delivered: Phase C1 (`feat/cad-polyline-close-backstep-c1`,
baseline `5aa6441`) shipped Close + session backstep schema-free, and Phase C2
(`feat/cad-polyline-bulge-width-c2`) shipped per-course arc legs + centred band
width via additive trailing optional `segmentGeometry`/`segmentWidths` (no
version bump, no migration). Remaining from item 4: vertex insert/delete. Still
missing globally: line chaining, Point Z, DXF/DWG import, ortho/polar/grid,
repeat, right-click finish. Evidence:
`docs/evidence/cad-polyline-c1-close-backstep/`,
`docs/evidence/cad-polyline-c2-bulge-width/`.
