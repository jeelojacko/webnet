import { canonicalNum } from '../cadSurfaceRevision';
import type { ContourLevelSpec } from './contourTypes';

/**
 * Phase 18H — contour geometry revision.
 *
 * Deterministic `crev1:` hash over geometry-affecting style ONLY:
 * minorInterval, majorEvery, baseElevation. Appearance (color, weight,
 * opacity, label visibility, showContours flag itself) must NEVER affect
 * it — an appearance-only change keeps the revision so the derived cache
 * stays CURRENT.
 */

export interface ContourGeometrySpec {
  minorInterval: number;
  majorEvery: number;
  baseElevation: number;
}

export const toContourGeometrySpec = (spec: ContourLevelSpec): ContourGeometrySpec => ({
  minorInterval: spec.minorInterval,
  majorEvery: spec.majorEvery,
  baseElevation: spec.baseElevation,
});

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const computeContourGeometryRevision = (spec: ContourGeometrySpec): string => {
  const parts = [
    `interval=${canonicalNum(spec.minorInterval)}`,
    `majorEvery=${canonicalNum(spec.majorEvery)}`,
    `base=${canonicalNum(spec.baseElevation)}`,
  ];
  return `crev1:${fnv1a(parts.join('#'))}`;
};

/** Pre-compute guard: level enumeration that exceeds this blocks, never silently bumps. */
export const SURFACE_CONTOUR_LEVEL_LIMIT = 2000;
/**
 * Total segment/path guard. Evidence bound: a 50k-point TIN holds ~100k
 * triangles and each triangle contributes at most one segment per level;
 * 1M segments is ~10x headroom over any displayable set (the display layer
 * carries one SVG path per surface — §7 of the 18G performance note) while
 * bounding worker memory and DOM cost. Exceeding blocks with a diagnostic —
 * never silent truncation, never a crash.
 */
export const SURFACE_CONTOUR_SEGMENT_LIMIT = 1_000_000;

export const SURFACE_CONTOUR_LEVEL_LIMIT_DIAGNOSTIC =
  'SURFACE_CONTOUR_LEVEL_LIMIT: level count exceeds 2000 — increase the minor interval.';
export const SURFACE_CONTOUR_SEGMENT_LIMIT_DIAGNOSTIC =
  'SURFACE_CONTOUR_SEGMENT_LIMIT: contour segment count exceeds 1000000 — increase the minor interval.';
export const SURFACE_CONTOUR_STALE_TIN_DIAGNOSTIC =
  'SURFACE_CONTOUR_STALE_TIN: parent TIN is not CURRENT — rebuild the surface first.';
