# CAD Draw Phase L1 — Line creation family architecture

Phase L1 turns the 16 previously-planned Civil-reference Line rows into live
WebNet commands. The engine math is Worker A (`src/engine/cad/cadLine*.ts` +
`cadTransactionsLineBatchCommand.ts`); icons are Worker C. Worker B owns the
session/registry/ribbon/workspace integration described here.

## 1. Module map

| Layer | Files | Responsibility |
|---|---|---|
| Keys | `src/hooks/surveyCad/useSurveyCadLineL1Keys.ts` | Canonical 16-key list, labels, hints, `createdBy` provenance. Dependency-free (imported by the type union, registry, ribbon, session). |
| Session | `src/hooks/surveyCad/useSurveyCadLineL1Session.ts` | `CadLineL1SessionState` factory, prompt/help, draft preview, point-pick handling, one-batch `commitCadLineL1Batch`, `GRIP_EDIT` commit, backstep. Reuses Worker A resolvers only. |
| Typed submit | `src/hooks/surveyCad/useSurveyCadLineL1Submit.ts` | Per-mode typed grammar → Worker A parsers/resolvers → draft or commit. Always returns true for an L1 session so the generic point parser never consumes mode syntax. |
| Seams | `useSurveyCadCommandTypes.ts`, `useSurveyCadCommandStarters(.types).ts`, `useSurveyCadCommandSession.ts`, `useSurveyCadConsumePoint.ts`, `useSurveyCadTypedSubmit(.types).ts`, `useSurveyCadCommandText.ts`, `useSurveyCadCommandHelpText.ts`, `useSurveyCadCommandPreview.ts`, `useSurveyCadCommandConstruction.ts`, `useSurveyCadCommandAvailability.ts`, `useSurveyCadCommandLifecycle.ts`, `useSurveyCadCommands(.types).ts`, `useSurveyCadWorkspace(.types).ts` | Switch/union wiring for the 16 keys. |
| Shell | `cadCommandRegistry.ts`, `cadRibbonToolFamilies.ts`, `SurveyCadWorkspace.tsx` | Registry rows, ribbon activation, `shellStarters` dispatch. |
| Bridge | `src/cad-app/cadSnapshotImport.ts` | Adopts the source `coordinateContext` into `CadProjectMetadata.coordinateContext` ONLY for a blank new drawing; never clobbers an existing drawing's context. |
| Engine (Worker A) | `cadLineTypes/Parsers/Construction/CoordinateContext/SurveyResolvers/EntityResolvers/Batch.ts`, `cadTransactionsLineBatchCommand.ts` | Pure math: parsing, directional geometry, CRS, station/alignment/entity resolution, batch build, `LINE_CREATE_BATCH`. |
| On-source engine (correction) | `src/engine/cad/cadLineOnSourceResolvers.ts` | Corrected TANGENT/PERP pure math: finite-segment / finite-sweep on-source projection parameterized by the viewport snap tolerance (engine clamps it into a documented absolute window) and floor-safe for short sources, source tangent/normal frames (line / arc / circle), signed ray endpoint, and two-ray click tie. |

## 2. Session state

`CadLineL1SessionState` is one shape for all 16 modes; only the used fields are
populated:

- `lineSegments: CadLineSegmentInput[]` — the ordered draft. It is the actual
  commit payload; nothing here touches the drawing while drafting.
- `lineAnchor: CommandPoint | null` — live chain tip (or the explicit start /
  occupy / reference point, depending on the mode).
- `lineReferenceStart/End` — reference course for ANGLE / DEFLECTION.
- `lineSourceEntityId/PickPoint/Endpoint/Side` — picked source for EXTENSION /
  FROM_END / TANGENT / PERP.
- `lineAlignmentId` — selected alignment for STATION_OFFSET.
- `resultText` — explicit safe reason shown by the prompt/dock echo.

## 3. Commit law

- **Creates** go through the shared `LINE_CREATE_BATCH` transaction
  (`lineCreateBatchCommand`): every segment is validated against
  `isCadLineSegmentValid` before any entity is created, all created lines land
  on the current layer, and the whole draft is ONE undo entry. `metadata.createdBy`
  records the mode key.
- **Extension** is NOT a create: `resolveCadLineExtensionFromText` returns the
  updated `CadLineEntity`, and the session applies it through `GRIP_EDIT`
  (`line-end` / `line-start`). The id, layer, metadata, and station labels are
  preserved — no new entity.
- Invalid/partial input replaces the session with an explicit `resultText` and
  never mutates the drawing.

## 4. Draft chain and backstep

For chain-like modes the draft advances `lineAnchor` per captured point and
appends one segment per new point. `U` / `UNDO` / `BACKSTEP` reuses the C1
session-local backstep law (`backstepCadLineL1Session`): it drops the newest
segment (or clears the pending anchor) with no history entry. Escape cancels the
session with zero mutation. Enter on an empty input commits a complete draft
(`cadLineL1CanFinish`) via `LINE_CREATE_BATCH`.

## 5. Preview

`buildCadLineL1Preview` emits dashed preview primitives for the drafted
segments plus a tip marker, and a hover segment from the tip to the pointer for
the chain-like modes. It never fabricates server-side geometry.

## 6. Activation and ribbon

`cadRibbonToolFamilies.ts` keeps the family id `line`, default
`line-create`, and `useCadToolFamilyState` UNCHANGED. All 17 rows drop
`planned:true` and carry full `commandKey`s; Worker C's curated icons are
preserved. `LINE` + alias `L` remain the default face. Typed `LINE_*` command
text does not change the sticky variant (dispatch is separate from
`selectVariant`). New/Open resets via `drawingId::generation`.
