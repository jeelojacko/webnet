import {
  cadAngleDegFromCenter,
  cadDistance,
  type CadArcDefinition,
  type CadWorldPoint,
} from './cadGeometry';
import { cadBuildArcFromCenterSweep } from './cadGeometryCurveCore';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import {
  isValidCadCurveDeltaDeg,
  isValidCadCurveRadius,
} from './cadCurveMetricsSolver';
import type { CadCurveFailureCode, CadTwoTangentRays } from './cadCurvesTwoTangent';

/**
 * Phase F1 — contract 4: a chain of 2..10 tangent curves between two rays with
 * exactly one floating curve. Pure geometry, no mutation.
 *
 * Non-floating deltas come from their source length and radius:
 *   Δ_i = turnSide · L_i / R_i
 * The floating curve absorbs the residual turn:
 *   Δ_f = Δ_total − Σ_{i≠f} Δ_i,  L_f = |R_f · Δ_f|
 * The chain is walked from PC with G1 joins; placement translates the chain
 * along ray 1 until its endpoint lands on ray 2.
 */

export interface CadCurveChainSegmentInput {
  radius: number;
  /** Arc length for non-floating curves; ignored for the floating index. */
  length: number;
  floating?: boolean;
}

export interface CadCurveChainRow {
  index: number;
  radius: number;
  deltaDeg: number;
  arcLength: number;
  chordLength: number;
  tangentLength: number;
  side: 'left' | 'right';
  floating: boolean;
  pc: CadWorldPoint;
  pt: CadWorldPoint;
}

export interface CadCurveChainResult {
  arcs: CadArcDefinition[];
  rows: CadCurveChainRow[];
  pc: CadWorldPoint;
  pt: CadWorldPoint;
  totalDeltaDeg: number;
}

export type CadCurveChainOutcome =
  | { ok: true; result: CadCurveChainResult }
  | { ok: false; code: CadCurveFailureCode };

export const CAD_CURVE_CHAIN_MIN = 2;
export const CAD_CURVE_CHAIN_MAX = 10;

const rotate = (vector: CadWorldPoint, deltaDeg: number): CadWorldPoint => {
  const radians = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
};

const add = (a: CadWorldPoint, b: CadWorldPoint): CadWorldPoint => ({ x: a.x + b.x, y: a.y + b.y });

const cross = (a: CadWorldPoint, b: CadWorldPoint): number => a.x * b.y - a.y * b.x;

