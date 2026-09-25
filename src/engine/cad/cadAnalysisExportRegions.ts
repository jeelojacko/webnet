/**
 * Phase 18U export slice F — engine results → export regions.
 *
 * The canonical view builders have not landed on this branch, so this is the
 * bounded bridge from the 18U engine results to the export geometry shape
 * (`AnalysisExportBandRegions`). It reuses the shared band helpers
 * (`classifyAnalysisValue`, `planeGradient`/`slopeRatioOf`,
 * `metricValueOfRatio`) — no band math is re-derived here.
 *
 * Elevation/depth results already carry display regions when computed with
 * `includeDisplay: true`; slope classifies whole faces and carries no regions,
 * so `analysisRegionsFromSlope` builds the per-band face rings in one pass.
 */
import type { AnalysisBand } from './surfaceAnalysis/scalarClip';
import { classifyAnalysisValue } from './surfaceAnalysis/scalarClip';
import { planeGradient, slopeRatioOf } from './surfaceAnalysis';
import type { ElevationAnalysisResult } from './surfaceAnalysis/elevationBands';
import type { DepthBandResult } from './surfaceAnalysis/depthBands';
import { metricValueOfRatio, type SlopeBandMetric, type SlopeMesh } from './surfaceAnalysis/slopeBands';
import type { AnalysisExportBandRegions } from './cadAnalysisExportScene';

export const analysisRegionsFromElevation = (
  result: ElevationAnalysisResult,
): AnalysisExportBandRegions[] =>
  result.bands.map((band) => ({
    bandId: band.bandId,
    rings: (band.regions ?? []).map((region) => ({
      points: region.ring.map((point) => ({ x: point.x, y: point.y })),
    })),
  }));

const flatRingToPoints = (ring: readonly number[]): Array<{ x: number; y: number }> => {
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < ring.length; index += 2) {
    points.push({ x: ring[index]!, y: ring[index + 1]! });
  }
  return points;
};

export const analysisRegionsFromDepth = (result: DepthBandResult): AnalysisExportBandRegions[] =>
  result.bands.map((band) => ({
    bandId: band.bandId,
    rings: (band.regions ?? []).map((region) => ({ points: flatRingToPoints(region.ring) })),
  }));

/**
 * Generic world-frame flat-XY rings (the shape session caches expose for all
 * three metrics) → export regions. Keeps the UI seam free of per-metric
 * branching. Deterministic band order follows the input order.
 */
export const analysisRegionsFromFlatRings = (
  regionsByBand: ReadonlyArray<{ bandId: string; rings: number[][] }>,
): AnalysisExportBandRegions[] =>
  regionsByBand.map((entry) => ({
    bandId: entry.bandId,
    rings: entry.rings.map((ring) => ({ points: flatRingToPoints(ring) })),
  }));

/**
 * Whole-face slope classification → one triangle ring per classified face.
 * Bands outside [lower, upper) coverage leave faces UNCLASSIFIED (no ring),
 * matching `analyzeSlopeBands` (gaps draw nothing, no fabricated geometry).
 */
export const analysisRegionsFromSlope = (
  mesh: SlopeMesh,
  bands: readonly AnalysisBand[],
  metric: SlopeBandMetric,
): AnalysisExportBandRegions[] => {
  const rings: Array<Array<{ points: Array<{ x: number; y: number }> }>> = bands.map(() => []);
  const indexById = new Map(bands.map((band, index) => [band.id, index]));
  const triCount = Math.floor(mesh.tris.length / 3);
  for (let t = 0; t < triCount; t += 1) {
    const i0 = mesh.tris[t * 3]!;
    const i1 = mesh.tris[t * 3 + 1]!;
    const i2 = mesh.tris[t * 3 + 2]!;
    const a = { entityId: '', x: mesh.xs[i0]!, y: mesh.ys[i0]!, z: mesh.zs[i0]! };
    const b = { entityId: '', x: mesh.xs[i1]!, y: mesh.ys[i1]!, z: mesh.zs[i1]! };
    const c = { entityId: '', x: mesh.xs[i2]!, y: mesh.ys[i2]!, z: mesh.zs[i2]! };
    if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)) continue;
    const plan = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (!(plan > 0)) continue;
    const gradient = planeGradient(a, b, c);
    if (!gradient) continue;
    const bandId = classifyAnalysisValue(metricValueOfRatio(slopeRatioOf(gradient), metric), bands);
    if (bandId === null) continue;
    const slot = rings[indexById.get(bandId) ?? -1];
    if (slot) slot.push({ points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: c.x, y: c.y }] });
  }
  return bands.map((band, index) => ({ bandId: band.id, rings: rings[index]! }));
};
