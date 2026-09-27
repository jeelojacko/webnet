// Phase 20A — feature-line CREATION (pure engine helpers).
//
// Two source families, one elevation pipeline:
//  - ordered Survey Points  -> SNAPSHOT (x/y/z copied once, no live dep)
//  - connected Line/Polyline/Arc chains -> plan copied exactly (arcs via the
//    Phase 19C endpoint+bulge seam; never a second convention), then Z is
//    supplied by the elevation method.
//
// Elevation methods: Constant | From CURRENT Surface (per-vertex XY query,
// all-or-nothing — an off-surface vertex BLOCKS the commit) | Entered
// per-vertex Z | Source (survey-point Z only; plan geometry has no trusted
// Z). Z is never defaulted to 0.

import { createStableRuntimeId } from '../id';
import { cadSignedSweepDeg } from './cadGeometry';
import { cadArcEndPoint, cadArcStartPoint } from './cadGeometryArcPrimitives';
import {
  CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG,
  CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE,
  parcelBulgeFromArcDefinition,
} from './cadParcelArcGeometry';
import { buildCadSurface, getSurfaceElevationAt } from './cadSurfaces';
import { createFeatureLineVertexId, sanitizeFeatureLine } from './cadFeatureLines';
import type {
  CadEntity,
  CadEntityId,
  CadFeatureLineEntity,
  CadFeatureLineSegmentGeometry,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from './cadTypes';

export type FeatureLineElevationMethod =
  | { method: 'constant'; z: number }
  | { method: 'surface'; surfaceId: string }
  | { method: 'entered'; z: number[] }
  | { method: 'source' };

export interface FeatureLinePlan {
  vertices: Array<{ x: number; y: number }>;
  /** Present only when at least one course is an arc. */
  segmentGeometry?: CadFeatureLineSegmentGeometry[];
  closed: boolean;
}

export interface FeatureLinePlanWithZ extends FeatureLinePlan {
  elevations: number[];
}

export type FeatureLineCreateResult =
  | { ok: true; entity: CadFeatureLineEntity }
  | {
      ok: false;
      reason: string;
      /** Vertex indices with no surface elevation (surface method only). */
      missingVertexIndices?: number[];
    };

const CONNECT_TOLERANCE = 1e-9;

const samePoint = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean =>
  Math.abs(a.x - b.x) <= CONNECT_TOLERANCE && Math.abs(a.y - b.y) <= CONNECT_TOLERANCE;

/** Deterministic unique default name: "Feature Line N". */
export const nextFeatureLineName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'feature-line') return;
    const match = /^Feature Line (\d+)$/i.exec((entity.name ?? '').trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `Feature Line ${maxSequence + 1}`;
};

const isFiniteXy = (point: { x: number; y: number }): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

// ---------------------------------------------------------------------------
// Plan extraction
// ---------------------------------------------------------------------------

/** Ordered survey points must all exist with finite XYZ (snapshot copy). */
export const buildFeatureLinePlanFromSurveyPoints = (
  project: CadProject,
  pointEntityIds: readonly CadEntityId[],
  closed = false,
): FeatureLinePlan | null => {
  if (pointEntityIds.length < (closed ? 3 : 2)) return null;
  const byId = new Map<string, CadSurveyPointEntity>();
  project.entities.forEach((entity) => {
    if (entity.type === 'survey-point') byId.set(entity.id, entity);
  });
  const points: Array<{ x: number; y: number }> = [];
  for (const id of pointEntityIds) {
    const point = byId.get(id);
    if (!point || !isFiniteXy(point) || !Number.isFinite(point.z)) return null;
    points.push({ x: point.x, y: point.y });

  }
  if (closed && points.length > 2 && samePoint(points[points.length - 1]!, points[0]!)) {
    points.pop();
  }
  return points.length >= (closed ? 3 : 2) ? { vertices: points, closed } : null;
};

/** Source Z for survey-point creation (the only trusted-Z source family). */
export const featureLineSourceElevationsFromSurveyPoints = (
  project: CadProject,
  pointEntityIds: readonly CadEntityId[],
): number[] | null => {
  const byId = new Map<string, CadSurveyPointEntity>();
  project.entities.forEach((entity) => {
    if (entity.type === 'survey-point') byId.set(entity.id, entity);
  });
  const zs: number[] = [];
  for (const id of pointEntityIds) {
    const point = byId.get(id);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;
    zs.push(point.z as number);
  }
  return zs;
};

interface SourcePiece {
  points: Array<{ x: number; y: number }>;
  courses: CadFeatureLineSegmentGeometry[];
  closed: boolean;
}

