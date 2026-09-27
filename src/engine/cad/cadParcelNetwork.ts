// Phase 19D Wave 1 — parcel network / adjacency (plan-topology QA only).
//
// buildParcelNetwork(project, links) classifies every parcel pair as
// LINKED_ADJACENCY, GEOMETRIC_SHARED_COURSE (unlinked), POINT_TOUCH,
// AREA_OVERLAP, or DISJOINT, and reports findings with severity. It is
// intentionally read-only: no auto-delete, no gap inference (§53 deferred),
// no legal conclusions.
//
// Exact whole-course matching runs over the canonical resolved courses
// (`resolveCadParcelCourses`) — endpoints + arc sweep, never tessellation or
// rounded strings. A bounding-box index only prunes candidate pairs; every
// final decision is geometry-based. Overlap reuses the existing overlap
// authority (`cadBuildParcelOverlapAreaSquareMeters`) plus analytic
// containment (`cadClassifyParcelBoundaryPoint`) and line/arc boundary
// intersection helpers — no bbox-only verdict, no raster.
//
// Deferred integration (Wave 2, NOT done here): Worker B persists the
// shared-boundary links as a trailing project-level collection of refs only
// (`parcelId` + `courseId` pairs, no cached geometry), mirroring
// `CadVolumeSurface`. This module already accepts those links as a plain
// `LinkedPair[]` parameter and never reads a store, so wiring is
// `buildParcelNetwork(project, persistedLinks)`. Dangling refs stay as
// BROKEN_LINK_REFERENCE findings, never rebound by index (survey-table
// precedent).

import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import { cadBuildParcelOverlapAreaSquareMeters } from './cadCogoParcelGeometryOverlap';
import {
  normalizeParcelPolygonVertices,
  parcelPointsMatch,
} from './cadCogoParcelGeometryPrimitives';
import { cadSegmentIntersection, type CadWorldPoint } from './cadGeometry';
import { cadIntersectArcArc, cadIntersectSegmentArc } from './cadGeometryCurveIntersections';
import { buildParcelCourseTopology, type CadParcelTopologyCourse } from './cadParcelArcGeometry';
import { cadClassifyParcelBoundaryPoint } from './cadParcelContainment';
import { resolveCadParcelCourses, type CadParcelCourse } from './cadParcelCourses';
import { cadParcelPlanRole as cadParcelRole, isCadParcelPrimaryRole } from './cadParcelPlanInfo';
import { buildCadBounds } from './cadProjectState';
import type { CadBounds, CadEntityId, CadParcelEntity, CadProject } from './cadTypes';

/**
 * Shared-boundary link shape owned by Worker B (may not exist yet in Wave 1).
 * `buildParcelNetwork` accepts these as a PARAMETER and never reads a store.
 * Wave 2 consolidates this with the persisted relationship record.
 */
export interface LinkedPair {
  first: { parcelId: string; courseId: string };
  second: { parcelId: string; courseId: string };
}

export type CadParcelAdjacencyRelation =
  | 'LINKED_ADJACENCY'
  | 'GEOMETRIC_SHARED_COURSE'
  | 'POINT_TOUCH'
  | 'AREA_OVERLAP'
  | 'DISJOINT';

export type CadParcelNetworkSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type CadParcelNetworkFindingCode =
  | 'BROKEN_LINK_REFERENCE'
  | 'LINK_GEOMETRY_MISMATCH'
  | 'PRIMARY_OVERLAP'
  | 'OVERLAY_INTERSECTION'
  | 'COINCIDENT_PARCELS'
  | 'UNLINKED_SHARED_COURSE'
  | 'POINT_TOUCH';

export interface CadParcelNetworkFinding {
  code: CadParcelNetworkFindingCode;
  severity: CadParcelNetworkSeverity;
  parcelIds: string[];
  courseIds: string[];
  message: string;
  /** Present for overlap/coincident findings. */
  overlapAreaSquareMeters?: number;
}

export interface CadParcelCourseMatch {
  firstCourseId: string;
  secondCourseId: string;
  geometryKind: 'line' | 'arc';
  lengthMeters: number;
  reversed: boolean;
}

