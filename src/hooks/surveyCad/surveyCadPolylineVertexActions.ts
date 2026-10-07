/**
 * Phase C3 — Properties row-action dispatch for polyline vertex topology.
 *
 * Extracted from the workspace hook so the action → command mapping is a
 * pure, directly testable seam. The insert point is the TRUE course midpoint
 * recomputed from the LIVE entity at dispatch time (a stale panel can never
 * insert at a moved position); delete re-runs the engine preflight, so a
 * stale/disabled row fails closed with zero mutation and no history entry.
 */

import {
  cadPolylineCourseMidpoint,
  resolveCadPolylineCourses,
} from '../../engine/cad/cadPolylineCourses';
import type { CadEntityPropertyRowAction } from '../../engine/cad/cadProperties';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadProject } from '../../engine/cad/cadTypes';

export interface PolylineVertexActionOutcome {
  applied: boolean;
  reason?: string;
}

/**
 * Handle a `polyline-insert-vertex` / `polyline-delete-vertex` row action.
 * Returns null for any other action kind so callers can keep their own
 * routing.
 */
export const runPolylineVertexRowAction = (
  action: CadEntityPropertyRowAction,
  project: CadProject,
  runCommand: (_command: CadCommand) => boolean,
): PolylineVertexActionOutcome | null => {
  if (action.kind !== 'polyline-insert-vertex' && action.kind !== 'polyline-delete-vertex') {
    return null;
  }
  const entityId = action.entityId;
  if (entityId == null) {
    return { applied: false, reason: 'Polyline action is missing its target entity.' };
  }
  if (action.kind === 'polyline-delete-vertex') {
    if (action.vertexIndex == null) {
      return { applied: false, reason: 'Delete Vertex is missing its vertex index.' };
    }
    const applied = runCommand({
      key: 'POLYLINE_DELETE_VERTEX',
      entityId,
      vertexIndex: action.vertexIndex,
    });
    return applied
      ? { applied: true }
      : { applied: false, reason: 'Delete rejected — the vertex cannot be merged safely.' };
  }
  const entity = project.entities.find((candidate) => candidate.id === entityId);
  const course =
    entity?.type === 'polyline' && action.courseIndex != null
      ? resolveCadPolylineCourses(entity)?.[action.courseIndex]
      : undefined;
  if (entity?.type !== 'polyline' || action.courseIndex == null || course == null) {
    return { applied: false, reason: 'Insert rejected — the course geometry does not resolve.' };
  }
  const midpoint = cadPolylineCourseMidpoint(course);
  const applied = runCommand({
    key: 'POLYLINE_INSERT_VERTEX',
    entityId,
    courseIndex: action.courseIndex,
    x: midpoint.x,
    y: midpoint.y,
  });
  return applied
    ? { applied: true }
    : { applied: false, reason: 'Insert rejected — the course midpoint is not insertable.' };
};
