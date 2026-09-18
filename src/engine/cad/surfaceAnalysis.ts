import type { CadSurfaceSourcePoint } from './cadSurfaces';

/**
 * Phase 18H — pure TIN face analysis (slope/aspect/areas, no I/O).
 *
 * Slope/aspect come from the exact containing-triangle plane z = ax+by+c
 * (NO finite differences — the TIN is piecewise-linear, so the face plane
 * IS the surface there). Azimuths are survey azimuths: 0=N (+y), 90=E
 * (+x), clockwise.
 */

export interface SurfacePlaneGradient {
  a: number;
  b: number;
}

/** Exact plane gradient via the face normal; null on degenerate faces. */
export const planeGradient = (
  a: CadSurfaceSourcePoint,
  b: CadSurfaceSourcePoint,
  c: CadSurfaceSourcePoint,
): SurfacePlaneGradient | null => {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  // Plan-degenerate faces cannot occur in a Delaunay TIN (nonzero plan
  // area ⇒ nz ≠ 0); the guard keeps the helper total regardless.
  if (!Number.isFinite(nx + ny + nz) || Math.abs(nz) <= 1e-18) return null;
  return { a: -nx / nz, b: -ny / nz };
};

/** Rise over run (dimensionless). */
export const slopeRatioOf = (gradient: SurfacePlaneGradient): number =>
  Math.hypot(gradient.a, gradient.b);

export const slopePercentOf = (gradient: SurfacePlaneGradient): number =>
  100 * slopeRatioOf(gradient);

export const slopeAngleDegOf = (gradient: SurfacePlaneGradient): number =>
  (Math.atan(slopeRatioOf(gradient)) * 180) / Math.PI;

/**
 * Downslope survey azimuth (deg, 0=N/90=E clockwise) of (-a,-b).
 * Flat (ratio ≈ 0) has no aspect — returns null, never 0.
 */
export const downslopeAspectDegOf = (gradient: SurfacePlaneGradient): number | null => {
  if (slopeRatioOf(gradient) <= 1e-12) return null;
  const azimuth = (Math.atan2(-gradient.a, -gradient.b) * 180) / Math.PI;
  return (azimuth + 360) % 360;
};

export const trianglePlanArea = (
  a: CadSurfaceSourcePoint,
  b: CadSurfaceSourcePoint,
  c: CadSurfaceSourcePoint,
): number =>
  Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

export const triangle3DArea = (
  a: CadSurfaceSourcePoint,
  b: CadSurfaceSourcePoint,
  c: CadSurfaceSourcePoint,
): number => {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) / 2;
};

export interface SurfaceSlopeResult {
  easting: number;
  northing: number;
  elevation: number;
  slopePercent: number;
  slopeAngleDeg: number;
  /** Null on flat faces (no aspect), never 0-by-default. */
  aspectDeg: number | null;
  /** Deterministic primary face: lowest retained-triangle index. */
  faceIndex: number;
  /** Triangle indices containing the point (plan-tolerance inclusive). */
  faceCount: number;
  /**
   * EDGE/VERTEX ambiguity disclosure, or null for clean interiors.
   * Interior shared edges of coplanar neighbors stay silent (continuous).
   */
  faceNote: string | null;
  minSlopePercent: number;
  maxSlopePercent: number;
}

const barycentricWeights = (
  px: number,
  py: number,
  a: CadSurfaceSourcePoint,
  b: CadSurfaceSourcePoint,
  c: CadSurfaceSourcePoint,
): [number, number, number] | null => {
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (denom === 0) return null;
  const l1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / denom;
  const l2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / denom;
  return [l1, l2, 1 - l1 - l2];
};

/**
 * Structured slope inquiry over retained triangles (full scan; inquiry is
 * rare, so no grid dependency). Fail-closed: null outside the mesh/voids.
 *
 * EDGE/VERTEX POLICY: a point exactly on a shared edge/vertex is contained
 * in every incident retained triangle. When those planes agree (coplanar
 * neighbors — the continuous interior case) the answer is silent; when
 * they differ materially the primary (lowest-index) face answers AND the
 * faceNote discloses the ambiguity with the deterministic face count and
 * slope range. The caller never has to guess which face won.
 */