export interface CadParcelNetworkPair {
  firstParcelId: string;
  secondParcelId: string;
  relation: CadParcelAdjacencyRelation;
  linked: boolean;
  sharedCourseIds: string[];
  firstCourseIds: string[];
  secondCourseIds: string[];
  sharedLengthMeters: number;
  sharedGeometryKinds: Array<'line' | 'arc'>;
  pointTouch: boolean;
  overlapAreaSquareMeters: number;
}

export interface CadParcelNetworkAdjacency {
  neighborParcelId: string;
  relation: CadParcelAdjacencyRelation;
  linked: boolean;
  ownCourseIds: string[];
  neighborCourseIds: string[];
  sharedLengthMeters: number;
  sharedGeometryKinds: Array<'line' | 'arc'>;
  pointTouch: boolean;
  overlapAreaSquareMeters: number;
}

export interface CadParcelNetwork {
  parcelIds: string[];
  pairs: CadParcelNetworkPair[];
  adjacencyByParcel: Map<string, CadParcelNetworkAdjacency[]>;
  components: string[][];
  findings: CadParcelNetworkFinding[];
}

export interface CadParcelNetworkOptions {
  /**
   * When true, an overlay intersection (road/ROW/easement/other) is raised
   * to ERROR instead of the default INFO. The default role policy treats
   * only lot/remainder vs lot/remainder as a primary ERROR.
   */
  strictRoles?: boolean;
}

const BBOX_TOLERANCE = 1e-6;
const OVERLAP_AREA_EPSILON = 1e-6;
const ARC_SWEEP_TOLERANCE_DEG = 1e-7;

const parcelSort = (left: CadParcelEntity, right: CadParcelEntity): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const boundsOverlap = (a: CadBounds, b: CadBounds): boolean =>
  a.minX - BBOX_TOLERANCE <= b.maxX &&
  b.minX - BBOX_TOLERANCE <= a.maxX &&
  a.minY - BBOX_TOLERANCE <= b.maxY &&
  b.minY - BBOX_TOLERANCE <= a.maxY;

const courseLengthMeters = (course: CadParcelCourse): number =>
  course.kind === 'arc' ? course.arcLength : course.distanceMeters;

const courseGeometryMatches = (
  first: CadParcelCourse,
  second: CadParcelCourse,
  reversed: boolean,
): boolean => {
  if (first.kind !== second.kind) return false;
  if (first.kind === 'line' || second.kind === 'line') return true;
  const expectedSweep = reversed ? -first.signedSweepDeg : first.signedSweepDeg;
  return Math.abs(expectedSweep - second.signedSweepDeg) <= ARC_SWEEP_TOLERANCE_DEG;
};

/** Exact whole-course match between two parcels (both orientations). */
export const matchParcelCourses = (
  first: CadParcelEntity,
  second: CadParcelEntity,
): CadParcelCourseMatch[] =>
  matchResolvedParcelCourses(resolveCadParcelCourses(first), resolveCadParcelCourses(second));

/** Same match over pre-resolved courses (network loop resolves once per parcel). */
export const matchResolvedParcelCourses = (
  firstCourses: readonly CadParcelCourse[],
  secondCourses: readonly CadParcelCourse[],
): CadParcelCourseMatch[] => {
  const matches: CadParcelCourseMatch[] = [];
  for (const firstCourse of firstCourses) {
    for (const secondCourse of secondCourses) {
      const forward =
        parcelPointsMatch(firstCourse.fromVertex, secondCourse.fromVertex) &&
        parcelPointsMatch(firstCourse.toVertex, secondCourse.toVertex);
      const reversed = !forward &&
        parcelPointsMatch(firstCourse.fromVertex, secondCourse.toVertex) &&
        parcelPointsMatch(firstCourse.toVertex, secondCourse.fromVertex);
      if (!forward && !reversed) continue;
      if (!courseGeometryMatches(firstCourse, secondCourse, reversed)) continue;
      matches.push({
        firstCourseId: firstCourse.courseId,
        secondCourseId: secondCourse.courseId,
        geometryKind: firstCourse.kind,
        lengthMeters: courseLengthMeters(firstCourse),
        reversed,
      });
    }
  }
  return matches;
};

const pointAtCourseEndpoints = (
  point: CadWorldPoint,
  course: CadParcelTopologyCourse,
): boolean => parcelPointsMatch(point, course.from) || parcelPointsMatch(point, course.to);

