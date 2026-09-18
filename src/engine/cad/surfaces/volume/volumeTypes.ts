/**
 * Phase 18I TIN-to-TIN cut/fill volume types (pure engine, worker-safe).
 *
 * Units are unitless here (meters internally per repo rules; drawing-unit
 * labels apply only at display/export boundaries). All quantities use
 * positive magnitudes except netVolume (fill − cut, signed).
 */

/** Flat-array mesh: points [x0,y0,z0, ...], triangles flat index triples. */
export interface VolumeMesh {
  points: Float64Array | number[];
  triangles: Uint32Array | number[];
}

/** Positive-magnitude quantity summary of one base/comparison pair. */
export interface VolumeQuantities {
  overlapArea: number;
  cutArea: number;
  fillArea: number;
  cutVolume: number;
  fillVolume: number;
  /** Signed: fillVolume − cutVolume. Positive means net fill. */
  netVolume: number;
  averageCutDepth: number;
  averageFillDepth: number;
  maxCutDepth: number;
  maxFillDepth: number;
  minDelta: number;
  maxDelta: number;
  baseArea: number;
  comparisonArea: number;
  /** Candidate bbox-overlapping triangle pairs tested. */
  pairCount: number;
  /** Pairs that produced a non-zero overlap polygon. */
  polygonCount: number;
}

/** One display region (world-frame flat XY ring pairs). */
export interface VolumeRegion {
  kind: 'cut' | 'fill';
  rings: number[];
}

export interface VolumeComputeOptions {
  includeDisplay: boolean;
}

export interface VolumeResult {
  quantities: VolumeQuantities;
  /** Empty unless includeDisplay is true; quantities are identical either way. */
  regions: VolumeRegion[];
}

/** Fail-closed error for uncomputable input (never a silent zero). */
export class VolumeError extends Error {
  constructor(message: string) {
    super(`volume: ${message}`);
    this.name = 'VolumeError';
  }
}
