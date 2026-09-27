/**
 * Phase 20B — grading arc linearization.
 *
 * Curved source courses linearize into chord samples that sit ON the exact
 * arc (center/radius/angles), with Z from exact station interpolation
 * (linear in arc-length fraction, same rule as feature-line breaklines).
 * Segment counts reuse the sagitta bound r*(1-cos(sweep/(2n))) via the
 * shared featureLineArcSubdivisions helper, so grading chords and surface
 * breakline chords agree on the same tolerance. Elliptical or otherwise
 * unsupported curves have no representation here and fail-closed to null.
 */
import { featureLineArcSubdivisions } from '../cadSurfaceRevision';

export interface GradingArcSample {
  x: number;
  y: number;
  z: number;
}

export interface LinearizedGradingArc {
  /** Exact-arc chord samples, start -> end inclusive. */
  points: GradingArcSample[];
  subdivisions: number;
  /** Achieved sagitta bound (metres, plan). */
  maxSagitta: number;
}

const TAU = Math.PI * 2;

/** Normalize any sweep into (0, TAU]; degenerate/whole-circle fail-closed. */
const resolveSweep = (
  startAngle: number,
  endAngle: number,
  sweepCCW: boolean,
): number | null => {
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) return null;
  let sweep = sweepCCW ? endAngle - startAngle : startAngle - endAngle;
  sweep = ((sweep % TAU) + TAU) % TAU;
  if (!(sweep > 0) || !Number.isFinite(sweep)) return null;
  return sweep;
};

/**
 * Linearize a circular arc. Angles in radians, Z linear in arc fraction.
 * Returns null for degenerate input (non-finite, radius <= 0, bad
 * tolerance, zero/full-circle sweep).
 */
export const linearizeGradingArc = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  sweepCCW: boolean,
  startZ: number,
  endZ: number,
  chordTolerance: number,
): LinearizedGradingArc | null => {
  for (const v of [centerX, centerY, radius, startAngle, endAngle, startZ, endZ, chordTolerance]) {
    if (!Number.isFinite(v)) return null;
  }
  if (!(radius > 0) || !(chordTolerance > 0)) return null;
  const sweep = resolveSweep(startAngle, endAngle, sweepCCW);
  if (sweep == null) return null;
  const n = featureLineArcSubdivisions(radius, sweep, chordTolerance);
  const dir = sweepCCW ? 1 : -1;
  const points: GradingArcSample[] = [];
  for (let step = 0; step <= n; step += 1) {
    const frac = step / n;
    const angle = startAngle + dir * sweep * frac;
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      z: startZ + (endZ - startZ) * frac,
    });
  }
  return { points, subdivisions: n, maxSagitta: radius * (1 - Math.cos(sweep / (2 * n))) };
};

/** Straight source passthrough: a single exact chord, start -> end. */
export const straightGradingChord = (
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
): LinearizedGradingArc | null => {
  for (const v of [startX, startY, startZ, endX, endY, endZ]) {
    if (!Number.isFinite(v)) return null;
  }
  const dx = endX - startX;
  const dy = endY - startY;
  if (!(Math.hypot(dx, dy) > 0)) return null;
  return {
    points: [
      { x: startX, y: startY, z: startZ },
      { x: endX, y: endY, z: endZ },
    ],
    subdivisions: 1,
    maxSagitta: 0,
  };
};