const coursesProperlyIntersect = (
  first: CadParcelEntity,
  second: CadParcelEntity,
): boolean => {
  const firstTopology = buildParcelCourseTopology(first.vertices, first.courseGeometry);
  const secondTopology = buildParcelCourseTopology(second.vertices, second.courseGeometry);
  if (!firstTopology || !secondTopology) return false;
  for (const a of firstTopology) {
    for (const b of secondTopology) {
      let hits: CadWorldPoint[] = [];
      if (!a.arc && !b.arc) {
        const hit = cadSegmentIntersection(a.from, a.to, b.from, b.to);
        hits = hit ? [hit] : [];
      } else if (a.arc && !b.arc) {
        hits = cadIntersectSegmentArc(
          b.from, b.to, a.arc.center, a.arc.radius, a.arc.startAngleDeg, a.arc.endAngleDeg,
        );
      } else if (!a.arc && b.arc) {
        hits = cadIntersectSegmentArc(
          a.from, a.to, b.arc.center, b.arc.radius, b.arc.startAngleDeg, b.arc.endAngleDeg,
        );
      } else if (a.arc && b.arc) {
        hits = cadIntersectArcArc(
          a.arc.center, a.arc.radius, a.arc.startAngleDeg, a.arc.endAngleDeg,
          b.arc.center, b.arc.radius, b.arc.startAngleDeg, b.arc.endAngleDeg,
        );
      }
      const proper = hits.some(
        (hit) => !pointAtCourseEndpoints(hit, a) && !pointAtCourseEndpoints(hit, b),
      );
      if (proper) return true;
    }
  }
  return false;
};

const hasVertexContact = (first: CadParcelEntity, second: CadParcelEntity): boolean => {
  const firstVertices = normalizeParcelPolygonVertices(first.vertices);
  const secondVertices = normalizeParcelPolygonVertices(second.vertices);
  // Inside-or-boundary, matching the existing overlap-diagnostics gate: a
  // vertex on the other boundary still requires an area check (the area
  // authority resolves shared-edge-only contact to 0).
  const touches = (parcel: CadParcelEntity, point: CadWorldPoint): boolean =>
    cadClassifyParcelBoundaryPoint({
      vertices: parcel.vertices,
      courseGeometry: parcel.courseGeometry,
      point,
    }) !== 'outside';
  return firstVertices.some((point) => touches(second, point)) ||
    secondVertices.some((point) => touches(first, point));
};

/**
 * Positive-area overlap (m²) or 0. Bounding boxes prune candidates only;
 * containment and exact line/arc boundary crossing gate the polygonal area
 * authority. Shared-edge-only contact classifies to 0.
 */
export const detectParcelOverlapAreaSquareMeters = (
  first: CadParcelEntity,
  second: CadParcelEntity,
  precomputed?: { firstBounds: CadBounds | null; secondBounds: CadBounds | null },
): number => {
  const firstBounds = precomputed?.firstBounds ?? buildCadBounds([first]);
  const secondBounds = precomputed?.secondBounds ?? buildCadBounds([second]);
  if (!firstBounds || !secondBounds || !boundsOverlap(firstBounds, secondBounds)) return 0;
  if (!hasVertexContact(first, second) && !coursesProperlyIntersect(first, second)) return 0;
  const area = cadBuildParcelOverlapAreaSquareMeters(
    normalizeParcelPolygonVertices(first.vertices),
    normalizeParcelPolygonVertices(second.vertices),
  );
  return area > OVERLAP_AREA_EPSILON ? area : 0;
};

const hasSharedVertex = (
  firstVertices: readonly CadWorldPoint[],
  secondVertices: readonly CadWorldPoint[],
): boolean =>
  firstVertices.some((point) =>
    secondVertices.some((candidate) => parcelPointsMatch(point, candidate)),
  );

const pairKey = (firstId: string, secondId: string): string =>
  firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;

