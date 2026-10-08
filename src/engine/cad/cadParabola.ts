/**
 * First-class finite parabola entity helpers (Worker B scope).
 *
 * Canonical schema (see docs/evidence/cad-best-fit-e1/architecture.md §3):
 *   vertex V, opening-axis angle A (degrees CCW from +X), focal length
 *   f > 0 (metres), finite extent [tStart, tEnd] with tStart < tEnd.
 *   P(t) = V + b * (2 f t) + a * (f t^2), a = unit axis, b = left-perp.
 *
 * The model stays analytic everywhere: tessellation is display/export-only
 * (bounded, deterministic, chord-tolerance driven) and never replaces the
 * stored vertex/axis/focal/range. All pure numerics live in
 * cadParabolaGeometry.ts (Worker A); this module is the entity seam.
 */
import { cadNormalizeAngleDeg } from './cadGeometry';
import {
  cadParabolaAxisBasis,
  cadParabolaClosestPoint,
  cadParabolaCurveLength,
  cadParabolaHalfLengthMidpointT,
  cadParabolaLineIntersection,
  cadParabolaParamPoint,
  type CanonicalParabola,
} from './cadParabolaGeometry';
import {
  applyPoint,
  applyVector,
  type CadTransform2D,
  type CadTransformClassification,
} from './cadTransform2D';
import type { CadParabolaEntity } from './cadTypes';

/** Chord tolerance for display/export tessellation (metres). Shared with
 * the surface breakline chord-tolerance convention (0.001 m). */
export const CAD_PARABOLA_TESSELLATION_CHORD_TOLERANCE = 0.001;

/** Hard cap so degenerate-but-valid ranges can never explode the DOM. */
export const CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS = 2048;

/** Focal floor: mirrors the shared CAD geometric floor (circle precedent)
 * and Worker A's canonical `PARABOLA_FLOOR` (1e-12 m). Kept local so the
 * entity seam does not pull the drafting-only shape-builders module into
 * the worker-reachable import closure. */
export const CAD_PARABOLA_FOCAL_FLOOR = 1e-12;

export const isValidParabolaGeometry = (
  vertexX: number,
  vertexY: number,
  axisAngleDeg: number,
  focalLength: number,
  tStart: number,
  tEnd: number,
): boolean =>
  Number.isFinite(vertexX) &&
  Number.isFinite(vertexY) &&
  Number.isFinite(axisAngleDeg) &&
  Number.isFinite(focalLength) &&
  Number.isFinite(tStart) &&
  Number.isFinite(tEnd) &&
  focalLength > CAD_PARABOLA_FOCAL_FLOOR &&
  tStart < tEnd;

export const isValidParabolaEntity = (entity: CadParabolaEntity): boolean =>
  isValidParabolaGeometry(
    entity.vertexX,
    entity.vertexY,
    entity.axisAngleDeg,
    entity.focalLength,
    entity.tStart,
    entity.tEnd,
  );

export const parabolaToCanonical = (entity: CadParabolaEntity): CanonicalParabola => ({
  vertexX: entity.vertexX,
  vertexY: entity.vertexY,
  axisAngleDeg: entity.axisAngleDeg,
  focalLength: entity.focalLength,
  tStart: entity.tStart,
  tEnd: entity.tEnd,
});

/** Caller-supplied identity/appearance for a projected parabola entity. */
export interface CadParabolaEntitySeed {
  id: string;
  layerId: string;
  styleId?: string;
  appearance?: CadParabolaEntity['appearance'];
  metadata?: CadParabolaEntity['metadata'];
  visible?: boolean;
  locked?: boolean;
}

/**
 * Pure projection of a canonical fit result (Worker A) into a first-class
 * CadParabolaEntity. Framework-free: the caller owns id/layer/appearance.
 * Returns null when the canonical geometry is invalid, so a best-fit result
 * can never materialize a malformed entity.
 */
