/**
 * Phase C3 — PLINEINSERTVERTEX / PLINEDELETEVERTEX command sessions.
 *
 * Both are pick-gated: the first click (or an unambiguous single selected
 * editable polyline at start) fixes the target, the next click fixes the
 * exact vertex (delete) or the on-course point (insert). The engine
 * transactions own the editable + boundary preflight, so a rejected pick
 * mutates nothing and creates no history entry.
 *
 * Insert always rides the ORIGINAL course: the click is handed to the pure
 * topology helper, which projects it onto the finite line / true swept arc
 * and splits the course there. It can never introduce an off-course
 * shape-changing vertex.
 */

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { validateBoundaryEntityVertexEdit } from '../../engine/cad/cadBoundaryCandidateValidation';
import { validateBreaklineEntityVertexEdit } from '../../engine/cad/cadSurfaceDefinitionReferences';
import {
  deleteCadPolylineVertex,
  insertCadPolylineVertexOnCourse,
} from '../../engine/cad/cadPolylineTopology';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import { cadClosestPointOnSegment } from '../../engine/cad/cadGeometry';
import { cadClosestPointOnArc } from '../../engine/cad/cadGeometryArcPrimitives';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import {
  cadPolylineCourseMidpoint,
  resolveCadPolylineCourses,
  type CadPolylineResolvedCourse,
} from '../../engine/cad/cadPolylineCourses';
import type { CadPolylineEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { parseAbsolutePoint } from './useSurveyCadCommandParsing';

export type PlineVertexSessionKey = 'PLINEINSERTVERTEX' | 'PLINEDELETEVERTEX';

export type PlineVertexSession = Extract<
  CommandSession,
  { key: PlineVertexSessionKey }
>;

export const isPlineVertexSessionKey = (key: string): key is PlineVertexSessionKey =>
  key === 'PLINEINSERTVERTEX' || key === 'PLINEDELETEVERTEX';

/** Whole-session narrowing so call sites can pass a typed `current`. */
export const isPlineVertexSession = (
  session: CommandSession,
): session is PlineVertexSession => isPlineVertexSessionKey(session.key);

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

/** Sole selected editable polyline, or null when absent/ambiguous/locked. */
export const resolveSoleSelectedEditablePolyline = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadPolylineEntity | null => {
  if (selectedEntityIds.length !== 1) return null;
  const target = project.entities.find((entity) => entity.id === selectedEntityIds[0]);
  if (target?.type !== 'polyline') return null;
  return checkCadEntityEditable(project, target).editable ? target : null;
};

const findEditablePolyline = (
  project: CadProject,
  entityId: string | null,
): CadPolylineEntity | null => {
  if (entityId == null) return null;
  const target = project.entities.find((entity) => entity.id === entityId);
  if (target?.type !== 'polyline') return null;
  return checkCadEntityEditable(project, target).editable ? target : null;
};

const pointToCourseDistance = (point: { x: number; y: number }, course: CadPolylineResolvedCourse): number => {
  const projected =
    course.kind === 'arc' && course.metrics != null
      ? cadClosestPointOnArc(
          point,
          course.metrics.center,
          course.metrics.radius,
          course.metrics.startAngleDeg,
          course.metrics.endAngleDeg,
        )
      : cadClosestPointOnSegment(point, course.from, course.to);
  return Math.hypot(projected.x - point.x, projected.y - point.y);
};

/** Nearest editable polyline to a pick, within tolerance when supplied. */
const nearestEditablePolyline = (
  project: CadProject,
  point: { x: number; y: number },
  tolerance: number | undefined,
): CadPolylineEntity | null => {
  let best: { entity: CadPolylineEntity; distance: number } | null = null;
  for (const entity of project.entities) {
    if (entity.type !== 'polyline') continue;
    if (!checkCadEntityEditable(project, entity).editable) continue;
    const courses = resolveCadPolylineCourses(entity);
    if (!courses) continue;
    for (const course of courses) {
      const distance = pointToCourseDistance(point, course);
      if (!best || distance < best.distance) best = { entity, distance };
    }
  }
  if (!best) return null;
  if (tolerance != null && best.distance > tolerance) return null;
  return best.entity;
};

const nearestVertexIndex = (
  entity: CadPolylineEntity,
  point: { x: number; y: number },
  tolerance: number | undefined,
): number | null => {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  entity.vertices.forEach((vertex, index) => {
    const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex == null) return null;
  if (tolerance != null && bestDistance > tolerance) return null;
  return bestIndex;
};

const nearestCourseIndex = (
  entity: CadPolylineEntity,
  point: { x: number; y: number },
  tolerance: number | undefined,
): number | null => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return null;
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const course of courses) {
    const distance = pointToCourseDistance(point, course);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = course.index;
    }
  }
  if (bestIndex == null) return null;
  if (tolerance != null && bestDistance > tolerance) return null;
  return bestIndex;
};

