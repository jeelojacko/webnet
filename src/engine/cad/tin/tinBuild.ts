import type {
  TinAdjacency,
  TinEdgeKindCode,
  TinEdgeKinds,
  TinSegment,
  TinTriangle,
} from './tinTypes';
import {
  TIN_EDGE_BREAKLINE,
  TIN_EDGE_OUTER,
  TIN_EDGE_VOID,
} from './tinTypes';
import { orient2d } from 'robust-predicates';
import { buildTinBase } from './tinBase';
import { mergeBoundaryPoints } from './tinBoundaries';
import { recoverConstrainedEdges } from './tinConstraintRecovery';
import { legalizeTin } from './tinLegalize';
import { filterTinDomain } from './tinDomainFilter';
import { buildTinTopology, tinEdgeKey } from './tinTopology';

export interface TinBuildInput {
  /** World coords, canonical order, exactly XY-deduped (see tinDedupe). */
  points: Array<{ x: number; y: number; z: number }>;
  /** Breakline segments (indices into points). */
  segments: TinSegment[];
  outers: Array<Array<{ x: number; y: number }>>;
  voids: Array<Array<{ x: number; y: number }>>;
  maxEdgeLength?: number;
  /** Owner surface id (synthetic boundary-vertex ids only). */
  surfaceId: string;
}

export interface TinBuildSuccess {
  ok: true;
  /** World-coords points: input order + boundary tail + Steiner tail. */
  points: Array<{ x: number; y: number; z: number }>;
  /** Entity ids for the boundary tail (aligned with points slice). */
  syntheticIds: string[];
  triangles: Array<[number, number, number]>;
  /** Neighbor opposite vertex 0/1/2, -1 exterior (aligned with triangles). */
  adjacency: TinAdjacency[];
  /** Constrained-edge flags opposite vertex 0/1/2 (aligned with triangles). */
  edgeKinds: TinEdgeKinds[];
  planimetricArea: number;
  steinerCount: number;
}

type KindedSegment = { a: number; b: number; kind: 'breakline' | 'outer' | 'void' };

/**
 * Split every constrained segment at exact-interior vertices (a data or
 * boundary vertex strictly inside the segment — exact zero predicate, no
 * epsilon). Without this, a segment spanning intermediate collinear
 * vertices (e.g. an outer edge along a grid line) can never appear as one
 * mesh edge and recovery fails. Kind inherited per piece; split order along
 * the segment is deterministic.
 */
const splitAtInteriorVertices = (
  points: Array<{ x: number; y: number; z: number }>,
  segments: KindedSegment[],
): KindedSegment[] => {
  const out: KindedSegment[] = [];
  for (const seg of segments) {
    const a = points[seg.a];
    const b = points[seg.b];
    const inner: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      if (i === seg.a || i === seg.b) continue;
      const p = points[i];
      if (p.x < Math.min(a.x, b.x) || p.x > Math.max(a.x, b.x)) continue;
      if (p.y < Math.min(a.y, b.y) || p.y > Math.max(a.y, b.y)) continue;
      if (orient2d(a.x, a.y, b.x, b.y, p.x, p.y) !== 0) continue;
      inner.push(i);
    }
    inner.sort((i, j) => {
      // Along-segment order from a to b (projection parameter — correct
      // for both segment directions; distinct collinear points differ in t).
      const ti = (points[i].x - a.x) * (b.x - a.x) + (points[i].y - a.y) * (b.y - a.y);
      const tj = (points[j].x - a.x) * (b.x - a.x) + (points[j].y - a.y) * (b.y - a.y);
      return ti - tj;
    });
    let prev = seg.a;
    for (const at of inner) {
      if (at !== prev) out.push({ a: prev, b: at, kind: seg.kind });
      prev = at;
    }
    if (prev !== seg.b) out.push({ a: prev, b: seg.b, kind: seg.kind });
  }
  return out;
};

const codeOf = (kind: KindedSegment['kind']): TinEdgeKindCode =>
  kind === 'outer' ? TIN_EDGE_OUTER : kind === 'void' ? TIN_EDGE_VOID : TIN_EDGE_BREAKLINE;

/**
 * Full TIN pipeline: boundary-vertex merge → base Delaunay →
 * constrained-edge recovery (breakline + boundary segments, bounded Steiner
 * restart rounds) → legalization → exact domain flood fill.
 *
 * Deterministic: rings processed in coordinate-sorted order, all segments
 * recovery-sorted by endpoint world coords (kind rank breaks ties), Steiner
 * points appended in discovery order. With no boundaries the merge is the
 * identity and the pipeline matches 18F exactly.
 */
