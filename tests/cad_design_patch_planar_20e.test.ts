/**
 * Phase 20E Wave-1B — planar Design Patch oracles.
 *
 * Pins the deterministic source-plane proof (§§57-60), the flat-or-coplanar
 * pad gate and its manifold merge (§61), the curved-flat canonical capture
 * that removes re-linearization drift (§§44/79/80), the curved-flat vs
 * arc-Z-varying split (§81), and the unchanged flat regression (§105:
 * 10000 interior, 19600 merged plan, 140x140 daylight).
 *
 * Plane coefficients are session-only and never persisted; the flat path is
 * asserted byte-identical to the legacy single-Z ear-clip.
 */
import { describe, expect, it } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { normalizeTinProvenance, tinProvenanceRevisionPart } from '../src/engine/cad/cadImportedTin';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import {
  buildPadInterior,
  deriveDesignPatchPlane,
  designPatchPlaneElevation,
  designPatchPlaneSlope,
  makeDesignPatchProvenance,
  mergePadWithGrading,
  resolveDesignPatchInterior,
  resolveDesignPatchRing,
  validateSourceRing,
  verifyRingAgainstMesh,
} from '../src/engine/cad/grading/designPatchBuild';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingMesh } from '../src/engine/cad/grading/gradingTypes';
import { buildGradingTopologyCertificateExact } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { GRADING_TOPOLOGY_POLICY_VERSION } from '../src/engine/cad/grading/gradingTopologyExpectation';
import type { GradingTopologyCertificate } from '../src/engine/cad/grading/gradingTopologyCertificate';

/** gtop2 certification for the hand-built annular shells below. */
const certifyShell = (
  sourceBoundaryPoints: readonly number[],
  gradingBoundaryPoints: readonly number[],
  mesh: GradingMesh,
): GradingTopologyCertificate => {
  const cert = buildGradingTopologyCertificateExact({
    scope: 'group', points: mesh.points, triangles: mesh.triangles,
    expectation: {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION, scope: 'group', shape: 'closed-annulus',
      expectedFaceComponents: 1, expectedBoundaryCycles: 2, positiveWidthRegionCount: 1,
      tiedSplitCoords: [], closed: true, sourceBoundaryKind: 'closed-ring', gradingBoundaryKind: 'closed-ring',
    },
    sourceBoundaryPoints, gradingBoundaryPoints,
  });
  if (!cert) throw new Error('hand-built shell failed gtop2 certification');
  return cert;
};

const planArea = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    sum += Math.abs(
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!),
    ) / 2;
  }
  return sum;
};

const meshVolume = (points: readonly number[], triangles: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i]! * 3;
    const b = triangles[i + 1]! * 3;
    const c = triangles[i + 2]! * 3;
    const area = Math.abs(
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[c]! - points[a]!) * (points[b + 1]! - points[a + 1]!),
    ) / 2;
    sum += area * (points[a + 2]! + points[b + 2]! + points[c + 2]!) / 3;
  }
  return sum;
};

const unitSquareRing = (z: readonly number[]): number[] => [
  0, 0, z[0]!, 100, 0, z[1]!, 100, 100, z[2]!, 0, 100, z[3]!,
];

/**
 * Square shell with the given inner boundary: outer corners scaled 1.4x from
 * the (50,50) centroid at `outerZ`. Two boundary cycles exactly as a real
 * closed-group annulus after the 20C compute.
 */
const squareShell = (inner: readonly number[], outerZ: (_index: number) => number): GradingMesh => {
  const points = [...inner];
  for (let i = 0; i < 4; i += 1) {
    const x = inner[i * 3]!;
    const y = inner[i * 3 + 1]!;
    points.push(50 + 1.4 * (x - 50), 50 + 1.4 * (y - 50), outerZ(i));
  }
  const triangles: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    triangles.push(4 + i, 4 + next, next, 4 + i, next, i);
  }
  return { points, triangles };
};

