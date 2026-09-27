// Phase 19C Round 2B — parcel course authoring commands.
//
// PARCELCOURSEARC adopts an existing CadArcEntity onto a parcel course:
// endpoints must coincide (either direction, including reversed sweep); the
// snapshot stores the exact bulge; courseId is preserved; the source arc is
// never modified. Mismatch blocks (returns null).
//
// PARCELCOURSELINE retires an arc course to its chord: same endpoints, same
// courseId, explicit warning, one undo.
//
// PARCELCOURSE3P is deferred (documented): a three-point solve needs a picked
// point channel that this slice does not own; it is intentionally not
// registered rather than shipped half-verified.

import { cadArcEndPoint, cadArcStartPoint } from './cadGeometryArcPrimitives';
import { cadSignedSweepDeg } from './cadGeometry';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import { parcelBulgeFromArcDefinition, parcelCourseCanonicalKind } from './cadParcelArcGeometry';
import {
  buildParcelCourseId,
  ensureParcelCourseIds,
  resolveCadParcelCourses,
} from './cadParcelCourses';
import { replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { parcelPointsMatch } from './cadCogoParcelGeometryPrimitives';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadArcEntity, CadEntityId, CadParcelCourseGeometry, CadParcelEntity } from './cadTypes';

const findParcel = (
  snapshot: { project: { entities: readonly { id: string; type: string }[] } },
  parcelEntityId: CadEntityId,
): CadParcelEntity | null =>
  (snapshot.project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === parcelEntityId && entity.type === 'parcel',
  ) ?? null) as CadParcelEntity | null;

interface LocatedCourse {
  rawIndex: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

const locateCourse = (parcel: CadParcelEntity, courseId: string): LocatedCourse | null => {
  const ensured = ensureParcelCourseIds(parcel);
  const courses = resolveCadParcelCourses(ensured);
  const course = courses.find(
    (candidate) =>
      candidate.courseId === courseId ||
      candidate.courseId === buildParcelCourseId(parcel.id, candidate.index),
  );
  if (!course) return null;
  const rawIndex = ensured.vertices.findIndex((vertex) => parcelPointsMatch(vertex, course.fromVertex));
  if (rawIndex < 0) return null;
  return {
    rawIndex,
    from: { x: course.fromVertex.x, y: course.fromVertex.y },
    to: { x: course.toVertex.x, y: course.toVertex.y },
  };
};

const withUpdatedGeometry = (
  parcel: CadParcelEntity,
  rawIndex: number,
  entry: CadParcelCourseGeometry,
): CadParcelEntity | null => {
  const base =
    parcel.courseGeometry?.map((existing) => ({ ...existing })) ??
    parcel.vertices.map<CadParcelCourseGeometry>(() => ({ kind: 'line' }));
  if (rawIndex < 0 || rawIndex >= base.length) return null;
  base[rawIndex] = entry;
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: base });
  return {
    ...parcel,
    courseGeometry: base,
    areaSquareMeters: metrics?.areaSquareMeters ?? parcel.areaSquareMeters,
    perimeterMeters: metrics?.perimeterMeters ?? parcel.perimeterMeters,
  };
};

export const parcelCourseArcCommand: CadCommandDefinition<{
  key: 'PARCELCOURSEARC';
  parcelEntityId: CadEntityId;
  courseId: string;
  arcEntityId: CadEntityId;
}> = {
  key: 'PARCELCOURSEARC',
  execute: (snapshot, command) => {
    const parcel = findParcel(snapshot, command.parcelEntityId);
    const arc = snapshot.project.entities.find(
      (entity): entity is CadArcEntity => entity.id === command.arcEntityId && entity.type === 'arc',
    );
    if (!parcel || !arc) return null;
    const located = locateCourse(parcel, command.courseId);
    if (!located) return null;

    const arcStart = cadArcStartPoint(arc);
    const arcEnd = cadArcEndPoint(arc);
    const forward = parcelPointsMatch(arcStart, located.from) && parcelPointsMatch(arcEnd, located.to);
    const reversed = parcelPointsMatch(arcStart, located.to) && parcelPointsMatch(arcEnd, located.from);
    if (!forward && !reversed) return null;

    const sweepDeg = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
    const traversalSweepDeg = forward ? sweepDeg : -sweepDeg;
    const bulge = parcelBulgeFromArcDefinition({
      from: located.from,
      to: located.to,
      center: { x: arc.centerX, y: arc.centerY },
      radius: arc.radius,
      signedSweepDeg: traversalSweepDeg,
    });
    if (bulge == null) return null;

    const updated = withUpdatedGeometry(parcel, located.rawIndex, { kind: 'arc', bulge });
    if (!updated) return null;
    const project = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === parcel.id ? updated : entity)),
    );
    return {
      nextSnapshot: {
        project,
        selection: createCadSelectionState(project, [parcel.id]),
      },
      commandState: {
        key: 'PARCELCOURSEARC',
        phase: 'committed',
        prompt: `PARCELCOURSEARC applied to ${parcel.parcelName} (course ${command.courseId}, radius ${arc.radius.toFixed(3)} m).`,
      },
      transactionLabel: `PARCELCOURSEARC (${parcel.parcelName})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

export const parcelCourseLineCommand: CadCommandDefinition<{
  key: 'PARCELCOURSELINE';
  parcelEntityId: CadEntityId;
  courseId: string;
}> = {
  key: 'PARCELCOURSELINE',
  execute: (snapshot, command) => {
    const parcel = findParcel(snapshot, command.parcelEntityId);
    if (!parcel) return null;
    const located = locateCourse(parcel, command.courseId);
    if (!located) return null;
    const entry = parcel.courseGeometry?.[located.rawIndex];
    if (parcelCourseCanonicalKind(entry) !== 'arc') return null;
    const updated = withUpdatedGeometry(parcel, located.rawIndex, { kind: 'line' });
    if (!updated) return null;
    const project = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === parcel.id ? updated : entity)),
    );
    return {
      nextSnapshot: {
        project,
        selection: createCadSelectionState(project, [parcel.id]),
      },
      commandState: {
        key: 'PARCELCOURSELINE',
        phase: 'committed',
        prompt: `WARNING: ${parcel.parcelName} course ${command.courseId} arc retired to its chord (endpoints and courseId preserved).`,
      },
      transactionLabel: `PARCELCOURSELINE (${parcel.parcelName})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};
