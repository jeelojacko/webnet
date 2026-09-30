/**
 * Phase 20D Wave-1B — Design Patch pure build (engine only, session-only).
 *
 * A Design Patch closes the hole inside a closed grading group: the source
 * ring (re-derived in `designPatchRing`) is triangulated flat at the source
 * elevation, then merged with the CURRENT grading shell through exact-XYZ
 * vertex interning. Nothing here is persisted; the caller snapshots the
 * returned payload as an ordinary `explicit-tin` surface.
 *
 * Fail-closed by construction: triangulation failure, holes/overlaps, and
 * non-manifold merges all return a named block code instead of guessing.
 * No elevation is ever averaged; no new triangulation math lives here
 * beyond calling `earClip`.
 */
import { canonicalizeBakedTin } from '../cadExplicitBake';
import { validateExplicitTinPayload } from '../cadImportedTin';
import { earClip } from '../cadSurfaceEditAddLine';
import { EditHalt, type CadSurfaceEditMeshPoint } from '../cadSurfaceEditMesh';
import type { WebnetGradingDesignPatchTinProvenance } from '../cadTypes';
import { checkFlatRing, designPatchBlock, ringCount, ringEdgeKey, ringVertexKey, validateSourceRing } from './designPatchRing';
import type { DesignPatchFailure } from './designPatchRing';
import { deriveDesignPatchPlane } from './designPatchPlane';
import { gradingTerminationKind } from './gradingTypes';
import { criteriaEqual } from './gradingGroupCourseCriteria';
import { canonicalAnalyticKinds, canonicalTerminationKinds, groupTerminationMode } from './gradingGroupTermination';
import type { GradingCriterion, GradingMesh } from './gradingTypes';

export {
  checkFlatRing,
  deriveSourceRing,
  resolveDesignPatchRing,
  validateSourceRing,
  verifyRingAgainstMesh,
} from './designPatchRing';
export type {
  DesignPatchBlockCode,
  DesignPatchFailure,
  DesignPatchRing,
} from './designPatchRing';
export {
  deriveDesignPatchPlane,
  designPatchPlaneElevation,
  designPatchPlaneSlope,
} from './designPatchPlane';
export type {
  DesignPatchPlane,
  DesignPatchPlaneKind,
  DesignPatchPlaneSlope,
} from './designPatchPlane';

export interface DesignPatchPad {
  ok: true;
  padPoints: number[];
  /** Flat index triples into `padPoints`, CCW. */
  padTriangles: number[];
}

export interface DesignPatchMesh {
  ok: true;
  points: number[];
  triangles: number[];
}

// ---------------------------------------------------------------------------
// 5. Flat pad interior via the shared ear clipper
// ---------------------------------------------------------------------------

/** Ear-clip the ring in plan; a flat pad uses `padZ`, a planar pad keeps the
 * ORIGINAL boundary XYZ (no overwrite, no Steiner point). */
export const buildPadInterior = (
  ring: readonly number[],
  padZ?: number,
): DesignPatchPad | DesignPatchFailure => {
  if (!Array.isArray(ring) || ring.length % 3 !== 0 || ringCount(ring) < 3) {
    return designPatchBlock('DESIGN_PATCH_NON_SIMPLE_RING', 'ring needs >=3 XYZ vertices');
  }
  if (padZ !== undefined && !Number.isFinite(padZ)) {
    return designPatchBlock('DESIGN_PATCH_TRIANGULATION_FAILED', 'non-finite pad Z');
  }
  const n = ringCount(ring);
  const pts: CadSurfaceEditMeshPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({
      id: `ring:${i}`,
      x: ring[i * 3]!,
      y: ring[i * 3 + 1]!,
      z: padZ === undefined ? ring[i * 3 + 2]! : padZ,
    });
  }
  try {
    const padTriangles = earClip(pts, pts.map((_, i) => i)).flat();
    const padPoints: number[] = [];
    for (const p of pts) padPoints.push(p.x, p.y, p.z);
    return { ok: true, padPoints, padTriangles };
  } catch (error) {
    const detail = error instanceof EditHalt ? error.reason : 'earClip failed';
    return designPatchBlock('DESIGN_PATCH_TRIANGULATION_FAILED', detail);
  }
};