// ---------------------------------------------------------------------------
// §§57-60 source-plane proof
// ---------------------------------------------------------------------------

describe('(§§57-59) deterministic source-plane proof', () => {
  it('derives the 2% ramp plane, center 11, and the slope metrics', () => {
    const ring = unitSquareRing([10, 12, 12, 10]); // z = 10 + 0.02x
    const plane = deriveDesignPatchPlane(ring);
    if (!plane.ok) throw new Error(`expected plane, got ${plane.code} ${plane.detail}`);
    expect(plane.kind).toBe('planar');
    expect(plane.a).toBeCloseTo(0.02, 12);
    expect(plane.b).toBeCloseTo(0, 12);
    expect(plane.c).toBe(10);
    expect(plane.originX).toBe(0);
    expect(plane.originY).toBe(0);
    expect(designPatchPlaneElevation(plane, 50, 50)).toBeCloseTo(11, 12);
    const slope = designPatchPlaneSlope(plane);
    expect(slope.slopePercent).toBeCloseTo(2, 12);
    expect(slope.slopeRatio).toBeCloseTo(0.02, 12);
  });

  it('is diagonal/rotation invariant for the planar pad volume', () => {
    const ring = unitSquareRing([10, 12, 12, 10]);
    const interior = resolveDesignPatchInterior(ring);
    if (!interior.ok) throw new Error(`expected interior, got ${interior.code}`);
    expect(interior.interiorPolicy).toBe('planar-source');
    expect(interior.padZ).toBeUndefined();
    expect(meshVolume(interior.pad.padPoints, interior.pad.padTriangles)).toBeCloseTo(110000, 9);
    // Same polygon rotated/reversed: ear-clip picks another diagonal, the
    // coplanar volume is identical (analytically 10000 * z(50,50) = 110000).
    const rotated = [100, 0, 12, 100, 100, 12, 0, 100, 10, 0, 0, 10];
    const reversed: number[] = [];
    for (let i = 3; i >= 0; i -= 1) reversed.push(ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!);
    for (const variant of [rotated, reversed]) {
      const out = resolveDesignPatchInterior(variant);
      if (!out.ok) throw new Error(`expected interior, got ${out.code}`);
      expect(meshVolume(out.pad.padPoints, out.pad.padTriangles)).toBeCloseTo(110000, 9);
      expect(planArea(out.pad.padPoints, out.pad.padTriangles)).toBeCloseTo(10000, 9);
    }
  });

  it('blocks a non-coplanar ring with the non-planar code', () => {
    const ring = unitSquareRing([10, 10, 10.1, 10]);
    expect(deriveDesignPatchPlane(ring)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED',
    });
    expect(resolveDesignPatchInterior(ring)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED',
    });
  });

  it('stays well-conditioned at E≈2M / N≈7M via the local frame', () => {
    const ox = 2_000_000;
    const oy = 7_000_000;
    const local = unitSquareRing([10, 12, 12, 10]);
    const far: number[] = [];
    for (let i = 0; i < 4; i += 1) far.push(local[i * 3]! + ox, local[i * 3 + 1]! + oy, local[i * 3 + 2]!);
    const plane = deriveDesignPatchPlane(far);
    if (!plane.ok) throw new Error(`expected plane, got ${plane.code} ${plane.detail}`);
    expect(plane.a).toBeCloseTo(0.02, 9);
    expect(plane.b).toBeCloseTo(0, 9);
    expect(designPatchPlaneElevation(plane, ox + 50, oy + 50)).toBeCloseTo(11, 9);
    const localPad = resolveDesignPatchInterior(local);
    const farPad = resolveDesignPatchInterior(far);
    if (!localPad.ok || !farPad.ok) throw new Error('expected both interiors');
    expect(planArea(farPad.pad.padPoints, farPad.pad.padTriangles)).toBeCloseTo(10000, 6);
    expect(meshVolume(farPad.pad.padPoints, farPad.pad.padTriangles))
      .toBeCloseTo(meshVolume(localPad.pad.padPoints, localPad.pad.padTriangles), 6);
  });
});