export const buildCadCurveChain = (
  rays: CadTwoTangentRays,
  segments: readonly CadCurveChainSegmentInput[],
): CadCurveChainOutcome => {
  if (segments.length < CAD_CURVE_CHAIN_MIN || segments.length > CAD_CURVE_CHAIN_MAX) {
    return { ok: false, code: 'INVALID_CHAIN' };
  }
  const floatingIndices = segments
    .map((segment, index) => (segment.floating ? index : -1))
    .filter((index) => index >= 0);
  if (floatingIndices.length !== 1) return { ok: false, code: 'INVALID_CHAIN' };
  const floatingIndex = floatingIndices[0]!;

  for (const segment of segments) {
    if (!isValidCadCurveRadius(segment.radius) || !Number.isFinite(segment.length)) {
      return { ok: false, code: 'INVALID_CHAIN' };
    }
    if (!segment.floating && segment.length <= 0) {
      return { ok: false, code: 'INVALID_CHAIN' };
    }
  }

  const turnSign = rays.signedTurnDeg >= 0 ? 1 : -1;
  const deltas: number[] = new Array(segments.length).fill(0);
  let othersSum = 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (index === floatingIndex) continue;
    const delta = (turnSign * Math.abs(segments[index]!.length) * 180) / (Math.PI * segments[index]!.radius);
    if (!isValidCadCurveDeltaDeg(Math.abs(delta))) return { ok: false, code: 'INVALID_CHAIN' };
    deltas[index] = delta;
    othersSum += delta;
  }
  const floatingDelta = rays.signedTurnDeg - othersSum;
  if (!isValidCadCurveDeltaDeg(Math.abs(floatingDelta))) {
    return { ok: false, code: 'CURVES_CANNOT_FIT' };
  }
  deltas[floatingIndex] = floatingDelta;

  const startDirection = rays.incomingTangent;
  let cursor: CadWorldPoint = { x: 0, y: 0 };
  let direction = { x: startDirection.x, y: startDirection.y };
  const localArcs: CadArcDefinition[] = [];
  const localRows: Array<Omit<CadCurveChainRow, 'pc' | 'pt'>> = [];

  for (let index = 0; index < segments.length; index += 1) {
    const radius = segments[index]!.radius;
    const signedDelta = deltas[index]!;
    const leftNormal = { x: -direction.y, y: direction.x };
    const centerOffset = signedDelta >= 0 ? radius : -radius;
    const center = add(cursor, { x: leftNormal.x * centerOffset, y: leftNormal.y * centerOffset });
    const startAngleDeg = cadAngleDegFromCenter(center, cursor);
    const arc = cadBuildArcFromCenterSweep(center, radius, startAngleDeg, signedDelta);
    if (!arc) return { ok: false, code: 'CURVES_CANNOT_FIT' };
    localArcs.push(arc);
    const deltaAbs = Math.abs(signedDelta);
    const deltaRad = (deltaAbs * Math.PI) / 180;
    const signedDeltaDeg = signedDelta;
    localRows.push({
      index,
      radius,
      deltaDeg: deltaAbs,
      arcLength: radius * deltaRad,
      chordLength: 2 * radius * Math.sin(deltaRad / 2),
      tangentLength: radius * Math.tan(deltaRad / 2),
      side: signedDeltaDeg >= 0 ? 'left' : 'right',
      floating: index === floatingIndex,
    });
    cursor = arc.endPoint;
    direction = rotate(direction, signedDelta);
  }

  // Final tangent must be G1 onto the second ray.
  const directionTolerance = 1e-9;
  if (
    Math.abs(direction.x - rays.outgoingTangent.x) > directionTolerance ||
    Math.abs(direction.y - rays.outgoingTangent.y) > directionTolerance
  ) {
    return { ok: false, code: 'CURVES_CANNOT_FIT' };
  }

  const denominator = cross(rays.ray1.direction, rays.ray2.direction);
  if (Math.abs(denominator) <= CAD_XY_DEGENERATE_FLOOR) {
    return { ok: false, code: 'DEGENERATE_RAYS' };
  }
  const placement = -cross(cursor, rays.ray2.direction) / denominator;
  const scale = Math.max(1, Math.abs(rays.pi.x), Math.abs(rays.pi.y));
  const tolerance = CAD_XY_DEGENERATE_FLOOR * scale;
  if (!Number.isFinite(placement) || placement <= tolerance) {
    return { ok: false, code: 'CURVES_CANNOT_FIT' };
  }

  const pc = {
    x: rays.pi.x + rays.ray1.direction.x * placement,
    y: rays.pi.y + rays.ray1.direction.y * placement,
  };
  const worldArcs = localArcs.map((arc) => ({
    ...arc,
    center: add(arc.center, pc),
    startPoint: add(arc.startPoint, pc),
    endPoint: add(arc.endPoint, pc),
  }));
  const pt = worldArcs[worldArcs.length - 1]!.endPoint;
  const ptParam = (pt.x - rays.pi.x) * rays.ray2.direction.x + (pt.y - rays.pi.y) * rays.ray2.direction.y;
  if (ptParam <= tolerance) return { ok: false, code: 'CURVES_CANNOT_FIT' };

  const rows: CadCurveChainRow[] = localRows.map((row, index) => ({
    ...row,
    pc: { ...worldArcs[index]!.startPoint },
    pt: { ...worldArcs[index]!.endPoint },
  }));

  return {
    ok: true,
    result: {
      arcs: worldArcs,
      rows,
      pc,
      pt,
      totalDeltaDeg: rays.signedTurnDeg,
    },
  };
};

/** Re-derive the floating curve's length from the solved table. */
export const cadCurveChainFloatingLength = (result: CadCurveChainResult): number =>
  result.rows.find((row) => row.floating)?.arcLength ?? 0;

/** Consecutive chord distance oracle helper: the equal-chord spacing angle. */
export const cadEqualChordStepDeg = (radius: number, chordLength: number): number | null => {
  if (!isValidCadCurveRadius(radius) || !Number.isFinite(chordLength) || chordLength <= 0) {
    return null;
  }
  if (chordLength >= 2 * radius - CAD_XY_DEGENERATE_FLOOR) return null;
  return (2 * Math.asin(chordLength / (2 * radius)) * 180) / Math.PI;
};

/** Consecutive chord distance at `count` equal chord steps (oracle for SUBDIVIDE). */
export const cadEqualChordDistance = (
  radius: number,
  center: CadWorldPoint,
  startAngleDeg: number,
  chordLength: number,
  count: number,
): number | null => {
  const stepDeg = cadEqualChordStepDeg(radius, chordLength);
  if (stepDeg == null || !Number.isFinite(count) || count < 1) return null;
  const firstAngle = startAngleDeg + stepDeg * (count - 1);
  const first = {
    x: center.x + Math.cos((firstAngle * Math.PI) / 180) * radius,
    y: center.y + Math.sin((firstAngle * Math.PI) / 180) * radius,
  };
  const secondAngle = startAngleDeg + stepDeg * count;
  const second = {
    x: center.x + Math.cos((secondAngle * Math.PI) / 180) * radius,
    y: center.y + Math.sin((secondAngle * Math.PI) / 180) * radius,
  };
  return cadDistance(first, second);
};