// ---------------------------------------------------------------------------
// 5b. Flat-OR-coplanar interior gate (the Design Patch legal-interior proof)
// ---------------------------------------------------------------------------

export type DesignPatchInteriorPolicy = 'flat-source' | 'planar-source';

export interface DesignPatchInterior {
  ok: true;
  kind: 'flat' | 'planar';
  interiorPolicy: DesignPatchInteriorPolicy;
  /** Present only for flat rings; the legacy byte-identical pad Z. */
  padZ?: number;
  pad: DesignPatchPad;
}

/**
 * Legal interior = bit-flat ring (byte-identical legacy flat path) OR exactly
 * coplanar ring (planar path, original XYZ). Non-coplanar rings fail closed
 * with `DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED`. Never averages, never
 * least-squares, never tolerance-based "planar enough".
 */
export const resolveDesignPatchInterior = (
  ring: readonly number[],
): DesignPatchInterior | DesignPatchFailure => {
  const valid = validateSourceRing(ring);
  if (!valid.ok) return valid;
  const flat = checkFlatRing(ring);
  if (flat.ok) {
    const pad = buildPadInterior(ring, flat.padZ);
    if (!pad.ok) return pad;
    return { ok: true, kind: 'flat', interiorPolicy: 'flat-source', padZ: flat.padZ, pad };
  }
  const plane = deriveDesignPatchPlane(ring);
  if (!plane.ok) return plane;
  const pad = buildPadInterior(ring);
  if (!pad.ok) return pad;
  return { ok: true, kind: plane.kind, interiorPolicy: 'planar-source', pad };
};

// ---------------------------------------------------------------------------
// 6. Direct topology merge with exact-XYZ interning
// ---------------------------------------------------------------------------

interface EdgeRecord {
  count: number;
  a: string;
  b: string;
}

const edgeRecords = (points: readonly number[], triangles: readonly number[]): Map<string, EdgeRecord> => {
  const records = new Map<string, EdgeRecord>();
  const bump = (a: string, b: string): void => {
    const key = ringEdgeKey(a, b);
    const at = records.get(key);
    if (at) at.count += 1;
    else records.set(key, { count: 1, a: a < b ? a : b, b: a < b ? b : a });
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = ringVertexKey(points, triangles[i]!);
    const b = ringVertexKey(points, triangles[i + 1]!);
    const c = ringVertexKey(points, triangles[i + 2]!);
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  return records;
};

/**
 * Number of disjoint simple boundary cycles, or -1 when the boundary has a
 * dangling/degree-4 vertex (a notch that fused the source and daylight rings).
 */
const boundaryCycleCount = (records: Map<string, EdgeRecord>): number => {
  const adjacency = new Map<string, string[]>();
  for (const record of records.values()) {
    if (record.count !== 1) continue;
    adjacency.set(record.a, [...(adjacency.get(record.a) ?? []), record.b]);
    adjacency.set(record.b, [...(adjacency.get(record.b) ?? []), record.a]);
  }
  for (const neighbors of adjacency.values()) if (neighbors.length !== 2) return -1;
  const visited = new Set<string>();
  let components = 0;
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    components += 1;
    let prev: string | null = null;
    let cur = start;
    for (let step = 0; step <= adjacency.size; step += 1) {
      visited.add(cur);
      const neighbors = adjacency.get(cur)!;
      const next = prev === null ? neighbors[0] : neighbors.find((v) => v !== prev);
      if (next == null) return -1;
      if (next === start) break;
      prev = cur;
      cur = next;
    }
  }
  return components;
};

const usedOnceKeys = (records: Map<string, EdgeRecord>): Set<string> => {
  const keys = new Set<string>();
  for (const [key, record] of records) if (record.count === 1) keys.add(key);
  return keys;
};