// ---------------------------------------------------------------------------
// §61 planar pad build + manifold merge
// ---------------------------------------------------------------------------

describe('(§61) planar pad build and manifold merge', () => {
  const ring = unitSquareRing([10, 12, 12, 10]);
  const shell = squareShell(ring, (i) => ring[i * 3 + 2]! - 5);

  it('interior keeps the ORIGINAL boundary XYZ (no Z overwrite, no Steiner)', () => {
    const interior = resolveDesignPatchInterior(ring);
    if (!interior.ok) throw new Error('expected interior');
    expect(interior.pad.padPoints).toEqual(ring);
    expect(interior.pad.padTriangles).toHaveLength(6);
    for (const index of interior.pad.padTriangles) {
      expect(ring).toContain(interior.pad.padPoints[index * 3 + 2]);
    }
  });

  it('merges to a valid 19600 m² manifold sharing the source seam exactly twice', () => {
    const interior = resolveDesignPatchInterior(ring);
    if (!interior.ok) throw new Error('expected interior');
    expect(validateSourceRing(ring)).toEqual({ ok: true });
    expect(verifyRingAgainstMesh(ring, shell)).toEqual({ ok: true });
    const merged = mergePadWithGrading(interior.pad.padPoints, interior.pad.padTriangles, shell);
    if (!merged.ok) throw new Error(`expected merge, got ${merged.code} ${merged.detail}`);
    expect(planArea(merged.points, merged.triangles)).toBeCloseTo(19600, 6);
    const counts = new Map<string, number>();
    const key = (i: number): string =>
      `${merged.points[i * 3]}|${merged.points[i * 3 + 1]}|${merged.points[i * 3 + 2]}`;
    for (let i = 0; i + 2 < merged.triangles.length; i += 3) {
      for (const [p, q] of [
        [merged.triangles[i]!, merged.triangles[i + 1]!],
        [merged.triangles[i + 1]!, merged.triangles[i + 2]!],
        [merged.triangles[i + 2]!, merged.triangles[i]!],
      ] as Array<[number, number]>) {
        const edge = [key(p), key(q)].sort().join('||');
        counts.set(edge, (counts.get(edge) ?? 0) + 1);
      }
    }
    // Source seam is interior (2 faces); only the outer daylight ring is boundary.
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(2);
    const boundary = [...counts.values()].filter((count) => count === 1).length;
    expect(boundary).toBe(4); // four outer edges of the 4-vertex shell
  });
});

// ---------------------------------------------------------------------------
// §105 flat regression
// ---------------------------------------------------------------------------

