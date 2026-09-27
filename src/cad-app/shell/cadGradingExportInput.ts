/**
 * Phase 20B — grading snapshot → export-input adapter (UI-owned, pure).
 *
 * The export scene consumes caller-composed `CadGradingExportInput`, while
 * the workspace only holds the snapshot. This closes the seam: CURRENT rows
 * contribute their cached result; anything else rides along with its real
 * status so the shared builder emits the standard CURRENT-only withheld
 * warning instead of a silent drop.
 */
import type { CadGradingExportInput } from '../../engine/cad/cadGradingExportScene';
import type { CadGradingSnapshot } from './cadGradingSnapshot';

export const buildGradingExportInput = (
  snapshot: CadGradingSnapshot | null | undefined,
): CadGradingExportInput | undefined => {
  const layers = (snapshot?.gradings ?? [])
    .filter((row) => row.status === 'CURRENT' && row.currentResult != null)
    .map((row) => ({
      grading: {
        id: row.id,
        name: row.name,
        ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
      },
      status: row.status,
      result: row.currentResult,
    }));
  return layers.length > 0 ? { layers } : undefined;
};