const pieceFromEntity = (entity: CadEntity): SourcePiece | null => {
  switch (entity.type) {
    case 'line':
      return {
        points: [
          { x: entity.fromX, y: entity.fromY },
          { x: entity.toX, y: entity.toY },
        ],
        courses: [{ kind: 'line' }],
        closed: false,
      };
    case 'polyline': {
      if (entity.vertices.length < 2) return null;
      return {
        points: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        courses: entity.vertices.map<CadFeatureLineSegmentGeometry>(() => ({ kind: 'line' })),
        closed: entity.closed === true,
      };
    }
    case 'arc': {
      const start = cadArcStartPoint(entity);
      const end = cadArcEndPoint(entity);
      const sweepDeg = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
      const bulge = parcelBulgeFromArcDefinition({
        from: start,
        to: end,
        center: { x: entity.centerX, y: entity.centerY },
        radius: entity.radius,
        signedSweepDeg: sweepDeg,
      });
      if (bulge == null || Math.abs(sweepDeg) >= CAD_PARCEL_ARC_FULL_CIRCLE_SWEEP_DEG) return null;
      return { points: [start, end], courses: [{ kind: 'arc', bulge }], closed: false };
    }
    default:
      return null;
  }
};

const reverseCourses = (
  courses: CadFeatureLineSegmentGeometry[],
): CadFeatureLineSegmentGeometry[] =>
  [...courses].reverse().map((entry) =>
    entry.kind === 'arc' ? { kind: 'arc', bulge: -entry.bulge } : { kind: 'line' },
  );

/** Greedy connect pieces in the given order; each join consumes a shared vertex. */
const chainPieces = (pieces: SourcePiece[]): SourcePiece | null => {
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return pieces[0]!;
  const remaining = pieces.slice(1);
  const points = [...pieces[0]!.points];
  const courses = [...pieces[0]!.courses];
  while (remaining.length > 0) {
    const end = points[points.length - 1]!;
    const index = remaining.findIndex(
      (piece) => samePoint(piece.points[0]!, end) || samePoint(piece.points[piece.points.length - 1]!, end),
    );
    if (index < 0) return null;
    const [piece] = remaining.splice(index, 1);
    const forward = samePoint(piece!.points[0]!, end);
    if (forward) {
      courses.push(...piece!.courses);
      points.push(...piece!.points.slice(1));
    } else {
      courses.push(...reverseCourses(piece!.courses));
      points.push(...[...piece!.points].reverse().slice(1));
    }
  }
  return { points, courses, closed: false };
};

/**
 * Plan from connected Line/Polyline/Arc sources, copied exactly. A single
 * closed polyline stays closed. `closed` forces a closing course
 * (last->first); a chain already returning to its first vertex drops the
 * duplicated vertex instead.
 */
export const buildFeatureLinePlanFromChain = (
  project: CadProject,
  sourceEntityIds: readonly CadEntityId[],
  closed = false,
): FeatureLinePlan | null => {
  if (sourceEntityIds.length === 0) return null;
  const byId = new Map(project.entities.map((entity) => [entity.id, entity]));
  const pieces: SourcePiece[] = [];
  for (const id of sourceEntityIds) {
    const entity = byId.get(id);
    if (!entity) return null;
    const piece = pieceFromEntity(entity);
    if (!piece) return null;
    if (!piece.points.every(isFiniteXy)) return null;
    pieces.push(piece);
  }
  const single = pieces.length === 1 ? pieces[0]! : null;
  const chained = single?.closed ? single : chainPieces(pieces);
  if (!chained) return null;
  let { points, courses } = chained;
  let isClosed = chained.closed;
  if (closed && !isClosed) {
    if (points.length > 2 && samePoint(points[points.length - 1]!, points[0]!)) {
      points = points.slice(0, -1);
    } else {
      courses = [...courses, { kind: 'line' }];
    }
    isClosed = true;
  }
  if (points.length < (isClosed ? 3 : 2)) return null;
  const hasArc = courses.some(
    (entry) => entry.kind === 'arc' && Math.abs(entry.bulge) > CAD_PARCEL_ARC_ZERO_CHORD_TOLERANCE,
  );
  return {
    vertices: points,
    ...(hasArc ? { segmentGeometry: courses } : {}),
    closed: isClosed,
  };
};

// ---------------------------------------------------------------------------
// Elevation methods
// ---------------------------------------------------------------------------

const findSurface = (project: CadProject, surfaceId: string): CadSurface | null =>
  project.surfaces?.find((surface) => surface.id === surfaceId) ?? null;

/**
 * Resolve Z for every plan vertex. All-or-nothing: any unresolved vertex
 * fails closed with its index list (surface outside / missing surface /
 * malformed input). No partial application.
 */
