import type { TinSegment } from './tinTypes';
import { buildTinBase } from './tinBase';
import { recoverConstrainedEdges } from './tinConstraintRecovery';
import { legalizeTin } from './tinLegalize';
import { filterTinDomain } from './tinDomainFilter';

export interface TinBuildInput {
  /** World coords, canonical order, exactly XY-deduped (see tinDedupe). */
  points: Array<{ x: number; y: number; z: number }>;
  segments: TinSegment[];
  outers: Array<Array<{ x: number; y: number }>>;
  voids: Array<Array<{ x: number; y: number }>>;
  maxEdgeLength?: number;
}

export interface TinBuildSuccess {
  ok: true;
  /** World-coords points: input order + appended Steiner points (if any). */
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  planimetricArea: number;
  steinerCount: number;
}

const edgeKeyOf = (p: number, q: number): string => `${Math.min(p, q)}>${Math.max(p, q)}`;

/**
 * Full TIN pipeline: base Delaunay → constrained-edge recovery (with
 * Steiner-point restart rounds) → legalization → domain filter.
 *
 * Steiner points carry linearly-interpolated Z along their breakline segment
 * (well-defined, never 0) and are appended deterministically in discovery
 * order; delaunator's output depends on the point set, not input order, so
 * appending keeps builds permutation-invariant. A Steiner midpoint that
 * coincides exactly with an existing vertex splits without appending (no
 * epsilon snap). Bounded restart rounds; failure maps to
 * SURFACE_TRIANGULATION_FAILED at the surface layer.
 */
export const buildConstrainedTin = (input: TinBuildInput): TinBuildSuccess | { ok: false } => {
  const points = input.points.map((p) => ({ ...p }));
  let segments = input.segments.map((s) => ({ ...s }));
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
      segments = [
        ...segments.slice(0, splitAt),
        { a: target.a, b: at },
        { a: at, b: target.b },
        ...segments.slice(splitAt + 1),
      ];
      continue;
    }

    const constrained = new Set(segments.map((s) => edgeKeyOf(s.a, s.b)));
    const legal = legalizeTin(base.points, recovery.triangles, constrained);
    const filtered = filterTinDomain({
      points: base.points,
      triangles: legal,
      outers: input.outers.map((ring) => ring.map((p) => toLocal(p.x, p.y))),
      voids: input.voids.map((ring) => ring.map((p) => toLocal(p.x, p.y))),
      maxEdgeLength: input.maxEdgeLength,
    });
    const triangles = filtered.triangles
      .map((tri): [number, number, number] => [tri.a, tri.b, tri.c])
      .sort((t1, t2) => (t1[0] !== t2[0] ? t1[0] - t2[0] : t1[1] !== t2[1] ? t1[1] - t2[1] : t1[2] - t2[2]));
    return {
      ok: true,
      points,
      triangles,
      planimetricArea: filtered.planimetricArea,
      steinerCount: points.length - input.points.length,
    };
  }
  return { ok: false };
};
