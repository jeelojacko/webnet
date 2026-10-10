// Phase 19D Wave 1 (Worker C) — Parcel Shared Boundary integrity + shared edit.
//
// Two responsibilities, both fail-closed and identity-first (no cached
// geometry, no legal semantics):
//   1. Guards: every existing parcel mutation seam asks this module whether the
//      operation would break a Shared Boundary link. Blocking is zero-mutation
//      and zero-history; the block code is `PARCEL_SHARED_BOUNDARY_LINKED`.
//   2. `PARCELSHAREDEDIT`: one command that edits BOTH sides of a link in a
//      single atomic transaction (move shared endpoint / set shared course
//      geometry, including line<->arc via the common chord).
//
// Wave 1 does NOT edit the command registry. Integration wires:
//   cadTransactions.types.ts : add 'PARCELSHAREDEDIT' to CadCommandKey and the
//                              CadCommand union ({ linkId, edit }).
//   cadTransactions.ts       : PARCELSHAREDEDIT: parcelSharedEditCommand as
//                              CadCommandDefinition<CadCommand>,
//   ERASE path               : call `deleteParcelsWithSharedLinks(project, ids)`
//                              and prompt with the plan when `ok === false`.
//
// The link store below is the SINGLE integration point. It is a thin { a, b }
// view over the persisted `project.sharedParcelBoundaries` first/second
// collection owned by cadParcelSharedBoundary.ts (one store, no parallel).

