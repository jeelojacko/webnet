/**
 * Phase 20E Wave-2B — planar pad integration oracles (§§62-66).
 *
 * The 20C corner solver cannot close a genuinely tilted closed loop
 * (`CORNER_NO_SOLUTION`, pinned in 20D), so a planar pad is exercised the way
 * the engine actually produces one: a CURRENT group result carrying the
 * captured planar source boundary (`sourceBoundaryPoints`) plus a matching
 * grading shell.  The Design Patch build then proves `planar-source` and the
 * ordinary 18I volume path consumes it.
 *
 * §62 hand derivation (independently derivable geometry)
 * ------------------------------------------------------
 * Pad footprint is exactly `0..100` in x and y.  The pad surface is the plane
 * `z(x,y) = 10 + 0.02·x`; the Existing Ground is the exact plane `z = 0` over
 * the same footprint.  Because the whole footprint lies inside one plane and
 * the EG plane is flat, the fill volume is the double integral
 *
 *   ∫₀¹⁰⁰ ∫₀¹⁰⁰ (10 + 0.02·x) dy dx
 *     = 100 · [10·x + 0.01·x²]₀¹⁰⁰
 *     = 100 · (1000 + 100)
 *     = 110 000 m³          (cut = 0, net = fill)
 *
 * The Design Patch is `100×100` pad interior (10 000 m²) merged with a
 * `1.4×` daylight shell (9 600 m²), so the merged plan area is 19 600 m² while
 * the volume over the pad footprint alone remains exactly 110 000 m³.
 *
 * §§63-66 then read the same plane back through the ordinary inquiry, 18U
 * slope/aspect, 18J profile, and 18K section seams: every one must reproduce
 * the analytic plane (not a tolerance-close approximation of it).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { runCadCommand, createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import {
  DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED,
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { buildGradingTopologyCertificateExact } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  deriveDesignPatchPlane,
  designPatchPlaneElevation,
  designPatchPlaneSlope,
  resolveDesignPatchInterior,
} from '../src/engine/cad/grading/designPatchBuild';
import { extractSurfaceProfile, type ProfileExtractionMesh } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingMesh } from '../src/engine/cad/grading/gradingTypes';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

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

/** Analytic pad ring: `z = 10 + 0.02x`, closed 100×100 footprint. */
const planarRing = (): number[] => [0, 0, 10, 100, 0, 12, 100, 100, 12, 0, 100, 10];

/** Daylight shell: inner boundary = the exact ring, outer 1.4× at z = 0. */
const planarShell = (): GradingMesh => {
  const ring = planarRing();
  const points = [...ring];
  for (let i = 0; i < 4; i += 1) {
    const x = ring[i * 3]!;
    const y = ring[i * 3 + 1]!;
    points.push(50 + 1.4 * (x - 50), 50 + 1.4 * (y - 50), 0);
  }
  const triangles: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    triangles.push(4 + i, 4 + next, next, 4 + i, next, i);
  }
  return { points, triangles };
};

/** Flat EG quad over exactly the pad footprint at z = 0 (2 triangles). */
const flatFootprint = (): { points: number[]; triangles: number[] } => ({
  points: [0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0],
  triangles: [0, 1, 2, 0, 2, 3],
});

const gridTin = (minX: number, minY: number, maxX: number, maxY: number, step = 20): ImportedTinPayload => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = minX; x <= maxX + 1e-9; x += step) xs.push(x);
  for (let y = minY; y <= maxY + 1e-9; y += step) ys.push(y);
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return {
    vertices,
    faces,
    provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
};

const makeSurface = (id: string, name: string, payload: ImportedTinPayload): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId: 'style-base',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: payload,
  },
  cachedRevision: null,
});

interface PlanarWorld {
  project: CadProject;
  entity: CadFeatureLineEntity;
  groupId: string;
  revision: string;
  targetId: string;
}