// Phase 19D F3 decision (documented, no new class): a partial-course shared
// edge — a segment shared without a whole-course coincidence (e.g. Lot 5 vs
// R/W 1) — intentionally classifies as POINT_TOUCH, never as a shared
// course. Partial-course links are out of scope per §19: the operator splits
// the course first, then links whole courses. The label is honest about what
// the classifier knows (shared endpoints, zero whole-course length); no
// BOUNDARY_INTERSECT relation is invented.
const relationFor = (
  linked: boolean,
  matches: CadParcelCourseMatch[],
  pointTouch: boolean,
  overlapArea: number,
): CadParcelAdjacencyRelation => {
  if (linked) return 'LINKED_ADJACENCY';
  if (matches.length > 0) return 'GEOMETRIC_SHARED_COURSE';
  if (overlapArea > OVERLAP_AREA_EPSILON) return 'AREA_OVERLAP';
  if (pointTouch) return 'POINT_TOUCH';
  return 'DISJOINT';
};

const parcelAreaSquareMeters = (parcel: CadParcelEntity): number =>
  cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })
    ?.areaSquareMeters ?? 0;

const overlapFinding = ({
  first,
  second,
  overlapArea,
  strictRoles,
}: {
  first: CadParcelEntity;
  second: CadParcelEntity;
  overlapArea: number;
  strictRoles: boolean;
}): CadParcelNetworkFinding => {
  const firstArea = parcelAreaSquareMeters(first);
  const secondArea = parcelAreaSquareMeters(second);
  const smallerArea = Math.min(firstArea, secondArea);
  // Coincident = same footprint, not containment: both areas must agree and
  // the overlap must cover the whole smaller parcel.
  const coincident =
    smallerArea > OVERLAP_AREA_EPSILON &&
    Math.abs(firstArea - secondArea) <= OVERLAP_AREA_EPSILON &&
    overlapArea >= smallerArea - OVERLAP_AREA_EPSILON;
  const bothPrimary =
    isCadParcelPrimaryRole(cadParcelRole(first)) && isCadParcelPrimaryRole(cadParcelRole(second));
  const severity: CadParcelNetworkSeverity = strictRoles || bothPrimary ? 'ERROR' : 'INFO';
  const code: CadParcelNetworkFindingCode = coincident
    ? 'COINCIDENT_PARCELS'
    : bothPrimary
      ? 'PRIMARY_OVERLAP'
      : 'OVERLAY_INTERSECTION';
  return {
    code,
    severity,
    parcelIds: [first.id, second.id],
    courseIds: [],
    message: coincident
      ? 'Parcels occupy the same footprint (plan-topology QA; no auto-delete).'
      : `Parcels overlap by ${overlapArea.toFixed(3)} m² (plan-topology QA, not a legal conclusion).`,
    overlapAreaSquareMeters: overlapArea,
  };
};

interface ResolvedLinkState {
  linkedPairs: Set<string>;
  findings: CadParcelNetworkFinding[];
}

