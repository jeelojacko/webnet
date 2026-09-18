import { computeVolumeQuantities } from '../engine/cad/surfaces/volume/computeVolume';
import type {
  VolumeComputeOptions,
  VolumeMesh,
  VolumeQuantities,
  VolumeRegion,
  VolumeResult,
} from '../engine/cad/surfaces/volume/volumeTypes';
import type { CadVolumeDisplayRegion, CadVolumeResult } from '../engine/cad/cadTypes';

/**
 * Phase 18I narrow worker→engine adapter.
 *
 * The pure volume math lives in `src/engine/cad/surfaces/volume/` (engine
 * worker). This adapter is the ONLY module the worker/persist slice imports
 * from it, and it owns the conversion from the engine's flat
 * `VolumeResult` into the persisted-contract `CadVolumeResult`. No math here.
 *
 * Engine contract:
 *   computeVolumeQuantities(base: VolumeMesh, cmp: VolumeMesh,
 *                           opts: VolumeComputeOptions): VolumeResult
 *   VolumeMesh = { points: flat [x,y,z,...]; triangles: flat index triples }
 * Quantities are bitwise identical for includeDisplay true/false.
 */
export { computeVolumeQuantities };
export type { VolumeComputeOptions, VolumeMesh, VolumeQuantities, VolumeRegion, VolumeResult };

export interface SurfaceVolumeComputeInput {
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  revision: string;
  base: VolumeMesh;
  comparison: VolumeMesh;
  includeDisplay: boolean;
}

const toVertices = (ring: number[]): Array<{ x: number; y: number }> => {
  const vertices: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < ring.length; index += 2) {
    vertices.push({ x: ring[index], y: ring[index + 1] });
  }
  return vertices;
};

const toDisplayRegions = (regions: VolumeRegion[]): CadVolumeDisplayRegion[] =>
  regions.map((region) => ({ kind: region.kind, vertices: toVertices(region.rings) }));

/** Map engine quantities/regions onto the persisted-contract result shape. */
export const toCadVolumeResult = (
  input: SurfaceVolumeComputeInput,
  result: VolumeResult,
): CadVolumeResult => {
  const quantities = result.quantities;
  const regions = input.includeDisplay ? toDisplayRegions(result.regions) : undefined;
  return {
    baseSurfaceId: input.baseSurfaceId,
    comparisonSurfaceId: input.comparisonSurfaceId,
    revision: input.revision,
    overlapArea: quantities.overlapArea,
    cutArea: quantities.cutArea,
    fillArea: quantities.fillArea,
    cutVolume: quantities.cutVolume,
    fillVolume: quantities.fillVolume,
    netVolume: quantities.netVolume,
    averageCutDepth: quantities.averageCutDepth,
    averageFillDepth: quantities.averageFillDepth,
    maxCutDepth: quantities.maxCutDepth,
    maxFillDepth: quantities.maxFillDepth,
    minDelta: quantities.minDelta,
    maxDelta: quantities.maxDelta,
    baseArea: quantities.baseArea,
    comparisonArea: quantities.comparisonArea,
    ...(regions != null ? { displayRegions: regions } : {}),
    stats: {
      candidatePairCount: quantities.pairCount,
      overlapPolygonCount: quantities.polygonCount,
    },
  };
};
