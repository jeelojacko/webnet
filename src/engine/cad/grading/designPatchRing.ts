/**
 * Phase 20D Wave-1B — Design Patch source ring (engine only, session-only).
 *
 * Re-derives the closed source boundary of a grading group with the SAME
 * discretization the group compute used (`linearizeGradingArc` for arcs,
 * single chords for straights), then validates it structurally, proves a
 * single flat pad Z, and proves the ring is the exact boundary of the
 * current grading mesh. Nothing here is persisted.
 */
import { resolveCadFeatureLine } from '../cadFeatureLines';
import type { CadFeatureLineEntity } from '../cadTypes';
import { resolveGradingSourceCourse, toGradingCourseLikes } from './gradingCourseFrame';
import { linearizeGradingArc } from './gradingCurve';
import type { CadGradingGroup } from './gradingGroupTypes';
import type { GradingMesh } from './gradingTypes';

/** Named fail-closed reasons; never a silent fallback. */
export type DesignPatchBlockCode =
  | 'DESIGN_PATCH_SOURCE_UNRESOLVED'
  | 'DESIGN_PATCH_NON_SIMPLE_RING'
  | 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED'
  | 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED'
  | 'DESIGN_PATCH_RING_MESH_MISMATCH'
  | 'DESIGN_PATCH_TRIANGULATION_FAILED'
  | 'DESIGN_PATCH_MERGE_FAILED';

export interface DesignPatchFailure {
  ok: false;
  code: DesignPatchBlockCode;
  detail?: string;
}

export interface DesignPatchRing {
  ok: true;
  /** Flat XYZ triplets; implicitly closed (no repeated closing vertex). */
  ring: number[];
}

export const designPatchBlock = (code: DesignPatchBlockCode, detail?: string): DesignPatchFailure =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };

export const ringCount = (ring: readonly number[]): number => Math.floor(ring.length / 3);

export const ringVertexKey = (ring: readonly number[], index: number): string =>
  `${ring[index * 3]}|${ring[index * 3 + 1]}|${ring[index * 3 + 2]}`;

export const ringEdgeKey = (a: string, b: string): string => (a < b ? `${a}||${b}` : `${b}||${a}`);

// ---------------------------------------------------------------------------
// 1. Source-ring derivation (same discretization as the group compute)
// ---------------------------------------------------------------------------

/**
 * One course's ring contribution: straights are a single start vertex;
 * arcs contribute every `linearizeGradingArc` sample except the final
 * (the next course owns the shared junction vertex).
 */
const courseRingPoints = (
  member: ReturnType<typeof resolveGradingSourceCourse>,
  tolerance: number,
): Array<{ x: number; y: number; z: number }> | null => {
  if (!member) return null;
  if (!member.isArc || !member.arc) return [{ x: member.startX, y: member.startY, z: member.startZ }];
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) return null;
  const linearized = linearizeGradingArc(
    member.arc.centerX, member.arc.centerY, member.arc.radius,
    member.arc.startAngle, member.arc.endAngle, member.arc.sweepCCW,
    member.startZ, member.endZ, tolerance,
  );
  if (!linearized) return null;
  return linearized.points
    .slice(0, linearized.subdivisions)
    .map((p) => ({ x: p.x, y: p.y, z: p.z }));
};

/**
 * Canonical closed source-boundary ring as flat XYZ triplets, derived from
 * the persisted group chain + Feature Line with the group's own chord
 * tolerance. Session-only: the ring is never persisted.
 */
