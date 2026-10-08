/**
 * Phase C3 — Properties row-action dispatch for polyline vertex topology.
 *
 * Extracted from the workspace hook so the action → command mapping is a
 * pure, directly testable seam. The insert point is the TRUE course midpoint
 * recomputed from the LIVE entity at dispatch time (a stale panel can never
 * insert at a moved position); delete re-runs the engine preflight, so a
 * stale/disabled row fails closed with zero mutation and no history entry.
 */

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { validateBoundaryEntityVertexEdit } from '../../engine/cad/cadBoundaryCandidateValidation';
import {
  cadPolylineCourseMidpoint,
  resolveCadPolylineCourses,
} from '../../engine/cad/cadPolylineCourses';
import type { CadEntityPropertyRowAction } from '../../engine/cad/cadProperties';
import {
  deleteCadPolylineVertex,
  insertCadPolylineVertexOnCourse,
} from '../../engine/cad/cadPolylineTopology';
import { validateBreaklineEntityVertexEdit } from '../../engine/cad/cadSurfaceDefinitionReferences';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadPolylineEntity, CadProject } from '../../engine/cad/cadTypes';

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
    if (applied) return { applied: true };
    // Phase C3 correction — report the ACTUAL refusal cause (read-only
    // re-derivation in commit order), not a generic merge guess.
    const entity = project.entities.find((candidate) => candidate.id === entityId);
    return {
      applied: false,
      reason:
        entity?.type === 'polyline'
          ? describeDeleteRejection(project, entity, action.vertexIndex)
          : 'Delete rejected — the polyline no longer resolves.',
    };
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
  if (applied) return { applied: true };
  // Phase C3 correction — report the ACTUAL refusal cause (read-only
  // re-derivation in commit order), not a generic midpoint guess.
  return {
    applied: false,
    reason: describeInsertRejection(project, entity, action.courseIndex, midpoint),
  };
};

/** Read-only delete refusal cause in engine commit order (no mutation). */
const describeDeleteRejection = (
  project: CadProject,
  entity: CadPolylineEntity,
  vertexIndex: number,
): string => {
  const check = checkCadEntityEditable(project, entity);
  if (!check.editable) {
    return `Delete rejected — the entity is not editable (${check.reason ?? 'NOT_EDITABLE'}).`;
  }
  const topology = deleteCadPolylineVertex(entity, { vertexIndex });
  if (!topology.ok) return `Delete rejected — ${topology.message} (${topology.code}).`;
  const boundary = validateBoundaryEntityVertexEdit(project, entity.id, topology.entity.vertices);
  if (boundary) {
    return `Delete rejected — the boundary source would become invalid (${boundary}).`;
  }
  const breakline = validateBreaklineEntityVertexEdit(project, entity.id);
  if (breakline) {
    return `Delete rejected — the polyline backs a surface breakline (${breakline}).`;
  }
  return 'Delete rejected — the vertex cannot be merged safely.';
};

/** Read-only insert refusal cause in engine commit order (no mutation). */
const describeInsertRejection = (
  project: CadProject,
  entity: CadPolylineEntity,
  courseIndex: number,
  midpoint: { x: number; y: number },
): string => {
  const check = checkCadEntityEditable(project, entity);
  if (!check.editable) {
    return `Insert rejected — the entity is not editable (${check.reason ?? 'NOT_EDITABLE'}).`;
  }
  const topology = insertCadPolylineVertexOnCourse(entity, {
    courseIndex,
    x: midpoint.x,
    y: midpoint.y,
  });
  if (!topology.ok) return `Insert rejected — ${topology.message} (${topology.code}).`;
  const boundary = validateBoundaryEntityVertexEdit(project, entity.id, topology.entity.vertices);
  if (boundary) {
    return `Insert rejected — the boundary source would become invalid (${boundary}).`;
  }
  const breakline = validateBreaklineEntityVertexEdit(project, entity.id);
  if (breakline) {
    return `Insert rejected — the polyline backs a surface breakline (${breakline}).`;
  }
  return 'Insert rejected — the course midpoint is not insertable.';
};
