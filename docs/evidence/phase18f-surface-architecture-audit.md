# Phase 18F Surface Architecture Audit

Date: 2026-09-18. Question: does a production surface/TIN model already
exist anywhere? Answer: NO — 18F builds the first one.

## Method

Read the candidate owners end to end; did not infer from test names.

## Findings

- **Drawing model** (`src/engine/cad/cadTypes.ts`, `CadProject` L373–410):
  layers, style library, entities, F2F catalog/settings — no surface,
  boundary, breakline, or TIN concept existed before 18F.
- **Display** (`cadDisplayTypes.ts`, `cadRenderer.ts`): entity primitives
  only; no surface layer, no contour/triangle rendering path.
- **No CAD worker**: only the adjustment `adjustmentWorkerHandler.ts`
  pattern exists; no surface build/snapshot worker, no surface cache.
- **Transactions** (`cadTransactions.types.ts` + `cadUndoRedo.ts`,
  `runCadCommand`): no SURFACE_* command keys; undo covers entities,
  layers, parcels, styles — not surfaces.
- **No Surfaces Toolspace / ribbon placeholder**: no UI affordance, command
  stub, or menu entry references surfaces.
- **WNCAD** (`cadDrawingFile.ts`): v2 additive precedent (optional trailing
  tables, key-order-sensitive signatures) — the pattern 18F follows for
  `surfaces?` / `surfaceStyles?` (no schema bump).
- **F2F provenance** (`cadGeneration.ts` L720): linework chains carry
  `metadata.sourcePointIds` (station ids) — the Z-resolution source 18F
  breaklines reuse via `sourcePointsOf` (`linkedSync.ts` L380).
- **Spatial index**: linear scan (`cadSpatialIndex.ts` lineage); 18F queries
  use a small uniform grid local to each build, no GIS framework.
- **Layer roles**: closed union (`points`, `control-points`, …); 18F adds
  no new role requirement (surfaces reference layers by id only).

## Conclusion

NO production surface model exists. 18F is greenfield by design:

- `cadTypes.ts`: `CadSurface*` model types + trailing optional
  `CadProject.surfaces?` / `surfaceStyles?` (18E precedent).
- `cadSurfaces.ts` + `src/engine/cad/tin/`: pure deterministic
  revision/build/status/interpolation engine; zero triangle entities.
- Solver/parity math untouched; no new runtime behavior outside CAD surfaces.
