/**
 * Phase 18U — pure elevation-band analysis over retained TIN triangles.
 *
 * Flat-array mesh convention (mirrors VolumeMesh): xs/ys/zs point arrays
 * plus flat index triples. Each triangle is clipped per band against z and
 * the plan area comes from the clipped ring (shoelace); the 3D area scales
 * by sqrt(1 + slopeRatio²) using the shared planeGradient/slopeRatioOf
 * helpers (never duplicated here). Per-band sums use Neumaier compensation.
 */

import { planeGradient, slopeRatioOf } from '../surfaceAnalysis';
import { clipScalarPolygon, type AnalysisBand } from './scalarClip';

export interface ElevationMesh {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  zs: ArrayLike<number>;
  /** Flat index triples, one triangle per 3 entries. */
  tris: ArrayLike<number>;
}

export interface ElevationRegion {
  bandId: string;
  ring: Array<{ x: number; y: number }>;
}

export interface ElevationBandResult {
  bandId: string;
  planArea: number;
  surface3DArea: number;
  regionCount: number;
  regions?: ElevationRegion[];
}

export interface ElevationAnalysisTotals {
  minZ: number | null;
  maxZ: number | null;
  classifiedPlanArea: number;
  unclassifiedPlanArea: number;
  surfacePlanArea: number;
  surface3DArea: number;
}

export interface ElevationAnalysisResult {
  bands: ElevationBandResult[];
  totals: ElevationAnalysisTotals;
}

export interface ElevationAnalysisOptions {
  /** False skips storing region polygons; quantities are identical either way. */
  includeDisplay: boolean;
}

interface CompSum {
  sum: number;
  comp: number;
}

const compAdd = (acc: CompSum, value: number): void => {
  const t = acc.sum + value;
  acc.comp += Math.abs(acc.sum) >= Math.abs(value) ? acc.sum - t + value : value - t + acc.sum;
  acc.sum = t;
};

const ringPlanArea = (ring: Array<{ x: number; y: number }>): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

export const analyzeElevationBands = (
  mesh: ElevationMesh,
  bands: readonly AnalysisBand[],
  options: ElevationAnalysisOptions,
): ElevationAnalysisResult => {
  const planAcc = bands.map((): CompSum => ({ sum: 0, comp: 0 }));
  const area3DAcc = bands.map((): CompSum => ({ sum: 0, comp: 0 }));
  const counts = bands.map(() => 0);
  const regions: ElevationRegion[][] = bands.map(() => []);
  const totalPlan: CompSum = { sum: 0, comp: 0 };
  const total3D: CompSum = { sum: 0, comp: 0 };
  let minZ: number | null = null;
  let maxZ: number | null = null;

  const triCount = Math.floor(mesh.tris.length / 3);
  for (let t = 0; t < triCount; t += 1) {
    const i0 = mesh.tris[t * 3]!;
    const i1 = mesh.tris[t * 3 + 1]!;
    const i2 = mesh.tris[t * 3 + 2]!;
    const x0 = mesh.xs[i0]!;
    const y0 = mesh.ys[i0]!;
    const z0 = mesh.zs[i0]!;
    const x1 = mesh.xs[i1]!;
    const y1 = mesh.ys[i1]!;
    const z1 = mesh.zs[i1]!;
    const x2 = mesh.xs[i2]!;
    const y2 = mesh.ys[i2]!;
    const z2 = mesh.zs[i2]!;
    if (![x0, y0, z0, x1, y1, z1, x2, y2, z2].every(Number.isFinite)) continue;
    const plan = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
    if (!(plan > 0)) continue;
    const gradient = planeGradient(
      { entityId: '', x: x0, y: y0, z: z0 },
      { entityId: '', x: x1, y: y1, z: z1 },
      { entityId: '', x: x2, y: y2, z: z2 },
    );
    if (!gradient) continue;
    const factor = Math.sqrt(1 + slopeRatioOf(gradient) ** 2);
    compAdd(totalPlan, plan);
    compAdd(total3D, plan * factor);
    for (const z of [z0, z1, z2]) {
      minZ = minZ === null ? z : Math.min(minZ, z);
      maxZ = maxZ === null ? z : Math.max(maxZ, z);
    }
    const triMin = Math.min(z0, z1, z2);
    const triMax = Math.max(z0, z1, z2);
    for (let b = 0; b < bands.length; b += 1) {
      const band = bands[b]!;
      if (triMax < band.lower || triMin > band.upper) continue;
      const clipped = clipScalarPolygon(
        [
          { x: x0, y: y0, value: z0 },
          { x: x1, y: y1, value: z1 },
          { x: x2, y: y2, value: z2 },
        ],
        band.lower,
        band.upper,
      );
      if (clipped.length < 3) continue;
      const area = ringPlanArea(clipped);
      if (!(area > 0)) continue;
      compAdd(planAcc[b]!, area);
      compAdd(area3DAcc[b]!, area * factor);
      counts[b] += 1;
      if (options.includeDisplay) {
        regions[b]!.push({ bandId: band.id, ring: clipped.map((p) => ({ x: p.x, y: p.y })) });
      }
    }
  }

  const surfacePlanArea = totalPlan.sum + totalPlan.comp;
  const surface3DArea = total3D.sum + total3D.comp;
  let classified = 0;
  const results: ElevationBandResult[] = bands.map((band, b) => {
    const planArea = planAcc[b]!.sum + planAcc[b]!.comp;
    classified += planArea;
    const entry: ElevationBandResult = {
      bandId: band.id,
      planArea,
      surface3DArea: area3DAcc[b]!.sum + area3DAcc[b]!.comp,
      regionCount: counts[b]!,
    };
    if (options.includeDisplay) entry.regions = regions[b]!;
    return entry;
  });
  return {
    bands: results,
    totals: {
      minZ,
      maxZ,
      classifiedPlanArea: classified,
      unclassifiedPlanArea: surfacePlanArea - classified,
      surfacePlanArea,
      surface3DArea,
    },
  };
};
