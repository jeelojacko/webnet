import { canonicalNum, fnv1a } from './cadSurfaceRevision';
import type { CadAnalysisBand, CadAnalysisMap } from './cadAnalysisTypes';

/**
 * Phase 18U analysis geometry revision (`arev1:`).
 *
 * Geometry identity = source kind + source id + metric + the ordered band
 * threshold set + the referenced source's own content revision. Appearance
 * (band colors/labels), map opacity, legend placement, layer, name and
 * description are EXCLUDED by construction: recoloring or relabelling a band
 * must never invalidate a cached result or trigger a rebuild.
 *
 * Thresholds are the sorted, de-duplicated set of every band edge. Band array
 * order therefore does not change the revision, which is correct: reordering
 * rows is a cosmetic edit. Overlap/gap validation lives in
 * `cadAnalysisMaps.validateAnalysisBands` (this module stays total).
 */

export interface AnalysisSourceRevisions {
  /** `srev1:` source TIN revision; null = never built (still identity-bearing). */
  surfaceRevision?: string | null;
  /** `vrev1:` volume relationship revision; null = never built. */
  volumeRevision?: string | null;
}

/** Sorted, de-duplicated finite band edges. Deterministic order. */
export const collectAnalysisThresholds = (
  bands: readonly CadAnalysisBand[],
): number[] => {
  const edges: number[] = [];
  for (const band of bands) {
    if (Number.isFinite(band.lower)) edges.push(band.lower);
    if (Number.isFinite(band.upper)) edges.push(band.upper);
  }
  return [...new Set(edges)].sort((a, b) => a - b);
};

export const computeAnalysisGeometryRevision = (
  def: Pick<CadAnalysisMap, 'source' | 'bands'>,
  sourceRevisions: AnalysisSourceRevisions,
): string => {
  const source = def.source;
  const sourceId = source.kind === 'surface' ? source.surfaceId : source.volumeSurfaceId;
  const sourceRevision =
    source.kind === 'surface'
      ? (sourceRevisions.surfaceRevision ?? 'none')
      : (sourceRevisions.volumeRevision ?? 'none');
  const parts = [
    `kind:${source.kind}`,
    `id:${sourceId}`,
    `metric:${source.metric}`,
    `src:${sourceRevision}`,
    `thresholds:${collectAnalysisThresholds(def.bands).map(canonicalNum).join(',')}`,
  ];
  return `arev1:${fnv1a(parts.join('#'))}`;
};
