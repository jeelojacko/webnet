/**
 * Phase 20E Wave-1B — deterministic Design Patch plane proof (engine only).
 *
 * A Design Patch interior is legal when the closed source ring is either
 * bit-flat or exactly coplanar: every triangle built from coplanar vertices
 * lies in that plane, so an XY ear-clip using the ORIGINAL boundary XYZ is
 * diagonal-invariant and needs no Steiner point and no Z overwrite.
 *
 * The plane is derived from a deterministic, conditioned triple
 * (anchor -> max-separated -> max |plan-area|) in a LOCAL XY frame, and the
 * coplanarity residual is compared against a machine-only tolerance anchored
 * to the local extent (never mm/ft thresholds, never least-squares, never
 * averaging). Flat rings short-circuit in `designPatchBuild` so the legacy
 * flat pad stays byte-identical; this helper is the planar authority.
 *
 * Slope metrics reuse the shared `surfaceAnalysis` gradient conventions
 * (`∇P = (dZ/dx, dZ/dy)`); nothing here is persisted.
 */
import {
  downslopeAspectDegOf,
  planeGradient,
  slopeAngleDegOf,
  slopePercentOf,
  slopeRatioOf,
  type SurfacePlaneGradient,
} from '../surfaceAnalysis';
import { designPatchBlock, type DesignPatchFailure } from './designPatchRing';

export type DesignPatchPlaneKind = 'flat' | 'planar';

/** Local-frame plane: `z = c + a·(x − originX) + b·(y − originY)`. */
export interface DesignPatchPlane {
  ok: true;
  kind: DesignPatchPlaneKind;
  /** World gradient dZ/dx (surfaceAnalysis `planeGradient` convention). */
  a: number;
  /** World gradient dZ/dy (surfaceAnalysis `planeGradient` convention). */
  b: number;
  /** Plane elevation at the local origin (first ring vertex). */
  c: number;
  originX: number;
  originY: number;
}

/** Local-frame plane evaluation (world XY in, plane Z out). */
export const designPatchPlaneElevation = (
  plane: Pick<DesignPatchPlane, 'a' | 'b' | 'c' | 'originX' | 'originY'>,
  x: number,
  y: number,
): number => plane.c + plane.a * (x - plane.originX) + plane.b * (y - plane.originY);

export interface DesignPatchPlaneSlope {
  /** Rise over run, dimensionless. */
  slopeRatio: number;
  slopePercent: number;
  slopeAngleDeg: number;
  /** Downslope survey azimuth (deg, 0=N/90=E CW); null when flat. */
  downslopeAspectDeg: number | null;
}

/** Slope/aspect of a derived plane through the shared 18H helpers. */
export const designPatchPlaneSlope = (
  plane: Pick<DesignPatchPlane, 'a' | 'b'>,
): DesignPatchPlaneSlope => {
  const gradient: SurfacePlaneGradient = { a: plane.a, b: plane.b };
  return {
    slopeRatio: slopeRatioOf(gradient),
    slopePercent: slopePercentOf(gradient),
    slopeAngleDeg: slopeAngleDegOf(gradient),
    downslopeAspectDeg: downslopeAspectDegOf(gradient),
  };
};

/** ulp margin: ~16ε covers a Cramer-style fit plus the residual evaluation. */
const PLANARITY_ULP_FACTOR = 16;

const maxAbs = (values: readonly number[]): number => {
  let out = 0;
  for (const value of values) out = Math.max(out, Math.abs(value));
  return out;
};

/** Second vertex: farthest from the anchor in the local XY frame. */
const maxSeparatedIndex = (localX: readonly number[], localY: readonly number[]): number => {
  let best = -1;
  let bestD2 = -1;
  for (let i = 1; i < localX.length; i += 1) {
    const d2 = localX[i]! * localX[i]! + localY[i]! * localY[i]!;
    if (d2 > bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return bestD2 > 0 ? best : -1;
};

/** Third vertex: maximizes |plan area| against the anchor/second baseline. */
const maxAreaIndex = (
  localX: readonly number[],
  localY: readonly number[],
  second: number,
): number => {
  const ax = localX[second]!;
  const ay = localY[second]!;
  let best = -1;
  let bestArea = 0;
  for (let i = 1; i < localX.length; i += 1) {
    if (i === second) continue;
    const area = Math.abs(ax * localY[i]! - ay * localX[i]!);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  }
  return best;
};

/**
 * Derive the deterministic source-ring plane. Returns the flat/planar kind or
 * `DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED` — never a tolerance-based
 * "planar enough" acceptance.
 */
export const deriveDesignPatchPlane = (
  ring: readonly number[],
): DesignPatchPlane | DesignPatchFailure => {
  if (!Array.isArray(ring) || ring.length % 3 !== 0 || ring.length < 9) {
    return designPatchBlock('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', 'ring needs >=3 XYZ vertices');
  }
  if (ring.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return designPatchBlock('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', 'ring has non-finite coordinates');
  }
  const n = ring.length / 3;
  const originX = ring[0]!;
  const originY = ring[1]!;
  const originZ = ring[2]!;
  const localX: number[] = [];
  const localY: number[] = [];
  const localZ: number[] = [];
  for (let i = 0; i < n; i += 1) {
    localX.push(ring[i * 3]! - originX);
    localY.push(ring[i * 3 + 1]! - originY);
    localZ.push(ring[i * 3 + 2]! - originZ);
  }
  const second = maxSeparatedIndex(localX, localY);
  if (second < 0) {
    return designPatchBlock('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', 'degenerate local XY basis');
  }
  const third = maxAreaIndex(localX, localY, second);
  if (third < 0) {
    return designPatchBlock('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', 'degenerate local XY basis');
  }
  const gradient = planeGradient(
    { entityId: '', x: 0, y: 0, z: originZ },
    { entityId: '', x: localX[second]!, y: localY[second]!, z: ring[second * 3 + 2]! },
    { entityId: '', x: localX[third]!, y: localY[third]!, z: ring[third * 3 + 2]! },
  );
  if (!gradient) {
    return designPatchBlock('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', 'degenerate conditioning triangle');
  }
  const scale = Math.max(
    1,
    maxAbs(localX),
    maxAbs(localY),
    Math.abs(gradient.a) * maxAbs(localX),
    Math.abs(gradient.b) * maxAbs(localY),
  );
  const tolerance = PLANARITY_ULP_FACTOR * Number.EPSILON * scale;
  for (let i = 0; i < n; i += 1) {
    const predicted = originZ + gradient.a * localX[i]! + gradient.b * localY[i]!;
    if (Math.abs(ring[i * 3 + 2]! - predicted) > tolerance) {
      return designPatchBlock(
        'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED',
        `vertex ${i} is off the source plane`,
      );
    }
  }
  const flat = localZ.every((value) => value === 0);
  return {
    ok: true,
    kind: flat ? 'flat' : 'planar',
    a: gradient.a,
    b: gradient.b,
    c: originZ,
    originX,
    originY,
  };
};