export const cadParabolaEntityFromCanonical = (
  canonical: CanonicalParabola,
  seed: CadParabolaEntitySeed,
): CadParabolaEntity | null => {
  if (
    !isValidParabolaGeometry(
      canonical.vertexX,
      canonical.vertexY,
      canonical.axisAngleDeg,
      canonical.focalLength,
      canonical.tStart,
      canonical.tEnd,
    )
  ) {
    return null;
  }
  return {
    id: seed.id,
    type: 'parabola',
    layerId: seed.layerId,
    ...(seed.styleId != null ? { styleId: seed.styleId } : {}),
    visible: seed.visible ?? true,
    locked: seed.locked ?? false,
    ...(seed.appearance != null ? { appearance: seed.appearance } : {}),
    ...(seed.metadata != null ? { metadata: seed.metadata } : {}),
    vertexX: canonical.vertexX,
    vertexY: canonical.vertexY,
    axisAngleDeg: canonical.axisAngleDeg,
    focalLength: canonical.focalLength,
    tStart: canonical.tStart,
    tEnd: canonical.tEnd,
  };
};

export interface CadParabolaEndpoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export const cadParabolaEntityEndpoints = (entity: CadParabolaEntity): CadParabolaEndpoints => {
  const canonical = parabolaToCanonical(entity);
  return {
    start: cadParabolaParamPoint(canonical, entity.tStart),
    end: cadParabolaParamPoint(canonical, entity.tEnd),
  };
};

export const cadParabolaEntityLength = (entity: CadParabolaEntity): number | null =>
  cadParabolaCurveLength(parabolaToCanonical(entity));

/** Half curve-length midpoint: exact primitive solve (never the t-average). */
export const cadParabolaEntityMidpoint = (entity: CadParabolaEntity): { x: number; y: number } | null => {
  const canonical = parabolaToCanonical(entity);
  const t = cadParabolaHalfLengthMidpointT(canonical);
  return t == null ? null : cadParabolaParamPoint(canonical, t);
};

/** Analytic finite closest point (cubic solve, never chord math). */
export const cadParabolaEntityClosestPoint = (
  entity: CadParabolaEntity,
  point: { x: number; y: number },
): { x: number; y: number } | null =>
  cadParabolaClosestPoint(parabolaToCanonical(entity), point);

interface TessellationWork {
  points: Array<{ x: number; y: number }>;
  tolerance: number;
}

/** Distance from point to the chord (a, b); degenerate chords read 0. */
const chordDeviation = (
  candidate: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return Math.hypot(candidate.x - a.x, candidate.y - a.y);
  const t = ((candidate.x - a.x) * dx + (candidate.y - a.y) * dy) / lengthSquared;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(candidate.x - (a.x + dx * clamped), candidate.y - (a.y + dy * clamped));
};

const subdivideRange = (
  canonical: CanonicalParabola,
  t0: number,
  t1: number,
  work: TessellationWork,
): void => {
  if (work.points.length >= CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS + 1) return;
  const p0 = cadParabolaParamPoint(canonical, t0);
  const p1 = cadParabolaParamPoint(canonical, t1);
  const mid = (t0 + t1) / 2;
  const pm = cadParabolaParamPoint(canonical, mid);
  if (chordDeviation(pm, p0, p1) <= work.tolerance) {
    work.points.push(p1);
    return;
  }
  if (work.points.length >= CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS) {
    work.points.push(p1);
    return;
  }
  subdivideRange(canonical, t0, mid, work);
  subdivideRange(canonical, mid, t1, work);
};

/**
 * Deterministic bounded tessellation of P(t) over [tStart, tEnd].
 * Recursive midpoint subdivision in t order (never reordered); every
 * emitted chord deviates from the analytic curve by at most `tolerance`
 * unless the segment cap binds (then the tail chord closes the range so
 * the endpoints stay exact). Returns null for invalid geometry.
 */
export const cadParabolaTessellatePoints = (
  entity: CadParabolaEntity,
  tolerance: number = CAD_PARABOLA_TESSELLATION_CHORD_TOLERANCE,
): Array<{ x: number; y: number }> | null => {
  if (!isValidParabolaEntity(entity)) return null;
  if (!Number.isFinite(tolerance) || tolerance <= 0) return null;
  const canonical = parabolaToCanonical(entity);
  const work: TessellationWork = {
    points: [cadParabolaParamPoint(canonical, entity.tStart)],
    tolerance,
  };
  subdivideRange(canonical, entity.tStart, entity.tEnd, work);
  return work.points;
};