export const buildConstrainedTin = (input: TinBuildInput): TinBuildSuccess | { ok: false } => {
  const merged = mergeBoundaryPoints(input.points, input.outers, input.voids, input.surfaceId);
  const boundaryCount = merged.points.length - input.points.length;
  const points = merged.points.map((p) => ({ ...p }));

  let segments: KindedSegment[] = input.segments.map((s) => ({ ...s, kind: 'breakline' as const }));
  for (const ring of merged.rings) {
    const code = ring.kind;
    for (let i = 0; i < ring.indices.length; i += 1) {
      const a = ring.indices[i];
      const b = ring.indices[(i + 1) % ring.indices.length];
      if (a !== b) segments.push({ a, b, kind: code });
    }
  }
  segments = splitAtInteriorVertices(points, segments);
  // Canonical segment order (input-permutation invariant): endpoint world
  // coords, kind rank breaking exact ties; overlap dedup keeps boundary wins.
  const keyOfPoint = (index: number): string => `${points[index].x},${points[index].y}`;
  segments = segments
    .sort((s1, s2) => {
      const a1 = keyOfPoint(Math.min(s1.a, s1.b));
      const b1 = keyOfPoint(Math.max(s1.a, s1.b));
      const a2 = keyOfPoint(Math.min(s2.a, s2.b));
      const b2 = keyOfPoint(Math.max(s2.a, s2.b));
      if (a1 !== a2) return a1 < a2 ? -1 : 1;
      if (b1 !== b2) return b1 < b2 ? -1 : 1;
      return codeOf(s1.kind) - codeOf(s2.kind);
    })
    .filter((seg, index, all) => {
      if (seg.a === seg.b) return false;
      const prev = all[index - 1];
      return !(prev && tinEdgeKey(prev.a, prev.b) === tinEdgeKey(seg.a, seg.b));
    });

  const maxRounds = 6;

  for (let round = 0; round < maxRounds; round += 1) {
    const base = buildTinBase(points);
    const toLocal = (x: number, y: number): { x: number; y: number } => ({
      x: x - base.originX,
      y: y - base.originY,
    });
    const recovery = recoverConstrainedEdges(base.points, base.triangles, segments);
    if (!recovery.ok) {
      if (recovery.steiner.length === 0) return { ok: false };
      const sp = recovery.steiner[0];
      const target = recovery.steinerFor[0] ?? segments[0];
      if (!target) return { ok: false };
      const wx = sp.u + base.originX;
      const wy = sp.v + base.originY;
      const exact = points.findIndex((p) => p.x === wx && p.y === wy);
      const at = exact >= 0 ? exact : points.length;
      if (exact < 0) points.push({ x: wx, y: wy, z: sp.z });
      const splitAt = segments.findIndex((s) => s.a === target.a && s.b === target.b);
      if (splitAt < 0) return { ok: false };
      const kind = segments[splitAt].kind;
      segments = [
        ...segments.slice(0, splitAt),
        { a: target.a, b: at, kind },
        { a: at, b: target.b, kind },
        ...segments.slice(splitAt + 1),
      ];
      continue;
    }

    const constrained = new Map<string, TinEdgeKindCode>();
    for (const seg of segments) {
      const key = tinEdgeKey(seg.a, seg.b);
      const code = codeOf(seg.kind);
      const prior = constrained.get(key) ?? 0;
      if (code > prior) constrained.set(key, code);
    }
    const constrainedKeys = new Set(constrained.keys());
    const legal = legalizeTin(base.points, recovery.triangles, constrainedKeys);
    const filtered = filterTinDomain({
      points: base.points,
      triangles: legal,
      outers: input.outers.map((ring) => ring.map((p) => toLocal(p.x, p.y))),
      voids: input.voids.map((ring) => ring.map((p) => toLocal(p.x, p.y))),
      constrained,
      maxEdgeLength: input.maxEdgeLength,
    });
    const order = filtered.triangles
      .map((tri, index) => ({ tri, index }))
      .sort((x, y) => {
        const t1 = [x.tri.a, x.tri.b, x.tri.c];
        const t2 = [y.tri.a, y.tri.b, y.tri.c];
        return t1[0] !== t2[0] ? t1[0] - t2[0] : t1[1] !== t2[1] ? t1[1] - t2[1] : t1[2] - t2[2];
      });
    const triangles = order.map(({ tri }): [number, number, number] => [tri.a, tri.b, tri.c]);
    const topology = buildTinTopology(
      order.map(({ tri }): TinTriangle => ({ ...tri })),
      constrained,
    );
    return {
      ok: true,
      points,
      syntheticIds: merged.syntheticIds,
      triangles,
      adjacency: topology.adjacency,
      edgeKinds: topology.edgeKinds,
      planimetricArea: filtered.planimetricArea,
      steinerCount: points.length - input.points.length - boundaryCount,
    };
  }
  return { ok: false };
};
