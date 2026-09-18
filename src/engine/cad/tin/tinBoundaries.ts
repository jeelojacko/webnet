import { buildTinBase } from './tinBase';
import { ccwSign } from './tinPredicates';

export interface RingPoint {
  x: number;
  y: number;
}

/** Fail-closed bucket for an invalid ring relation (caller maps to codes). */
export type RingRelationProblem = 'outer-invalid' | 'void-invalid' | 'breakline-crossing';

interface XySeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const asTin = (p: RingPoint): { u: number; v: number; z: number } => ({ u: p.x, v: p.y, z: 0 });

/** Exact orientation sign over ring coords (reuses the ccwSign convention). */
const orient = (a: RingPoint, b: RingPoint, c: RingPoint): number =>
  ccwSign(asTin(a), asTin(b), asTin(c));

const onSegInterior = (a: RingPoint, b: RingPoint, p: RingPoint): boolean =>
  orient(a, b, p) === 0 &&
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
  Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y) &&
  !((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y));

const properlyCrosses = (s1: XySeg, s2: XySeg): boolean => {
  const a = { x: s1.ax, y: s1.ay };
  const b = { x: s1.bx, y: s1.by };
  const p = { x: s2.ax, y: s2.ay };
  const q = { x: s2.bx, y: s2.by };
  const o1 = orient(p, q, a);
  const o2 = orient(p, q, b);
  const o3 = orient(a, b, p);
  const o4 = orient(a, b, q);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

/** True when two segments share an exact endpoint (allowed contact). */
const sharesVertex = (s1: XySeg, s2: XySeg): boolean =>
  (s1.ax === s2.ax && s1.ay === s2.ay) ||
  (s1.ax === s2.bx && s1.ay === s2.by) ||
  (s1.bx === s2.ax && s1.by === s2.ay) ||
  (s1.bx === s2.bx && s1.by === s2.by);

/**
 * Illegal contact between two segments: a proper crossing, or a T-touch
 * (an endpoint of one strictly inside the other) without an exact shared
 * vertex. Shared vertices (breakline terminating on a boundary, ring
 * corners) always pass.
 */
const illegalContact = (s1: XySeg, s2: XySeg): boolean => {
  if (properlyCrosses(s1, s2)) return true;
  const a1 = { x: s1.ax, y: s1.ay };
  const b1 = { x: s1.bx, y: s1.by };
  const a2 = { x: s2.ax, y: s2.ay };
  const b2 = { x: s2.bx, y: s2.by };
  if (sharesVertex(s1, s2)) {
    // Shared corner: only a spike-back (non-shared endpoint inside the
    // other segment) is still illegal.
    const others1 = (s1.ax === s2.ax && s1.ay === s2.ay) || (s1.ax === s2.bx && s1.ay === s2.by) ? [b1] : [a1, b1];
    const others2 = (s2.ax === s1.ax && s2.ay === s1.ay) || (s2.ax === s1.bx && s2.ay === s1.by) ? [b2] : [a2, b2];
    return others1.some((p) => onSegInterior(a2, b2, p)) || others2.some((p) => onSegInterior(a1, b1, p));
  }
  return (
    onSegInterior(a1, b1, a2) || onSegInterior(a1, b1, b2) ||
    onSegInterior(a2, b2, a1) || onSegInterior(a2, b2, b1)
  );
};

const ringSegments = (ring: RingPoint[]): XySeg[] => {
  const segs: XySeg[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a.x !== b.x || a.y !== b.y) segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return segs;
};

const pairIllegal = (a: XySeg[], b: XySeg[], same: boolean): boolean => {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (same && j <= i) continue;
      if (illegalContact(a[i], b[j])) return true;
    }
  }
  return false;
};

/**
 * Fail-closed ring-relation validation (pure, exact predicates). Rings are
 * world XY; breaklines are world-XY vertex chains. Returns the first problem
 * found in a deterministic check order, or null when clean.
 */
export const validateRingRelations = (
  outers: RingPoint[][],
  voids: RingPoint[][],
  breaklines: RingPoint[][],
): RingRelationProblem | null => {
  const outerSegs = outers.map(ringSegments);
  const voidSegs = voids.map(ringSegments);
  const breakSegs: XySeg[][] = [];
  for (const chain of breaklines) {
    const segs: XySeg[] = [];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a.x !== b.x || a.y !== b.y) segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
    breakSegs.push(segs);
  }
  for (const segs of outerSegs) {
    if (pairIllegal(segs, segs, true)) return 'outer-invalid';
  }
  for (const segs of voidSegs) {
    if (pairIllegal(segs, segs, true)) return 'void-invalid';
  }
  for (let i = 0; i < outerSegs.length; i += 1) {
    for (let j = i + 1; j < outerSegs.length; j += 1) {
      if (pairIllegal(outerSegs[i], outerSegs[j], false)) return 'outer-invalid';
    }
  }
  for (let i = 0; i < voidSegs.length; i += 1) {
    for (let j = i + 1; j < voidSegs.length; j += 1) {
      // Nested voids without contact are union-harmless; only contact fails.
      if (pairIllegal(voidSegs[i], voidSegs[j], false)) return 'void-invalid';
    }
  }
  for (const oSegs of outerSegs) {
    for (const vSegs of voidSegs) {
      if (pairIllegal(oSegs, vSegs, false)) return 'void-invalid';
    }
  }
  for (const bSegs of breakSegs) {
    for (const oSegs of outerSegs) {
      if (pairIllegal(bSegs, oSegs, false)) return 'breakline-crossing';
    }
    for (const vSegs of voidSegs) {
      if (pairIllegal(bSegs, vSegs, false)) return 'breakline-crossing';
    }
  }
  return null;
};

