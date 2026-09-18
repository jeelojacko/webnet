import type { CadEntityId } from '../cadTypes';

export interface TinDedupeInput {
  entityId: CadEntityId;
  x: number;
  y: number;
  z: number;
}

export interface TinDedupeResult {
  /** Survivors; deterministic (lowest entity id wins each XY). */
  unique: TinDedupeInput[];
  /** True when one XY carries two different Zs (build must BLOCK). */
  conflict: boolean;
}

const xyKey = (x: number, y: number): string => {
  const nx = x === 0 ? 0 : x;
  const ny = y === 0 ? 0 : y;
  return `${Object.is(nx, -0) ? '0' : String(nx)},${Object.is(ny, -0) ? '0' : String(ny)}`;
};

/**
 * Exact-coordinate XY dedupe (NO epsilon snap: near-but-distinct coordinates
 * stay distinct; delaunator skips exact duplicates silently and would desync
 * indices, so the engine boundary owns this). Same-entity repeats drop
 * silently; identical XY + equal Z keeps the lowest entity id; same XY +
 * differing Z flags a conflict (caller BLOCKS, never averages).
 */
export const dedupeTinPoints = (points: TinDedupeInput[]): TinDedupeResult => {
  const ordered = [...points].sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  const seenEntities = new Set<CadEntityId>();
  const zByXY = new Map<string, number>();
  const unique: TinDedupeInput[] = [];
  let conflict = false;
  for (const point of ordered) {
    if (seenEntities.has(point.entityId)) continue;
    seenEntities.add(point.entityId);
    const key = xyKey(point.x, point.y);
    const prev = zByXY.get(key);
    if (prev === undefined) {
      zByXY.set(key, point.z);
      unique.push(point);
    } else if (prev !== point.z) {
      conflict = true;
    }
  }
  return { unique, conflict };
};
