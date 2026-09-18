import { canonicalEdgeKey, findPlateauRegions } from './plateau';
import type { ContourVertex } from './plateau';
import type {
  CadSurfaceContourPath,
  CadSurfaceContourSet,
  ComputedLevel,
  ContourPoint,
} from './contourTypes';

export interface ExtractSurfaceContoursArgs {
  surfaceId: string;
  surfaceRevision: string;
  styleRevision: string;
  points: ContourVertex[];
  triangles: Array<[number, number, number]>;
  levels: ComputedLevel[];
}

interface Segment {
  aId: string;
  bId: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const vertexId = (i: number): string => `v:${i}`;
const crossingId = (lo: number, hi: number, levelIdx: number): string =>
  `e:${Math.min(lo, hi)}:${Math.max(lo, hi)}:${levelIdx}`;

/**
 * Crossing on edge (a, b), always interpolated low-index -> high-index so the
 * shared edge agrees bit-for-bit from either adjacent triangle.
 * Large-coordinate safe: parameter form, no XY rounding for identity.
 */
const edgeCrossing = (
  points: ContourVertex[],
  a: number,
  b: number,
  level: number,
): ContourPoint => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const zlo = points[lo].z;
  const zhi = points[hi].z;
  const t = (level - zlo) / (zhi - zlo);
  return {
    x: points[lo].x + t * (points[hi].x - points[lo].x),
    y: points[lo].y + t * (points[hi].y - points[lo].y),
  };
};

/** Per-triangle plane intersection: at most one segment per level. */
const triangleSegment = (
  points: ContourVertex[],
  tri: [number, number, number],
  level: number,
  levelIdx: number,
  flatEdges: Set<string>,
  emittedEdges: Set<string>,
): Segment | null => {
  const [a, b, c] = tri;
  const za = points[a].z;
  const zb = points[b].z;
  const zc = points[c].z;
  const onA = za === level;
  const onB = zb === level;
  const onC = zc === level;
  const onCount = (onA ? 1 : 0) + (onB ? 1 : 0) + (onC ? 1 : 0);
  if (onCount === 3) return null; // flat: plateau module owns the perimeter
  if (onCount === 2) {
    // Shared exact edge — emit once via canonical key; skip plateau borders.
    const off = !onA ? a : !onB ? b : c;
    const e1 = off === a ? b : a;
    const e2 = off === a ? c : off === b ? c : b;
    const key = canonicalEdgeKey(e1, e2);
    if (flatEdges.has(key) || emittedEdges.has(key)) return null;
    emittedEdges.add(key);
    return {
      aId: vertexId(e1),
      bId: vertexId(e2),
      ax: points[e1].x,
      ay: points[e1].y,
      bx: points[e2].x,
      by: points[e2].y,
    };
  }
  if (onCount === 1) {
    const on = onA ? a : onB ? b : c;
    const [p, q] = on === a ? [b, c] : on === b ? [a, c] : [a, b];
    const zp = points[p].z;
    const zq = points[q].z;
    if ((zp < level) === (zq < level)) return null; // extremum touch, same side
    const cross = edgeCrossing(points, p, q, level);
    return {
      aId: vertexId(on),
      bId: crossingId(p, q, levelIdx),
      ax: points[on].x,
      ay: points[on].y,
      bx: cross.x,
      by: cross.y,
    };
  }
  // No exact hits: edges with strictly opposite signs give 0 or 2 crossings.
  const crosses: Array<{ p: ContourPoint; id: string }> = [];
  for (const [p, q] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
    const zp = points[p].z;
    const zq = points[q].z;
    if ((zp < level) !== (zq < level)) {
      crosses.push({ p: edgeCrossing(points, p, q, level), id: crossingId(p, q, levelIdx) });
    }
  }
  if (crosses.length !== 2) return null;
  return {
    aId: crosses[0].id,
    bId: crosses[1].id,
    ax: crosses[0].p.x,
    ay: crosses[0].p.y,
    bx: crosses[1].p.x,
    by: crosses[1].p.y,
  };
};