describe('(§105) flat patch regression', () => {
  const flat = unitSquareRing([10, 10, 10, 10]);

  it('keeps the flat pad byte-identical to the legacy single-Z ear-clip', () => {
    const interior = resolveDesignPatchInterior(flat);
    if (!interior.ok) throw new Error('expected interior');
    expect(interior.kind).toBe('flat');
    expect(interior.interiorPolicy).toBe('flat-source');
    expect(interior.padZ).toBe(10);
    const legacy = buildPadInterior(flat, 10);
    if (!legacy.ok) throw new Error('expected legacy pad');
    expect(interior.pad).toEqual(legacy);
  });

  it('merges 10000 interior + 9600 shell = 19600 with the 140x140 daylight ring', () => {
    const interior = resolveDesignPatchInterior(flat);
    if (!interior.ok) throw new Error('expected interior');
    const shell = squareShell(flat, () => 0);
    expect(planArea(shell.points, shell.triangles)).toBeCloseTo(9600, 9);
    const merged = mergePadWithGrading(interior.pad.padPoints, interior.pad.padTriangles, shell);
    if (!merged.ok) throw new Error(`expected merge, got ${merged.code}`);
    expect(planArea(merged.points, merged.triangles)).toBeCloseTo(19600, 6);
    expect(meshVolume(interior.pad.padPoints, interior.pad.padTriangles)).toBeCloseTo(100000, 9);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < merged.points.length; i += 3) {
      xs.push(merged.points[i]!);
      ys.push(merged.points[i + 1]!);
    }
    expect(Math.min(...xs)).toBe(-20);
    expect(Math.max(...xs)).toBe(120);
    expect(Math.min(...ys)).toBe(-20);
    expect(Math.max(...ys)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// §§44/79/80 curved-flat canonical capture + §81 arc-Z-varying block
//
// The 20C corner solver does not currently produce a simple, computable
// curved closed loop (every convex/tangent curved variant fails its sector
// or tie gates), so these oracles pin the capture CONTRACT: a canonical
// curved source ring is the boundary authority verbatim (closing vertex
// normalized), a re-derived/drifted ring is not silently substituted, and
// the full DESIGNPATCH command consumes the capture and builds the patch.
// ---------------------------------------------------------------------------

/** Canonical curved ring: `count`-gon at `radius`, Z from `z(i,x,y)`. */
const curvedRing = (
  count: number,
  radius: number,
  cx: number,
  cy: number,
  z: (_index: number, _x: number, _y: number) => number,
): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    out.push(x, y, z(i, x, y));
  }
  return out;
};

/** Shell with `ring` as the exact inner boundary; outer scaled from centroid. */
const ringShell = (ring: readonly number[], scale: number, outerZ: number): GradingMesh => {
  const n = ring.length / 3;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    cx += ring[i * 3]!;
    cy += ring[i * 3 + 1]!;
  }
  cx /= n;
  cy /= n;
  const points = [...ring];
  for (let i = 0; i < n; i += 1) {
    points.push(
      cx + scale * (ring[i * 3]! - cx),
      cy + scale * (ring[i * 3 + 1]! - cy),
      outerZ,
    );
  }
  const triangles: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    triangles.push(n + i, n + next, next, n + i, next, i);
  }
  return { points, triangles };
};

interface CurvedWorld {
  project: CadProject;
  entity: CadFeatureLineEntity;
  groupId: string;
  revision: string;
}

/** Real closed group on a curved (arc) feature line, for revision resolution. */
const curvedWorld = (): CurvedWorld => {
  const entity: CadFeatureLineEntity = {
    id: 'fl-20e-curved',
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Curved',
    closed: true,
    vertices: [
      { id: 'A', x: 0, y: 0, z: 10 },
      { id: 'B', x: 100, y: 0, z: 10 },
      { id: 'C', x: 100, y: 60, z: 10 },
      { id: 'D', x: 0, y: 60, z: 10 },
    ],
    segmentGeometry: [
      { kind: 'line' },
      { kind: 'arc', bulge: 0.5 },
      { kind: 'line' },
      { kind: 'arc', bulge: 0.5 },
    ],
  };
  const drawing = createBlankCadDrawingDocument({ name: '20E Curved', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [entity],
    surfaces: [{
      id: 'tgt-20e',
      name: 'EG',
      layerId: 'general',
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: {
          vertices: [-100, -100, 0, 300, -100, 0, 300, 300, 0, -100, 300, 0],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: {
            kind: 'webnet-bake', sourceSurfaceId: 'seed',
            sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed',
          },
        },
      },
      cachedRevision: null,
    }],
  };
  const ids = entity.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'G Curved',
    sourceFeatureLineId: entity.id,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: 'tgt-20e',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const group = withGroup.gradingGroups![0]!;
  const inputs = resolveGroupInputs(withGroup, group.id);
  if (!inputs) throw new Error('curved group inputs did not resolve');
  return { project: withGroup, entity, groupId: group.id, revision: inputs.revision };
};