/**
 * Phase C3 correction — read-only rejection reason mirroring the engine
 * commit order (editable gate, pure topology, boundary preflight,
 * breakline preflight) so a refused pick reports the ACTUAL cause.
 */
const describeVertexEditRejection = (
  project: CadProject,
  entity: CadPolylineEntity,
  edit:
    | { kind: 'delete'; vertexIndex: number }
    | { kind: 'insert'; courseIndex: number; x: number; y: number },
): string => {
  const check = checkCadEntityEditable(project, entity);
  if (!check.editable) {
    return `Edit rejected (${check.reason ?? 'NOT_EDITABLE'}): the polyline is not editable.`;
  }
  const topology =
    edit.kind === 'delete'
      ? deleteCadPolylineVertex(entity, { vertexIndex: edit.vertexIndex })
      : insertCadPolylineVertexOnCourse(entity, {
          courseIndex: edit.courseIndex,
          x: edit.x,
          y: edit.y,
        });
  if (!topology.ok) return `Edit rejected (${topology.code}): ${topology.message}`;
  const boundary = validateBoundaryEntityVertexEdit(project, entity.id, topology.entity.vertices);
  if (boundary) {
    return `Edit rejected (${boundary}): the boundary source would become invalid.`;
  }
  const breakline = validateBreaklineEntityVertexEdit(project, entity.id);
  if (breakline) {
    return `Edit rejected (${breakline}): the polyline backs a surface breakline.`;
  }
  return 'Edit rejected: the vertex edit is not applicable.';
};

/**
 * Phase C3 correction — `runCadCommand` returns the unchanged state on
 * rejection, so compare first: a refused edit keeps the session alive with
 * the typed failure reason (another pick allowed); only a committed edit
 * closes the session. Rejected edits never touch history.
 */
const finishVertexCommit = (
  history: CadHistoryState,
  command: CadCommand,
  entity: CadPolylineEntity,
  edit: { kind: 'delete'; vertexIndex: number } | { kind: 'insert'; courseIndex: number; x: number; y: number },
  current: PlineVertexSession,
  applyHistoryUpdate: ApplyHistoryUpdate,
  replaceSession: ReplaceSession,
): void => {
  const preview = runCadCommand(history, command);
  if (preview === history) {
    replaceSession({
      ...current,
      polylineId: entity.id,
      inputValue: '',
      resultText: describeVertexEditRejection(history.present.project, entity, edit),
    });
    return;
  }
  applyHistoryUpdate(() => preview);
  replaceSession(null);
};

const commitDelete = (
  entity: CadPolylineEntity,
  vertexIndex: number,
  history: CadHistoryState,
  current: PlineVertexSession,
  applyHistoryUpdate: ApplyHistoryUpdate,
  replaceSession: ReplaceSession,
): void => {
  finishVertexCommit(
    history,
    { key: 'POLYLINE_DELETE_VERTEX', entityId: entity.id, vertexIndex },
    entity,
    { kind: 'delete', vertexIndex },
    current,
    applyHistoryUpdate,
    replaceSession,
  );
};

const commitInsert = (
  entity: CadPolylineEntity,
  courseIndex: number,
  x: number,
  y: number,
  history: CadHistoryState,
  current: PlineVertexSession,
  applyHistoryUpdate: ApplyHistoryUpdate,
  replaceSession: ReplaceSession,
): void => {
  finishVertexCommit(
    history,
    { key: 'POLYLINE_INSERT_VERTEX', entityId: entity.id, courseIndex, x, y },
    entity,
    { kind: 'insert', courseIndex, x, y },
    current,
    applyHistoryUpdate,
    replaceSession,
  );
};

export interface HandlePlineVertexPointPickOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  current: PlineVertexSession;
  history: CadHistoryState;
  pickToleranceWorld?: number;
  point: CommandPoint;
  replaceSession: ReplaceSession;
}

