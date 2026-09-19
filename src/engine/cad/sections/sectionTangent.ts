import { alignmentElementLength } from '../cadAlignmentElements';
import { cadNormalizeAngleDeg, cadPointOnCircle, cadSignedSweepDeg } from '../cadGeometry';
import type { CadAlignmentElement, CadDisplayPoint } from '../cadTypes';
import type { SectionErrorCode } from './sectionTypes';

export interface AlignmentTangent {
  point: CadDisplayPoint;
  /** Unit forward tangent (direction of increasing chainage). */
  tangent: { x: number; y: number };
  elementIndex: number;
  /**
   * Element-boundary policy: at an internal continuous boundary the AHEAD
   * element tangent wins; at the alignment end the BACK (last element)
   * tangent is used. Null when strictly inside one element.
   *
   * Sharp-PI behavior: at a kink the point is shared but the direction is
   * discontinuous — the ahead direction wins outright. NO averaging, NO
   * bisecting: the cross-section must follow one exact element geometry.
   */
  atBoundary: 'ahead' | 'back' | null;
}

export type TangentResult =
  | { ok: true; value: AlignmentTangent }
  | { ok: false; code: Extract<SectionErrorCode, 'OUT_OF_RANGE' | 'EMPTY_ALIGNMENT' | 'DEGENERATE_GEOMETRY'> };

const BOUNDARY_TOL = 1e-9;
const DEGENERATE_TOL = 1e-12;

const lineTangent = (element: Extract<CadAlignmentElement, { kind: 'line' }>): { x: number; y: number } | null => {
  const length = alignmentElementLength(element);
  if (length <= DEGENERATE_TOL) return null;
  return {
    x: (element.end.x - element.start.x) / length,
    y: (element.end.y - element.start.y) / length,
  };
};

const arcTangentAt = (
  element: Extract<CadAlignmentElement, { kind: 'arc' }>,
  distanceAlong: number,
): { point: CadDisplayPoint; tangent: { x: number; y: number } } => {
  const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
  const direction = sweepDeg >= 0 ? 1 : -1;
  const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
  const angleDeg = cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg);
  const angleRad = (angleDeg * Math.PI) / 180;
  // Exact derivative of circular motion: CCW -> (-sin, cos); CW negates it.
  const tangent =
    direction >= 0
      ? { x: -Math.sin(angleRad), y: Math.cos(angleRad) }
      : { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
  return { point: cadPointOnCircle(element.center, element.radius, angleDeg), tangent };
};

/**
 * Exact forward tangent at a RAW station. NO finite-difference fallback:
 * line direction and exact arc derivative cover all element kinds.
 * Out-of-range raw station is fail-closed OUT_OF_RANGE (no clamp).
 */
export const resolveTangentAtRawStation = (
  elements: readonly CadAlignmentElement[],
  startStation: number,
  rawStation: number,
): TangentResult => {
  if (elements.length === 0) return { ok: false, code: 'EMPTY_ALIGNMENT' };
  if (!Number.isFinite(startStation) || !Number.isFinite(rawStation)) {
    return { ok: false, code: 'OUT_OF_RANGE' };
  }
  const lengths = elements.map(alignmentElementLength);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  const local = rawStation - startStation;
  if (local < -BOUNDARY_TOL || local > totalLength + BOUNDARY_TOL) {
    return { ok: false, code: 'OUT_OF_RANGE' };
  }
  const clampedLocal = Math.max(0, Math.min(totalLength, local));

  // Alignment end: BACK tangent of the last non-degenerate element.
  if (Math.abs(clampedLocal - totalLength) <= BOUNDARY_TOL) {
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index]!;
      const length = lengths[index]!;
      if (length <= DEGENERATE_TOL && element.kind === 'line') continue;
      if (element.kind === 'line') {
        const tangent = lineTangent(element);
        if (!tangent) continue;
        return { ok: true, value: { point: { ...element.end }, tangent, elementIndex: index, atBoundary: 'back' } };
      }
      const end = arcTangentAt(element, length);
      return { ok: true, value: { point: end.point, tangent: end.tangent, elementIndex: index, atBoundary: 'back' } };
    }
    return { ok: false, code: 'DEGENERATE_GEOMETRY' };
  }

  // Internal boundary: AHEAD element wins (skip degenerate line points).
  let traversed = 0;
  for (let index = 0; index < elements.length; index += 1) {
    traversed += lengths[index]!;
    if (index + 1 < elements.length && Math.abs(clampedLocal - traversed) <= BOUNDARY_TOL) {
      for (let ahead = index + 1; ahead < elements.length; ahead += 1) {
        const element = elements[ahead]!;
        if (element.kind === 'line') {
          const tangent = lineTangent(element);
          if (!tangent) continue;
          return { ok: true, value: { point: { ...element.start }, tangent, elementIndex: ahead, atBoundary: 'ahead' } };
        }
        const start = arcTangentAt(element, 0);
        return { ok: true, value: { point: start.point, tangent: start.tangent, elementIndex: ahead, atBoundary: 'ahead' } };
      }
      return { ok: false, code: 'DEGENERATE_GEOMETRY' };
    }
  }

  // Strict interior: first element whose span contains the station.
  traversed = 0;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const length = lengths[index]!;
    const next = traversed + length;
    if (clampedLocal <= next + BOUNDARY_TOL) {
      const distanceAlong = Math.max(0, Math.min(length, clampedLocal - traversed));
      if (element.kind === 'line') {
        const tangent = lineTangent(element);
        if (!tangent) return { ok: false, code: 'DEGENERATE_GEOMETRY' };
        const ratio = length <= DEGENERATE_TOL ? 0 : distanceAlong / length;
        return {
          ok: true,
          value: {
            point: {
              x: element.start.x + (element.end.x - element.start.x) * ratio,
              y: element.start.y + (element.end.y - element.start.y) * ratio,
            },
            tangent,
            elementIndex: index,
            atBoundary: null,
          },
        };
      }
      const at = arcTangentAt(element, distanceAlong);
      return { ok: true, value: { point: at.point, tangent: at.tangent, elementIndex: index, atBoundary: null } };
    }
    traversed = next;
  }
  return { ok: false, code: 'OUT_OF_RANGE' };
};
