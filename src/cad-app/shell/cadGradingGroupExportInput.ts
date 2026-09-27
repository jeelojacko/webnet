/**
 * Phase 20C Wave-4B — grading-group snapshot → export-input adapter (pure).
 *
 * Mirrors the 20B `cadGradingExportInput.ts` seam: the export scene consumes
 * a caller-composed `CadGradingGroupExportInput`, while the workspace holds
 * the snapshot. Only CURRENT rows with a cached result contribute layers;
 * the shared builder still warns explicitly if a caller forwards a
 * non-CURRENT layer (CURRENT-only gate, never a silent drop).
 *
 * `plotCornerSeams` is intentionally left unset: corner seams are a
 * PLOT-INTENDED display annotation with no per-row flag yet, so they stay
 * out of plots by default (fail-closed, never silently added).
 */
import type { CadGradingGroupExportInput } from '../../engine/cad/cadGradingGroupExportScene';
import type { CadGradingGroupSnapshot } from './cadGradingGroupSnapshot';

export const buildGradingGroupExportInput = (
  snapshot: CadGradingGroupSnapshot | null | undefined,
): CadGradingGroupExportInput | undefined => {
  const layers = (snapshot?.groups ?? [])
    .filter((row) => row.status === 'CURRENT' && row.currentResult != null)
    .map((row) => ({
      group: {
        id: row.id,
        name: row.name,
        ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
      },
      status: row.status,
      result: row.currentResult,
    }));
  return layers.length > 0 ? { layers } : undefined;
};
