// Phase 19D Worker B — parcel Shared Boundary relationship model.
//
// A Shared Boundary is a PERSISTENT RELATIONSHIP between two parcel courses
// that describe the same physical edge in opposite traversal directions.
// The record stores refs only (parcelId + courseId); every geometry value
// (length, radius, endpoints, sweep) is DERIVED from the authoritative
// course resolver at resolve time and NEVER persisted (§18/§2.3, mirroring
// the CadVolumeSurface "refs only, no cached geometry" precedent).
//
// Identity is deterministic (no randomness): the id is a canonical function
// of the two ends, so repeated mints agree and A<->B mints the same id as
// B<->A. Status is derived only — CURRENT | BROKEN_REFERENCE |
// GEOMETRY_MISMATCH — and is never a trusted persisted flag.
//
// This module also owns the load-path sanitizer (malformed entries are
// dropped with an explicit diagnostic; refs are never rebound by index or
// designation) and the wave-1 persistence helpers used by cadPersistence.ts
// and cadDrawingFile.ts. Central registry wiring is deferred to the
// integration wave.

import { resolveCadParcelCourses } from './cadParcelCourses';
import type { CadParcelArcCourse, CadParcelCourse } from './cadParcelCourses';
import type {
  CadDisplayPoint,
  CadParcelEntity,
  CadParcelSharedBoundary,
  CadParcelSharedBoundaryEnd,
  CadProject,
} from './cadTypes';

export type { CadParcelSharedBoundary, CadParcelSharedBoundaryEnd };

/** Derived only; never persisted as a flag. */
export type CadParcelSharedBoundaryStatus =
  | 'CURRENT'
  | 'BROKEN_REFERENCE'
  | 'GEOMETRY_MISMATCH';

// Project field lives on CadProject in cadTypes.ts (trailing optional key;
// load paths backfill []). This module owns the resolver/validator/sanitizer
// over that collection.

// ---------------------------------------------------------------------------
// Machine-conditioning constants (NOT survey tolerances, NOT topology).
// Two independently-derived courses that describe the same edge agree to
// float-noise scale; anything looser would be snapping/proximity, which this
// layer must never do.
// ---------------------------------------------------------------------------

export const CAD_PARCEL_SHARED_POINT_EPS = 1e-9;
export const CAD_PARCEL_SHARED_SWEEP_EPS_DEG = 1e-9;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const endKey = (end: CadParcelSharedBoundaryEnd): string => `${end.parcelId}:${end.courseId}`;

const sameEnd = (a: CadParcelSharedBoundaryEnd, b: CadParcelSharedBoundaryEnd): boolean =>
  a.parcelId === b.parcelId && a.courseId === b.courseId;

const pointsMatch = (a: CadDisplayPoint, b: CadDisplayPoint): boolean =>
  Math.abs(a.x - b.x) <= CAD_PARCEL_SHARED_POINT_EPS &&
  Math.abs(a.y - b.y) <= CAD_PARCEL_SHARED_POINT_EPS;

/**
 * Canonical deterministic id: order-independent over the two ends, so
 * `first`/`second` orientation never changes identity and repeated mints
 * agree (buildParcelCourseId symmetry, no randomness).
 */
export const buildCadParcelSharedBoundaryId = (
  first: CadParcelSharedBoundaryEnd,
  second: CadParcelSharedBoundaryEnd,
): string => {
  const keys = [endKey(first), endKey(second)].sort();
  return `parcel-shared:${keys[0]}|${keys[1]}`;
};

/** Drawing-owned relationship collection (backfilled to [] for legacy). */
export const readCadParcelSharedBoundaries = (project: CadProject): CadParcelSharedBoundary[] =>
  project.sharedParcelBoundaries ?? [];

export const cloneCadParcelSharedBoundaries = (
  boundaries: readonly CadParcelSharedBoundary[],
): CadParcelSharedBoundary[] =>
  boundaries.map((boundary) => ({
    id: boundary.id,
    first: { ...boundary.first },
    second: { ...boundary.second },
  }));

