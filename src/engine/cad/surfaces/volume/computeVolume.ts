import { findOverlappingPairs } from './bboxIndex';
import {
  buildVertices,
  compAdd,
  compValue,
  fitPlane,
  integratePolygon,
  newAccumulators,
} from './integrate';
import { clipTrianglePair } from './overlap';
import type {
  VolumeComputeOptions,
  VolumeMesh,
  VolumeQuantities,
  VolumeRegion,
  VolumeResult,
} from './volumeTypes';
import { VolumeError } from './volumeTypes';

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

const meshArea = (mesh: VolumeMesh): number => {
  const p = mesh.points;
  const t = mesh.triangles;
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2;
  }
  return area;
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

/**
 * TIN-to-TIN cut/fill volumes: index → canonical pairs → overlap clip →
 * delta-plane split → exact fan integration. Sign: delta = cmp − base,
 * delta > 0 is FILL, delta < 0 is CUT, net = fill − cut. Quantity-only mode
 * discards polygons; display mode returns identical quantities plus regions.
 */
export const computeVolumeQuantities = (
  base: VolumeMesh,
  cmp: VolumeMesh,
  opts: VolumeComputeOptions = { includeDisplay: false },
): VolumeResult => {
  validateMesh(base, 'base');
  validateMesh(cmp, 'comparison');
  const baseArea = meshArea(base);
  const comparisonArea = meshArea(cmp);
  const acc = newAccumulators();
  const regions: VolumeRegion[] = [];
  let minDelta = 0;
  let maxDelta = 0;
  let polygonCount = 0;
  const pairs = findOverlappingPairs(base, cmp);
  for (const { baseIdx, cmpIdx } of pairs) {
    const clipped = clipTrianglePair(triXY(base, baseIdx), triXY(cmp, cmpIdx));
    if (!clipped) continue;
    polygonCount += 1;
    const basePlane = fitPlane(triXYZ(base, baseIdx, clipped.originX, clipped.originY));
    const cmpPlane = fitPlane(triXYZ(cmp, cmpIdx, clipped.originX, clipped.originY));
    const verts = buildVertices(clipped.local, basePlane, cmpPlane);
    let area2 = 0;
    for (let i = 0; i < verts.length; i += 1) {
      const p = verts[i];
      const q = verts[(i + 1) % verts.length];
      area2 += p.x * q.y - q.x * p.y;
    }
    compAdd(acc.overlapArea, Math.abs(area2) / 2);
    for (const v of verts) {
      minDelta = Math.min(minDelta, v.d);
      maxDelta = Math.max(maxDelta, v.d);
    }
    const out = opts.includeDisplay ? { cut: [] as number[][], fill: [] as number[][] } : undefined;
    integratePolygon(verts, acc, out);
    if (out) {
      for (const [rings, kind] of [
        [out.cut, 'cut'],
        [out.fill, 'fill'],
      ] as const) {
        for (const ring of rings) {
          const world: number[] = [];
          for (let i = 0; i < ring.length; i += 2) {
            world.push(ring[i] + clipped.originX, ring[i + 1] + clipped.originY);
          }
          regions.push({ kind, rings: world });
        }
      }
    }
  }
  const cutVolume = compValue(acc.cutVolume);
  const fillVolume = compValue(acc.fillVolume);
  const cutArea = compValue(acc.cutArea);
  const fillArea = compValue(acc.fillArea);
  const quantities: VolumeQuantities = {
    overlapArea: compValue(acc.overlapArea),
    cutArea,
    fillArea,
    cutVolume,
    fillVolume,
    netVolume: fillVolume - cutVolume,
    averageCutDepth: cutArea > 0 ? cutVolume / cutArea : 0,
    averageFillDepth: fillArea > 0 ? fillVolume / fillArea : 0,
    maxCutDepth: Math.max(0, -minDelta),
    maxFillDepth: Math.max(0, maxDelta),
    minDelta,
    maxDelta,
    baseArea,
    comparisonArea,
    pairCount: pairs.length,
    polygonCount,
  };
  return { quantities, regions };
};