const otherEnd = (seg: Segment, node: string): string =>
  seg.aId === node ? seg.bId : seg.aId;

interface WalkResult {
  ids: string[];
  closed: boolean;
}

/**
 * Stitch per-level segments through the endpoint-ID graph. Saddle nodes
 * (degree > 2) are barriers: paths split there instead of guessing a pairing.
 */
const stitchLevel = (segments: Segment[]): string[][] => {
  const index = new Map<string, number[]>();
  segments.forEach((seg, i) => {
    for (const node of [seg.aId, seg.bId]) {
      const list = index.get(node) ?? [];
      list.push(i);
      index.set(node, list);
    }
  });
  for (const list of index.values()) list.sort((x, y) => x - y);
  const visited = new Array<boolean>(segments.length).fill(false);

  const walk = (startSeg: number, startNode: string): WalkResult => {
    const ids = [startNode];
    visited[startSeg] = true;
    let curSeg = startSeg;
    let cur = otherEnd(segments[startSeg], startNode);
    ids.push(cur);
    for (;;) {
      if (cur === startNode) return { ids, closed: true };
      const at = index.get(cur) ?? [];
      if (at.length !== 2) return { ids, closed: false };
      // at.length === 2 and curSeg is one of them; pick the other one.
      const pick = at.find((s) => s !== curSeg);
      if (pick === undefined || visited[pick]) {
        const back = pick !== undefined && otherEnd(segments[pick], cur) === startNode;
        if (back) ids.push(startNode);
        return { ids, closed: back };
      }
      visited[pick] = true;
      curSeg = pick;
      cur = otherEnd(segments[pick], cur);
      ids.push(cur);
    }
  };

  const paths: string[][] = [];
  const nodes = [...index.keys()].sort();
  // 1. Open chains from degree-1 endpoints.
  for (const node of nodes) {
    const at = index.get(node) as number[];
    if (at.length === 1 && !visited[at[0]]) paths.push(walk(at[0], node).ids);
  }
  // 2. Split at saddle (degree > 2) nodes: one path per incident segment.
  for (const node of nodes) {
    const at = index.get(node) as number[];
    if (at.length > 2) {
      for (const s of at) {
        if (!visited[s]) {
          const r = walk(s, node);
          paths.push(r.ids);
        }
      }
    }
  }
  // 3. Remaining pure degree-2 loops.
  for (let s = 0; s < segments.length; s += 1) {
    if (!visited[s]) paths.push(walk(s, segments[s].aId).ids);
  }
  return paths;
};

const lexPt = (a: ContourPoint, b: ContourPoint): number =>
  a.x !== b.x ? a.x - b.x : a.y - b.y;

/** Deterministic start vertex + orientation (translation-invariant). */
const canonicalize = (ids: string[], coords: Map<string, ContourPoint>, closed: boolean): ContourPoint[] => {
  let seq = closed && ids[ids.length - 1] === ids[0] ? ids.slice(0, -1) : [...ids];
  if (closed) {
    let best = 0;
    for (let i = 1; i < seq.length; i += 1) {
      if (seq[i] < seq[best]) best = i;
    }
    seq = [...seq.slice(best), ...seq.slice(0, best)];
    const pts = seq.map((id) => coords.get(id) as ContourPoint);
    if (pts.length > 2 && lexPt(pts[1], pts[pts.length - 1]) > 0) {
      seq = [seq[0], ...seq.slice(1).reverse()];
    }
    return seq.map((id) => coords.get(id) as ContourPoint);
  }
  const pts = seq.map((id) => coords.get(id) as ContourPoint);
  if (pts.length > 1 && lexPt(pts[0], pts[pts.length - 1]) > 0) seq = [...seq].reverse();
  return seq.map((id) => coords.get(id) as ContourPoint);
};