// ---------------------------------------------------------------------------
// Resolution (canonical course seam only) + opposite-traversal equivalence
// ---------------------------------------------------------------------------

export interface CadParcelSharedBoundaryResolved {
  parcel: CadParcelEntity;
  course: CadParcelCourse;
}

export const resolveCadParcelSharedBoundaryEnd = (
  project: CadProject,
  end: CadParcelSharedBoundaryEnd,
): CadParcelSharedBoundaryResolved | null => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity =>
      entity.type === 'parcel' && entity.id === end.parcelId,
  );
  if (!parcel) return null;
  const course = resolveCadParcelCourses(parcel).find(
    (candidate) => candidate.courseId === end.courseId,
  );
  return course ? { parcel, course } : null;
};

export type CadParcelSharedBoundaryMismatchCode =
  | 'KIND_MISMATCH'
  | 'ENDPOINT_MISMATCH'
  | 'CIRCLE_MISMATCH'
  | 'SWEEP_MISMATCH';

/**
 * Exact whole-course opposite-traversal equivalence under machine conditioning
 * only (no snapping/proximity). Lines: endpoints swap exactly. Arcs: endpoints
 * swap, same center + radius, and signed sweeps sum to zero — which pins
 * direction AND major/minor (|sweep| equal, sign opposite).
 * Returns null when equivalent, else the first mismatch code.
 */
export const compareCadParcelSharedBoundaryCourses = (
  left: CadParcelCourse,
  right: CadParcelCourse,
): CadParcelSharedBoundaryMismatchCode | null => {
  if (left.kind !== right.kind) return 'KIND_MISMATCH';
  if (
    !pointsMatch(left.fromVertex, right.toVertex) ||
    !pointsMatch(left.toVertex, right.fromVertex)
  ) {
    return 'ENDPOINT_MISMATCH';
  }
  if (left.kind === 'line') return null;
  const rightArc = right as CadParcelArcCourse;
  const radiusScale = Math.max(1, Math.abs(left.radius), Math.abs(rightArc.radius));
  if (Math.abs(left.radius - rightArc.radius) > CAD_PARCEL_SHARED_POINT_EPS * radiusScale) {
    return 'CIRCLE_MISMATCH';
  }
  if (!pointsMatch(left.center, rightArc.center)) return 'CIRCLE_MISMATCH';
  if (
    Math.abs(left.signedSweepDeg + rightArc.signedSweepDeg) >
    CAD_PARCEL_SHARED_SWEEP_EPS_DEG
  ) {
    return 'SWEEP_MISMATCH';
  }
  return null;
};

// ---------------------------------------------------------------------------
// Link validation (stateful: duplicate-link + one-course-one-neighbor guards)
// ---------------------------------------------------------------------------

export type CadParcelSharedBoundaryValidationCode =
  | 'UNKNOWN_PARCEL'
  | 'UNKNOWN_COURSE'
  | 'SAME_PARCEL'
  | 'DUPLICATE_SIDE'
  | 'DUPLICATE_LINK'
  | 'COURSE_ALREADY_LINKED'
  | CadParcelSharedBoundaryMismatchCode;

export interface CadParcelSharedBoundaryIssue {
  code: CadParcelSharedBoundaryValidationCode;
  message: string;
}

export interface CadParcelSharedBoundaryValidation {
  ok: boolean;
  issues: CadParcelSharedBoundaryIssue[];
}

const issue = (
  code: CadParcelSharedBoundaryValidationCode,
  message: string,
): CadParcelSharedBoundaryIssue => ({ code, message });

const resolveEndIssue = (
  project: CadProject,
  end: CadParcelSharedBoundaryEnd,
): { resolved: CadParcelSharedBoundaryResolved | null; issue: CadParcelSharedBoundaryIssue | null } => {
  const resolved = resolveCadParcelSharedBoundaryEnd(project, end);
  if (resolved) return { resolved, issue: null };
  const parcelExists = project.entities.some(
    (entity) => entity.type === 'parcel' && entity.id === end.parcelId,
  );
  return {
    resolved: null,
    issue: parcelExists
      ? issue('UNKNOWN_COURSE', `Parcel ${end.parcelId} has no course ${end.courseId}.`)
      : issue('UNKNOWN_PARCEL', `Parcel ${end.parcelId} does not exist.`),
  };
};

