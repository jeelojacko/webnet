/**
 * Phase 18U — pure whole-face slope classification over retained triangles.
 *
 * Each triangle's slopeRatio is computed once via the shared
 * planeGradient/slopeRatioOf helpers; the band metric is either
 * slope-percent (100 × ratio) or slope-angle (atan in degrees). The whole
 * face classifies into exactly one band via classifyAnalysisValue, so band
 * plan areas always conserve the mesh plan area (up to gaps → UNCLASSIFIED).
 */

import { planeGradient, slopeRatioOf } from '../surfaceAnalysis';
import { classifyAnalysisValue, type AnalysisBand } from './scalarClip';

export type SlopeBandMetric = 'slope-percent' | 'slope-angle';

export interface SlopeMesh {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  zs: ArrayLike<number>;
  tris: ArrayLike<number>;
}

export interface SlopeBandResult {
  bandId: string;
  planArea: number;
  surface3DArea: number;
  triangleCount: number;
  percentOfPlan: number;
}

export interface SlopeAnalysisTotals {
  surfacePlanArea: number;
  surface3DArea: number;
  classifiedPlanArea: number;
  unclassifiedPlanArea: number;
  unclassifiedTriangles: number;
}

export interface SlopeAnalysisResult {
  metric: SlopeBandMetric;
  bands: SlopeBandResult[];
  totals: SlopeAnalysisTotals;
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

const compTotal = (acc: CompSum): number => acc.sum + acc.comp;

export const metricValueOfRatio = (ratio: number, metric: SlopeBandMetric): number =>
  metric === 'slope-percent' ? 100 * ratio : (Math.atan(ratio) * 180) / Math.PI;

export const analyzeSlopeBands = (
  mesh: SlopeMesh,
  bands: readonly AnalysisBand[],
  metric: SlopeBandMetric,
): SlopeAnalysisResult => {
  const planAcc = bands.map((): CompSum => ({ sum: 0, comp: 0 }));
  const area3DAcc = bands.map((): CompSum => ({ sum: 0, comp: 0 }));
  const counts = bands.map(() => 0);
  const totalPlan: CompSum = { sum: 0, comp: 0 };
  const total3D: CompSum = { sum: 0, comp: 0 };
  let unclassifiedTriangles = 0;

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
    const ratio = slopeRatioOf(gradient);
    const area3D = plan * Math.sqrt(1 + ratio * ratio);
    compAdd(totalPlan, plan);
    compAdd(total3D, area3D);
    const value = metricValueOfRatio(ratio, metric);
    const bandId = classifyAnalysisValue(value, bands);
    if (bandId === null) {
      unclassifiedTriangles += 1;
      continue;
    }
    const bIndex = bands.findIndex((band) => band.id === bandId);
    compAdd(planAcc[bIndex]!, plan);
    compAdd(area3DAcc[bIndex]!, area3D);
    counts[bIndex] += 1;
  }
  const surfacePlanArea = compTotal(totalPlan);
  const classified = planAcc.reduce((sum, acc) => sum + compTotal(acc), 0);
  const bandsOut: SlopeBandResult[] = bands.map((band, b) => {
    const planArea = compTotal(planAcc[b]!);
    return {
      bandId: band.id,
      planArea,
      surface3DArea: compTotal(area3DAcc[b]!),
      triangleCount: counts[b]!,
      percentOfPlan: surfacePlanArea > 0 ? (100 * planArea) / surfacePlanArea : 0,
    };
  });
  return {
    metric,
    bands: bandsOut,
    totals: {
      surfacePlanArea,
      surface3DArea: compTotal(total3D),
      classifiedPlanArea: classified,
      unclassifiedPlanArea: surfacePlanArea - classified,
      unclassifiedTriangles,
    },
  };
};