/** Numeric comparison: total, deterministic, translation-invariant. */
const comparePaths = (a: CadSurfaceContourPath, b: CadSurfaceContourPath): number => {
  if (a.elevation !== b.elevation) return a.elevation - b.elevation;
  if (a.points.length !== b.points.length) return a.points.length - b.points.length;
  for (let i = 0; i < a.points.length; i += 1) {
    const c = lexPt(a.points[i], b.points[i]);
    if (c !== 0) return c;
  }
  return 0;
};

const polyLength = (pts: ContourPoint[], closed: boolean): number => {
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (closed && pts.length > 1) {
    len += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  }
  return len;
};

export const extractSurfaceContours = (args: ExtractSurfaceContoursArgs): CadSurfaceContourSet => {
  const { surfaceId, surfaceRevision, styleRevision, points, triangles, levels } = args;
  const minorPaths: CadSurfaceContourPath[] = [];
  const majorPaths: CadSurfaceContourPath[] = [];

  levels.forEach((computed, levelIdx) => {
    const { elevation: level, kind } = computed;
    const flat: number[] = [];
    const flatEdges = new Set<string>();
    triangles.forEach((tri, t) => {
      if (points[tri[0]].z === level && points[tri[1]].z === level && points[tri[2]].z === level) {
        flat.push(t);
        flatEdges.add(canonicalEdgeKey(tri[0], tri[1]));
        flatEdges.add(canonicalEdgeKey(tri[1], tri[2]));
        flatEdges.add(canonicalEdgeKey(tri[2], tri[0]));
      }
    });
    const emittedEdges = new Set<string>();
    const segments = triangles
      .map((tri) => triangleSegment(points, tri, level, levelIdx, flatEdges, emittedEdges))
      .filter((s): s is Segment => {
        if (!s) return false;
        if (s.aId === s.bId || (s.ax === s.bx && s.ay === s.by)) return false; // never zero-length
        return true;
      });
    const coords = new Map<string, ContourPoint>();
    for (const s of segments) {
      if (!coords.has(s.aId)) coords.set(s.aId, { x: s.ax, y: s.ay });
      if (!coords.has(s.bId)) coords.set(s.bId, { x: s.bx, y: s.by });
    }
    const out = kind === 'major' ? majorPaths : minorPaths;
    for (const ids of stitchLevel(segments)) {
      if (ids.length < 2) continue;
      const last = ids[ids.length - 1];
      const closed = last === ids[0];
      const pts = canonicalize(ids, coords, closed);
      if (pts.length < 2) continue;
      out.push({ elevation: level, kind, closed, points: pts });
    }
    // Plateau outer perimeters at this level.
    if (flat.length > 0) {
      for (const region of findPlateauRegions(points, triangles, flat)) {
        if (region.outerRing.length >= 3) {
          out.push({
            elevation: level,
            kind,
            closed: true,
            points: region.outerRing.map((p) => ({ x: p.x, y: p.y })),
          });
        }
      }
    }
  });

  minorPaths.sort(comparePaths);
  majorPaths.sort(comparePaths);
  const all = [...minorPaths, ...majorPaths];
  let totalLength = 0;
  let segmentCount = 0;
  for (const p of all) {
    totalLength += polyLength(p.points, p.closed);
    segmentCount += p.closed ? p.points.length : p.points.length - 1;
  }
  return {
    surfaceId,
    surfaceRevision,
    styleRevision,
    minorPaths,
    majorPaths,
    minLevel: levels.length > 0 ? levels[0].elevation : null,
    maxLevel: levels.length > 0 ? levels[levels.length - 1].elevation : null,
    stats: {
      levelCount: levels.length,
      minorLevelCount: levels.filter((l) => l.kind === 'minor').length,
      majorLevelCount: levels.filter((l) => l.kind === 'major').length,
      minorPathCount: minorPaths.length,
      majorPathCount: majorPaths.length,
      totalLength,
      segmentCount,
    },
  };
};
