/**
 * Phase 18A — snapshot → drawing import adapter (CAD side only).
 *
 * Applies an explicit AdjustmentSourceSnapshot to a drawing through the
 * existing 17E-stamped import path. Units/context mismatches fail closed;
 * unresolvable identity is left to the 17E evaluators (UNKNOWN/NEEDS REVIEW,
 * never CURRENT).
 */
import { importAdjustedPointsIntoCadDrawing } from '../engine/cad/cadAdjustedPointsImport';
import type { CadCoordinateContext, CadDrawingDocument } from '../engine/cad/cadTypes';
import {
  checkSnapshotImportCompatibility,
  type AdjustmentSourceSnapshot,
} from './cadSourceBridge';

const normalizeCrsId = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * CAD Draw L1 — decide the drawing's coordinate context after an import. The
 * source CRS is only a CLAIM; it does not prove the drawing's XY is that
 * grid's XY, so provenance is only ever kept or newly established — never
 * relabelled:
 *
 *  - A drawing that already carries a usable `crsId` keeps it ONLY when the
 *    incoming source proves the SAME CRS id. Any other source — a different
 *    CRS, or a null/unprovenanced local source — DEPROVENANCES the drawing:
 *    the context is removed so GRID_NE/LATLONG fail closed until grid
 *    provenance is re-established. Replaced/mixed geometry is never
 *    authorized by the old CRS.
 *  - Only a new/blank drawing (no entities yet) may ADOPT a non-null source
 *    CRS, because its coordinates are the imported grid stations.
 *  - A null/blank source CRS establishes nothing: the field is left absent so
 *    GRID_NE/LATLONG stay fail-closed.
 */
const resolveImportedCoordinateContext = (
  document: CadDrawingDocument,
  snapshot: AdjustmentSourceSnapshot,
): CadCoordinateContext | null => {
  const sourceCrsId = normalizeCrsId(snapshot.coordinateContext.crsId);
  const existing = document.project.metadata.coordinateContext;
  const existingCrsId = normalizeCrsId(existing?.crsId);
  if (existingCrsId != null) {
    return existing && sourceCrsId === existingCrsId ? existing : null;
  }
  if (sourceCrsId == null) return null;
  if (document.project.entities.length > 0) return null;
  return { crsId: sourceCrsId, crsLabel: snapshot.coordinateContext.crsLabel };
};

export const importSnapshotIntoCadDrawing = (params: {
  document: CadDrawingDocument;
  snapshot: AdjustmentSourceSnapshot;
  sourceName?: string;
}):
  | { ok: true; drawing: CadDrawingDocument }
  | { ok: false; message: string } => {
  const compatibility = checkSnapshotImportCompatibility(params.snapshot, params.document.units);
  if (!compatibility.ok) return compatibility;
  const imported = importAdjustedPointsIntoCadDrawing({
    document: params.document,
    identity: params.snapshot.appliedRunIdentity,
    result: { stations: params.snapshot.stations },
    sourceName:
      params.sourceName ??
      `Adjustment ${params.snapshot.projectName ?? params.snapshot.projectId} (${params.snapshot.resultFingerprint.slice(0, 12)})`,
  });
  // CAD Draw L1: resolve the drawing's grid/CRS provenance after the import
  // (see resolveImportedCoordinateContext). Provenance is kept only for a
  // same-CRS refresh; a different-or-null source removes it so no mode
  // authorizes stale grid geometry. Never inferred, never relabelled.
  const nextContext = resolveImportedCoordinateContext(params.document, params.snapshot);
  const metadata: CadDrawingDocument['project']['metadata'] = { ...imported.project.metadata };
  if (nextContext) metadata.coordinateContext = nextContext;
  else delete metadata.coordinateContext;
  const drawing: CadDrawingDocument = {
    ...imported,
    project: { ...imported.project, metadata },
  };
  return { ok: true, drawing };
};