/**
 * Validate a candidate link against the current project state. Fails closed:
 * any issue means the caller must not persist. One course may participate in
 * at most one shared boundary, so a second link touching either course is
 * blocked (this also subsumes the exact-duplicate case).
 */
export const validateSharedBoundary = (
  project: CadProject,
  first: CadParcelSharedBoundaryEnd,
  second: CadParcelSharedBoundaryEnd,
): CadParcelSharedBoundaryValidation => {
  const issues: CadParcelSharedBoundaryIssue[] = [];
  if (sameEnd(first, second)) {
    issues.push(issue('DUPLICATE_SIDE', 'Both sides reference the same parcel course.'));
  } else if (first.parcelId === second.parcelId) {
    issues.push(issue('SAME_PARCEL', 'A parcel cannot share a boundary with itself.'));
  }
  const left = resolveEndIssue(project, first);
  const right = resolveEndIssue(project, second);
  if (left.issue) issues.push(left.issue);
  if (right.issue) issues.push(right.issue);
  if (issues.length > 0) return { ok: false, issues };

  const existing = readCadParcelSharedBoundaries(project);
  const duplicate = existing.some(
    (boundary) =>
      (sameEnd(boundary.first, first) && sameEnd(boundary.second, second)) ||
      (sameEnd(boundary.first, second) && sameEnd(boundary.second, first)),
  );
  const alreadyLinked = existing.some((boundary) =>
    [boundary.first, boundary.second].some((end) => sameEnd(end, first) || sameEnd(end, second)),
  );
  if (duplicate) {
    issues.push(issue('DUPLICATE_LINK', 'This shared boundary already exists.'));
  } else if (alreadyLinked) {
    issues.push(
      issue('COURSE_ALREADY_LINKED', 'A course in this link already has a shared boundary.'),
    );
  }
  const mismatch = compareCadParcelSharedBoundaryCourses(left.resolved!.course, right.resolved!.course);
  if (mismatch) {
    issues.push(issue(mismatch, `Courses are not exact opposite traversals of one edge (${mismatch}).`));
  }
  return { ok: issues.length === 0, issues };
};

export const deriveCadParcelSharedBoundaryStatus = (
  project: CadProject,
  boundary: CadParcelSharedBoundary,
): CadParcelSharedBoundaryStatus => {
  if (sameEnd(boundary.first, boundary.second) || boundary.first.parcelId === boundary.second.parcelId) {
    return 'BROKEN_REFERENCE';
  }
  const left = resolveCadParcelSharedBoundaryEnd(project, boundary.first);
  const right = resolveCadParcelSharedBoundaryEnd(project, boundary.second);
  if (!left || !right) return 'BROKEN_REFERENCE';
  return compareCadParcelSharedBoundaryCourses(left.course, right.course) == null
    ? 'CURRENT'
    : 'GEOMETRY_MISMATCH';
};

/** Derived shared length/radius; null unless the relationship is CURRENT. */
export interface CadParcelSharedBoundaryGeometry {
  kind: 'line' | 'arc';
  lengthMeters: number;
  radiusMeters: number | null;
}

export const resolveCadParcelSharedBoundaryGeometry = (
  project: CadProject,
  boundary: CadParcelSharedBoundary,
): CadParcelSharedBoundaryGeometry | null => {
  if (deriveCadParcelSharedBoundaryStatus(project, boundary) !== 'CURRENT') return null;
  const resolved = resolveCadParcelSharedBoundaryEnd(project, boundary.first);
  if (!resolved) return null;
  return resolved.course.kind === 'line'
    ? { kind: 'line', lengthMeters: resolved.course.distanceMeters, radiusMeters: null }
    : { kind: 'arc', lengthMeters: resolved.course.arcLength, radiusMeters: resolved.course.radius };
};

// ---------------------------------------------------------------------------
// Load-path sanitizer (never crashes, never rebinds by index/designation)
// ---------------------------------------------------------------------------

