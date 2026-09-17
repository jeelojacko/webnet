/**
 * Phase 18A — snapshot → drawing import adapter (CAD side only).
 *
 * Applies an explicit AdjustmentSourceSnapshot to a drawing through the
 * existing 17E-stamped import path. Units/context mismatches fail closed;
 * unresolvable identity is left to the 17E evaluators (UNKNOWN/NEEDS REVIEW,
 * never CURRENT).
 */
import { importAdjustedPointsIntoCadDrawing } from '../engine/cad/cadAdjustedPointsImport';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import {
  checkSnapshotImportCompatibility,
  type AdjustmentSourceSnapshot,
} from './cadSourceBridge';

export const importSnapshotIntoCadDrawing = (params: {
  document: CadDrawingDocument;
  snapshot: AdjustmentSourceSnapshot;
  sourceName?: string;
}):
  | { ok: true; drawing: CadDrawingDocument }
  | { ok: false; message: string } => {
  const compatibility = checkSnapshotImportCompatibility(params.snapshot, params.document.units);
  if (!compatibility.ok) return compatibility;
  const drawing = importAdjustedPointsIntoCadDrawing({
    document: params.document,
    identity: params.snapshot.appliedRunIdentity,
    result: { stations: params.snapshot.stations },
    sourceName:
      params.sourceName ??
      `Adjustment ${params.snapshot.projectName ?? params.snapshot.projectId} (${params.snapshot.resultFingerprint.slice(0, 12)})`,
  });
  return { ok: true, drawing };
};
