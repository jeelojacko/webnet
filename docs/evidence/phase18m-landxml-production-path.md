# Phase 18M — LandXML Production Path (baseline audit)

Baseline: `10ed75d7826d72d78d2837ebcfa6518c3ae5b424` (origin/main, matches mission creation).
Branch: `feat/cad-landxml-production-import`.

## Current engine path (18L, exists)

```
XML text
  -> buildLandXmlImportPreview  (src/engine/landxmlImport.ts:148)
  -> commitLandXmlImport        (src/engine/cad/cadLandxmlCommit.ts:65)
  -> ONE LANDXML_IMPORT transaction (runCadCommand, cadUndoRedo.ts:58)
```

- Preview contract: points/lines/curves/parcels/alignments/surfaces/units/crs/inputHash/unsupported/warnings/duplicates.
- Units: `m | ft | usft`; unknown linearUnit BLOCKED before geometry.
- CRS: opaque metadata string, never transformed.
- Commit: only IMPORTABLE|WARNING committed by default; explicit UNSUPPORTED/BLOCKED selection fails closed, state unchanged.
- Report has NO `importedSurfaceIds` — 18M adds it.
- **Sync mesh build inside commit** (`cadLandxmlCommit.ts:182-192`): main-thread `buildCadSurface` + `applySurfaceBuildSuccess`. Must NOT reach production UI for large TINs.

## Current production UI: NO reachable civil-import command (confirmed)

- `SurveyCadWorkspace.tsx`: zero LandXML import references.
- `CAD_SHELL_COMMANDS`: no Import entry; no `LANDXMLIMPORT` key anywhere.
- Only production `'imported-tin'` awareness is display-side (`cadSurfaceSnapshot.ts`, `CadSurfaceDefinitionEditor.tsx`).
- Only non-test caller of preview/commit is dev harness `surveyDrafting13cSteps.ts` (manual append, not `commitLandXmlImport`).

## Seams mapped

- **File menu**: flat registry (`CadMenuBar.tsx`), no submenus. Import = flat `SHELL_IMPORT_LANDXML` action entry (or hardcoded block). New action keys need BOTH availability + dispatch cases (silent no-op trap).
- **File picker**: hidden `<input type=file accept=".xml">` (specs disable FS Access APIs). Helpers in `src/engine/browserFileIo.ts`.
- **Review UI**: precedent `AppImportReviewModal.tsx`; CAD-local precedent `ExportCenterPanel.tsx` + F2F catalog notice.
- **History/dirty**: undo/redo in `useSurveyCadWorkspace`, dirty in `useCadAppController.applyDrawingChange`. Import must route through both (precedent: `runLayerCommand`).
- **Surface builds**: `SurfaceBuildService` (serial queue, one worker per service, ownership gauntlet in `complete`). Imported-TIN routes through existing `buildSurfaceBuildRequest`/`buildCadSurface` with NO protocol change (definition clone carries vertices/faces; `materializeImportedTin`, no Delaunay).
- **Status**: BUILDING overlay via `buildingSurfaceIds`; CURRENT/FAILED/UNBUILT otherwise. No STALE status (boolean overlay).
- **Export Center**: `landxml` format reachable via `SHELL_EXPORT_CENTER`; LandXML export requires CURRENT + cached mesh.
- **WNCAD**: imported TIN persists as vertices/faces + provenance; mesh rebuilt on reopen. No schema change needed.
- **Browser tests**: `tests-browser/cad-landxml-18m.spec.ts` (new), hidden-input injection, baseURL convention.

## 18M deltas (planned)

1. `LandXmlCommitReport.importedSurfaceIds` + skip-sync-mesh commit option (sync helper retained for unit tests).
2. `SHELL_IMPORT_LANDXML` command + File menu entry + `LANDXMLIMPORT` alias.
3. Import Review panel (summary/units/CRS/counts/selection/warnings/unsupported).
4. Workspace commit through history seam → schedule imported TINs via `SurfaceBuildService` (BUILDING → CURRENT/FAILED).
5. Ownership: drawing-switch safety, undo-during-build discard (reuse 18G patterns).
6. Full-circle Curve: explicit SUPPORT or BLOCK (audit in worker 1).
7. Fixture + browser QA + large-TIN evidence (`phase18m-landxml-browser-performance.md`).

## Known gaps flagged

- Roadway/PipeNetwork/Volume silently ignored by importer (evidence doc over-claims) — count or correct doc.
- `syncFallback` 1000-point limit measures survey points, not imported vertices — adjust for imported-tin.
- `buildSurfaceBuildRequest` snapshots all survey points even for imported surfaces — prune if cheap.
