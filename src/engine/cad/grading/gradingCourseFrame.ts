/**
 * Phase 20B — grading source-course frame + identity.
 *
 * One physical Feature Line course is graded in the PERSISTED A->B
 * direction; left/right are relative to that direction. The world side is
 * therefore stable across source reversal: resolving B->A storage against
 * an A->B definition reorients the geometry instead of flipping the side.
 *
 * Arc reorientation note: a circular arc course reversed B->A keeps the
 * same circle (center/radius) but logically reverses sweep and bulge —
 * signed sweep negates and start/end angles swap. This slice resolves only
 * straight-course plan frames; arc courses carry `isArc: true` so the
 * curve slice (gradingCurve.ts) can linearize within the chord tolerance.
 */
import type { ResolvedGradingArc, ResolvedGradingSource } from './gradingTypes';
import type { GradingSide } from './gradingTypes';

export interface PlanVector {
  nx: number;
  ny: number;
}

export interface LocalFrame {
  /** Along-source station from A (metres, plan). */
  u: number;
  /** Signed offset from the source: + toward the side normal. */
  d: number;
}

/**
 * Unit side normal of a unit tangent T=(tx,ty): Nleft=(-ty,tx),
 * Nright=(ty,-tx). The tangent is normalized defensively; degenerate
 * (non-finite or zero-length) input fail-closes to null.
 */
export const gradingSideNormal = (
  tx: number,
  ty: number,
  side: GradingSide,
): PlanVector | null => {
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  const len = Math.hypot(tx, ty);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  const ux = tx / len;
  const uy = ty / len;
  // +0 collapses -0 so normals compare cleanly under toEqual.
  return side === 'left' ? { nx: -uy + 0, ny: ux + 0 } : { nx: uy + 0, ny: -ux + 0 };
};

/** Unit tangent of a resolved source in A->B direction, null when degenerate. */
const sourceTangent = (src: ResolvedGradingSource): PlanVector | null => {
  if (!Number.isFinite(src.startX) || !Number.isFinite(src.startY)) return null;
  if (!Number.isFinite(src.endX) || !Number.isFinite(src.endY)) return null;
  if (!Number.isFinite(src.length) || !(src.length > 0)) return null;
  const dx = src.endX - src.startX;
  const dy = src.endY - src.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { nx: dx / len, ny: dy / len };
};

/** World XY -> local (u along source, d toward the side normal). */
export const toLocalFrame = (
  qx: number,
  qy: number,
  src: ResolvedGradingSource,
  n: PlanVector,
): LocalFrame | null => {
  if (!Number.isFinite(qx) || !Number.isFinite(qy)) return null;
  if (!Number.isFinite(n.nx) || !Number.isFinite(n.ny)) return null;
  const t = sourceTangent(src);
  if (!t) return null;
  const rx = qx - src.startX;
  const ry = qy - src.startY;
  return { u: rx * t.nx + ry * t.ny, d: rx * n.nx + ry * n.ny };
};

/** Local (u,d) -> world XY. Inverse of toLocalFrame for the same frame. */
export const fromLocalFrame = (
  u: number,
  d: number,
  src: ResolvedGradingSource,
  n: PlanVector,
): { x: number; y: number } | null => {
  if (!Number.isFinite(u) || !Number.isFinite(d)) return null;
  if (!Number.isFinite(n.nx) || !Number.isFinite(n.ny)) return null;
  const t = sourceTangent(src);
  if (!t) return null;
  return { x: src.startX + t.nx * u + n.nx * d, y: src.startY + t.ny * u + n.ny * d };
};

/**
 * Structural course shape (subset of ResolvedFeatureLineCourse fields).
 * Structural on purpose: tests pass fakes without building a feature line.
 */
export interface GradingCourseLike {
  fromVertexId: string;
  toVertexId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startZ: number;
  endZ: number;
  planLength: number;
  isArc: boolean;
  /**
   * Arc circle parameters in stored-course orientation (degrees). Absent on
   * straight courses; absorbed into `arc` (radians, A->B) on resolve.
   */
  arc?: {
    centerX: number;
    centerY: number;
    radius: number;
    startAngleDeg: number;
    signedSweepDeg: number;
  };
}

/**
 * Orient stored arc parameters into A->B radians. A reversed (B->A)
 * course keeps the same circle but swaps start/end and negates the sweep.
 * Returns undefined when the course carries no usable arc parameters
 * (the worker then falls back to the legacy single-chord solve).
 */