describe('(§§44/79/80) curved-flat canonical capture', () => {
  const flatCurved = curvedRing(16, 30, 50, 50, () => 10);

  it('consumes the captured boundary verbatim (closing vertex normalized)', () => {
    const world = curvedWorld();
    const captured = [...flatCurved, flatCurved[0]!, flatCurved[1]!, flatCurved[2]!];
    const resolved = resolveDesignPatchRing(
      world.project.gradingGroups![0]!, world.entity, 0.05, captured,
    );
    if (!resolved.ok) throw new Error(`expected captured ring, got ${resolved.code}`);
    expect(resolved.ring).toEqual(flatCurved);
    expect(validateSourceRing(resolved.ring)).toEqual({ ok: true });
    // No capture -> the legacy re-derivation remains available as fallback.
    const fallback = resolveDesignPatchRing(world.project.gradingGroups![0]!, world.entity, 0.05);
    expect(fallback.ok).toBe(true);
  });

  it('does not silently substitute a drifted re-derivation for the capture', () => {
    const shell = ringShell(flatCurved, 1.4, 5);
    expect(verifyRingAgainstMesh(flatCurved, shell)).toEqual({ ok: true });
    // A sub-micron re-derivation difference is enough for the exact-match
    // verifier to fail.
    const drifted = [...flatCurved];
    drifted[15] = drifted[15]! * (1 + 1e-12);
    expect(verifyRingAgainstMesh(drifted, shell)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_RING_MESH_MISMATCH',
    });
    const resolved = resolveDesignPatchRing(
      curvedWorld().project.gradingGroups![0]!, curvedWorld().entity, 0.05, drifted,
    );
    // The explicit capture IS the authority: the drifted ring is returned and
    // then fail-closed by the integrity check, never replaced by a fallback.
    if (!resolved.ok) throw new Error('expected capture authority');
    expect(resolved.ring).toEqual(drifted);
  });

  it('builds a flat-source patch end-to-end from the capture', () => {
    const world = curvedWorld();
    const shell = ringShell(flatCurved, 1.4, 5);
    const captured = [...flatCurved, flatCurved[0]!, flatCurved[1]!, flatCurved[2]!];
    const result: CadGradingGroupResult = {
      groupId: world.groupId,
      revision: world.revision,
      accuracy: 'CURVE_APPROXIMATED',
      memberCount: 4,
      cornerCount: 4,
      memberRegions: [],
      corners: [],
      daylightPoints: [],
      sourceBoundaryPoints: captured,
      gradingMesh: shell,
      topologyCertificate: certifyShell(captured, [], shell),
      sourceLength: 0,
      gradingPlanArea: 0,
      grading3dArea: 0,
      minProjectionDistance: 0,
      maxProjectionDistance: 0,
      meanProjectionDistance: 0,
      cutSourceLength: 0,
      fillSourceLength: 0,
      tiedSourceLength: 0,
      candidateTriangleCount: 0,
      intersectionSegmentCount: 0,
      multipleSolutionCount: 0,
      diagnostics: [],
    };
    const resolved = resolveDesignPatch(world.project, world.groupId, result, world.revision, true);
    if (!resolved.ok) throw new Error(`expected patch, got ${resolved.code} ${resolved.detail}`);
    expect(resolved.value.provenance.interiorPolicy).toBe('flat-source');
    expect(resolved.value.provenance.accuracy).toBe('CURVE_APPROXIMATED');
    expect(resolved.value.padZ).toBe(10);
    expect(resolved.value.ring).toEqual(flatCurved);
    expect(planArea(resolved.value.points, resolved.value.triangles)).toBeGreaterThan(0);
  });
});