/** Real closed tilted-FL group (resolution only; the compute is forged). */
const planarWorld = (): PlanarWorld => {
  const entity: CadFeatureLineEntity = {
    id: 'fl-20e-planar',
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'FL Planar',
    closed: true,
    vertices: [
      { id: 'A', x: 0, y: 0, z: 10 },
      { id: 'B', x: 100, y: 0, z: 12 },
      { id: 'C', x: 100, y: 100, z: 12 },
      { id: 'D', x: 0, y: 100, z: 10 },
    ],
  };
  const drawing = createBlankCadDrawingDocument({ name: '20E Planar', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [entity],
    surfaces: [makeSurface('tgt-20e-planar', 'EG', gridTin(-60, -60, 160, 160))],
  };
  const ids = entity.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'Pad',
    sourceFeatureLineId: entity.id,
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % ids.length]! })),
    targetSurfaceId: 'tgt-20e-planar',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId);
  if (!inputs) throw new Error('planar group inputs did not resolve');
  return { project: withGroup, entity, groupId, revision: inputs.revision, targetId: 'tgt-20e-planar' };
};

/** CURRENT result carrying the captured planar boundary + matching shell. */
const planarResult = (world: PlanarWorld): CadGradingGroupResult => {
  const ring = planarRing();
  const sourceBoundaryPoints = [...ring, ring[0]!, ring[1]!, ring[2]!];
  const gradingMesh = planarShell();
  const topologyCertificate = buildGradingTopologyCertificateExact({
    scope: 'group', points: gradingMesh.points, triangles: gradingMesh.triangles,
    expectation: deriveGradingTopologyExpectation({ scope: 'group', closed: true, positiveWidthRegions: 1 }),
    sourceBoundaryPoints, gradingBoundaryPoints: [],
  });
  if (!topologyCertificate) throw new Error('planar shell failed gtop2 certification');
  return {
    groupId: world.groupId,
    revision: world.revision,
    accuracy: 'EXACT',
    memberCount: 4,
    cornerCount: 4,
    memberRegions: [],
    corners: [],
    daylightPoints: [],
    sourceBoundaryPoints,
    gradingMesh,
    topologyCertificate,
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
};

const padExtractionMesh = (ring: readonly number[]): ProfileExtractionMesh => {
  const interior = resolveDesignPatchInterior(ring);
  if (!interior.ok) throw new Error(`pad interior failed: ${interior.code}`);
  const points: Array<{ entityId: string; x: number; y: number; z: number }> = [];
  for (let i = 0; i < interior.pad.padPoints.length; i += 3) {
    points.push({
      entityId: 'pad',
      x: interior.pad.padPoints[i]!,
      y: interior.pad.padPoints[i + 1]!,
      z: interior.pad.padPoints[i + 2]!,
    });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < interior.pad.padTriangles.length; i += 3) {
    triangles.push([
      interior.pad.padTriangles[i]!,
      interior.pad.padTriangles[i + 1]!,
      interior.pad.padTriangles[i + 2]!,
    ]);
  }
  return { points, triangles, grid: buildSurfaceGrid(points, triangles) };
};

// ---------------------------------------------------------------------------
// §62 planar volume oracle
// ---------------------------------------------------------------------------

describe('(§62) planar pad volume oracle', () => {
  const ring = planarRing();

  it('derives the analytic plane and the exact 110000 m³ pad interior', () => {
    const plane = deriveDesignPatchPlane(ring);
    if (!plane.ok) throw new Error(`expected plane, got ${plane.code} ${plane.detail}`);
    expect(plane.kind).toBe('planar');
    expect(plane.a).toBeCloseTo(0.02, 12);
    expect(plane.b).toBeCloseTo(0, 12);
    expect(plane.c).toBe(10);

    const interior = resolveDesignPatchInterior(ring);
    if (!interior.ok) throw new Error(`expected interior, got ${interior.code}`);
    expect(interior.interiorPolicy).toBe('planar-source');
    expect(interior.padZ).toBeUndefined();
    // The hand-derived integral: 110 000 m³ over the 10 000 m² footprint.
    expect(planArea(interior.pad.padPoints, interior.pad.padTriangles)).toBeCloseTo(10000, 9);
    expect(meshVolume(interior.pad.padPoints, interior.pad.padTriangles)).toBeCloseTo(110000, 9);
  });

  it('ordinary 18I volume of the baked Design Patch is exactly 110000 fill', () => {
    const world = planarWorld();
    const patch = runCadCommand(createCadHistoryState(world.project), {
      key: 'DESIGNPATCH',
      groupId: world.groupId,
      result: planarResult(world),
      expectedRevision: world.revision,
      sessionCurrent: true,
    }).present.project;
    const patchSurface = patch.surfaces!.find((entry) => entry.purpose === 'design-patch')!;
    expect(patchSurface).toBeDefined();
    expect(patchSurface.definition.importedTin!.provenance).toMatchObject({
      kind: 'webnet-grading-design-patch',
      interiorPolicy: 'planar-source',
    });

    const built = buildCadSurface(patch, patchSurface);
    if (built.outcome !== 'ok') throw new Error(`patch build failed: ${built.outcome}`);
    const designMesh = {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    };
    // Merged plan area is the 10000 pad + 9600 daylight shell.
    expect(planArea(designMesh.points, designMesh.triangles)).toBeCloseTo(19600, 6);

    const quantities = computeVolumeQuantities(
      flatFootprint(),
      designMesh,
      { includeDisplay: false },
    ).quantities;
    expect(quantities.fillVolume).toBeCloseTo(110000, 6);
    expect(quantities.cutVolume).toBe(0);
    expect(quantities.netVolume).toBe(quantities.fillVolume);
    expect(quantities.overlapArea).toBeCloseTo(10000, 6);
  });

  it('resolves the same pad through the pure DESIGNPATCH seam', () => {
    const world = planarWorld();
    const resolved = resolveDesignPatch(world.project, world.groupId, planarResult(world), world.revision, true);
    if (!resolved.ok) throw new Error(`expected patch, got ${resolved.code} ${resolved.detail}`);
    expect(resolved.value.padZ).toBeNull();
    expect(resolved.value.ring).toEqual(ring);
    expect(resolved.value.provenance.interiorPolicy).toBe('planar-source');
    expect(planArea(resolved.value.points, resolved.value.triangles)).toBeCloseTo(19600, 6);
  });

  it('blocks a genuinely non-planar ring before any mesh read', () => {
    const world = planarWorld();
    const nonPlanar: CadGradingGroupResult = {
      ...planarResult(world),
      sourceBoundaryPoints: [0, 0, 10, 100, 0, 12, 100, 100, 10.1, 0, 100, 10, 0, 0, 10],
    };
    expect(resolveDesignPatch(world.project, world.groupId, nonPlanar, world.revision, true))
      .toMatchObject({ ok: false, code: DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED });
  });
});

// ---------------------------------------------------------------------------
// §63 interior inquiry — exact plane elevations
// ---------------------------------------------------------------------------

describe('(§63) interior inquiry returns exact-plane elevations', () => {
  it('samples every interior point on z = 10 + 0.02x', () => {
    const world = planarWorld();
    const plane = deriveDesignPatchPlane(planarRing());
    if (!plane.ok) throw new Error('expected plane');
    // The full baked patch (pad interior + daylight shell) is the design
    // surface the operator inquires against.
    const patched = runCadCommand(createCadHistoryState(world.project), {
      key: 'DESIGNPATCH',
      groupId: world.groupId,
      result: planarResult(world),
      expectedRevision: world.revision,
      sessionCurrent: true,
    }).present.project;
    const patchSurface = patched.surfaces!.find((entry) => entry.purpose === 'design-patch')!;
    const built = buildCadSurface(patched, patchSurface);
    if (built.outcome !== 'ok') throw new Error('surface build failed');
    for (const [x, y] of [[0, 0], [50, 50], [100, 100], [25, 75], [100, 0], [10, 90]] as const) {
      expect(getSurfaceElevationAt(built, x, y)).toBeCloseTo(10 + 0.02 * x, 9);
      expect(designPatchPlaneElevation(plane, x, y)).toBeCloseTo(10 + 0.02 * x, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// §64 18U constant slope / aspect
// ---------------------------------------------------------------------------

describe('(§64) 18U slope and aspect of the planar pad', () => {
  it('is a constant 2% plane with a 270° (west) downslope', () => {
    const plane = deriveDesignPatchPlane(planarRing());
    if (!plane.ok) throw new Error('expected plane');
    const slope = designPatchPlaneSlope(plane);
    expect(slope.slopeRatio).toBeCloseTo(0.02, 12);
    expect(slope.slopePercent).toBeCloseTo(2, 12);
    expect(slope.slopeAngleDeg).toBeCloseTo(Math.atan(0.02) * 180 / Math.PI, 9);
    // Gradient +x (rises east) => downslope points west = 270° survey azimuth.
    expect(slope.downslopeAspectDeg).toBeCloseTo(270, 9);
  });

  it('is identical at every interior point (constant gradient, no face break)', () => {
    const mesh = padExtractionMesh(planarRing());
    const gradientSigns = new Set<string>();
    for (const tri of mesh.triangles) {
      const [a, b, c] = tri.map((index) => mesh.points[index]!) as [
        { x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number },
      ];
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const vz = c.z - a.z;
      const nz = ux * vy - uy * vx;
      const ga = -(uy * vz - uz * vy) / nz;
      const gb = -(uz * vx - ux * vz) / nz;
      gradientSigns.add(`${ga.toFixed(9)}|${gb.toFixed(9)}`);
    }
    expect([...gradientSigns]).toEqual(['0.020000000|0.000000000']);
  });
});

// ---------------------------------------------------------------------------
// §65 18J profile — linear trend
// ---------------------------------------------------------------------------

describe('(§65) 18J profile across the pad is a linear trend', () => {
  it('elevation(s) = 10 + 0.02·s along y = 50', () => {
    const result = extractSurfaceProfile({
      profileId: 'p-20e',
      revision: 'prev1:20e',
      alignmentElements: [{ kind: 'line', start: { x: 0, y: 50 }, end: { x: 100, y: 50 } }],
      startStation: 0,
      mesh: padExtractionMesh(planarRing()),
    });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    const samples = result.segments[0]!.samples;
    expect(samples.length).toBeGreaterThan(1);
    let previous: number | null = null;
    for (const sample of samples) {
      expect(sample.elevation).toBeCloseTo(10 + 0.02 * sample.rawChainage, 9);
      if (previous != null) {
        // Linear trend: second differences vanish.
        const last = samples[samples.indexOf(sample) - 1]!;
        const slope = (sample.elevation - last.elevation) / (sample.rawChainage - last.rawChainage);
        expect(slope).toBeCloseTo(0.02, 9);
      }
      previous = sample.elevation;
    }
    expect(result.minElevation).toBeCloseTo(10, 9);
    expect(result.maxElevation).toBeCloseTo(12, 9);
  });
});

// ---------------------------------------------------------------------------
// §66 18K section — linear trace
// ---------------------------------------------------------------------------

describe('(§66) 18K section across the pad is a constant trace', () => {
  it('a section at x = 50 holds z = 11 across the full width', () => {
    const extracted = extractSampleLine({
      mesh: padExtractionMesh(planarRing()),
      center: { x: 50, y: 50 },
      direction: { x: 0, y: 1 },
      leftWidth: 50,
      rightWidth: 50,
      rawStation: 50,
      lineId: 'sec-20e',
    });
    if (!extracted.ok) throw new Error(`expected section, got ${extracted.code}`);
    const section = extracted.section;
    expect(section.diagnostics).toHaveLength(0);
    const samples = section.segments.flatMap((segment) => segment.samples);
    expect(samples.length).toBeGreaterThan(1);
    for (const sample of samples) {
      expect(sample.x).toBeCloseTo(50, 9);
      expect(sample.elevation).toBeCloseTo(11, 9);
    }
    expect(section.minElevation).toBeCloseTo(11, 9);
    expect(section.maxElevation).toBeCloseTo(11, 9);
  });
});
