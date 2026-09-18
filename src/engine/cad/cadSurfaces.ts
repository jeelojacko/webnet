import type {
  CadEntityId,
  CadProject,
  CadSurface,
  CadSurfaceStatus,
} from './cadTypes';
import { buildConstrainedTin } from './tin/tinBuild';
import type { TinAdjacency, TinEdgeKinds } from './tin/tinTypes';
import { ccwSign } from './tin/tinPredicates';
import { collectSources, computeCadSurfaceSourceRevision } from './cadSurfaceRevision';
import { buildSurfaceGrid } from './cadSurfaceInterpolation';
import { computeSurfaceFaceStats } from './surfaceAnalysis';

export { computeCadSurfaceSourceRevision } from './cadSurfaceRevision';
export { buildSurfaceGrid, getSurfaceElevationAt } from './cadSurfaceInterpolation';
export type { CollectedSources } from './cadSurfaceRevision';

/**
 * Phase 18F TIN surface model — ENGINE ONLY (no UI, no persistence, no worker).
 *
 * Model rules (see docs/evidence/phase18f-surface-architecture-audit.md):
 * - Surfaces are definitions over survey-point entities; NO triangle entities
 *   are ever created. Builds are pure + deterministic.
 * - Missing-Z policy: source points without a finite Z are SKIPPED with a
 *   SURFACE_POINT_MISSING_Z warning. Z is NEVER defaulted to 0.
 * - Breakline Z policy: entity-backed breaklines resolve Z ONLY via
 *   survey-point refs (point-chain ids, line from/to stations,
 *   metadata.sourcePointIds). Unresolvable Z BLOCKS the build, never Z=0.
 * - XY-duplicate policy: same entity deduped silently; identical XY + equal Z
 *   deduped deterministically (lowest entity id wins); same XY + differing Z
 *   BLOCKS with SURFACE_DUPLICATE_XY_CONFLICT. Exact-coordinate equality —
 *   no epsilon snap.
 * - Triangulation: delaunator + robust-predicates + in-repo constraint
 *   recovery (see docs/evidence/phase18f-triangulation-decision.md and
 *   src/engine/cad/tin/).
 */

export type CadSurfaceReasonCode =
  | 'SURFACE_TOO_FEW_POINTS'
  | 'SURFACE_COLLINEAR_POINTS'
  | 'SURFACE_POINT_MISSING_Z'
  | 'SURFACE_DUPLICATE_XY_CONFLICT'
  | 'SURFACE_BREAKLINE_INVALID'
  | 'SURFACE_BREAKLINE_MISSING_Z'
  | 'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX'
  | 'SURFACE_BOUNDARY_INVALID'
  | 'SURFACE_VOID_INVALID'
  | 'SURFACE_REFERENCE_MISSING'
  | 'SURFACE_TRIANGULATION_FAILED';

export interface CadSurfaceSourcePoint {
  entityId: CadEntityId;
  x: number;
  y: number;
  z: number;
}

export interface CadSurfaceBuildStats {
  resolvedPointCount: number;
  usedPointCount: number;
  skippedMissingZCount: number;
  triangleCount: number;
  minZ: number | null;
  maxZ: number | null;
  minX: number | null;
  minY: number | null;
  maxX: number | null;
  maxY: number | null;
  planimetricArea: number;
  /** Sum of 3D face areas (≥ planimetric; display Planimetric vs 3D distinctly). */
  surface3DArea: number;
  /** Planimetric-area-weighted mean elevation (exact for piecewise-linear TINs). */
  meanElevation: number | null;
  /** Per-face slope ratios (rise/run); mean is area-weighted over RATIOS —
   * report mean% as 100×mean and mean angle as atan(mean), since
   * mean(angle) ≠ angle(mean). Pin: arithmetic-mean-of-vertices is NOT used. */
  minFaceSlopeRatio: number | null;
  maxFaceSlopeRatio: number | null;
  meanFaceSlopeRatio: number | null;
}

export interface CadSurfaceBuildResult {
  outcome: 'ok' | 'insufficient' | 'blocked';
  revision: string;
  reasonCodes: CadSurfaceReasonCode[];
  /** Resolved vertices in canonical order (world coords, + boundary/synthetic tail + Steiner tail). */
  points: CadSurfaceSourcePoint[];
  /** CCW index triples into points. */
  triangles: Array<[number, number, number]>;
  /** Neighbor opposite vertex 0/1/2, -1 exterior (aligned with triangles). */
  adjacency: TinAdjacency[];
  /** Constrained-edge flags opposite vertex 0/1/2 (derived only, never persisted). */
  edgeKinds: TinEdgeKinds[];
  stats: CadSurfaceBuildStats;
  /** Uniform-grid query index (opaque; engine-local). */
  grid: CadSurfaceGrid;
}