import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import {
  describeParcelArcCourse,
  validateParcelCourseGeometry,
} from './cadParcelArcGeometry';
import { ensureParcelCourseIds, resolveCadParcelCourses } from './cadParcelCourses';
import { replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import type { CadHistoryState } from './cadUndoRedo';
import type { ParcelSharedEditCommand } from './cadTransactionsParcelCommandTypes';
import type {
  CadCommandExecutionResult,
  CadCommandKey,
  CadCommandState,
  CadTransaction,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadEntityId,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
} from './cadTypes';

// ---------------------------------------------------------------------------
// Link store + seam (19D integrated: { id, a, b } Link is a view over the
// persisted sharedParcelBoundaries first/second collection).
// ---------------------------------------------------------------------------

export interface CadParcelSharedBoundaryRef {
  parcelId: string;
  courseId: string;
}

export interface CadParcelSharedBoundaryLink {
  id: string;
  a: CadParcelSharedBoundaryRef;
  b: CadParcelSharedBoundaryRef;
}

export const PARCEL_SHARED_BOUNDARY_LINKED = 'PARCEL_SHARED_BOUNDARY_LINKED';

const GUIDANCE = 'use Edit Shared Boundary to edit the shared geometry, or Unlink first.';

export const parcelSharedBoundaryBlockReason = (detail?: string): string =>
  `${PARCEL_SHARED_BOUNDARY_LINKED}: ${detail ? `${detail} ` : ''}${GUIDANCE}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isBoundaryRef = (value: unknown): value is CadParcelSharedBoundaryRef =>
  isRecord(value) &&
  typeof value['parcelId'] === 'string' &&
  typeof value['courseId'] === 'string';

const isStoredBoundary = (value: unknown): value is StoredBoundary =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  isBoundaryRef(value['first']) &&
  isBoundaryRef(value['second']);

interface StoredBoundary {
  id: string;
  first: CadParcelSharedBoundaryRef;
  second: CadParcelSharedBoundaryRef;
}

// The ONE lookup (adapter over the persisted first/second collection).
// Everything below reads links through this.
const readParcelSharedLinks = (project: unknown): CadParcelSharedBoundaryLink[] => {
  if (!isRecord(project)) return [];
  const raw = (project as { sharedParcelBoundaries?: unknown }).sharedParcelBoundaries;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredBoundary).map((boundary) => ({
    id: boundary.id,
    a: { ...boundary.first },
    b: { ...boundary.second },
  }));
};

/**
 * Writer for the persisted link store (fixtures + link removal). Maps the
 * { a, b } Link view onto the first/second boundary collection.
 */
export const attachParcelSharedLinks = (
  project: CadProject,
  links: readonly CadParcelSharedBoundaryLink[],
): CadProject => ({
  ...project,
  sharedParcelBoundaries: links.map((link) => ({
    id: link.id,
    first: { ...link.a },
    second: { ...link.b },
  })),
});

/** Every link touching `parcelId` (all links when omitted). */
export const listParcelSharedLinks = (
  project: unknown,
  parcelId?: string,
): CadParcelSharedBoundaryLink[] =>
  readParcelSharedLinks(project).filter(
    (link) =>
      parcelId == null || link.a.parcelId === parcelId || link.b.parcelId === parcelId,
  );

/** Linked courseIds ON this parcel (the guard-facing seam). */
export const listLinkedCourseIds = (project: unknown, parcelId: string): Set<string> => {
  const ids = new Set<string>();
  for (const link of readParcelSharedLinks(project)) {
    if (link.a.parcelId === parcelId) ids.add(link.a.courseId);
    if (link.b.parcelId === parcelId) ids.add(link.b.courseId);
  }
  return ids;
};

/** Every OTHER parcel directly linked to this one. */
export const listLinkedParcelIds = (project: unknown, parcelId: string): Set<string> => {
  const ids = new Set<string>();
  for (const link of readParcelSharedLinks(project)) {
    if (link.a.parcelId === parcelId && link.b.parcelId !== parcelId) ids.add(link.b.parcelId);
    if (link.b.parcelId === parcelId && link.a.parcelId !== parcelId) ids.add(link.a.parcelId);
  }
  return ids;
};

/** Transitive connected component of linked parcels (includes `parcelId`). */
export const buildParcelLinkComponent = (project: unknown, parcelId: string): Set<string> => {
  const component = new Set<string>([parcelId]);
  const queue: string[] = [parcelId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of listLinkedParcelIds(project, current)) {
      if (component.has(next)) continue;
      component.add(next);
      queue.push(next);
    }
  }
  return component;
};

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

const samePoint = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean => Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;

/** Linked courses touching the grip vertex at `vertexIndex` (empty = safe). */
export const linkedCourseIdsAtVertex = (
  project: unknown,
  parcel: CadParcelEntity,
  vertexIndex: number,
): string[] => {
  const linked = listLinkedCourseIds(project, parcel.id);
  if (linked.size === 0) return [];
  const target = parcel.vertices[vertexIndex];
  if (!target) return [];
  const hits = new Set<string>();
  for (const course of resolveCadParcelCourses(ensureParcelCourseIds(parcel))) {
    if (!linked.has(course.courseId)) continue;
    if (samePoint(course.fromVertex, target) || samePoint(course.toVertex, target)) {
      hits.add(course.courseId);
    }
  }
  return [...hits];
};

/** Generic parcel vertex grip: a linked course on either side blocks. */
export const parcelGripEditBlockReason = (
  project: unknown,
  parcel: CadParcelEntity,
  vertexIndex: number | undefined,
): string | null => {
  if (vertexIndex == null) return null;
  const hits = linkedCourseIdsAtVertex(project, parcel, vertexIndex);
  return hits.length > 0
    ? parcelSharedBoundaryBlockReason(`vertex touches linked course(s) ${hits.join(', ')}.`)
    : null;
};

/** PARCELCOURSEARC / PARCELCOURSELINE on a linked course: block; edit via PARCELSHAREDEDIT. */
export const courseEditBlockReason = (
  project: unknown,
  parcelId: string,
  courseId: string,
): string | null =>
  listLinkedCourseIds(project, parcelId).has(courseId)
    ? parcelSharedBoundaryBlockReason(`course ${courseId} of parcel ${parcelId} is linked.`)
    : null;

/**
 * Split consumes the whole parent; any link on it blocks.
 */
export const parcelSplitBlockReason = (project: unknown, parcelId: string): string | null => {
  const linked = listLinkedCourseIds(project, parcelId);
  return linked.size > 0
    ? parcelSharedBoundaryBlockReason(
        `split would consume parcel ${parcelId} with ${linked.size} linked course(s); ` +
          'split the shared boundary explicitly instead.',
      )
    : null;
};

/**
 * Transform guard: every parcel in a linked component must move together (the
 * same transform keeps shared endpoints coincident). A partial selection of a
 * component blocks; a component fully inside the selection is allowed.
 */
export const linkedComponentSelectionBlockReason = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): string | null => {
  const selected = new Set(selectedEntityIds);
  for (const entity of project.entities) {
    if (entity.type !== 'parcel' || !selected.has(entity.id)) continue;
    const component = buildParcelLinkComponent(project, entity.id);
    if (component.size <= 1) continue;
    const missing = [...component].filter((id) => !selected.has(id));
    if (missing.length > 0) {
      return parcelSharedBoundaryBlockReason(
        `parcel ${entity.id} belongs to a ${component.size}-parcel linked group; ` +
          `Move all connected linked Parcels together or unlink first (missing: ${missing.join(', ')}).`,
      );
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// PARCELSHAREDEDIT.
// ---------------------------------------------------------------------------

export const PARCEL_SHARED_EDIT_KEY = 'PARCELSHAREDEDIT' as CadCommandState['key'];

// STRUCT-195.4: payloads moved to the type-only leaf; re-exported here so the
// original import paths keep working.
export type { ParcelSharedEditCommand, ParcelSharedEditEdit } from './cadTransactionsParcelCommandTypes';

interface LocatedCourse {
  parcel: CadParcelEntity;
  courseId: string;
  rawIndex: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

const findParcel = (project: CadProject, id: string): CadParcelEntity | null =>
  project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === id && entity.type === 'parcel',
  ) ?? null;

const locateCourse = (parcel: CadParcelEntity, courseId: string): LocatedCourse | null => {
  const ensured = ensureParcelCourseIds(parcel);
  const course = resolveCadParcelCourses(ensured).find((entry) => entry.courseId === courseId);
  const rawIndex = (ensured.courseIds ?? []).indexOf(courseId);
  if (!course || rawIndex < 0) return null;
  return {
    parcel: ensured,
    courseId,
    rawIndex,
    from: { ...course.fromVertex },
    to: { ...course.toVertex },
  };
};

type SharedOrientation = 'same' | 'opposite';

const resolveSharedPair = (
  a: LocatedCourse,
  b: LocatedCourse,
): { orientation: SharedOrientation; aPoint: { x: number; y: number }; bPoint: { x: number; y: number } } | null => {
  if (samePoint(a.from, b.to) && samePoint(a.to, b.from)) {
    return { orientation: 'opposite', aPoint: a.from, bPoint: b.to };
  }
  if (samePoint(a.from, b.from) && samePoint(a.to, b.to)) {
    return { orientation: 'same', aPoint: a.from, bPoint: b.from };
  }
  return null;
};

const setPoint = (
  parcel: CadParcelEntity,
  from: { x: number; y: number },
  to: { x: number; y: number },
): CadParcelEntity => ({
  ...parcel,
  vertices: parcel.vertices.map((vertex) =>
    samePoint(vertex, from) ? { x: to.x, y: to.y } : vertex,
  ),
});

const withCourseGeometry = (
  parcel: CadParcelEntity,
  rawIndex: number,
  entry: CadParcelCourseGeometry,
): CadParcelCourseGeometry[] | null => {
  const base =
    parcel.courseGeometry?.map((existing) => ({ ...existing })) ??
    parcel.vertices.map<CadParcelCourseGeometry>(() => ({ kind: 'line' }));
  if (rawIndex < 0 || rawIndex >= base.length) return null;
  base[rawIndex] = entry;
  return base;
};

const rebuildParcel = (
  parcel: CadParcelEntity,
  geometry: CadParcelCourseGeometry[] | undefined,
): CadParcelEntity | null => {
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: geometry });
  if (!metrics) return null;
  return {
    ...parcel,
    ...(geometry != null ? { courseGeometry: geometry } : {}),
    areaSquareMeters: metrics.areaSquareMeters,
    perimeterMeters: metrics.perimeterMeters,
    closureDeltaX: metrics.closureDeltaX,
    closureDeltaY: metrics.closureDeltaY,
    closureDistanceMeters: metrics.closureDistanceMeters,
  };
};

const reverseCourseGeometry = (geometry: CadParcelCourseGeometry): CadParcelCourseGeometry =>
  geometry.kind === 'arc' ? { kind: 'arc', bulge: -geometry.bulge } : { kind: 'line' };

const sharedArcConsistent = (a: LocatedCourse, b: LocatedCourse, bulge: number): boolean => {
  const arcA = describeParcelArcCourse(a.from, a.to, bulge);
  const arcB = describeParcelArcCourse(b.from, b.to, -bulge);
  if (!arcA || !arcB) return false;
  const tolerance = Math.max(1e-9, arcA.radius * 1e-9);
  return (
    Math.hypot(arcA.center.x - arcB.center.x, arcA.center.y - arcB.center.y) <= tolerance &&
    Math.abs(arcA.radius - arcB.radius) <= tolerance
  );
};

export interface ParcelSharedEditApplied {
  project: CadProject;
  selectionIds: CadEntityId[];
  transactionLabel: string;
}

export type ParcelSharedEditApplyResult =
  | ({ ok: true } & ParcelSharedEditApplied)
  | { ok: false; reason: string };

/**
 * Full validation on BOTH parcels BEFORE any result is produced. Returns the
 * two rebuilt parcels plus the untouched link store (links survive identity
 * edits — only coordinates/kind change). Pure: zero mutation on every failure.
 */
export const applyParcelSharedEdit = (
  project: CadProject,
  command: ParcelSharedEditCommand,
): ParcelSharedEditApplyResult => {
  const link = readParcelSharedLinks(project).find((candidate) => candidate.id === command.linkId);
  if (!link) return { ok: false, reason: 'PARCEL_SHARED_EDIT_UNKNOWN_LINK' };
  const parcelA = findParcel(project, link.a.parcelId);
  const parcelB = findParcel(project, link.b.parcelId);
  if (!parcelA || !parcelB) return { ok: false, reason: 'PARCEL_SHARED_EDIT_MISSING_PARCEL' };
  const a = locateCourse(parcelA, link.a.courseId);
  const b = locateCourse(parcelB, link.b.courseId);
  if (!a || !b) return { ok: false, reason: 'PARCEL_SHARED_EDIT_MISSING_COURSE' };
  const pair = resolveSharedPair(a, b);
  if (!pair) return { ok: false, reason: 'PARCEL_SHARED_EDIT_NOT_SHARED' };

  let nextA: CadParcelEntity;
  let nextB: CadParcelEntity;
  if (command.edit.kind === 'move-endpoint') {
    const { x, y } = command.edit;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, reason: 'PARCEL_SHARED_EDIT_NON_FINITE' };
    }
    const anchor = command.edit.end === 'from' ? a.from : a.to;
    nextA = setPoint(a.parcel, anchor, { x, y });
    nextB = setPoint(b.parcel, anchor, { x, y });
  } else {
    // Equal-and-opposite traversal is what makes A=b / B=-b exact.
    if (pair.orientation !== 'opposite') {
      return { ok: false, reason: 'PARCEL_SHARED_EDIT_DIRECTION' };
    }
    const geometryB = reverseCourseGeometry(command.edit.geometry);
    if (
      command.edit.geometry.kind === 'arc' &&
      !sharedArcConsistent(a, b, command.edit.geometry.bulge)
    ) {
      return { ok: false, reason: 'PARCEL_SHARED_EDIT_ARC_MISMATCH' };
    }
    const geometryA = withCourseGeometry(a.parcel, a.rawIndex, command.edit.geometry);
    const nextGeometryB = withCourseGeometry(b.parcel, b.rawIndex, geometryB);
    if (!geometryA || !nextGeometryB) return { ok: false, reason: 'PARCEL_SHARED_EDIT_INDEX' };
    if (!validateParcelCourseGeometry(a.parcel.vertices, geometryA).ok) {
      return { ok: false, reason: 'PARCEL_SHARED_EDIT_INVALID_GEOMETRY_A' };
    }
    if (!validateParcelCourseGeometry(b.parcel.vertices, nextGeometryB).ok) {
      return { ok: false, reason: 'PARCEL_SHARED_EDIT_INVALID_GEOMETRY_B' };
    }
    nextA = { ...a.parcel, courseGeometry: geometryA };
    nextB = { ...b.parcel, courseGeometry: nextGeometryB };
  }

  // Both parcels must still close exactly; otherwise the whole edit is void.
  const rebuiltA = rebuildParcel(nextA, nextA.courseGeometry);
  const rebuiltB = rebuildParcel(nextB, nextB.courseGeometry);
  if (!rebuiltA || !rebuiltB) return { ok: false, reason: 'PARCEL_SHARED_EDIT_DEGENERATE' };

  const nextProject = replaceCadProjectEntities(
    project,
    project.entities.map((entity) => {
      if (entity.id === rebuiltA.id) return rebuiltA;
      if (entity.id === rebuiltB.id) return rebuiltB;
      return entity;
    }),
  );
  return {
    ok: true,
    project: nextProject,
    selectionIds: [rebuiltA.id, rebuiltB.id],
    transactionLabel: `PARCELSHAREDEDIT (${rebuiltA.parcelName} ↔ ${rebuiltB.parcelName})`,
  };
};

export const parcelSharedEditCommand = {
  key: 'PARCELSHAREDEDIT' as const,
  execute: (
    snapshot: CadWorkspaceSnapshot,
    command: ParcelSharedEditCommand,
  ): CadCommandExecutionResult | null => {
    const applied = applyParcelSharedEdit(snapshot.project, command);
    if (!applied.ok) return null;
    return {
      nextSnapshot: {
        project: applied.project,
        selection: createCadSelectionState(applied.project, applied.selectionIds),
      },
      commandState: {
        key: PARCEL_SHARED_EDIT_KEY,
        phase: 'committed',
        prompt: `${applied.transactionLabel} applied to both parcels atomically.`,
      },
      transactionLabel: applied.transactionLabel,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

export const commitParcelSharedEditResult = (
  state: CadHistoryState,
  applied: ParcelSharedEditApplied,
  commandKey: CadCommandKey = PARCEL_SHARED_EDIT_KEY as CadCommandKey,
): CadHistoryState => {
  const before = state.present;
  const after: CadWorkspaceSnapshot = {
    project: applied.project,
    selection: createCadSelectionState(applied.project, applied.selectionIds),
  };
  const transaction: CadTransaction = {
    id: `cad-tx-${state.nextSequence}`,
    sequence: state.nextSequence,
    commandKey,
    label: applied.transactionLabel,
    beforeSelectionIds: before.selection.selectedEntityIds,
    afterSelectionIds: after.selection.selectedEntityIds,
    addedEntityIds: [],
    removedEntityIds: [],
  };
  return {
    present: after,
    undoStack: [...state.undoStack, { transaction, before, after }],
    redoStack: [],
    nextSequence: state.nextSequence + 1,
    commandState: {
      key: commandKey,
      phase: 'committed',
      prompt: `${applied.transactionLabel} committed.`,
    },
  };
};

// ---------------------------------------------------------------------------
// DELETE / ERASE with link cleanup.
// ---------------------------------------------------------------------------

export interface ParcelSharedLinkDeletePlan {
  linkIds: string[];
  linkCount: number;
  message: string;
}

/** Non-null when deleting `parcelIds` would remove links (N is link count). */
export const evaluateParcelDeleteSharedLinks = (
  project: unknown,
  parcelIds: readonly string[],
): ParcelSharedLinkDeletePlan | null => {
  const deleting = new Set(parcelIds);
  const linkIds = readParcelSharedLinks(project)
    .filter((link) => deleting.has(link.a.parcelId) || deleting.has(link.b.parcelId))
    .map((link) => link.id);
  if (linkIds.length === 0) return null;
  return {
    linkIds,
    linkCount: linkIds.length,
    message:
      `Deleting ${parcelIds.length} parcel(s) removes ${linkIds.length} Shared Boundary link(s); ` +
      'confirm to unlink the neighbors (their geometry is unchanged).',
  };
};

export type ParcelDeleteWithLinksResult =
  | { ok: true; project: CadProject; removedLinkIds: string[] }
  | { ok: false; plan: ParcelSharedLinkDeletePlan };

/**
 * Atomic delete: without `confirm` a linked parcel returns the plan (zero
 * mutation); with `confirm` the parcels AND their links are removed together,
 * neighbors untouched. One command = one undo entry.
 */
export const deleteParcelsWithSharedLinks = (
  project: CadProject,
  parcelIds: readonly string[],
  options: { confirm?: boolean } = {},
): ParcelDeleteWithLinksResult => {
  const plan = evaluateParcelDeleteSharedLinks(project, parcelIds);
  if (plan && options.confirm !== true) return { ok: false, plan };
  const deleting = new Set(parcelIds);
  const links = readParcelSharedLinks(project);
  const kept = links.filter(
    (link) => !deleting.has(link.a.parcelId) && !deleting.has(link.b.parcelId),
  );
  const removedLinkIds = links
    .filter((link) => deleting.has(link.a.parcelId) || deleting.has(link.b.parcelId))
    .map((link) => link.id);
  const unlinked = attachParcelSharedLinks(project, kept);
  const nextProject = replaceCadProjectEntities(
    unlinked,
    unlinked.entities.filter((entity) => !deleting.has(entity.id)),
  );
  return { ok: true, project: nextProject, removedLinkIds };
};
