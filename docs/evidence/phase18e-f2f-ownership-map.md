# Phase 18E — Current F2F Ownership Map (baseline 43223e16, PR #94 merged)

Source: scout-f2f-core + scout-f2f-own read-only recon, verified against working tree.
Goal: answer "What Field-to-Finish catalog is authoritative for this drawing?" — today the answer is **workspace React state, not the drawing**.

## CATALOG DATA (FeatureCodeCatalog object)

- **Location:** `SurveyCadWorkspace.tsx:310` `useState(cloneSampleCatalog)` + `featureCatalogRef`; panel-local fallback `SurveyCadFieldToFinishPanel.tsx:62`.
- **Status:** WORKSPACE-OWNED, SESSION-ONLY, NOT PERSISTED.
- **Default source:** `src/engine/fieldToFinish/sampleCatalog.ts` (`sample-generic`, v1, 7 defs, alias EP→EDGE).
- **Proof:** `CadProject` (`cadTypes.ts:371-400`) has NO catalog field (grep confirms); `handleNewDrawing` (471-478) / `handleOpenDrawingChange` (493-511) never reset catalog — catalog silently persists across document swaps.
- **Export:** `exportCenter.ts:459` exports exactly the workspace object; `importCatalog` has zero non-test callers.

## CATALOG EDIT STATE (draft form values, search/sort/selection)

- **Location:** `SurveyCadFeatureCatalogEditor.tsx` local `useState` (selected id, alias adder), panel tab state.
- **Status:** SESSION-ONLY, DERIVED, NOT PERSISTED. Search/sort/selection never dirty the drawing (18E must keep it that way).

## CATALOG REVISION (what "version" means today)

- `FeatureCodeCatalog`: `{ id, name, version, definitions[], aliases[] }` — `version` is display-only (`SurveyCadFeatureCatalogEditor.tsx:103`), nothing in `src/` sets it except sample (`'1'`).
- `FieldToFinishLink.catalogRevision` = `catalog.version` at generation time (`linkedSync.ts` linkOfPayload: `first.catalogVersion ?? ''`), NOT a content hash.
- Edit-time classifier `classifyCatalogChange` (`linkedSync.ts:181-190`): referential identity → `version !==` → order-sensitive `JSON.stringify(definitions)` → `JSON.stringify(aliases)`. Result `CATALOG_CHANGED` only when version string changes (unreachable in practice — catalog edits classify as `FEATURE_METADATA_CHANGED`); reorder-only edits falsely dirty.
- No content hash exists. `catalogsSemanticallyEqual` (`catalogIo.ts:199-220`, order-insensitive) is test-only.

## IMPORT REVIEW DATA (parsed points, runId, preview payload)

- **Location:** `SurveyCadFieldToFinishPanel.tsx`: `runImport` (137-153) → `parseTerrestrialCoordinateCsv` → `controlStationsToFieldToFinishPoints` → `setPoints`, `runId` (`ui-N`); preview tab builds payload only (`buildFieldToFinishPayload`, 82-97).
- **Status:** SESSION-ONLY, DERIVED, NOT PERSISTED. Rebuilt per import; `previewFieldToFinishRegen`/`applyFieldToFinishRegen` have zero production callers (dev harness only).

## GENERATED ENTITY PROVENANCE

- **Location:** per-entity `provenance` (`cadGeneration.ts:56-68`): `generatedBy:'FIELD_TO_FINISH'`, `sourceImportId?/sourceFileHash?/sourceRecordId?/sourceStationId?`, `featureDefinitionId?`, `catalogId?`, `catalogVersion?`, `generationRunId?`, `state: GENERATED|MANUAL_OVERRIDE|DETACHED`.
- **Status:** DRAWING-OWNED, PERSISTED (entities persist in WNCAD). Provenance survives save/reopen; it is the ONLY catalog trace in legacy files (id/version/definitionId, no catalog contents).

## F2F LINK (FieldToFinishLink)

- **Location:** `project.metadata.fieldToFinishLink` (`cadTypes.ts:368`, type in `linkedSync.ts:40-67`); cloned/persisted (`cadPersistence.ts:133-141`).
- **Status:** DRAWING-OWNED, PERSISTED. Fields: generationRunId, catalogId, catalogRevision (=version string), sourceKind, sourceRevision (+fingerprints), sourceRecordIds/stationIds/generatedEntityIds/generatedLabelIds, syncPolicy manual, status.
- **Staleness:** snapshot classifier `computeSyncStatus` (strict `!==` chain, precedence UNLINKED > MISSING_SOURCE > MANUAL_CONFLICT > CATALOG_CHANGED > SOURCE_TOPOLOGY > FEATURE_METADATA > COORDINATES > CURRENT); edit-time stamp `stampCatalogStaleStatus` gated on CURRENT/COORDINATES_CHANGED; rerun path `linkedRerunSync.ts:295` never fed catalogRevision/sourceRecordIds in production.

## MANUAL OVERRIDES

- **Mechanism:** `provenance.state` transitions via `markFieldToFinishManualOverride` / `detachFieldToFinishEntity` (`regeneration.ts:246-267`, `replaceCadProjectEntities`-based); regen removal skips non-GENERATED (`regeneration.ts:199-201`); rerun moves GENERATED only, DETACHED untouched.
- **Status:** DRAWING-OWNED, PERSISTED (per-entity state). **No production UI caller** (dev harnesses only) — overrides exist as data contract, not reachable workflow.

## REGENERATION STATE (preview/commit/link status)

- **Commit:** `onCommitPayload` → `useSurveyCadWorkspace.ts:441` → `runFieldToFinishCommand` → CAD command `F2F_GENERATE` (one undoable transaction). Linked commit stamps adjustment fingerprints.
- **Status:** DERIVED (link status + snapshot compare), PERSISTED (link object). Preview is SESSION-ONLY (payload built, never persisted); no auto-regen on catalog edit (explicit review chain preserved).

## Ownership summary table

| Item | Drawing | Workspace | Session | Derived | Persisted |
|---|---|---|---|---|---|
| Catalog data | NO | YES | YES | no | NO |
| Catalog edit/search/sort | no | no | YES | YES | NO |
| Catalog revision (version string) | link copy only | YES | no | compare | link only |
| Import review data | no | no | YES | YES | NO |
| Entity provenance | YES | no | no | no | YES |
| F2F link | YES | no | no | status | YES |
| Manual overrides | YES | no | no | no | YES |
| Regen preview | no | no | YES | YES | NO |

## 18E consequences (binding)

1. Add `fieldToFinishCatalog` (or named nested resource) to `CadProject`; deep-clone in `cloneCadProject` **in the same trailing position** (signature is key-order-sensitive `JSON.stringify`); backfill on load; reset/derive on new/open.
2. Introduce deterministic content revision `computeFeatureCatalogRevision` (semantic fields, stable ordering); link stores catalog id + revision; derived `CATALOG_CHANGED` comparison; undo-exact-restore may return CURRENT.
3. Legacy: no catalog + no F2F content → seed starter; no catalog + F2F content → MISSING/LEGACY-UNRESOLVED, regen blocked, surface provenance catalogId/version/definitionId, never claim SAMPLE authority.
4. Control-token aliases (`BEGIN/CONTINUE/END/CLOSE/BREAK`) are session-only/inert (no production caller passes them; review hardcodes `{}`); 18E decides drawing home (`FieldToFinishSettings.controlTokenAliases`) without vendor formats.
5. No F2F Toolspace node; ribbon has single `f2f` entry → drafting panel; no `F2F_*` command ids; snapshot has no catalog field — manager/Toolspace/ribbon wiring is greenfield on drawing-owned state.