describe('(§§57/61) planar DESIGNPATCH end-to-end + provenance', () => {
  const tilted = unitSquareRing([10, 12, 12, 10]);
  const tiltedShell = squareShell(tilted, (index) => {
    const outerX = 50 + 1.4 * (tilted[index * 3]! - 50);
    return 10 + 0.02 * outerX - 5;
  });

  it('builds a planar-source patch and never persists plane coefficients', () => {
    const world = curvedWorld();
    const captured = [...tilted, tilted[0]!, tilted[1]!, tilted[2]!];
    const result: CadGradingGroupResult = {
      groupId: world.groupId,
      revision: world.revision,
      accuracy: 'EXACT',
      memberCount: 4,
      cornerCount: 4,
      memberRegions: [],
      corners: [],
      daylightPoints: [],
      sourceBoundaryPoints: captured,
      gradingMesh: tiltedShell,
      topologyCertificate: certifyShell(captured, [], tiltedShell),
      sourceLength: 0,
      gradingPlanArea: 0,
      grading3dArea: 0,
      minProjectionDistance: 0,
      maxProjectionDistance: 0,
      meanProjectionDistance: 0,
      cutSourceLength: 0,
      fillSourceLength: 0,
      tiedSourceLength: 0,
      candidateTriangleCount: 0,
      intersectionSegmentCount: 0,
      multipleSolutionCount: 0,
      diagnostics: [],
    };
    const resolved = resolveDesignPatch(world.project, world.groupId, result, world.revision, true);
    if (!resolved.ok) throw new Error(`expected planar patch, got ${resolved.code} ${resolved.detail}`);
    expect(resolved.value.provenance.interiorPolicy).toBe('planar-source');
    expect(resolved.value.padZ).toBeNull();
    expect(resolved.value.ring).toEqual(tilted);
    // No plane coefficients anywhere in the persisted provenance.
    expect(JSON.stringify(resolved.value.provenance)).not.toMatch(/slope|"a"|"b"|"c"/i);
  });

  it('round-trips both policies and gives them distinct revisions', () => {
    const base = {
      kind: 'webnet-grading-design-patch' as const,
      groupId: 'g', groupName: 'G', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['A>B'],
      targetSurfaceId: 't', targetSurfaceRevision: 'srev1:y',
      accuracy: 'EXACT' as const, cornerMode: 'miter' as const,
      includesInterior: true as const,
    };
    const flat = makeDesignPatchProvenance({ ...base, interiorPolicy: 'flat-source' });
    const planar = makeDesignPatchProvenance({ ...base, interiorPolicy: 'planar-source' });
    const normFlat = normalizeTinProvenance(flat);
    const normPlanar = normalizeTinProvenance(planar);
    if (normFlat.kind !== 'webnet-grading-design-patch' || normPlanar.kind !== 'webnet-grading-design-patch') {
      throw new Error('expected design-patch kind');
    }
    expect(normFlat.interiorPolicy).toBe('flat-source');
    expect(normPlanar.interiorPolicy).toBe('planar-source');
    expect(tinProvenanceRevisionPart(planar)).not.toBe(tinProvenanceRevisionPart(flat));
    // Legacy/unknown policies read back as flat-source (read-tolerant).
    const legacy = normalizeTinProvenance({ ...planar, interiorPolicy: 'legacy' as never });
    if (legacy.kind !== 'webnet-grading-design-patch') throw new Error('expected design-patch kind');
    expect(legacy.interiorPolicy).toBe('flat-source');
  });
});

describe('(§81) curved-flat planar vs arc-Z-varying block', () => {
  it('accepts a curved flat ring but blocks a curved ring that leaves the plane', () => {
    const flat = curvedRing(16, 30, 50, 50, () => 10);
    const flatInterior = resolveDesignPatchInterior(flat);
    if (!flatInterior.ok) throw new Error(`expected curved-flat interior, got ${flatInterior.code}`);
    expect(flatInterior.interiorPolicy).toBe('flat-source');

    // Z linear in the sample index rides a helix: no plane contains the ring.
    const helical = curvedRing(16, 30, 50, 50, (index) => 10 + 0.05 * index);
    expect(deriveDesignPatchPlane(helical)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED',
    });
    expect(resolveDesignPatchInterior(helical)).toMatchObject({
      ok: false, code: 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED',
    });
  });
});