/**
 * Consume one viewport pick. First pick (when the session has no target)
 * selects the polyline; the second performs the topology edit.
 */
export const handlePlineVertexPointPick = ({
  applyHistoryUpdate,
  current,
  history,
  pickToleranceWorld,
  point,
  replaceSession,
}: HandlePlineVertexPointPickOptions): boolean => {
  const project = history.present.project;
  const selected = findEditablePolyline(project, current.polylineId);
  if (selected == null) {
    const picked = nearestEditablePolyline(project, point, pickToleranceWorld);
    if (picked == null) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'No editable polyline near that pick. Click a polyline, or press Esc.',
      });
      return true;
    }
    replaceSession({
      ...current,
      polylineId: picked.id,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }

  if (current.key === 'PLINEDELETEVERTEX') {
    const vertexIndex = nearestVertexIndex(selected, point, pickToleranceWorld);
    if (vertexIndex == null) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'No vertex near that pick. Click an existing vertex, or press Esc.',
      });
      return true;
    }
    commitDelete(selected, vertexIndex, history, current, applyHistoryUpdate, replaceSession);
    return true;
  }

  const courseIndex = nearestCourseIndex(selected, point, pickToleranceWorld);
  if (courseIndex == null) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText: 'No course near that pick. Click on a course, or press Esc.',
    });
    return true;
  }
  commitInsert(selected, courseIndex, point.x, point.y, history, current, applyHistoryUpdate, replaceSession);
  return true;
};


export interface HandlePlineVertexTypedSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  history: CadHistoryState;
  replaceSession: ReplaceSession;
  session: CommandSession;
}

const parseVertexToken = (text: string): number | null => {
  const match = /^V?(\d+)$/i.exec(text.trim());
  if (!match) return null;
  const ordinal = Number.parseInt(match[1] ?? '', 10);
  return Number.isInteger(ordinal) && ordinal >= 1 ? ordinal - 1 : null;
};

const parseCourseToken = (text: string): number | null => {
  const match = /^C(\d+)$/i.exec(text.trim());
  if (!match) return null;
  const ordinal = Number.parseInt(match[1] ?? '', 10);
  return Number.isInteger(ordinal) && ordinal >= 1 ? ordinal - 1 : null;
};

/**
 * Typed path: `V<n>` deletes vertex n (1-based), `C<n>` inserts at the
 * midpoint of course n, and `x,y` inserts at that on-course point. Returns
 * false when the key is not a polyline-vertex session.
 */
export const handlePlineVertexTypedSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandlePlineVertexTypedSubmitOptions): boolean => {
  if (!isPlineVertexSession(session)) return false;
  const text = session.inputValue.trim();
  const project = history.present.project;
  const selected = findEditablePolyline(project, session.polylineId);

  if (selected == null) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: 'Select a polyline first (or click one), then retry.',
    });
    return true;
  }

  if (session.key === 'PLINEDELETEVERTEX') {
    const vertexIndex = parseVertexToken(text);
    if (vertexIndex == null || vertexIndex >= selected.vertices.length) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: `Enter a vertex like \`V1\` (1..${selected.vertices.length}).`,
      });
      return true;
    }
    commitDelete(selected, vertexIndex, history, session, applyHistoryUpdate, replaceSession);
    return true;
  }

  const courseIndex = parseCourseToken(text);
  if (courseIndex != null) {
    const course = resolveCadPolylineCourses(selected)?.[courseIndex];
    if (course == null) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'That course index does not resolve on this polyline.',
      });
      return true;
    }
    const midpoint = cadPolylineCourseMidpoint(course);
    commitInsert(selected, courseIndex, midpoint.x, midpoint.y, history, session, applyHistoryUpdate, replaceSession);
    return true;
  }

  const point = parseAbsolutePoint(text);
  if (point == null) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: 'Enter an on-course point like `x,y` or a course like `C2`.',
    });
    return true;
  }
  const pickedCourseIndex = nearestCourseIndex(selected, point, undefined);
  if (pickedCourseIndex == null) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: 'No course resolves for that point.',
    });
    return true;
  }
  commitInsert(selected, pickedCourseIndex, point.x, point.y, history, session, applyHistoryUpdate, replaceSession);
  return true;
};