export interface CadSurfaceGrid {
  minX: number;
  minY: number;
  cellSize: number;
  cells: Map<string, number[]>;
}

const emptyStats = (): CadSurfaceBuildStats => ({
  resolvedPointCount: 0,
  usedPointCount: 0,
  skippedMissingZCount: 0,
  triangleCount: 0,
  minZ: null,
  maxZ: null,
  minX: null,
  minY: null,
  maxX: null,
  maxY: null,
  planimetricArea: 0,
  surface3DArea: 0,
  meanElevation: null,
  minFaceSlopeRatio: null,
  maxFaceSlopeRatio: null,
  meanFaceSlopeRatio: null,
});

const isCollinearWorld = (points: CadSurfaceSourcePoint[]): boolean => {
  if (points.length < 3) return false;
  let minX = Infinity;
  let minY = Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  const local = points.map((p) => ({ u: p.x - minX, v: p.y - minY, z: p.z }));
  const a = local[0];
  const b = local.find((p) => p.u !== a.u || p.v !== a.v);
  if (!b) return true;
  const base = Math.hypot(b.u - a.u, b.v - a.v);
  const eps = 1e-9 * Math.max(1, base);
  return local.every((p) => Math.abs(ccwSign(a, b, p)) <= eps * base);
};

export const buildCadSurface = (project: CadProject, surface: CadSurface): CadSurfaceBuildResult => {
  const revision = computeCadSurfaceSourceRevision(project, surface);
  const collected = collectSources(project, surface);
  const fail = (
    outcome: 'insufficient' | 'blocked',
    reasonCodes: CadSurfaceReasonCode[],
  ): CadSurfaceBuildResult => ({
    outcome,
    revision,
    reasonCodes,
    points: [],
    triangles: [],
    adjacency: [],
    edgeKinds: [],
    stats: {
      ...emptyStats(),
      resolvedPointCount: collected.points.length,
      skippedMissingZCount: collected.skippedMissingZ,
    },
    grid: buildSurfaceGrid([], []),
  });
  const warnings: CadSurfaceReasonCode[] =
    collected.skippedMissingZ > 0 ? ['SURFACE_POINT_MISSING_Z'] : [];

  if (collected.brokenRefs.length > 0) return fail('blocked', ['SURFACE_REFERENCE_MISSING']);
  if (collected.duplicateConflict) return fail('blocked', ['SURFACE_DUPLICATE_XY_CONFLICT']);
  if (collected.breaklineError) return fail('blocked', [...warnings, collected.breaklineError]);
  if (collected.boundaryError) return fail('blocked', [collected.boundaryError]);
  if (collected.points.length < 3) return fail('insufficient', [...warnings, 'SURFACE_TOO_FEW_POINTS']);
  if (isCollinearWorld(collected.points)) {
    return fail('insufficient', [...warnings, 'SURFACE_COLLINEAR_POINTS']);
  }

  // Canonical input order (input-permutation invariant); the TIN layer owns
  // local-frame conditioning, so large translations keep identical topology.
  const ordered = [...collected.points].sort((a, b) =>
    a.x !== b.x
      ? a.x - b.x
      : a.y !== b.y
        ? a.y - b.y
        : a.z !== b.z
          ? a.z - b.z
          : a.entityId < b.entityId
            ? -1
            : 1,
  );
  const localIndex = new Map(ordered.map((p, index) => [p.entityId, index]));
  const segments: Array<{ a: number; b: number }> = [];
  for (const chain of collected.breaklines) {
    const remapped: number[] = [];
    for (const worldIndex of chain) {
      const entityId = collected.points[worldIndex]?.entityId;
      const at = entityId != null ? localIndex.get(entityId) : undefined;
      if (at === undefined) return fail('blocked', ['SURFACE_TRIANGULATION_FAILED']);
      if (remapped[remapped.length - 1] !== at) remapped.push(at);
    }
    for (let i = 0; i + 1 < remapped.length; i += 1) {
      segments.push({ a: remapped[i], b: remapped[i + 1] });
    }
  }

  // Breaklines must not cross except at shared vertices.
  if (breaklinesCross(ordered, segments)) {
    return fail('blocked', ['SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX']);
  }

  const tin = buildConstrainedTin({
    points: ordered.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    segments,
    outers: collected.outers,
    voids: collected.voids,
    maxEdgeLength: collected.buildOptions.maxEdgeLength,
    surfaceId: surface.id,
  });
  if (!tin.ok) return fail('blocked', ['SURFACE_TRIANGULATION_FAILED']);

  const boundaryCount = tin.syntheticIds.length;
  const finalPoints: CadSurfaceSourcePoint[] = ordered.map((p) => ({ ...p }));
  for (let i = 0; i < boundaryCount; i += 1) {
    const at = ordered.length + i;
    finalPoints.push({
      entityId: tin.syntheticIds[i],
      x: tin.points[at].x,
      y: tin.points[at].y,
      z: tin.points[at].z,
    });
  }
  for (let i = ordered.length + boundaryCount; i < tin.points.length; i += 1) {
    finalPoints.push({
      entityId: `steiner:${surface.id}:${i - ordered.length - boundaryCount}`,
      x: tin.points[i].x,
      y: tin.points[i].y,
      z: tin.points[i].z,
    });
  }

  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of finalPoints) {
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return {
    outcome: 'ok',
    revision,
    reasonCodes: warnings,
    points: finalPoints,
    triangles: tin.triangles,
    adjacency: tin.adjacency,
    edgeKinds: tin.edgeKinds,
    stats: {
      resolvedPointCount: collected.points.length,
      usedPointCount: finalPoints.length,
      skippedMissingZCount: collected.skippedMissingZ,
      triangleCount: tin.triangles.length,
      minZ,
      maxZ,
      minX,
      minY,
      maxX,
      maxY,
      planimetricArea: tin.planimetricArea,
      // Single-pass face stats over the retained mesh (worker path
      // inherits them via result.stats) — never recomputed on render.
      ...computeSurfaceFaceStats(finalPoints, tin.triangles),
    },
    grid: buildSurfaceGrid(finalPoints, tin.triangles),
  };
};

