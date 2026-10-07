# CAD Draw Phase L1 — drawing coordinate context

`LINE_GRID_NE` and `LINE_LATLONG` are the only L1 modes that need an
authoritative drawing grid/CRS; both fail closed without one.

## 1. The seam

Worker A added `CadCoordinateContext` to `CadProjectMetadata.coordinateContext`:

```ts
interface CadCoordinateContext {
  crsId: string | null;   // null/absent => no grid context
  crsLabel?: string | null; // provenance/prompting only, never transformed
}
```

Resolvers (`resolveCadLineCoordinateContext/GridNePoint/LatLongPoint`) read this
field. A blank `crsId` is unusable; the transform then goes exclusively through
the shared geodesy authority (`projectGrid` / `inverseGrid`) — there is no second
projection path.

## 2. Ownership / lifecycle law (same-CRS keep, otherwise deprovenance)

- **Writer:** `src/cad-app/cadSnapshotImport.ts` (`importSnapshotIntoCadDrawing`),
  via `resolveImportedCoordinateContext`. The source CRS is a *claim*, not proof
  that the drawing's XY is that grid's XY, so the import only keeps or
  establishes provenance — it never relabels a drawing:
  - a drawing that already has a usable `crsId` keeps it **only when the
    incoming source proves the SAME `crsId`**. A same-CRS refresh is a genuine
    no-op: the established context (including its label) is preserved verbatim.
  - any other source — a **different** CRS id, or a **null/unprovenanced local**
    source — **deprovenances** the drawing: `coordinateContext` is removed, so
    GRID_NE/LATLONG fail closed until grid provenance is re-established. The old
    CRS is never left authorizing coordinates replaced by a different grid (or
    by unprovenanced local coordinates). This is intentional even though the
    coordinate refresh itself still applies — the drawing is left truthful (no
    grid claims) rather than silently mixed.
  - only a **new/blank drawing** (no entities yet) whose coordinates are the
    imported grid stations may adopt a **non-null** source `crsId`;
  - a null/blank source CRS establishes nothing: the field is left **absent**
    (not `{ crsId: null }`), so GRID_NE/LATLONG stay fail-closed.
- **Reader:** the L1 session/resolvers read `project.metadata.coordinateContext`;
  no command mutates it. An absent context (all legacy drawings and every
  local-XY drawing) is fully supported and simply disables GRID_NE/LATLONG.
- **Never relabelled:** no transform, command, edit, or later import copies a
  source `crsId` onto a non-blank drawing. Provenance is established only by a
  blank grid-proven adoption or preserved by an identical same-CRS refresh;
  every mismatch removes it rather than guessing.

Units remain a separate, unchanged gate (`checkSnapshotImportCompatibility`):
mismatched units still fail the import before any write.

## 3. Fail-closed law

| Situation | Result |
|---|---|
| No context / blank `crsId` | `NO_DRAWING_GRID_CONTEXT`; prompt says the drawing needs an active grid/ground context |
| GRID_NE coordinate outside the CRS | `GRID_NE_OUT_OF_CRS` (round-tripped through `inverseGrid`) |
| LATLONG outside `[-90,90]` / `[-180,180]` | `LATLONG_OUT_OF_RANGE` |
| LATLONG projection failure | `CRS_TRANSFORM_FAILED` |
| Non-finite input | `NON_FINITE` |

No mode ever fabricates a local/equirectangular substitute or stores a fake
point. Context presence never implies the drawing's existing geometry is grid
consistent — it means the drawing was created **from** that grid source.

## 4. Tests pinning the law

- `tests/cad_line_l1_coordinate_context.test.ts` — resolver fail-closed,
  success, and no-mutation.
- `tests/cad_line_l1_sessions.test.ts` — session-level refusals and CRS-present
  successes.
- `tests/cad_app_bridge.test.ts` — the lifecycle law: blank-drawing adoption
  (grid-proven success), **same-CRS refresh keeps** the established context
  (no clobber, no relabel), **different-CRS refresh deprovenances**,
  **null-CRS refresh deprovenances**, and **no-context fail-closed** for a
  non-blank drawing that later receives a CRS-bearing source.

## 5. GRID_NE axis asymmetry

GRID_NE uses the same operator order as `Northing,Easting`: the **first**
component is northing, the **second** is easting. Drawing XY is `{ x: east,
y: north }`, so the two are deliberately asymmetric and a swap regression is
caught by the NE test.