export const resolveFeatureLinePlanElevations = (
  project: CadProject,
  plan: FeatureLinePlan,
  method: FeatureLineElevationMethod,
  sourceElevations?: readonly number[],
): { ok: true; elevations: number[] } | { ok: false; reason: string; missingVertexIndices?: number[] } => {
  const count = plan.vertices.length;
  switch (method.method) {
    case 'constant':
      if (!Number.isFinite(method.z)) return { ok: false, reason: 'FEATURE_LINE_ELEVATION_NOT_FINITE' };
      return { ok: true, elevations: Array.from({ length: count }, () => method.z) };
    case 'entered': {
      if (method.z.length !== count || !method.z.every(Number.isFinite)) {
        return { ok: false, reason: 'FEATURE_LINE_ENTERED_ELEVATION_LENGTH' };
      }
      return { ok: true, elevations: [...method.z] };
    }
    case 'source': {
      if (!sourceElevations || sourceElevations.length !== count || !sourceElevations.every(Number.isFinite)) {
        return { ok: false, reason: 'FEATURE_LINE_SOURCE_HAS_NO_TRUSTED_Z' };
      }
      return { ok: true, elevations: [...sourceElevations] };
    }
    case 'surface': {
      const surface = findSurface(project, method.surfaceId);
      if (!surface) return { ok: false, reason: 'FEATURE_LINE_SURFACE_NOT_FOUND' };
      const build = buildCadSurface(project, surface);
      const missing: number[] = [];
      const elevations: number[] = [];
      plan.vertices.forEach((vertex, index) => {
        const z = getSurfaceElevationAt(build, vertex.x, vertex.y);
        if (z == null) missing.push(index);
        elevations.push(z ?? Number.NaN);
      });
      if (missing.length > 0) {
        return { ok: false, reason: 'FEATURE_LINE_SURFACE_MISSING_Z', missingVertexIndices: missing };
      }
      return { ok: true, elevations };
    }
    default:
      return { ok: false, reason: 'FEATURE_LINE_ELEVATION_METHOD_UNKNOWN' };
  }
};

/** Materialize a validated entity (fail-closed sanitize before returning). */
export const buildFeatureLineEntity = (
  project: CadProject,
  plan: FeatureLinePlanWithZ,
  options?: { name?: string; description?: string; createdBy?: string },
): CadFeatureLineEntity | null => {
  if (plan.elevations.length !== plan.vertices.length) return null;
  const featureLineId = createStableRuntimeId('cad-feature-line');
  const entity: CadFeatureLineEntity = {
    id: featureLineId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: options?.name?.trim() || nextFeatureLineName(project),
    ...(options?.description ? { description: options.description } : {}),
    vertices: plan.vertices.map((vertex, index) => ({
      id: createFeatureLineVertexId(featureLineId),
      x: vertex.x,
      y: vertex.y,
      z: plan.elevations[index]!,
    })),
    ...(plan.segmentGeometry != null
      ? { segmentGeometry: plan.segmentGeometry.map((entry) => ({ ...entry })) }
      : {}),
    ...(plan.closed ? { closed: true } : {}),
    metadata: { createdBy: options?.createdBy ?? 'FEATURELINE', manual: true },
  };
  return sanitizeFeatureLine(entity).ok ? entity : null;
};

export interface CreateFeatureLineRequest {
  /** Survey points (ordered) or a connected Line/Polyline/Arc chain. */
  sourceEntityIds: CadEntityId[];
  sourceKind: 'survey-points' | 'chain';
  elevation: FeatureLineElevationMethod;
  name?: string;
  description?: string;
  closed?: boolean;
}

/** Create (never mutate): plan + elevation + stable defaults, or fail closed. */
export const createCadFeatureLine = (
  project: CadProject,
  request: CreateFeatureLineRequest,
): FeatureLineCreateResult => {
  const plan =
    request.sourceKind === 'survey-points'
      ? buildFeatureLinePlanFromSurveyPoints(project, request.sourceEntityIds, request.closed ?? false)
      : buildFeatureLinePlanFromChain(project, request.sourceEntityIds, request.closed ?? false);
  if (!plan) return { ok: false, reason: 'FEATURE_LINE_INVALID_SOURCE_GEOMETRY' };
  const sourceElevations =
    request.sourceKind === 'survey-points'
      ? featureLineSourceElevationsFromSurveyPoints(project, request.sourceEntityIds) ?? undefined
      : undefined;
  const resolved = resolveFeatureLinePlanElevations(project, plan, request.elevation, sourceElevations);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.missingVertexIndices != null
        ? { missingVertexIndices: resolved.missingVertexIndices }
        : {}),
    };
  }
  const entity = buildFeatureLineEntity(
    project,
    { ...plan, elevations: resolved.elevations },
    { name: request.name, description: request.description, createdBy: 'FEATURELINE' },
  );
  if (!entity) return { ok: false, reason: 'FEATURE_LINE_INVALID_RESULT' };
  return { ok: true, entity };
};