/** Append one mesh's faces into the shared interning table; returns face indices. */
const internMesh = (
  points: number[],
  indexByKey: Map<string, number>,
  sourcePoints: readonly number[],
  sourceTriangles: readonly number[],
): number[] => {
  const intern = (key: string, index: number): number => {
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const created = points.length / 3;
    points.push(sourcePoints[index * 3]!, sourcePoints[index * 3 + 1]!, sourcePoints[index * 3 + 2]!);
    indexByKey.set(key, created);
    return created;
  };
  const faces: number[] = [];
  for (let i = 0; i + 2 < sourceTriangles.length; i += 3) {
    for (const index of [sourceTriangles[i]!, sourceTriangles[i + 1]!, sourceTriangles[i + 2]!]) {
      intern(ringVertexKey(sourcePoints, index), index);
    }
    faces.push(
      indexByKey.get(ringVertexKey(sourcePoints, sourceTriangles[i]!))!,
      indexByKey.get(ringVertexKey(sourcePoints, sourceTriangles[i + 1]!))!,
      indexByKey.get(ringVertexKey(sourcePoints, sourceTriangles[i + 2]!))!,
    );
  }
  return faces;
};

/**
 * Merge the flat pad with the grading shell: exact-XYZ interning, canonical
 * topology, stock payload validation, then a per-source-edge manifold check
 * (exactly one pad side + one grading side) and daylight ring as the only
 * boundary.
 */
export const mergePadWithGrading = (
  padPoints: readonly number[],
  padTriangles: readonly number[],
  gradingMesh: GradingMesh,
): DesignPatchMesh | DesignPatchFailure => {
  const padEdges = edgeRecords(padPoints, padTriangles);
  const gradingEdges = edgeRecords(gradingMesh.points, gradingMesh.triangles);
  // A closed-pad shell is exactly two simple boundary cycles: source + daylight.
  if (boundaryCycleCount(gradingEdges) !== 2) {
    return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', 'grading shell is not a two-boundary annulus');
  }
  const sourceEdgeKeys = new Set<string>();
  for (const [key, record] of padEdges) {
    if (record.count !== 1) continue;
    const grading = gradingEdges.get(key);
    if (!grading || grading.count !== 1) {
      return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', `source edge ${record.a}->${record.b} not shared exactly once`);
    }
    sourceEdgeKeys.add(key);
  }
  const points: number[] = [];
  const indexByKey = new Map<string, number>();
  const faces = [
    ...internMesh(points, indexByKey, padPoints, padTriangles),
    ...internMesh(points, indexByKey, gradingMesh.points, gradingMesh.triangles),
  ];
  const canonical = canonicalizeBakedTin(points, faces);
  const error = validateExplicitTinPayload({
    vertices: canonical.vertices,
    faces: canonical.faces,
    provenance: { format: 'explicit', fileName: 'design-patch', surfaceName: 'design-patch' },
  });
  if (error != null) return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', error);
  const mergedEdges = edgeRecords(canonical.vertices, canonical.faces);
  for (const record of mergedEdges.values()) {
    if (record.count > 2) return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', 'merged mesh has a non-manifold edge');
  }
  const boundaryKeys = usedOnceKeys(mergedEdges);
  const expectedKeys = usedOnceKeys(gradingEdges);
  for (const key of sourceEdgeKeys) expectedKeys.delete(key);
  if (boundaryKeys.size !== expectedKeys.size) {
    return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', 'merged boundary is not the daylight ring');
  }
  for (const key of boundaryKeys) {
    if (!expectedKeys.has(key)) {
      return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', 'merged boundary is not the daylight ring');
    }
  }
  if (boundaryCycleCount(mergedEdges) !== 1) {
    return designPatchBlock('DESIGN_PATCH_MERGE_FAILED', 'merged boundary is not a single ring');
  }
  return { ok: true, points: canonical.vertices, triangles: canonical.faces };
};

// ---------------------------------------------------------------------------
// 7. Provenance builder
// ---------------------------------------------------------------------------

