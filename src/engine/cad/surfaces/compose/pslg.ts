/**
 * Phase 18Y — composition PSLG construction (pure, worker-safe).
 *
 * Constraints = every overlay triangle edge (interior plane-breaks plus the
 * domain boundary, so overlay facets survive retriangulation exactly) plus
 * the pieces of base edges lying outside overlay coverage. Base edges
 * crossing the overlay boundary split at exact-touch vertices or computed
 * crossings; collinear overlaps canonicalize to the overlay edge (the
 * overlapped middle is dropped, split coordinates reuse exact endpoints —
 * no rounded duplicates); base pieces strictly inside overlay are dropped.
 *
 * Predicates are exact (robust-predicates orient2d zero tests); crossing
 * coordinates use a local frame with the integer-truncated pair minimum
 * subtracted (volume/overlap.ts conditioning). Candidate pairs come from a
 * uniform-grid bbox index over overlay boundary edges.
 */
import { orient2d } from 'robust-predicates';
import { createMeshView, locateInMesh } from './coverage';
import type { ComposeMeshPoint, ComposeMeshTriangle } from './coverage';

export interface PslgPoint {
  x: number;
  y: number;
  z: number;
}

export interface PslgSegment {
  a: number;
  b: number;
}

export interface ComposePslg {
  /** Exactly XY-deduped points (z is a placeholder — reassigned post-build). */
  points: PslgPoint[];
  segments: PslgSegment[];
}

type Adjacency = ReadonlyArray<readonly [number, number, number]>;

const pointKey = (x: number, y: number): string => `${x},${y}`;
const edgeKey = (a: number, b: number): string =>
  `${Math.min(a, b)}>${Math.max(a, b)}`;

/**
 * Boundary extraction from retained TIN adjacency: mesh edges with exactly
 * one adjacent retained triangle. Islands, holes, and voids each surface
 * their own ring — no single-outer-ring assumption.
 */
export const extractBoundaryEdges = (
  triangles: ReadonlyArray<ComposeMeshTriangle>,
  adjacency: Adjacency,
): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  triangles.forEach((tri, t) => {
    const neighbors = adjacency[t];
    if (!neighbors) return;
    for (let k = 0; k < 3; k += 1) {
      if (neighbors[k] !== -1) continue;
      out.push([tri[(k + 1) % 3]!, tri[(k + 2) % 3]!]);
    }
  });
  return out;
};

interface WorldPt {
  x: number;
  y: number;
}

const orient = (a: WorldPt, b: WorldPt, p: WorldPt): number =>
  orient2d(a.x, a.y, b.x, b.y, p.x, p.y);

const onSegmentExact = (a: WorldPt, b: WorldPt, p: WorldPt): boolean =>
  orient(a, b, p) === 0 &&
  p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);

const samePt = (a: WorldPt, b: WorldPt): boolean => a.x === b.x && a.y === b.y;

/** Crossing of a→b with c→d in a pair-local frame; null on parallel. */
const crossingPoint = (a: WorldPt, b: WorldPt, c: WorldPt, d: WorldPt): WorldPt | null => {
  const ox = Math.floor(Math.min(a.x, b.x, c.x, d.x));
  const oy = Math.floor(Math.min(a.y, b.y, c.y, d.y));
  const ax = a.x - ox;
  const ay = a.y - oy;
  const bx = b.x - ox;
  const by = b.y - oy;
  const cx = c.x - ox;
  const cy = c.y - oy;
  const dx = d.x - ox;
  const dy = d.y - oy;
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (denom === 0) return null;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
};

interface BoundaryEdge {
  c: WorldPt;
  d: WorldPt;
}

/** Uniform-grid candidate index over overlay boundary edges. */
const buildEdgeIndex = (
  edges: BoundaryEdge[],
): { candidates(_minX: number, _minY: number, _maxX: number, _maxY: number): BoundaryEdge[] } => {
  if (edges.length === 0) return { candidates: () => [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.c.x, e.d.x);
    minY = Math.min(minY, e.c.y, e.d.y);
    maxX = Math.max(maxX, e.c.x, e.d.x);
    maxY = Math.max(maxY, e.c.y, e.d.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const cell = Math.max(span / Math.sqrt(edges.length), span / 64, 1e-9);
  const cells = new Map<string, BoundaryEdge[]>();
  edges.forEach((e) => {
    const x0 = Math.floor((Math.min(e.c.x, e.d.x) - minX) / cell);
    const x1 = Math.floor((Math.max(e.c.x, e.d.x) - minX) / cell);
    const y0 = Math.floor((Math.min(e.c.y, e.d.y) - minY) / cell);
    const y1 = Math.floor((Math.max(e.c.y, e.d.y) - minY) / cell);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const key = `${ix},${iy}`;
        const list = cells.get(key);
        if (list) list.push(e);
        else cells.set(key, [e]);
      }
    }
  });
  return {
    candidates(qMinX: number, qMinY: number, qMaxX: number, qMaxY: number): BoundaryEdge[] {
      const x0 = Math.floor((qMinX - minX) / cell);
      const x1 = Math.floor((qMaxX - minX) / cell);
      const y0 = Math.floor((qMinY - minY) / cell);
      const y1 = Math.floor((qMaxY - minY) / cell);
      const seen = new Set<BoundaryEdge>();
      const out: BoundaryEdge[] = [];
      for (let ix = x0; ix <= x1; ix += 1) {
        for (let iy = y0; iy <= y1; iy += 1) {
          const list = cells.get(`${ix},${iy}`);
          if (!list) continue;
          for (const e of list) {
            if (!seen.has(e)) {
              seen.add(e);
              out.push(e);
            }
          }
        }
      }
      return out;
    },
  };
};

