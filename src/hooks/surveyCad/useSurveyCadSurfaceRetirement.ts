/**
 * STRUCT-194.8 — surface mesh session retirement.
 *
 * Extracted verbatim from `SurveyCadWorkspace` with no behavior change, at the
 * exact former surface-deletion effect position (immediately after the
 * profile/section retirement effects). Drops session meshes for deleted
 * surfaces; meshes never persist. The updater is byte-equivalent:
 *   - builds the live id set from `surfaces`,
 *   - retains every live surface's revisions by reference,
 *   - for a retired surface invalidates the TIN cache and cancels in-flight
 *     contour derivations through `contourService.handleSurfaceDeleted`,
 *   - returns the PREVIOUS record object unchanged when nothing was deleted
 *     (so React bails out of the state update).
 *
 * Dependency array `[surfaces, surfaceCache, contourService]` and the targeted
 * `exhaustive-deps` suppression are byte-identical to the original. Never moved
 * into the STRUCT-194.4 surface-build lifecycle.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { SurfaceContourService } from '../../workers/surfaceContourService';

export interface SurveyCadSurfaceRetirementArgs {
  surfaces: CadProject['surfaces'];
  setSurfaceMeshSessions: Dispatch<SetStateAction<Record<string, string[]>>>;
  surfaceCache: CadSurfaceCache;
  contourService: SurfaceContourService;
}

export const useSurveyCadSurfaceRetirement = ({
  surfaces,
  setSurfaceMeshSessions,
  surfaceCache,
  contourService,
}: SurveyCadSurfaceRetirementArgs): void => {
  // Phase 18F — drop session meshes for deleted surfaces (meshes never
  // persist; the revision index doubles as the known-id set). Phase 18H:
  // contour sets drop with the definition (service cancels in-flight
  // derivations first so late arrivals never re-apply).
  useEffect(() => {
    const live = new Set((surfaces ?? []).map((entry) => entry.id));
    setSurfaceMeshSessions((previous) => {
      const kept: Record<string, string[]> = {};
      let changed = false;
      for (const [id, revisions] of Object.entries(previous)) {
        if (live.has(id)) kept[id] = revisions;
        else {
          changed = true;
          surfaceCache.invalidate(id);
          contourService.handleSurfaceDeleted(id);
        }
      }
      return changed ? kept : previous;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaces, surfaceCache, contourService]);
};
