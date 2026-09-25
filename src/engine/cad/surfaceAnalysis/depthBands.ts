/**
 * Phase 18U — pure depth-band analysis over a base/comparison TIN pair.
 *
 * Reuses the 18I cut/fill pipeline verbatim: bbox pair candidate search,
 * convex triangle-pair clip, and per-vertex linear delta planes
 * (delta = comparisonZ − baseZ, positive = FILL, negative = CUT). The ONLY
 * added step is a partition of each overlap polygon by user-defined signed
 * delta bands: every intersected band clips the polygon with the shared
 * scalar-range clipper, then the SAME linear delta plane is fan-integrated
 * over the clipped ring by 18I's `integratePolygon`. Band quantities
 * therefore reconcile with `computeVolumeQuantities` when the bands cover
 * the full delta range.
 *
 * Zero policy: `buildVertices`/`zeroDelta` are untouched, so machine-scale
 * zero deltas stay exactly zero. A user band such as −0.1 .. +0.1 is purely
 * CLASSIFICATION: it can claim zero-measure area but never fabricates
 * cut/fill volume.
 *
 * Frame note: polygons are clipped in the 18F local frame (origin =
 * integer-truncated pair min) and regions are reported back in world XY.
 */

import { findOverlappingPairs } from '../surfaces/volume/bboxIndex';
import {
  buildVertices,
  compAdd,
  compValue,
  fitPlane,
  integratePolygon,
  newAccumulators,
  newSum,
  type CompSum,
  type VolumeAccumulators,
  type ZVertex,
} from '../surfaces/volume/integrate';
import { clipTrianglePair, type ClippedPolygon } from '../surfaces/volume/overlap';
import { VolumeError, type VolumeMesh } from '../surfaces/volume/volumeTypes';
import {
  clipScalarPolygon,
  validateAnalysisBands,
  type AnalysisBand,
  type ScalarVertex,
} from './scalarClip';

export type DepthBand = AnalysisBand;

/** One clipped band polygon, world-frame flat XY ring. */
export interface DepthBandRegion {
  bandId: string;
  ring: number[];
}

export interface DepthBandSummary {
  bandId: string;
  lower: number;
  upper: number;
  /** Plan (XY) area covered by this band's clipped overlap polygons. */
  planArea: number;
  cutArea: number;
  fillArea: number;
  cutVolume: number;
  fillVolume: number;
  /** Signed: fillVolume − cutVolume. */
  netVolume: number;
  /** Clipped overlap polygons assigned to this band (display-independent). */
  regionCount: number;
  /** Empty unless includeDisplay; quantities identical either way. */
  regions?: DepthBandRegion[];
}

export interface DepthBandTotals {
  overlapArea: number;
  cutVolume: number;
  fillVolume: number;
  netVolume: number;
  /** Sum of per-band plan area (≤ overlapArea outside band coverage). */
  classifiedArea: number;
  /** overlapArea − classifiedArea: bands' gaps are UNCLASSIFIED. */
  unclassifiedArea: number;
  minDelta: number;
  maxDelta: number;
}

export interface DepthBandResult {
  bands: DepthBandSummary[];
  totals: DepthBandTotals;
}

export interface DepthBandOptions {
  includeDisplay?: boolean;
}

const validateMesh = (mesh: VolumeMesh, name: string): void => {
  if (mesh.points.length % 3 !== 0) throw new VolumeError(`${name} points not XYZ triples`);
  if (mesh.triangles.length % 3 !== 0) throw new VolumeError(`${name} triangles not triples`);
  for (const v of mesh.points) {
    if (!Number.isFinite(v)) throw new VolumeError(`${name} has non-finite coordinate`);
  }
  const verts = mesh.points.length / 3;
  for (const idx of mesh.triangles) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= verts) {
      throw new VolumeError(`${name} has out-of-range triangle index`);
    }
  }
};

const triXYZ = (mesh: VolumeMesh, tri: number, originX: number, originY: number): number[] => {
  const p = mesh.points;
  const t = mesh.triangles;
  const out: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    const v = t[tri * 3 + k] * 3;
    out.push(p[v] - originX, p[v + 1] - originY, p[v + 2]);
  }
  return out;
};

const triXY = (mesh: VolumeMesh, tri: number): number[] => {
  const p = mesh.points;
  const t = mesh.triangles;
  const out: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    const v = t[tri * 3 + k] * 3;
    out.push(p[v], p[v + 1]);
  }
  return out;
};

const planArea2 = (poly: ReadonlyArray<{ x: number; y: number }>): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

/**
 * Carry baseZ/cmpZ through the shared clipper's `extra` record so the
 * reconstructed ZVertex keeps the same interpolation (t formula) as 18I.
 */
const tagVertices = (verts: readonly ZVertex[]): ScalarVertex[] =>
  verts.map((v) => ({
    x: v.x,
    y: v.y,
    value: v.d,
    extra: { baseZ: v.baseZ, cmpZ: v.cmpZ },
  }));

const toZVertices = (poly: readonly ScalarVertex[]): ZVertex[] =>
  poly.map((p) => ({
    x: p.x,
    y: p.y,
    baseZ: p.extra?.baseZ ?? 0,
    cmpZ: p.extra?.cmpZ ?? 0,
    d: p.value,
  }));

interface BandAccumulator {
  planArea: CompSum;
  volume: VolumeAccumulators;
  regionCount: number;
  regions: DepthBandRegion[] | undefined;
}

