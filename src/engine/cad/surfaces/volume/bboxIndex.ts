import type { VolumeMesh } from './volumeTypes';

export interface BboxPair {
  baseIdx: number;
  cmpIdx: number;
}

interface TriBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const triBbox = (mesh: VolumeMesh, tri: number, out: TriBbox): void => {
  const p = mesh.points;
  const t = mesh.triangles;
  const i0 = t[tri * 3] * 3;
  const i1 = t[tri * 3 + 1] * 3;
  const i2 = t[tri * 3 + 2] * 3;
  out.minX = Math.min(p[i0], p[i1], p[i2]);
  out.minY = Math.min(p[i0 + 1], p[i1 + 1], p[i2 + 1]);
  out.maxX = Math.max(p[i0], p[i1], p[i2]);
  out.maxY = Math.max(p[i0 + 1], p[i1 + 1], p[i2 + 1]);
};

const overlaps = (a: TriBbox, b: TriBbox): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Uniform-grid comparison-triangle bbox index. Cell size follows the existing
 * interpolation-grid heuristic (span / √M). Pair output is canonical
 * (sorted by baseIdx, cmpIdx) so downstream math never depends on grid
 * insertion order. Dedupe uses a last-seen stamp array (no giant Set).
 */
export const findOverlappingPairs = (base: VolumeMesh, cmp: VolumeMesh): BboxPair[] => {
  const baseCount = base.triangles.length / 3;
  const cmpCount = cmp.triangles.length / 3;
  if (baseCount === 0 || cmpCount === 0) return [];
  const boxes: TriBbox[] = Array.from({ length: cmpCount }, () => ({
    minX: 0, minY: 0, maxX: 0, maxY: 0,
  }));
  let spanMinX = Infinity;
  let spanMinY = Infinity;
  let spanMaxX = -Infinity;
  let spanMaxY = -Infinity;
  for (let c = 0; c < cmpCount; c += 1) {
    triBbox(cmp, c, boxes[c]);
    spanMinX = Math.min(spanMinX, boxes[c].minX);
    spanMinY = Math.min(spanMinY, boxes[c].minY);
    spanMaxX = Math.max(spanMaxX, boxes[c].maxX);
    spanMaxY = Math.max(spanMaxY, boxes[c].maxY);
  }
  const span = Math.max(spanMaxX - spanMinX, spanMaxY - spanMinY);
  const cellSize = span > 0 ? span / Math.sqrt(cmpCount) : 1;
  const cells = new Map<string, number[]>();
  const key = (cx: number, cy: number): string => `${cx},${cy}`;
  for (let c = 0; c < cmpCount; c += 1) {
    const b = boxes[c];
    const x0 = Math.floor((b.minX - spanMinX) / cellSize);
    const x1 = Math.floor((b.maxX - spanMinX) / cellSize);
    const y0 = Math.floor((b.minY - spanMinY) / cellSize);
    const y1 = Math.floor((b.maxY - spanMinY) / cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const k = key(cx, cy);
        const list = cells.get(k);
        if (list) list.push(c);
        else cells.set(k, [c]);
      }
    }
  }
  const seen = new Int32Array(cmpCount).fill(-1);
  const box: TriBbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pairs: BboxPair[] = [];
  for (let bIdx = 0; bIdx < baseCount; bIdx += 1) {
    triBbox(base, bIdx, box);
    const x0 = Math.floor((box.minX - spanMinX) / cellSize);
    const x1 = Math.floor((box.maxX - spanMinX) / cellSize);
    const y0 = Math.floor((box.minY - spanMinY) / cellSize);
    const y1 = Math.floor((box.maxY - spanMinY) / cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const list = cells.get(key(cx, cy));
        if (!list) continue;
        for (const c of list) {
          if (seen[c] === bIdx) continue;
          seen[c] = bIdx;
          if (overlaps(box, boxes[c])) pairs.push({ baseIdx: bIdx, cmpIdx: c });
        }
      }
    }
  }
  pairs.sort((a, b) => a.baseIdx - b.baseIdx || a.cmpIdx - b.cmpIdx);
  return pairs;
};