const resolveLinks = (
  parcelsById: Map<string, CadParcelEntity>,
  links: readonly LinkedPair[],
): ResolvedLinkState => {
  const linkedPairs = new Set<string>();
  const findings: CadParcelNetworkFinding[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const firstParcel = parcelsById.get(link.first.parcelId);
    const secondParcel = parcelsById.get(link.second.parcelId);
    if (!firstParcel || !secondParcel || firstParcel.id === secondParcel.id) {
      findings.push({
        code: 'BROKEN_LINK_REFERENCE',
        severity: 'ERROR',
        parcelIds: [link.first.parcelId, link.second.parcelId],
        courseIds: [link.first.courseId, link.second.courseId],
        message: 'Link references a missing parcel (or itself).',
      });
      continue;
    }
    const firstCourses = resolveCadParcelCourses(firstParcel);
    const secondCourses = resolveCadParcelCourses(secondParcel);
    const firstCourse = firstCourses.find((course) => course.courseId === link.first.courseId);
    const secondCourse = secondCourses.find((course) => course.courseId === link.second.courseId);
    if (!firstCourse || !secondCourse) {
      findings.push({
        code: 'BROKEN_LINK_REFERENCE',
        severity: 'ERROR',
        parcelIds: [firstParcel.id, secondParcel.id],
        courseIds: [link.first.courseId, link.second.courseId],
        message: 'Link references a course id that no longer resolves.',
      });
      continue;
    }
    const key = `${pairKey(firstParcel.id, secondParcel.id)}:${link.first.courseId}:${link.second.courseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = matchParcelCourses(firstParcel, secondParcel);
    const matched = matches.some(
      (match) =>
        (match.firstCourseId === firstCourse.courseId &&
          match.secondCourseId === secondCourse.courseId) ||
        (match.firstCourseId === secondCourse.courseId &&
          match.secondCourseId === firstCourse.courseId),
    );
    if (!matched) {
      findings.push({
        code: 'LINK_GEOMETRY_MISMATCH',
        severity: 'ERROR',
        parcelIds: [firstParcel.id, secondParcel.id],
        courseIds: [firstCourse.courseId, secondCourse.courseId],
        message: 'Linked courses are not geometrically coincident.',
      });
      continue;
    }
    linkedPairs.add(pairKey(firstParcel.id, secondParcel.id));
  }
  return { linkedPairs, findings };
};

const buildPair = ({
  first,
  second,
  matches,
  linked,
  pointTouch,
  overlapArea,
}: {
  first: CadParcelEntity;
  second: CadParcelEntity;
  matches: CadParcelCourseMatch[];
  linked: boolean;
  pointTouch: boolean;
  overlapArea: number;
}): CadParcelNetworkPair => {
  const firstCourseIds = matches.map((match) => match.firstCourseId);
  const secondCourseIds = matches.map((match) => match.secondCourseId);
  return {
    firstParcelId: first.id,
    secondParcelId: second.id,
    relation: relationFor(linked, matches, pointTouch, overlapArea),
    linked,
    sharedCourseIds: [...new Set([...firstCourseIds, ...secondCourseIds])],
    firstCourseIds,
    secondCourseIds,
    sharedLengthMeters: matches.reduce((total, match) => total + match.lengthMeters, 0),
    sharedGeometryKinds: [...new Set(matches.map((match) => match.geometryKind))],
    pointTouch,
    overlapAreaSquareMeters: overlapArea,
  };
};

const pairFindings = ({
  first,
  second,
  pair,
  strictRoles,
}: {
  first: CadParcelEntity;
  second: CadParcelEntity;
  pair: CadParcelNetworkPair;
  strictRoles: boolean;
}): CadParcelNetworkFinding[] => {
  const findings: CadParcelNetworkFinding[] = [];
  if (pair.overlapAreaSquareMeters > OVERLAP_AREA_EPSILON) {
    findings.push(
      overlapFinding({ first, second, overlapArea: pair.overlapAreaSquareMeters, strictRoles }),
    );
  }
  if (pair.relation === 'GEOMETRIC_SHARED_COURSE') {
    findings.push({
      code: 'UNLINKED_SHARED_COURSE',
      severity: 'WARNING',
      parcelIds: [first.id, second.id],
      courseIds: pair.sharedCourseIds,
      message: 'Parcels share an exact course but have no explicit link.',
    });
  }
  if (pair.relation === 'POINT_TOUCH') {
    findings.push({
      code: 'POINT_TOUCH',
      severity: 'INFO',
      parcelIds: [first.id, second.id],
      courseIds: [],
      message: 'Parcels meet at a single endpoint (zero shared length).',
    });
  }
  return findings;
};

const buildAdjacency = (pairs: readonly CadParcelNetworkPair[]): Map<string, CadParcelNetworkAdjacency[]> => {
  const adjacencyByParcel = new Map<string, CadParcelNetworkAdjacency[]>();
  const push = (parcelId: string, entry: CadParcelNetworkAdjacency): void => {
    const existing = adjacencyByParcel.get(parcelId);
    if (existing) existing.push(entry);
    else adjacencyByParcel.set(parcelId, [entry]);
  };
  for (const pair of pairs) {
    push(pair.firstParcelId, {
      neighborParcelId: pair.secondParcelId,
      relation: pair.relation,
      linked: pair.linked,
      ownCourseIds: pair.firstCourseIds,
      neighborCourseIds: pair.secondCourseIds,
      sharedLengthMeters: pair.sharedLengthMeters,
      sharedGeometryKinds: pair.sharedGeometryKinds,
      pointTouch: pair.pointTouch,
      overlapAreaSquareMeters: pair.overlapAreaSquareMeters,
    });
    push(pair.secondParcelId, {
      neighborParcelId: pair.firstParcelId,
      relation: pair.relation,
      linked: pair.linked,
      ownCourseIds: pair.secondCourseIds,
      neighborCourseIds: pair.firstCourseIds,
      sharedLengthMeters: pair.sharedLengthMeters,
      sharedGeometryKinds: pair.sharedGeometryKinds,
      pointTouch: pair.pointTouch,
      overlapAreaSquareMeters: pair.overlapAreaSquareMeters,
    });
  }
  return adjacencyByParcel;
};

const buildComponents = (
  parcelIds: readonly string[],
  pairs: readonly CadParcelNetworkPair[],
): string[][] => {
  const parent = new Map<string, string>(parcelIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const pair of pairs) {
    if (pair.sharedCourseIds.length === 0) continue;
    const firstRoot = find(pair.firstParcelId);
    const secondRoot = find(pair.secondParcelId);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  }
  const grouped = new Map<string, string[]>();
  for (const id of parcelIds) {
    const root = find(id);
    const group = grouped.get(root);
    if (group) group.push(id);
    else grouped.set(root, [id]);
  }
  return [...grouped.values()]
    .map((group) => [...group].sort())
    .sort((left, right) => (left[0]! < right[0]! ? -1 : 1));
};

export const buildParcelNetwork = (
  project: CadProject,
  links: readonly LinkedPair[] = [],
  options: CadParcelNetworkOptions = {},
): CadParcelNetwork => {
  const parcels = project.entities
    .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
    .sort(parcelSort);
  const parcelsById = new Map(parcels.map((parcel) => [parcel.id, parcel]));
  const linkState = resolveLinks(parcelsById, links);
  const pairs: CadParcelNetworkPair[] = [];
  const findings: CadParcelNetworkFinding[] = [...linkState.findings];

  // Phase 19D F5: resolve bounds / courses / vertices ONCE per parcel.
  // The pair loop below only compares cached values and skips disjoint
  // bbox pairs before any exact comparison (no spatial index framework).
  const cached = parcels.map((parcel) => ({
    parcel,
    bounds: buildCadBounds([parcel]),
    courses: resolveCadParcelCourses(parcel),
    vertices: normalizeParcelPolygonVertices(parcel.vertices),
  }));
  for (let firstIndex = 0; firstIndex < cached.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < cached.length; secondIndex += 1) {
      const first = cached[firstIndex]!;
      const second = cached[secondIndex]!;
      if (!first.bounds || !second.bounds || !boundsOverlap(first.bounds, second.bounds)) continue;
      const matches = matchResolvedParcelCourses(first.courses, second.courses);
      const linked = linkState.linkedPairs.has(pairKey(first.parcel.id, second.parcel.id));
      const pointTouch = matches.length === 0 && hasSharedVertex(first.vertices, second.vertices);
      const overlapArea = detectParcelOverlapAreaSquareMeters(first.parcel, second.parcel, {
        firstBounds: first.bounds,
        secondBounds: second.bounds,
      });
      const pair = buildPair({ first: first.parcel, second: second.parcel, matches, linked, pointTouch, overlapArea });
      if (pair.relation === 'DISJOINT') continue;
      pairs.push(pair);
      findings.push(...pairFindings({ first: first.parcel, second: second.parcel, pair, strictRoles: options.strictRoles ?? false }));
    }
  }

  return {
    parcelIds: parcels.map((parcel) => parcel.id),
    pairs,
    adjacencyByParcel: buildAdjacency(pairs),
    components: buildComponents(
      parcels.map((parcel) => parcel.id),
      pairs,
    ),
    findings,
  };
};

/** On-demand classification of any two parcels (may return DISJOINT). */
export const classifyCadParcelNetworkPair = (
  project: CadProject,
  links: readonly LinkedPair[],
  firstParcelId: CadEntityId,
  secondParcelId: CadEntityId,
  options: CadParcelNetworkOptions = {},
): CadParcelAdjacencyRelation => {
  const network = buildParcelNetwork(project, links, options);
  return (
    network.pairs.find(
      (pair) =>
        (pair.firstParcelId === firstParcelId && pair.secondParcelId === secondParcelId) ||
        (pair.firstParcelId === secondParcelId && pair.secondParcelId === firstParcelId),
    )?.relation ?? 'DISJOINT'
  );
};