export const querySurfaceSlopeAt = (
  points: readonly CadSurfaceSourcePoint[],
  triangles: ReadonlyArray<readonly [number, number, number]>,
  x: number,
  y: number,
): SurfaceSlopeResult | null => {
  const tol = 1e-9;
  const hits: number[] = [];
  for (let index = 0; index < triangles.length; index += 1) {
    const tri = triangles[index]!;
    const weights = barycentricWeights(x, y, points[tri[0]]!, points[tri[1]]!, points[tri[2]]!);
    if (!weights) continue;
    if (weights.some((w) => w < -tol || w > 1 + tol)) continue;
    hits.push(index);
  }
  if (hits.length === 0) return null;
  const faceIndex = hits[0]!;
  const primary = triangles[faceIndex]!;
  const pa = points[primary[0]]!;
  const pb = points[primary[1]]!;
  const pc = points[primary[2]]!;
  const weights = barycentricWeights(x, y, pa, pb, pc)!;
  const elevation = weights[0]! * pa.z + weights[1]! * pb.z + weights[2]! * pc.z;
  const primaryGradient = planeGradient(pa, pb, pc);
  if (!primaryGradient) return null;
  let minPercent = slopePercentOf(primaryGradient);
  let maxPercent = minPercent;
  let differs = false;
  for (let i = 1; i < hits.length; i += 1) {
    const tri = triangles[hits[i]!]!;
    const gradient = planeGradient(points[tri[0]]!, points[tri[1]]!, points[tri[2]]!);
    if (!gradient) continue;
    const percent = slopePercentOf(gradient);
    minPercent = Math.min(minPercent, percent);
    maxPercent = Math.max(maxPercent, percent);
    if (Math.abs(gradient.a - primaryGradient.a) > 1e-9 || Math.abs(gradient.b - primaryGradient.b) > 1e-9) {
      differs = true;
    }
  }
  return {
    easting: x,
    northing: y,
    elevation,
    slopePercent: slopePercentOf(primaryGradient),
    slopeAngleDeg: slopeAngleDegOf(primaryGradient),
    aspectDeg: downslopeAspectDegOf(primaryGradient),
    faceIndex,
    faceCount: hits.length,
    faceNote:
      hits.length > 1 && differs
        ? `on edge/vertex shared by ${hits.length} faces (face ${faceIndex} answers; slope range ${minPercent.toFixed(1)}–${maxPercent.toFixed(1)}%)`
        : null,
    minSlopePercent: minPercent,
    maxSlopePercent: maxPercent,
  };
};

/**
 * Display text for a structured slope answer. Mirrors the legacy elevation
 * format (E/N to 3dp, quoted surface name); aspect prints as azimuth or —.
 */
export const formatSurfaceSlopeAnswer = (
  surfaceName: string,
  x: number,
  y: number,
  result: SurfaceSlopeResult | null,
  hasFreshMesh: boolean,
): string => {
  if (!hasFreshMesh) {
    return `“${surfaceName}” has no current mesh — rebuild before querying slope.`;
  }
  if (!result) {
    return `No surface slope at point (${x.toFixed(3)}, ${y.toFixed(3)}) on “${surfaceName}”.`;
  }
  const aspect = result.aspectDeg == null ? '—' : `${result.aspectDeg.toFixed(1)}°`;
  const note = result.faceNote ? ` ${result.faceNote}.` : '';
  return `“${surfaceName}” E ${x.toFixed(3)} N ${y.toFixed(3)} elevation ${result.elevation.toFixed(3)} slope ${result.slopePercent.toFixed(1)}% (${result.slopeAngleDeg.toFixed(1)}°) aspect ${aspect}.${note}`;
};

export interface SurfaceFaceStats {
  surface3DArea: number;
  /** Planimetric-area-weighted mean of per-face (z1+z2+z3)/3 — exact for piecewise-linear TINs. */
  meanElevation: number | null;
  minFaceSlopeRatio: number | null;
  maxFaceSlopeRatio: number | null;
  /**
   * Planimetric-area-weighted mean of face slope RATIOS. Report mean% as
   * 100×meanRatio and the mean angle as atan(meanRatio): mean(angle) ≠
   * angle(mean) by Jensen, so averaging angles/percents directly would bias.
   */
  meanFaceSlopeRatio: number | null;
}

/**
 * Single-pass face statistics over retained triangles. O(n), computed once
 * at build time (worker path inherits it) — NEVER recomputed on render.
 */
export const computeSurfaceFaceStats = (
  points: readonly CadSurfaceSourcePoint[],
  triangles: ReadonlyArray<readonly [number, number, number]>,
): SurfaceFaceStats => {
  let area3D = 0;
  let planTotal = 0;
  let elevWeighted = 0;
  let ratioWeighted = 0;
  let minRatio: number | null = null;
  let maxRatio: number | null = null;
  for (const tri of triangles) {
    const a = points[tri[0]]!;
    const b = points[tri[1]]!;
    const c = points[tri[2]]!;
    const plan = trianglePlanArea(a, b, c);
    if (!(plan > 0)) continue;
    const gradient = planeGradient(a, b, c);
    if (!gradient) continue;
    const ratio = slopeRatioOf(gradient);
    area3D += triangle3DArea(a, b, c);
    planTotal += plan;
    elevWeighted += plan * ((a.z + b.z + c.z) / 3);
    ratioWeighted += plan * ratio;
    minRatio = minRatio == null ? ratio : Math.min(minRatio, ratio);
    maxRatio = maxRatio == null ? ratio : Math.max(maxRatio, ratio);
  }
  if (!(planTotal > 0) || minRatio == null || maxRatio == null) {
    return {
      surface3DArea: area3D,
      meanElevation: null,
      minFaceSlopeRatio: null,
      maxFaceSlopeRatio: null,
      meanFaceSlopeRatio: null,
    };
  }
  return {
    surface3DArea: area3D,
    meanElevation: elevWeighted / planTotal,
    minFaceSlopeRatio: minRatio,
    maxFaceSlopeRatio: maxRatio,
    meanFaceSlopeRatio: ratioWeighted / planTotal,
  };
};