export type CadParcelSharedBoundaryDropReason =
  | 'MALFORMED'
  | 'UNKNOWN_REFERENCE'
  | 'SAME_PARCEL'
  | 'DUPLICATE_SIDE'
  | 'NON_MANIFOLD';

export interface CadParcelSharedBoundarySanitizeDiagnostic {
  code: 'CAD_PARCEL_SHARED_BOUNDARY_DROPPED';
  reason: CadParcelSharedBoundaryDropReason;
  message: string;
}

const parseEnd = (value: unknown): CadParcelSharedBoundaryEnd | null => {
  if (!isRecord(value)) return null;
  const parcelId = value['parcelId'];
  const courseId = value['courseId'];
  if (typeof parcelId !== 'string' || parcelId.length === 0) return null;
  if (typeof courseId !== 'string' || courseId.length === 0) return null;
  return { parcelId, courseId };
};

const parseBoundary = (
  value: unknown,
): { id: string | null; first: CadParcelSharedBoundaryEnd; second: CadParcelSharedBoundaryEnd } | null => {
  if (!isRecord(value)) return null;
  const first = parseEnd(value['first']);
  const second = parseEnd(value['second']);
  if (!first || !second) return null;
  const id = typeof value['id'] === 'string' && value['id'].length > 0 ? value['id'] : null;
  return { id, first, second };
};

/**
 * Load-time sanitize + backfill. Legacy (absent field) opens with []. Every
 * malformed entry is dropped with an explicit diagnostic — unknown
 * parcel/course, same parcel both sides, duplicated side, or a course
 * already claimed by an earlier boundary (so 3-parcels-one-course can never
 * persist). Stored order decides which link survives; refs are never rebound
 * by index or designation. Pure and total: never throws.
 */
export const sanitizeCadParcelSharedBoundaries = (
  project: CadProject,
): {
  boundaries: CadParcelSharedBoundary[];
  diagnostics: CadParcelSharedBoundarySanitizeDiagnostic[];
} => {
  const raw = project.sharedParcelBoundaries;
  const diagnostics: CadParcelSharedBoundarySanitizeDiagnostic[] = [];
  const drop = (reason: CadParcelSharedBoundaryDropReason, message: string): void => {
    diagnostics.push({ code: 'CAD_PARCEL_SHARED_BOUNDARY_DROPPED', reason, message });
  };
  if (raw == null) return { boundaries: [], diagnostics };
  if (!Array.isArray(raw)) {
    drop('MALFORMED', 'sharedParcelBoundaries is not an array.');
    return { boundaries: [], diagnostics };
  }
  const boundaries: CadParcelSharedBoundary[] = [];
  const claimedCourses = new Set<string>();
  raw.forEach((entry, index) => {
    const parsed = parseBoundary(entry);
    if (!parsed) {
      drop('MALFORMED', `Shared boundary at index ${index} is malformed.`);
      return;
    }
    const { first, second } = parsed;
    if (sameEnd(first, second)) {
      drop('DUPLICATE_SIDE', 'Shared boundary references the same parcel course on both sides.');
      return;
    }
    if (first.parcelId === second.parcelId) {
      drop('SAME_PARCEL', 'Shared boundary references one parcel on both sides.');
      return;
    }
    if (
      !resolveCadParcelSharedBoundaryEnd(project, first) ||
      !resolveCadParcelSharedBoundaryEnd(project, second)
    ) {
      drop('UNKNOWN_REFERENCE', 'Shared boundary references an unknown parcel or course.');
      return;
    }
    const firstKey = endKey(first);
    const secondKey = endKey(second);
    if (claimedCourses.has(firstKey) || claimedCourses.has(secondKey)) {
      drop('NON_MANIFOLD', 'A course in this shared boundary already has one.');
      return;
    }
    claimedCourses.add(firstKey);
    claimedCourses.add(secondKey);
    boundaries.push({
      id: parsed.id ?? buildCadParcelSharedBoundaryId(first, second),
      first: { ...first },
      second: { ...second },
    });
  });
  return { boundaries, diagnostics };
};