export interface DesignPatchProvenanceInput {
  groupId: string;
  groupName: string;
  groupRevision: string;
  sourceFeatureLineId: string;
  sourceCourseRefs: string[];
  /** Group default criterion: identifies the termination family + analytic inputs. */
  criterion?: GradingCriterion;
  /** Phase 20H: effective per-member criteria for mixed-analytic detection. */
  memberCriteria?: GradingCriterion[];
  /** Surface-family patches only (legacy files always carry these). */
  targetSurfaceId?: string;
  targetSurfaceRevision?: string;
  accuracy: 'EXACT' | 'CURVE_APPROXIMATED';
  interiorPolicy?: DesignPatchInteriorPolicy;
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

/** Exact informational snapshot; intentionally free of any legal wording. */
export const makeDesignPatchProvenance = (
  input: DesignPatchProvenanceInput,
): WebnetGradingDesignPatchTinProvenance => {
  // Phase 20J: the patch targetKind reflects the EFFECTIVE per-course
  // criteria. Homogeneous groups keep their exact legacy shape;
  // mixed-analytic groups keep `mixed-analytic` + analyticKinds; hybrid
  // (surface+analytic) groups record `hybrid` + canonical
  // terminationKinds with the live target id + rev — never a singular
  // analytic value.
  const effective = (input.memberCriteria?.length ?? 0) > 0
    ? input.memberCriteria!
    : (input.criterion !== undefined ? [input.criterion] : []);
  const defaultCriterion = input.criterion;
  const hybrid = defaultCriterion !== undefined
    && groupTerminationMode(defaultCriterion, effective) === 'hybrid';
  const analyticKinds = canonicalAnalyticKinds(effective);
  const terminationKinds = canonicalTerminationKinds(effective);
  const mixed = !hybrid && analyticKinds.length > 1;
  const kind = effective.length > 0 ? gradingTerminationKind(effective[0]!) : undefined;
  const analytic = mixed || kind === 'distance' || kind === 'elevation' || kind === 'relative-elevation';
  const stored = input.criterion;
  const criterion = stored !== undefined &&
    effective.some((entry) => criteriaEqual(entry, stored))
    ? stored
    : effective[0];
  return {
    kind: 'webnet-grading-design-patch',
    groupId: input.groupId,
    groupName: input.groupName,
    groupRevision: input.groupRevision,
    sourceFeatureLineId: input.sourceFeatureLineId,
    sourceCourseRefs: [...input.sourceCourseRefs],
    // Analytic patches record their own termination family; a dormant target
    // id never leaks into the snapshot (surface keeps legacy bytes).
    // Hybrid patches record `hybrid` + terminationKinds with the live target.
    ...(analytic && !mixed && !hybrid && kind !== undefined ? { targetKind: kind } : {}),
    ...(mixed ? { targetKind: 'mixed-analytic' as const, analyticKinds } : {}),
    ...(hybrid ? { targetKind: 'hybrid' as const, terminationKinds } : {}),
    ...(input.targetSurfaceId != null && (!analytic || hybrid) ? { targetSurfaceId: input.targetSurfaceId } : {}),
    ...(input.targetSurfaceRevision != null && (!analytic || hybrid) ? { targetSurfaceRevision: input.targetSurfaceRevision } : {}),
    ...(criterion?.kind === 'distance' && !mixed && !hybrid ? { criterionDistance: criterion.distance } : {}),
    ...(criterion?.kind === 'elevation' && !mixed && !hybrid ? { targetElevation: criterion.targetElevation } : {}),
    ...(criterion?.kind === 'relative-elevation' && !mixed && !hybrid ? { relativeElevation: criterion.relativeElevation } : {}),
    accuracy: input.accuracy,
    cornerMode: 'miter',
    includesInterior: true,
    interiorPolicy: input.interiorPolicy ?? 'flat-source',
    ...(input.fileName != null ? { fileName: input.fileName } : {}),
    ...(input.surfaceName != null ? { surfaceName: input.surfaceName } : {}),
    ...(input.sourceId != null ? { sourceId: input.sourceId } : {}),
  };
};