export const deriveSourceRing = (
  group: CadGradingGroup,
  featureLineEntity: CadFeatureLineEntity,
  curveChordTolerance: number,
): DesignPatchRing | DesignPatchFailure => {
  if (group.closed !== true) return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'group is not closed');
  const resolved = resolveCadFeatureLine(featureLineEntity);
  if (!resolved) return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'feature line is invalid');
  const courses = toGradingCourseLikes(resolved.courses);
  const refs = group.sourceCourses;
  if (refs.length < 3) return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'closed group needs three courses');
  const ring: number[] = [];
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!;
    const next = refs[(index + 1) % refs.length]!;
    if (ref.vertexBId !== next.vertexAId) {
      return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'group source courses are not contiguous');
    }
    const points = courseRingPoints(
      resolveGradingSourceCourse(courses, ref.vertexAId, ref.vertexBId),
      curveChordTolerance,
    );
    if (!points) {
      return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', `course ${ref.vertexAId}>${ref.vertexBId} unresolved`);
    }
    for (const p of points) ring.push(p.x, p.y, p.z);
  }
  return { ok: true, ring };
};

/**
 * Normalize a captured `sourceBoundaryPoints` array to the implicit-closure
 * ring convention (no repeated closing vertex). Returns null when the capture
 * is structurally unusable, so the caller fail-closes instead of drifting
 * back to a re-linearized ring.
 */
const normalizeCapturedRing = (points: readonly number[]): number[] | null => {
  if (!Array.isArray(points) || points.length % 3 !== 0 || points.length < 9) return null;
  const ring = [...points];
  const last = ring.length - 3;
  if (ring[0] === ring[last] && ring[1] === ring[last + 1] && ring[2] === ring[last + 2]) {
    ring.length = last;
  }
  return ring.length >= 9 ? ring : null;
};

/**
 * Canonical closed source ring for a Design Patch. When the group compute
 * captured its exact source discretization (`CadGradingGroupResult.
 * sourceBoundaryPoints`), that capture IS the boundary authority: it reuses
 * the exact vertices the solver interned, so arc joints cannot drift from
 * the grading mesh. `deriveSourceRing` remains the legacy fallback/diagnostic
 * for snapshots without a capture.
 */
export const resolveDesignPatchRing = (
  group: CadGradingGroup,
  featureLineEntity: CadFeatureLineEntity,
  curveChordTolerance: number,
  sourceBoundaryPoints?: readonly number[],
): DesignPatchRing | DesignPatchFailure => {
  if (sourceBoundaryPoints !== undefined) {
    const captured = normalizeCapturedRing(sourceBoundaryPoints);
    if (!captured) {
      return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'captured source boundary is malformed');
    }
    return { ok: true, ring: captured };
  }
  return deriveSourceRing(group, featureLineEntity, curveChordTolerance);
};

// ---------------------------------------------------------------------------
// 2. Structural ring validation (finite, simple, nonzero plan area)
// ---------------------------------------------------------------------------

const orientXy = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => {
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
};

const onSegment = (ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean =>
  Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);

const segmentsIntersect = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean => {
  const o1 = orientXy(ax, ay, bx, by, cx, cy);
  const o2 = orientXy(ax, ay, bx, by, dx, dy);
  const o3 = orientXy(cx, cy, dx, dy, ax, ay);
  const o4 = orientXy(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
};

const signedDoubleArea = (ring: readonly number[]): number => {
  let sum = 0;
  const n = ringCount(ring);
  for (let i = 0; i < n; i += 1) {
    const a = i * 3;
    const b = ((i + 1) % n) * 3;
    sum += ring[a]! * ring[b + 1]! - ring[b]! * ring[a + 1]!;
  }
  return sum;
};

/** Finite, >=3 distinct non-adjacent-XY verts, simple, nonzero plan area. */
export const validateSourceRing = (ring: readonly number[]): { ok: true } | DesignPatchFailure => {
  if (!Array.isArray(ring) || ring.length % 3 !== 0 || ringCount(ring) < 3) {
    return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'ring needs >=3 XYZ vertices');
  }
  if (ring.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'ring has non-finite coordinates');
  }
  const n = ringCount(ring);
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    if (ring[i * 3]! === ring[next * 3]! && ring[i * 3 + 1]! === ring[next * 3 + 1]!) {
      return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', `duplicate adjacent vertex ${i}/${next}`);
    }
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (ring[i * 3]! === ring[j * 3]! && ring[i * 3 + 1]! === ring[j * 3 + 1]!) {
        return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', `duplicate non-adjacent vertex ${i}/${j}`);
      }
      const a = i;
      const b = (i + 1) % n;
      const c = j;
      const d = (j + 1) % n;
      if (
        segmentsIntersect(
          ring[a * 3]!, ring[a * 3 + 1]!, ring[b * 3]!, ring[b * 3 + 1]!,
          ring[c * 3]!, ring[c * 3 + 1]!, ring[d * 3]!, ring[d * 3 + 1]!,
        )
      ) {
        return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', `self-intersection ${i}/${j}`);
      }
    }
  }
  if (signedDoubleArea(ring) === 0) return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'zero plan area');
  return { ok: true };
};