export interface CadParabolaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const cadParabolaEntityBounds = (entity: CadParabolaEntity): CadParabolaBounds | null => {
  if (!isValidParabolaEntity(entity)) return null;
  const { minX, minY, maxX, maxY } = entityBoundsOf(entity);
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};

const entityBoundsOf = (entity: CadParabolaEntity): CadParabolaBounds => {
  const canonical = parabolaToCanonical(entity);
  const { aX, aY, bX, bY } = cadParabolaAxisBasis(entity.axisAngleDeg);
  const candidates = [entity.tStart, entity.tEnd];
  if (Math.abs(aX) > CAD_PARABOLA_FOCAL_FLOOR) candidates.push(-bX / aX);
  if (Math.abs(aY) > CAD_PARABOLA_FOCAL_FLOOR) candidates.push(-bY / aY);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of candidates) {
    if (t < entity.tStart || t > entity.tEnd) continue;
    const point = cadParabolaParamPoint(canonical, t);
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Exact line/segment vs finite parabola (quadratic in the canonical frame,
 * via Worker A). Circle/arc/parabola-vs-parabola are explicitly deferred:
 * no function here claims them, so callers cannot render false chords.
 */
export const cadParabolaSegmentIntersections = (
  entity: CadParabolaEntity,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Array<{ x: number; y: number }> => {
  if (!isValidParabolaEntity(entity)) return [];
  return cadParabolaLineIntersection(parabolaToCanonical(entity), start, end);
};

export type TransformParabolaResult =
  | { ok: true; entity: CadParabolaEntity }
  | { ok: false; reason: string };

/**
 * Exact similarity transform. Translation/rotation/uniform-scale carry the
 * analytic model (vertex through the matrix, axis through the linear part,
 * focal scaled by |scale|). Reflection (determinant < 0) re-parameterizes
 * t -> -t so the canonical left-perp convention survives the handedness
 * flip. Non-uniform/shear/affine fail closed (a parabola would leave the
 * canonical family), as does a sub-floor focal result.
 */
export const transformParabolaEntity = (
  entity: CadParabolaEntity,
  transform: CadTransform2D,
  classification: CadTransformClassification,
): TransformParabolaResult => {
  if (classification.kind === 'GENERAL_AFFINE') {
    return { ok: false, reason: 'CAD_TRANSFORM_PARABOLA_NON_UNIFORM_UNSUPPORTED' };
  }
  const radians = (entity.axisAngleDeg * Math.PI) / 180;
  const axis = applyVector(transform, { x: Math.cos(radians), y: Math.sin(radians) });
  if (!(Math.hypot(axis.x, axis.y) > 0)) {
    return { ok: false, reason: 'CAD_TRANSFORM_PARABOLA_DEGENERATE_RESULT' };
  }
  const vertex = applyPoint(transform, { x: entity.vertexX, y: entity.vertexY });
  const axisAngleDeg = cadNormalizeAngleDeg((Math.atan2(axis.y, axis.x) * 180) / Math.PI);
  const focalLength = entity.focalLength * Math.abs(classification.scale);
  const reflected = classification.determinantSign === -1;
  const tStart = reflected ? -entity.tEnd : entity.tStart;
  const tEnd = reflected ? -entity.tStart : entity.tEnd;
  if (!isValidParabolaGeometry(vertex.x, vertex.y, axisAngleDeg, focalLength, tStart, tEnd)) {
    return { ok: false, reason: 'CAD_TRANSFORM_PARABOLA_DEGENERATE_RESULT' };
  }
  return {
    ok: true,
    entity: { ...entity, vertexX: vertex.x, vertexY: vertex.y, axisAngleDeg, focalLength, tStart, tEnd },
  };
};

/** Axis azimuth (degrees clockwise from north) for read-only summaries. */
export const cadParabolaAxisAzimuthDeg = (entity: CadParabolaEntity): number =>
  cadNormalizeAngleDeg(90 - entity.axisAngleDeg);
