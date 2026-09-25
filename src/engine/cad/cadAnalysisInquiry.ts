import type { CadAnalysisMap } from './cadAnalysisTypes';
import { classifyAnalysisValue } from './surfaceAnalysis/scalarClip';
import { queryMeshElevation, queryMeshSlope } from './cadSurfaceView';
import type { CachedSurfaceMesh } from './cadSurfaceCache';

/**
 * Phase 18U analysis inquiry (pure, UI-owned).
 *
 * Point queries read DIRECT source geometry (cached TIN meshes via the
 * engine grid/full-scan inquiry), never display polygons: fills are
 * clipped approximations, while inquiry must answer the exact value at
 * the point. Band membership reuses `classifyAnalysisValue`, so
 * exact-boundary determinism matches the engines ([lower, upper) except
 * the last band, which is [lower, upper]).
 */

/** Direct source meshes for inquiry (whichever the definition needs). */
export interface AnalysisInquiryMeshes {
  surface?: CachedSurfaceMesh | null;
  base?: CachedSurfaceMesh | null;
  comparison?: CachedSurfaceMesh | null;
}

export interface AnalysisBandLabel {
  bandId: string;
  /** Band label override, else the default `lower – upper` text. */
  label: string;
  range: [number, number];
}

export type AnalysisInquiryResult =
  | {
      metric: 'elevation';
      elevation: number;
      band: AnalysisBandLabel | null;
    }
  | {
      metric: 'slope-percent' | 'slope-angle';
      percent: number;
      degrees: number;
      band: AnalysisBandLabel | null;
    }
  | {
      metric: 'signed-depth';
      baseZ: number;
      cmpZ: number;
      /** comparison − base (positive = FILL, negative = CUT). */
      delta: number;
      side: 'CUT' | 'FILL' | 'BALANCED';
      band: AnalysisBandLabel | null;
    };

const bandLabelOf = (def: CadAnalysisMap, bandId: string | null): AnalysisBandLabel | null => {
  if (bandId == null) return null;
  const band = def.bands.find((entry) => entry.id === bandId);
  if (!band) return null;
  return {
    bandId: band.id,
    label: band.label ?? `${band.lower} – ${band.upper}`,
    range: [band.lower, band.upper],
  };
};

const sortedBands = (def: CadAnalysisMap): Array<{ id: string; lower: number; upper: number }> =>
  [...def.bands].sort((a, b) => a.lower - b.lower);

/**
 * Value at a plan point from direct source geometry. Null when the point
 * is outside every retained triangle (caller reports "no value at point").
 */
export const queryAnalysisAt = (
  def: CadAnalysisMap,
  meshes: AnalysisInquiryMeshes,
  x: number,
  y: number,
): AnalysisInquiryResult | null => {
  if (def.source.kind === 'surface' && def.source.metric === 'elevation') {
    if (!meshes.surface) return null;
    const elevation = queryMeshElevation(meshes.surface, x, y);
    if (elevation == null) return null;
    return {
      metric: 'elevation',
      elevation,
      band: bandLabelOf(def, classifyAnalysisValue(elevation, sortedBands(def))),
    };
  }
  if (def.source.kind === 'surface') {
    if (!meshes.surface) return null;
    const slope = queryMeshSlope(meshes.surface, x, y);
    if (!slope) return null;
    const metric = def.source.metric;
    if (metric !== 'slope-percent' && metric !== 'slope-angle') return null;
    const value = metric === 'slope-percent' ? slope.slopePercent : slope.slopeAngleDeg;
    return {
      metric,
      percent: slope.slopePercent,
      degrees: slope.slopeAngleDeg,
      band: bandLabelOf(def, classifyAnalysisValue(value, sortedBands(def))),
    };
  }
  if (!meshes.base || !meshes.comparison) return null;
  const baseZ = queryMeshElevation(meshes.base, x, y);
  const cmpZ = queryMeshElevation(meshes.comparison, x, y);
  if (baseZ == null || cmpZ == null) return null;
  const delta = cmpZ - baseZ;
  return {
    metric: 'signed-depth',
    baseZ,
    cmpZ,
    delta,
    side: delta > 0 ? 'FILL' : delta < 0 ? 'CUT' : 'BALANCED',
    band: bandLabelOf(def, classifyAnalysisValue(delta, sortedBands(def))),
  };
};