interface SplitVertex {
  t: number;
  x: number;
  y: number;
}

/**
 * Clip one base edge against the overlay boundary. Returns kept outside
 * pieces as world-coordinate polylines (split coordinates exact where they
 * reuse vertices). Interior (covered) pieces are dropped.
 */
const clipBaseEdge = (
  a: WorldPt,
  b: WorldPt,
  boundary: { candidates(_minX: number, _minY: number, _maxX: number, _maxY: number): BoundaryEdge[] },
  covered: (_x: number, _y: number) => boolean,
): Array<[WorldPt, WorldPt]> => {
  if (samePt(a, b)) return [];
  const splits: SplitVertex[] = [];
  const overlaps: Array<[number, number]> = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const project = (p: WorldPt): number => ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cands = boundary.candidates(
    Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y),
  );
  for (const e of cands) {
    const { c, d } = e;
    const oac = orient(a, b, c);
    const oad = orient(a, b, d);
    const oca = orient(c, d, a);
    const ocb = orient(c, d, b);
    if (oac === 0 && oad === 0) {
      // Collinear: canonicalize to the overlay edge — drop the overlap,
      // split at overlay endpoints strictly inside this edge.
      const tc = project(c);
      const td = project(d);
      const lo = Math.max(0, Math.min(tc, td));
      const hi = Math.min(1, Math.max(tc, td));
      if (hi - lo > 0) {
        overlaps.push([lo, hi]);
        if (tc > 0 && tc < 1) splits.push({ t: tc, x: c.x, y: c.y });
        if (td > 0 && td < 1) splits.push({ t: td, x: d.x, y: d.y });
      } else {
        // Endpoint touch on the line: split so chains share vertices.
        if (tc > 0 && tc < 1 && onSegmentExact(a, b, c)) splits.push({ t: tc, x: c.x, y: c.y });
        if (td > 0 && td < 1 && onSegmentExact(a, b, d)) splits.push({ t: td, x: d.x, y: d.y });
      }
      continue;
    }
    // Exact touches reuse vertex coordinates (never computed points).
    if (onSegmentExact(a, b, c) && !samePt(c, a) && !samePt(c, b)) {
      splits.push({ t: project(c), x: c.x, y: c.y });
    }
    if (onSegmentExact(a, b, d) && !samePt(d, a) && !samePt(d, b)) {
      splits.push({ t: project(d), x: d.x, y: d.y });
    }
    if (onSegmentExact(c, d, a) || onSegmentExact(c, d, b)) {
      // Base endpoint on the overlay edge: endpoint already a PSLG vertex;
      // no split needed (piece classification handles inside/outside).
    }
    if (oac !== 0 && oad !== 0 && ((oac < 0) !== (oad < 0)) && oca !== 0 && ocb !== 0 && ((oca < 0) !== (ocb < 0))) {
      const cross = crossingPoint(a, b, c, d);
      if (cross) {
        const t = project(cross);
        if (t > 0 && t < 1) splits.push({ t, x: cross.x, y: cross.y });
      }
    }
  }
  splits.sort((s1, s2) => s1.t - s2.t);
  const bounds: SplitVertex[] = [{ t: 0, x: a.x, y: a.y }];
  for (const s of splits) {
    const prev = bounds[bounds.length - 1]!;
    if (s.t - prev.t > 0 && (s.x !== prev.x || s.y !== prev.y)) bounds.push(s);
  }
  bounds.push({ t: 1, x: b.x, y: b.y });
  const insideOverlap = (tm: number): boolean => overlaps.some(([lo, hi]) => tm > lo && tm < hi);
  const kept: Array<[WorldPt, WorldPt]> = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const p = bounds[i]!;
    const q = bounds[i + 1]!;
    if (p.x === q.x && p.y === q.y) continue;
    const tm = (p.t + q.t) / 2;
    if (insideOverlap(tm)) continue;
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    if (covered(mx, my)) continue;
    kept.push([{ x: p.x, y: p.y }, { x: q.x, y: q.y }]);
  }
  return kept;
};

/**
 * Assemble the composition PSLG. Overlay edges (all of them) plus kept
 * base-edge pieces, over the exactly-deduped union of base vertices,
 * overlay vertices, and crossing points (z placeholder 0 — reassigned
 * from owning planes after retriangulation).
 */