const ringText = (ring: RingPoint[]): string => ring.map((p) => `${p.x},${p.y}`).join('>');

export interface MergedBoundaries {
  /** Data points + appended synthetic ring vertices (XY-sorted tail). */
  points: Array<{ x: number; y: number; z: number }>;
  /** Entity ids for the appended tail (aligned, deterministic). */
  syntheticIds: string[];
  /** Rings in coordinate-sorted order with resolved point indices. */
  rings: Array<{ kind: 'outer' | 'void'; indices: number[] }>;
}

const barycentricZ = (
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): [number, number, number] | null => {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (denom === 0) return null;
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
  return [l1, l2, 1 - l1 - l2];
};

/**
 * Merge outer/void ring vertices into the point set. Exact-XY matches reuse
 * the existing index (shared vertices: breaklines terminating on boundaries,
 * ring corners on survey points). New vertices get Z interpolated from a
 * stage-1 base Delaunay over data points only (containing-triangle
 * barycentric, else nearest vertex, lowest index breaking ties) — never 0.
 * The appended tail is XY-sorted with ids `boundary:<surfaceId>:<n>, so the
 * merge is invariant under translation, input shuffle, and ring permutation.
 */
export const mergeBoundaryPoints = (
  data: Array<{ x: number; y: number; z: number }>,
  outers: RingPoint[][],
  voids: RingPoint[][],
  surfaceId: string,
): MergedBoundaries => {
  const sortedOuters = [...outers].sort((a, b) => (ringText(a) < ringText(b) ? -1 : 1));
  const sortedVoids = [...voids].sort((a, b) => (ringText(a) < ringText(b) ? -1 : 1));
  if (sortedOuters.length === 0 && sortedVoids.length === 0) {
    return { points: data.map((p) => ({ ...p })), syntheticIds: [], rings: [] };
  }
  const keyOf = (x: number, y: number): string => `${x},${y}`;
  const indexByKey = new Map<string, number>();
  data.forEach((p, index) => {
    if (!indexByKey.has(keyOf(p.x, p.y))) indexByKey.set(keyOf(p.x, p.y), index);
  });
  const fresh = new Map<string, { x: number; y: number }>();
  const orderedRings: Array<{ kind: 'outer' | 'void'; ring: RingPoint[] }> = [
    ...sortedOuters.map((ring) => ({ kind: 'outer' as const, ring })),
    ...sortedVoids.map((ring) => ({ kind: 'void' as const, ring })),
  ];
  for (const { ring } of orderedRings) {
    for (const p of ring) {
      const key = keyOf(p.x, p.y);
      if (!indexByKey.has(key) && !fresh.has(key)) fresh.set(key, { x: p.x, y: p.y });
    }
  }
  const points = data.map((p) => ({ ...p }));
  const syntheticIds: string[] = [];
  if (fresh.size > 0) {
    // Stage-1 interpolant over data points only (local frame; translation
    // preserves barycentric weights and neighbor distances exactly enough
    // that topology — never raw Z — is what must stay invariant, and the
    // triangle/nearest scans below are index-ordered and deterministic).
    const base = buildTinBase(data);
    const freshSorted = [...fresh.values()].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
    freshSorted.forEach((p, n) => {
      const lx = p.x - base.originX;
      const ly = p.y - base.originY;
      let z: number | null = null;
      for (const tri of base.triangles) {
        const a = base.points[tri.a];
        const b = base.points[tri.b];
        const c = base.points[tri.c];
        const w = barycentricZ(lx, ly, a.u, a.v, b.u, b.v, c.u, c.v);
        if (!w) continue;
        if (w.every((v) => v >= -1e-9 && v <= 1 + 1e-9)) {
          z = w[0] * a.z + w[1] * b.z + w[2] * c.z;
          break;
        }
      }
      if (z == null) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < data.length; i += 1) {
          const d = (data[i].x - p.x) ** 2 + (data[i].y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        z = data[best].z;
      }
      indexByKey.set(keyOf(p.x, p.y), points.length);
      points.push({ x: p.x, y: p.y, z });
      syntheticIds.push(`boundary:${surfaceId}:${n}`);
    });
  }
  const rings = orderedRings.map(({ kind, ring }) => ({
    kind,
    indices: ring.map((p) => indexByKey.get(keyOf(p.x, p.y)) as number),
  }));
  return { points, syntheticIds, rings };
};