const breaklinesCross = (
  ordered: CadSurfaceSourcePoint[],
  segments: Array<{ a: number; b: number }>,
): boolean => {
  const P = (i: number): { u: number; v: number; z: number } => ({
    u: ordered[i].x,
    v: ordered[i].y,
    z: ordered[i].z,
  });
  const onSeg = (a: number, b: number, p: number): boolean =>
    ccwSign(P(a), P(b), P(p)) === 0 &&
    Math.min(ordered[a].x, ordered[b].x) <= ordered[p].x &&
    ordered[p].x <= Math.max(ordered[a].x, ordered[b].x) &&
    Math.min(ordered[a].y, ordered[b].y) <= ordered[p].y &&
    ordered[p].y <= Math.max(ordered[a].y, ordered[b].y);
  const crosses = (s1: { a: number; b: number }, s2: { a: number; b: number }): boolean => {
    const shared = new Set([s1.a, s1.b, s2.a, s2.b]).size;
    if (shared === 2) return false; // same edge
    const o1 = ccwSign(P(s1.a), P(s1.b), P(s2.a));
    const o2 = ccwSign(P(s1.a), P(s1.b), P(s2.b));
    const o3 = ccwSign(P(s2.a), P(s2.b), P(s1.a));
    const o4 = ccwSign(P(s2.a), P(s2.b), P(s1.b));
    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (shared < 3) {
      if (onSeg(s1.a, s1.b, s2.a) || onSeg(s1.a, s1.b, s2.b)) return true;
      if (onSeg(s2.a, s2.b, s1.a) || onSeg(s2.a, s2.b, s1.b)) return true;
    } else {
      // One shared endpoint: block only a touch landing mid-edge.
      const other1 = [s1.a, s1.b].find((v) => v !== s2.a && v !== s2.b);
      const other2 = [s2.a, s2.b].find((v) => v !== s1.a && v !== s1.b);
      if (other1 !== undefined && onSeg(s2.a, s2.b, other1)) return true;
      if (other2 !== undefined && onSeg(s1.a, s1.b, other2)) return true;
    }
    return false;
  };
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (crosses(segments[i], segments[j])) return true;
    }
  }
  return false;
};

export const deriveSurfaceStatus = (
  project: CadProject,
  surface: CadSurface,
  options?: { building?: boolean },
): CadSurfaceStatus => {
  if (options?.building) return 'BUILDING';
  const collected = collectSources(project, surface);
  if (collected.brokenRefs.length > 0) return 'BROKEN_REFERENCE';
  if (collected.points.length < 3) return 'INSUFFICIENT_DATA';
  if (collected.duplicateConflict) return 'FAILED';
  if (collected.breaklineError || collected.boundaryError) return 'FAILED';
  if (isCollinearWorld(collected.points)) return 'INSUFFICIENT_DATA';
  if (surface.cachedRevision == null) return 'UNBUILT';
  return computeCadSurfaceSourceRevision(project, surface) === surface.cachedRevision
    ? 'CURRENT'
    : 'NEEDS_REBUILD';
};