const orientArc = (
  stored: GradingCourseLike['arc'],
  forward: boolean,
): ResolvedGradingArc | undefined => {
  if (stored == null) return undefined;
  const { centerX, centerY, radius, startAngleDeg, signedSweepDeg } = stored;
  for (const v of [centerX, centerY, radius, startAngleDeg, signedSweepDeg]) {
    if (!Number.isFinite(v)) return undefined;
  }
  if (!(radius! > 0) || signedSweepDeg === 0) return undefined;
  const factor = Math.PI / 180;
  const startDeg = forward ? startAngleDeg! : startAngleDeg! + signedSweepDeg!;
  const sweepDeg = forward ? signedSweepDeg! : -signedSweepDeg!;
  return {
    centerX: centerX!,
    centerY: centerY!,
    radius: radius!,
    startAngle: startDeg * factor,
    endAngle: (startDeg + sweepDeg) * factor,
    sweepCCW: sweepDeg > 0,
  };
};

/**
 * Phase 20C: structural mapping from a resolved Feature Line course (the
 * `ResolvedFeatureLineCourse` shape) to the grading-course shape consumed by
 * `resolveGradingSourceCourse`. Shared by the single-course and group
 * resolve paths so the two cannot drift.
 */
export const toGradingCourseLikes = (
  courses: ReadonlyArray<{
    fromVertexId: string;
    toVertexId: string;
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    planLength: number;
    kind: 'line' | 'arc';
    center?: { x: number; y: number };
    radius?: number;
    startAngleDeg?: number;
    signedSweepDeg?: number;
  }>,
): GradingCourseLike[] =>
  courses.map((course) => ({
    fromVertexId: course.fromVertexId,
    toVertexId: course.toVertexId,
    startX: course.from.x,
    startY: course.from.y,
    endX: course.to.x,
    endY: course.to.y,
    startZ: course.from.z,
    endZ: course.to.z,
    planLength: course.planLength,
    isArc: course.kind === 'arc',
    ...(course.kind === 'arc' &&
    course.center != null &&
    course.radius != null &&
    course.startAngleDeg != null &&
    course.signedSweepDeg != null
      ? {
          arc: {
            centerX: course.center.x,
            centerY: course.center.y,
            radius: course.radius,
            startAngleDeg: course.startAngleDeg,
            signedSweepDeg: course.signedSweepDeg,
          },
        }
      : {}),
  }));

/**
 * Resolve the single course whose endpoints match {A,B} in either order,
 * oriented A->B (`reoriented: true` when stored B->A). Returns null when
 * the vertex pair is not adjacent (BROKEN_REFERENCE downstream): no match,
 * ambiguous duplicates, non-finite geometry, or non-positive plan length.
 * An inserted vertex breaks adjacency by construction (A->V, V->B), and a
 * deleted endpoint removes every match.
 */
export const resolveGradingSourceCourse = (
  courses: GradingCourseLike[],
  vertexAId: string,
  vertexBId: string,
): ResolvedGradingSource | null => {
  if (!Array.isArray(courses) || courses.length === 0) return null;
  if (typeof vertexAId !== 'string' || vertexAId.length === 0) return null;
  if (typeof vertexBId !== 'string' || vertexBId.length === 0) return null;
  if (vertexAId === vertexBId) return null;
  const hits = courses.filter(
    (c) =>
      (c.fromVertexId === vertexAId && c.toVertexId === vertexBId) ||
      (c.fromVertexId === vertexBId && c.toVertexId === vertexAId),
  );
  if (hits.length !== 1) return null;
  const hit = hits[0] as GradingCourseLike;
  const forward = hit.fromVertexId === vertexAId;
  const startX = forward ? hit.startX : hit.endX;
  const startY = forward ? hit.startY : hit.endY;
  const endX = forward ? hit.endX : hit.startX;
  const endY = forward ? hit.endY : hit.startY;
  const startZ = forward ? hit.startZ : hit.endZ;
  const endZ = forward ? hit.endZ : hit.startZ;
  for (const v of [startX, startY, endX, endY, startZ, endZ]) {
    if (!Number.isFinite(v)) return null;
  }
  const arc = orientArc(hit.arc, forward);
  const dx = endX - startX;
  const dy = endY - startY;
  const chord = Math.hypot(dx, dy);
  if (!(chord > 0) || !Number.isFinite(chord)) return null;
  // Arc plan length is arc length (>= chord); straight uses the chord so a
  // stored planLength can never smuggle a zero/short length past VALIDATION.
  // ponytail: trusts caller planLength for arcs; recompute from sweep when the curve slice owns arc metrics.
  const length = hit.isArc
    ? Number.isFinite(hit.planLength) && hit.planLength >= chord
      ? hit.planLength
      : chord
    : chord;
  return {
    startX,
    startY,
    endX,
    endY,
    startZ,
    endZ,
    length,
    reoriented: !forward,
    isArc: hit.isArc === true,
    ...(arc !== undefined ? { arc } : {}),
  };
};