const clipBandPolygon = (
  poly: readonly ScalarVertex[],
  band: DepthBand,
  origin: { x: number; y: number },
  acc: BandAccumulator,
  includeDisplay: boolean,
): void => {
  const clipped = clipScalarPolygon(poly as ScalarVertex[], band.lower, band.upper);
  if (clipped.length < 3) return;
  const area = planArea2(clipped);
  if (area === 0) return;
  compAdd(acc.planArea, area);
  acc.regionCount += 1;
  integratePolygon(toZVertices(clipped), acc.volume);
  if (includeDisplay && acc.regions) {
    const ring: number[] = [];
    for (const p of clipped) ring.push(p.x + origin.x, p.y + origin.y);
    acc.regions.push({ bandId: band.id, ring });
  }
};

const classifyPair = (
  verts: readonly ZVertex[],
  clipped: ClippedPolygon,
  bands: readonly DepthBand[],
  acc: readonly BandAccumulator[],
  includeDisplay: boolean,
): void => {
  let polyMin = Infinity;
  let polyMax = -Infinity;
  for (const v of verts) {
    polyMin = Math.min(polyMin, v.d);
    polyMax = Math.max(polyMax, v.d);
  }
  const tagged = tagVertices(verts);
  const origin = { x: clipped.originX, y: clipped.originY };
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    if (polyMax < band.lower || polyMin > band.upper) continue;
    // Half-open [lower, upper), matching classifyAnalysisValue: a fragment
    // sitting exactly on a shared edge belongs to the upper band (the last
    // band keeps the overall max), so a constant-delta overlap on an edge is
    // never fan-integrated twice.
    if (i < bands.length - 1 && polyMin >= band.upper) continue;
    clipBandPolygon(tagged, band, origin, acc[i]!, includeDisplay);
  }
};

const summarizeBands = (
  bands: readonly DepthBand[],
  acc: readonly BandAccumulator[],
  includeDisplay: boolean,
): DepthBandSummary[] =>
  bands.map((band, i) => {
    const slot = acc[i]!;
    const cutVolume = compValue(slot.volume.cutVolume);
    const fillVolume = compValue(slot.volume.fillVolume);
    const summary: DepthBandSummary = {
      bandId: band.id,
      lower: band.lower,
      upper: band.upper,
      planArea: compValue(slot.planArea),
      cutArea: compValue(slot.volume.cutArea),
      fillArea: compValue(slot.volume.fillArea),
      cutVolume,
      fillVolume,
      netVolume: fillVolume - cutVolume,
      regionCount: slot.regionCount,
    };
    if (includeDisplay && slot.regions) summary.regions = slot.regions;
    return summary;
  });

/**
 * Depth-band analysis of one base/comparison TIN pair. Bands are validated
 * signed-delta ranges (`validateAnalysisBands`); overlaps are rejected, gaps
 * stay UNCLASSIFIED, and any band touching zero is classification-only.
 */
export const computeDepthBands = (
  base: VolumeMesh,
  cmp: VolumeMesh,
  bands: readonly DepthBand[],
  opts: DepthBandOptions = {},
): DepthBandResult => {
  const includeDisplay = opts.includeDisplay === true;
  validateMesh(base, 'base');
  validateMesh(cmp, 'comparison');
  const validation = validateAnalysisBands(bands);
  if (!validation.ok) throw new VolumeError(`invalid depth bands: ${validation.errors.join('; ')}`);
  const ordered = validation.bands;
  const acc: BandAccumulator[] = ordered.map(() => ({
    planArea: newSum(),
    volume: newAccumulators(),
    regionCount: 0,
    regions: includeDisplay ? [] : undefined,
  }));
  const overlapArea = newSum();
  let minDelta = 0;
  let maxDelta = 0;
  for (const { baseIdx, cmpIdx } of findOverlappingPairs(base, cmp)) {
    const clipped = clipTrianglePair(triXY(base, baseIdx), triXY(cmp, cmpIdx));
    if (!clipped) continue;
    const basePlane = fitPlane(triXYZ(base, baseIdx, clipped.originX, clipped.originY));
    const cmpPlane = fitPlane(triXYZ(cmp, cmpIdx, clipped.originX, clipped.originY));
    const verts = buildVertices(clipped.local, basePlane, cmpPlane);
    compAdd(overlapArea, planArea2(verts));
    for (const v of verts) {
      minDelta = Math.min(minDelta, v.d);
      maxDelta = Math.max(maxDelta, v.d);
    }
    classifyPair(verts, clipped, ordered, acc, includeDisplay);
  }
  const summaries = summarizeBands(ordered, acc, includeDisplay);
  const totalCut = newSum();
  const totalFill = newSum();
  const classified = newSum();
  for (const b of summaries) {
    compAdd(totalCut, b.cutVolume);
    compAdd(totalFill, b.fillVolume);
    compAdd(classified, b.planArea);
  }
  const cutVolume = compValue(totalCut);
  const fillVolume = compValue(totalFill);
  const totalOverlap = compValue(overlapArea);
  const classifiedArea = compValue(classified);
  return {
    bands: summaries,
    totals: {
      overlapArea: totalOverlap,
      cutVolume,
      fillVolume,
      netVolume: fillVolume - cutVolume,
      classifiedArea,
      unclassifiedArea: totalOverlap - classifiedArea,
      minDelta,
      maxDelta,
    },
  };
};