// ---------------------------------------------------------------------------
// 3. Flat-interior gate (strict ===, never averaged)
// ---------------------------------------------------------------------------

/** Every vertex Z must be bit-identical to the first; returns the pad Z. */
export const checkFlatRing = (ring: readonly number[]): { ok: true; padZ: number } | DesignPatchFailure => {
  if (!Array.isArray(ring) || ring.length % 3 !== 0 || ringCount(ring) < 3) {
    return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'ring needs >=3 XYZ vertices');
  }
  const padZ = ring[2]!;
  if (!Number.isFinite(padZ)) {
    return designPatchBlock('DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED', 'non-finite Z');
  }
  for (let i = 1; i < ringCount(ring); i += 1) {
    if (ring[i * 3 + 2] !== padZ) {
      return designPatchBlock('DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED', `vertex ${i} Z differs`);
    }
  }
  return { ok: true, padZ };
};

// ---------------------------------------------------------------------------
// 4. Ring/mesh discretization agreement (exact XYZ + exact edges)
// ---------------------------------------------------------------------------

const meshTopology = (
  points: readonly number[],
  triangles: readonly number[],
): { vertices: Set<string>; edges: Set<string> } => {
  const key = (index: number): string =>
    `${points[index * 3]}|${points[index * 3 + 1]}|${points[index * 3 + 2]}`;
  const vertices = new Set<string>();
  for (let i = 0; i + 2 < points.length; i += 3) vertices.add(`${points[i]}|${points[i + 1]}|${points[i + 2]}`);
  const edges = new Set<string>();
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = key(triangles[i]!);
    const b = key(triangles[i + 1]!);
    const c = key(triangles[i + 2]!);
    edges.add(ringEdgeKey(a, b));
    edges.add(ringEdgeKey(b, c));
    edges.add(ringEdgeKey(c, a));
  }
  return { vertices, edges };
};

/**
 * Every ring vertex must be an EXACT mesh vertex and every ring edge an
 * EXACT mesh edge — the proof that the pad shares the group's discretization.
 */
export const verifyRingAgainstMesh = (
  ring: readonly number[],
  gradingMesh: GradingMesh,
): { ok: true } | DesignPatchFailure => {
  const topology = meshTopology(gradingMesh.points, gradingMesh.triangles);
  const n = ringCount(ring);
  const keys: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const key = ringVertexKey(ring, i);
    if (!topology.vertices.has(key)) {
      return designPatchBlock('DESIGN_PATCH_RING_MESH_MISMATCH', `ring vertex ${i} missing from grading mesh`);
    }
    keys.push(key);
  }
  for (let i = 0; i < n; i += 1) {
    if (!topology.edges.has(ringEdgeKey(keys[i]!, keys[(i + 1) % n]!))) {
      return designPatchBlock('DESIGN_PATCH_RING_MESH_MISMATCH', `ring edge ${i}/${(i + 1) % n} missing`);
    }
  }
  return { ok: true };
};