export const buildComposePslg = (
  basePoints: ReadonlyArray<ComposeMeshPoint>,
  baseTriangles: ReadonlyArray<ComposeMeshTriangle>,
  overlayPoints: ReadonlyArray<ComposeMeshPoint>,
  overlayTriangles: ReadonlyArray<ComposeMeshTriangle>,
  overlayBoundary: Array<[number, number]>,
): ComposePslg => {
  const overlayView = createMeshView(overlayPoints, overlayTriangles);
  const covered = (x: number, y: number): boolean => locateInMesh(overlayView, x, y) != null;

  const points: PslgPoint[] = [];
  const indexOf = new Map<string, number>();
  const intern = (x: number, y: number): number => {
    const key = pointKey(x, y);
    const known = indexOf.get(key);
    if (known !== undefined) return known;
    const at = points.length;
    points.push({ x, y, z: 0 });
    indexOf.set(key, at);
    return at;
  };
  for (const p of basePoints) intern(p.x, p.y);
  for (const p of overlayPoints) intern(p.x, p.y);

  const segments: PslgSegment[] = [];
  const seenSegments = new Set<string>();
  const addSegment = (a: number, b: number): void => {
    if (a === b) return;
    const key = edgeKey(a, b);
    if (seenSegments.has(key)) return;
    seenSegments.add(key);
    segments.push({ a, b });
  };

  // Every overlay edge is a constraint (plane-breaks + domain boundary).
  const overlayEdges = new Set<string>();
  for (const tri of overlayTriangles) {
    for (let k = 0; k < 3; k += 1) {
      const a = overlayPoints[tri[(k + 1) % 3]!]!;
      const b = overlayPoints[tri[(k + 2) % 3]!]!;
      const ia = intern(a.x, a.y);
      const ib = intern(b.x, b.y);
      const key = edgeKey(ia, ib);
      if (!overlayEdges.has(key)) {
        overlayEdges.add(key);
        addSegment(ia, ib);
      }
    }
  }

  const boundaryEdges: BoundaryEdge[] = overlayBoundary.map(([c, d]) => ({
    c: { x: overlayPoints[c]!.x, y: overlayPoints[c]!.y },
    d: { x: overlayPoints[d]!.x, y: overlayPoints[d]!.y },
  }));
  const boundaryIndex = buildEdgeIndex(boundaryEdges);

  // Base edges: unique mesh edges, kept only where outside overlay.
  const baseEdges = new Set<string>();
  const basePairs: Array<[WorldPt, WorldPt]> = [];
  for (const tri of baseTriangles) {
    for (let k = 0; k < 3; k += 1) {
      const a = basePoints[tri[(k + 1) % 3]!]!;
      const b = basePoints[tri[(k + 2) % 3]!]!;
      const key = pointKey(a.x, a.y) < pointKey(b.x, b.y)
        ? `${pointKey(a.x, a.y)}|${pointKey(b.x, b.y)}`
        : `${pointKey(b.x, b.y)}|${pointKey(a.x, a.y)}`;
      if (baseEdges.has(key)) continue;
      baseEdges.add(key);
      basePairs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
    }
  }
  // Deterministic processing order (input-permutation invariant).
  basePairs.sort((p1, p2) => {
    const k1 = pointKey(p1[0].x, p1[0].y) < pointKey(p1[1].x, p1[1].y)
      ? `${pointKey(p1[0].x, p1[0].y)}|${pointKey(p1[1].x, p1[1].y)}`
      : `${pointKey(p1[1].x, p1[1].y)}|${pointKey(p1[0].x, p1[0].y)}`;
    const k2 = pointKey(p2[0].x, p2[0].y) < pointKey(p2[1].x, p2[1].y)
      ? `${pointKey(p2[0].x, p2[0].y)}|${pointKey(p2[1].x, p2[1].y)}`
      : `${pointKey(p2[1].x, p2[1].y)}|${pointKey(p2[0].x, p2[0].y)}`;
    return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
  });
  // Two-phase crossing interning: collect every kept piece first, then
  // intern split coordinates in sorted order so point indices never depend
  // on edge processing order.
  const keptPieces: Array<[WorldPt, WorldPt]> = [];
  for (const [a, b] of basePairs) keptPieces.push(...clipBaseEdge(a, b, boundaryIndex, covered));
  const fresh: WorldPt[] = [];
  const freshSeen = new Set<string>();
  for (const [p, q] of keptPieces) {
    for (const v of [p, q]) {
      const key = pointKey(v.x, v.y);
      if (!indexOf.has(key) && !freshSeen.has(key)) {
        freshSeen.add(key);
        fresh.push(v);
      }
    }
  }
  fresh.sort((v1, v2) => (v1.x !== v2.x ? v1.x - v2.x : v1.y - v2.y));
  for (const v of fresh) intern(v.x, v.y);
  for (const [p, q] of keptPieces) addSegment(intern(p.x, p.y), intern(q.x, q.y));

  return { points, segments };
};
