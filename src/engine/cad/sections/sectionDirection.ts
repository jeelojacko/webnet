import type { SectionErrorCode } from './sectionTypes';

export interface SampleFrame {
  /** Unit forward tangent T (increasing chainage). */
  t: { x: number; y: number };
  /** Unit left normal N = (-ty, tx); positive offset = LEFT. */
  n: { x: number; y: number };
  /** Unit sample-line direction D = N*cos(skew) + T*sin(skew). */
  d: { x: number; y: number };
  skewDeg: number;
}

export type FrameResult =
  | { ok: true; value: SampleFrame }
  | { ok: false; code: Extract<SectionErrorCode, 'INVALID_SKEW' | 'INVALID_DIRECTION'> };

/** Skew bound is fail-closed: |skewDeg| < 89 required, never silently clamped. */
export const MAX_SAMPLE_SKEW_DEG = 89;

/**
 * Sample-line direction: T=(tx,ty), N=(-ty,tx) (positive = LEFT),
 * D = N*cos(skew) + T*sin(skew); P(offset) = center + D*offset.
 */
export const resolveSampleFrame = (
  tangent: { x: number; y: number },
  skewDeg = 0,
): FrameResult => {
  if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y)) {
    return { ok: false, code: 'INVALID_DIRECTION' };
  }
  const length = Math.hypot(tangent.x, tangent.y);
  if (!(length > 1e-12)) return { ok: false, code: 'INVALID_DIRECTION' };
  if (!Number.isFinite(skewDeg) || Math.abs(skewDeg) >= MAX_SAMPLE_SKEW_DEG) {
    return { ok: false, code: 'INVALID_SKEW' };
  }
  const tx = tangent.x / length;
  const ty = tangent.y / length;
  const nx = -ty;
  const ny = tx;
  const skewRad = (skewDeg * Math.PI) / 180;
  const cos = Math.cos(skewRad);
  const sin = Math.sin(skewRad);
  const dx = nx * cos + tx * sin;
  const dy = ny * cos + ty * sin;
  const dLength = Math.hypot(dx, dy);
  if (!(dLength > 1e-12)) return { ok: false, code: 'INVALID_DIRECTION' };
  return {
    ok: true,
    value: { t: { x: tx, y: ty }, n: { x: nx, y: ny }, d: { x: dx / dLength, y: dy / dLength }, skewDeg },
  };
};

/** P(offset) = center + D*offset. Positive offset = LEFT. */
export const pointAtSampleOffset = (
  center: { x: number; y: number },
  direction: { x: number; y: number },
  offset: number,
): { x: number; y: number } => ({
  x: center.x + direction.x * offset,
  y: center.y + direction.y * offset,
});

export const validateSampleWidths = (
  leftWidth: number,
  rightWidth: number,
): { ok: true } | { ok: false; code: Extract<SectionErrorCode, 'INVALID_WIDTH'> } => {
  if (
    !Number.isFinite(leftWidth) ||
    !Number.isFinite(rightWidth) ||
    leftWidth < 0 ||
    rightWidth < 0 ||
    !(leftWidth > 0 || rightWidth > 0)
  ) {
    return { ok: false, code: 'INVALID_WIDTH' };
  }
  return { ok: true };
};

/** Canonical offset domain is -rightWidth..+leftWidth, ascending (pin order). */
export const sampleOffsetDomain = (
  leftWidth: number,
  rightWidth: number,
): { min: number; max: number } => ({ min: -rightWidth, max: leftWidth });
