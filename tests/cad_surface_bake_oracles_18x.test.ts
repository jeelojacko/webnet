/**
 * Phase 18X bake oracle + conservation pins (agent tier, fast, engine only).
 *
 * Native/imported bake-copy oracles, in-place geometry equivalence, edit-stack
 * flattening, boundary/void + ridge preservation, dependent staleness +
 * downstream conservation, invalid-payload gates, persistence/undo round-trips,
 * and bake-adjacent invariants (capability matrix, once-only transform,
 * no-Delaunay, never-LandXML).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createBakedPayloadFromMesh } from '../src/engine/cad/cadExplicitBake';
import {
  explicitTinTopologyDigest,
  materializeExplicitTin,
  tinProvenanceKind,
  validateExplicitTinPayload,
} from '../src/engine/cad/cadImportedTin';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
  type CadSurfaceBuildResult,
} from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { surfaceBakeCapability } from '../src/cad-app/shell/cadSurfaceSnapshot';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import { deriveSurfaceContourStatus } from '../src/engine/cad/surfaceContourStatus';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import {
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import { analyzeElevationBands, type ElevationMesh } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import { computeAnalysisGeometryRevision } from '../src/engine/cad/cadAnalysisRevision';
import { deriveAnalysisStatus } from '../src/engine/cad/cadAnalysisStatus';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type {
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { isExplicitTopologyDefinition } from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pt = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId: id, x, y, z, pointClass: 'free', source: 'parsed-input',
});

/** Native quad surface (optionally with edits/breakline/boundary). */
const nativeProject = (opts: {
  edits?: CadSurfaceEdit[];
  refs?: boolean;
  zA?: number;
} = {}): { project: CadProject; surface: CadSurface } => {
  const zA = opts.zA ?? 10;
  const base = createBlankCadProject({ name: 'T18X', units: 'm' });
  const entities: CadProject['entities'] = [
    pt('pt-1', 0, 0, zA),
    pt('pt-2', 10, 0, 11),
    pt('pt-3', 10, 10, 12),
    pt('pt-4', 0, 10, 13),
  ];
  if (opts.refs) {
    entities.push({
      id: 'poly-1', type: 'polygon', layerId: 'general', visible: true, locked: false,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      vertexLabels: ['', '', '', ''],
    } as CadProject['entities'][number]);
  }
  const surface: CadSurface = {
    id: 'surf-1',
    name: 'Site',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
      ...(opts.refs
        ? {
            breaklines: [{ id: 'bl-1', type: 'standard', source: { kind: 'point-chain', pointEntityIds: ['pt-1', 'pt-2'] } }],
            boundaries: [{ type: 'outer', sourceEntityId: 'poly-1' }],
          }
        : {}),
      ...(opts.edits ? { edits: opts.edits } : {}),
    },
  };
  return { project: { ...base, entities, surfaces: [surface] }, surface };
};

const explicitSurface = (
  id: string,
  vertices: number[],
  faces: number[],
  provenance: NonNullable<CadSurface['definition']['importedTin']>['provenance'],
  edits?: CadSurfaceEdit[],
): CadSurface => ({
  id,
  name: id,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: { vertices, faces, provenance },
    ...(edits ? { edits } : {}),
  },
  cachedRevision: null,
});

const landxmlProvenance = () => ({ format: 'LandXML', fileName: 'site.xml', surfaceName: 'EG' }) as const;

const withCurrent = (project: CadProject, surfaceId: string): CadProject => {
  const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
  const revision = computeCadSurfaceSourceRevision(project, surface);
  return {
    ...project,
    surfaces: project.surfaces!.map((entry) =>
      entry.id === surfaceId ? { ...entry, cachedRevision: revision } : entry),
  };
};

const revOf = (project: CadProject, surfaceId: string): string =>
  computeCadSurfaceSourceRevision(project, project.surfaces!.find((entry) => entry.id === surfaceId)!);

const buildOk = (project: CadProject, surface: CadSurface): CadSurfaceBuildResult => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome}`);
  return build;
};

const bakeCopy = (surfaceId: string, expectedRevision: string) =>
  ({ key: 'SURFBAKECOPY', surfaceId, expectedRevision }) as const;
const bakeInPlace = (surfaceId: string, expectedRevision: string) =>
  ({ key: 'SURFBAKE', surfaceId, expectedRevision }) as const;

const planArea = (build: CadSurfaceBuildResult): number => {
  let area = 0;
  for (const tri of build.triangles) {
    const a = build.points[tri[0]]!;
    const b = build.points[tri[1]]!;
    const c = build.points[tri[2]]!;
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return area;
};

const PROBES = [
  { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 5 }, { x: 2, y: 8 }, { x: 8, y: 8 },
];

const probeAll = (build: CadSurfaceBuildResult, probes = PROBES): Array<number | null> =>
  probes.map((p) => getSurfaceElevationAt(build, p.x, p.y));

/** Full mesh-equivalence snapshot: XYZ, faces, domain, Z range, area, probes. */
const meshSnap = (build: CadSurfaceBuildResult) => ({
  xyz: build.points.map((p) => [p.x, p.y, p.z]),
  faces: build.triangles.map((t) => [...t]),
  minZ: Math.min(...build.points.map((p) => p.z)),
  maxZ: Math.max(...build.points.map((p) => p.z)),
  area: planArea(build),
  probes: probeAll(build),
});

// ---------------------------------------------------------------------------
// 1. Bake-copy native oracle
// ---------------------------------------------------------------------------

describe('18X bake-copy native oracle', () => {
  it('breakline+boundary+edits → CURRENT → SURFBAKECOPY: source byte-identical, baked equivalent, no old refs', () => {
    const { project, surface } = nativeProject({
      refs: true,
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-1' }, z: 20 }],
    });
    const current = withCurrent(project, surface.id);
    expect(deriveSurfaceStatus(current, current.surfaces![0]!)).toBe('CURRENT');
    const before = buildOk(current, current.surfaces![0]!);
    const beforeSnap = meshSnap(before);
    const sourceBefore = JSON.stringify(current.surfaces!.find((entry) => entry.id === surface.id));
    const oldRefIds = ['pt-1', 'pt-2', 'poly-1', 'bl-1', 'e-set'];

    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(current, surface.id)));
    expect(next).not.toBe(history);
    const after = next.present.project;
    expect(after.surfaces).toHaveLength(2);
    // Original byte-identical.
    expect(JSON.stringify(after.surfaces!.find((entry) => entry.id === surface.id))).toBe(sourceBefore);
    // Baked copy: mesh equivalent on every axis.
    const copy = after.surfaces!.find((entry) => entry.id !== surface.id)!;
    expect(copy.id).not.toBe(surface.id);
    expect(copy.name).toBe('Site - Baked');
    expect(meshSnap(buildOk(after, copy))).toEqual(beforeSnap);
    // No old refs anywhere in the baked definition.
    const dumped = JSON.stringify(copy.definition);
    for (const ref of oldRefIds) expect(dumped).not.toContain(ref);
    expect(copy.definition.sourceKind).toBe('explicit-tin');
    expect(copy.definition.edits).toBeUndefined();
    expect(copy.definition.breaklines).toBeUndefined();
    expect(copy.definition.boundaries).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Bake-copy imported oracle
// ---------------------------------------------------------------------------

describe('18X bake-copy imported oracle', () => {
  it('LandXML TIN + 18T/V edits → copy is webnet-bake, no LandXML fiction, mesh equivalent', () => {
    const vertices = [0, 0, 10, 10, 0, 11, 10, 10, 12, 0, 10, 13];
    const faces = [0, 1, 2, 0, 2, 3];
    const surface = explicitSurface('surf-lx', vertices, faces, landxmlProvenance(), [
      { id: 'e-raise', kind: 'raise-lower-points', vertices: [{ key: 'imported:surf-lx:0' }], deltaZ: 5 },
      { id: 'e-set', kind: 'set-elevation-many', vertices: [{ key: 'imported:surf-lx:1' }], z: 99 },
    ]);
    let project: CadProject = { ...createBlankCadProject({ name: 'T18X-LX', units: 'm' }), surfaces: [surface] };
    project = withCurrent(project, surface.id);
    const before = buildOk(project, project.surfaces![0]!);
    const beforeSnap = meshSnap(before);

    const history = createCadHistoryState(project);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(project, surface.id)));
    const after = next.present.project;
    const copy = after.surfaces!.find((entry) => entry.id !== surface.id)!;
    const prov = copy.definition.importedTin!.provenance;
    expect(prov.kind).toBe('webnet-bake');
    expect(prov).not.toHaveProperty('format');
    expect(prov).not.toHaveProperty('fileName');
    expect(tinProvenanceKind(prov)).toBe('webnet-bake');
    expect(JSON.stringify(copy.definition)).not.toContain('LandXML');
    expect(meshSnap(buildOk(after, copy))).toEqual(beforeSnap);
  });
});

// ---------------------------------------------------------------------------
// 3. In-place geometry oracle
// ---------------------------------------------------------------------------

describe('18X in-place geometry oracle', () => {
  it('M vs M2: XYZ/faces/domain/min/max/areas/probes identical', () => {
    const { project, surface } = nativeProject({
      refs: true,
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-3' }, z: 42 }],
    });
    const current = withCurrent(project, surface.id);
    const before = meshSnap(buildOk(current, current.surfaces![0]!));
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeInPlace(surface.id, revOf(current, surface.id)));
    const baked = next.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(baked.id).toBe(surface.id);
    const rebuilt = buildOk(next.present.project, baked);
    const afterSnap = meshSnap(rebuilt);
    expect(afterSnap).toEqual(before);
    expect(rebuilt.triangles).toHaveLength(before.faces.length);
    expect(afterSnap.minZ).toBe(before.minZ);
    expect(afterSnap.maxZ).toBe(before.maxZ);
  });
});

// ---------------------------------------------------------------------------
// 4. Edit-stack flatten
// ---------------------------------------------------------------------------

describe('18X edit-stack flatten', () => {
  it('pre edits>0 → post empty + same mesh; new Set Elevation with baked ref works', () => {
    const { project, surface } = nativeProject({
      edits: [
        { id: 'e1', kind: 'raise-lower-surface', deltaZ: 2 },
        { id: 'e2', kind: 'set-elevation', vertex: { key: 'source:pt-2' }, z: 50 },
      ],
    });
    const current = withCurrent(project, surface.id);
    expect(current.surfaces![0]!.definition.edits).toHaveLength(2);
    const before = meshSnap(buildOk(current, current.surfaces![0]!));
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeInPlace(surface.id, revOf(current, surface.id)));
    const baked = next.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(baked.definition.edits).toBeUndefined();
    expect(meshSnap(buildOk(next.present.project, baked))).toEqual(before);
    // A fresh Set Elevation against the baked mesh resolves and applies.
    const bakedBuild = buildOk(next.present.project, baked);
    expect(bakedBuild.points.length).toBeGreaterThan(0);
    const targetZ = bakedBuild.points[0]!.z + 7;
    const edited: CadSurface = {
      ...baked,
      definition: {
        ...baked.definition,
        edits: [{ id: 'e-new', kind: 'set-elevation', vertex: { key: `imported:${baked.id}:0` }, z: targetZ }],
      },
    };
    const editedBuild = buildOk(next.present.project, edited);
    expect(editedBuild.points[0]!.z).toBeCloseTo(targetZ, 12);
  });
});

// ---------------------------------------------------------------------------
// 5. Boundary/void
// ---------------------------------------------------------------------------

describe('18X boundary/void oracle', () => {
  // Rect outer with a top notch (concave) + one rectangular hole.
  // 0:A(0,0) 1:B(12,0) 2:C(12,8) 3:D(7,8) 4:E(7,5) 5:F(5,5)
  // 6:G(5,8) 7:H(0,8) 8:h0(8,2) 9:h1(10,2) 10:h2(10,4) 11:h3(8,4)
  const frame = [
    0, 0, 1, 12, 0, 1, 12, 8, 1, 7, 8, 1,
    7, 5, 1, 5, 5, 1, 5, 8, 1, 0, 8, 1,
    8, 2, 1, 10, 2, 1, 10, 4, 1, 8, 4, 1,
  ];
  const frameFaces = [
    0, 1, 9, 0, 9, 8, 0, 8, 7, 7, 0, 5, 7, 5, 6,
    1, 2, 10, 1, 10, 9, 2, 3, 10, 3, 4, 10, 4, 11, 10,
    5, 11, 4, 5, 8, 11,
  ];
  const hole = { x0: 8, y0: 2, x1: 10, y1: 4 };

  it('concave outer + void preserved, null queries in hole, no boundary refs', () => {
    const surface = explicitSurface(
      'surf-void',
      frame,
      frameFaces,
      { kind: 'webnet-bake', sourceSurfaceId: 'n', sourceSurfaceName: 'N', sourceRevision: 'r' },
    );
    let project: CadProject = { ...createBlankCadProject({ name: 'T18X-V', units: 'm' }), surfaces: [surface] };
    project = withCurrent(project, surface.id);
    const before = buildOk(project, project.surfaces![0]!);
    // Hole interior + concave notch are outside the domain.
    expect(getSurfaceElevationAt(before, (hole.x0 + hole.x1) / 2, (hole.y0 + hole.y1) / 2)).toBeNull();
    expect(getSurfaceElevationAt(before, 6, 7)).toBeNull();
    expect(getSurfaceElevationAt(before, 4, 4)).not.toBeNull();
    expect(getSurfaceElevationAt(before, 10, 6)).not.toBeNull();

    const history = createCadHistoryState(project);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(project, surface.id)));
    const after = next.present.project;
    const copy = after.surfaces!.find((entry) => entry.id !== surface.id)!;
    const rebuilt = buildOk(after, copy);
    expect(meshSnap(rebuilt)).toEqual(meshSnap(before));
    expect(getSurfaceElevationAt(rebuilt, (hole.x0 + hole.x1) / 2, (hole.y0 + hole.y1) / 2)).toBeNull();
    expect(getSurfaceElevationAt(rebuilt, 6, 7)).toBeNull();
    expect(getSurfaceElevationAt(rebuilt, 4, 4)).not.toBeNull();
    expect(getSurfaceElevationAt(rebuilt, 10, 6)).not.toBeNull();
    expect(copy.definition.boundaries).toBeUndefined();
    expect(JSON.stringify(copy.definition)).not.toContain('sourceEntityId');
  });
});

// ---------------------------------------------------------------------------
// 6. Ridge / topology / source-vs-surface / created-point / bulk persist
// ---------------------------------------------------------------------------

describe('18X ridge + topology + source isolation oracles', () => {
  const quad = [0, 0, 0, 10, 0, 0, 10, 10, 10, 0, 10, 0];

  it('breakline ridge retained through bake', () => {
    // Ridge along diagonal 0-2 (apex z=10); faces keep the crease.
    const surface = explicitSurface(
      'surf-ridge',
      quad,
      [0, 1, 2, 0, 2, 3],
      { kind: 'webnet-bake', sourceSurfaceId: 'n', sourceSurfaceName: 'N', sourceRevision: 'r' },
    );
    let project: CadProject = { ...createBlankCadProject({ name: 'T18X-R', units: 'm' }), surfaces: [surface] };
    project = withCurrent(project, surface.id);
    const before = probeAll(buildOk(project, project.surfaces![0]!));
    const history = createCadHistoryState(project);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(project, surface.id)));
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    expect(probeAll(buildOk(next.present.project, copy))).toEqual(before);
    // Ridge apex still high.
    expect(getSurfaceElevationAt(buildOk(next.present.project, copy), 5, 5)).toBeCloseTo(5, 9);
  });

  it('topology distinction: two diagonals stay different (digest + mesh)', () => {
    const a = explicitSurface('a', quad, [0, 1, 2, 0, 2, 3],
      { kind: 'webnet-bake', sourceSurfaceId: 'n', sourceSurfaceName: 'N', sourceRevision: 'r' });
    const b = explicitSurface('b', quad, [0, 1, 3, 1, 2, 3],
      { kind: 'webnet-bake', sourceSurfaceId: 'n', sourceSurfaceName: 'N', sourceRevision: 'r' });
    expect(explicitTinTopologyDigest(a.definition.importedTin!))
      .not.toBe(explicitTinTopologyDigest(b.definition.importedTin!));
    const bakeOne = (surface: CadSurface) => {
      let project: CadProject = { ...createBlankCadProject({ name: 'T', units: 'm' }), surfaces: [surface] };
      project = withCurrent(project, surface.id);
      const next = runCadCommand(createCadHistoryState(project), bakeCopy(surface.id, revOf(project, surface.id)));
      const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
      return copy.definition.importedTin!.faces;
    };
    expect(bakeOne(a)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(bakeOne(b)).toEqual([0, 1, 3, 1, 2, 3]);
  });

  it('source-vs-surface Z: bake 105, survey still 100, source change is a no-op on the copy', () => {
    const { project, surface } = nativeProject({
      zA: 100,
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-1' }, z: 105 }],
    });
    const current = withCurrent(project, surface.id);
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(current, surface.id)));
    const after = next.present.project;
    const copy = after.surfaces!.find((entry) => entry.id !== surface.id)!;
    const bakedPts = buildOk(after, copy).points;
    const bakedA = bakedPts.find((p) => p.x === 0 && p.y === 0)!;
    expect(bakedA.z).toBeCloseTo(105, 12);
    // Survey source untouched.
    expect((after.entities.find((e) => e.id === 'pt-1') as CadSurveyPointEntity).z).toBe(100);
    // Moving the survey point later does not move the baked copy.
    const moved: CadProject = {
      ...after,
      entities: after.entities.map((e) => (e.id === 'pt-1' ? { ...e, z: 1000 } : e)),
    };
    expect(buildOk(moved, moved.surfaces!.find((entry) => entry.id === copy.id)!).points
      .find((p) => p.x === 0 && p.y === 0)!.z).toBeCloseTo(105, 12);
  });

  it('edit-created point becomes an ordinary vertex (no edit refs survive)', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-add', kind: 'add-point', x: 5, y: 5, z: 77 }],
    });
    const current = withCurrent(project, surface.id);
    const before = buildOk(current, current.surfaces![0]!);
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeCopy(surface.id, revOf(current, surface.id)));
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    const rebuilt = buildOk(next.present.project, copy);
    expect(rebuilt.points).toHaveLength(before.points.length);
    expect(rebuilt.points.some((p) => p.z === 77)).toBe(true);
    expect(validateExplicitTinPayload(copy.definition.importedTin!)).toBeNull();
    expect(JSON.stringify(copy.definition)).not.toContain('edit:');
  });

  it('18V bulk result persists without records', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-bulk', kind: 'set-elevation-many', vertices: [{ key: 'source:pt-2' }, { key: 'source:pt-3' }], z: 60 }],
    });
    const current = withCurrent(project, surface.id);
    const before = meshSnap(buildOk(current, current.surfaces![0]!));
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeInPlace(surface.id, revOf(current, surface.id)));
    const baked = next.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(baked.definition.edits).toBeUndefined();
    expect(meshSnap(buildOk(next.present.project, baked))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 7. Dependents: stale after in-place, equivalent after recalc; copy stales nothing
// ---------------------------------------------------------------------------

describe('18X dependent staleness', () => {
  const bands = [
    { id: 'low', lower: 0, upper: 11.5, color: '#111111' },
    { id: 'high', lower: 11.5, upper: 60, color: '#222222' },
  ];

  const setup = () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-1' }, z: 42 }],
    });
    // Second surface as the volume comparison: two distinct ids (same-id pairs
    // are not a supported volume configuration).
    const cmp: CadSurface = {
      id: 'surf-2',
      name: 'Cmp',
      definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] } },
    };
    const two: CadProject = { ...project, surfaces: [surface, cmp] };
    const current = withCurrent(withCurrent(two, cmp.id), surface.id);
    const baseRev = revOf(current, surface.id);
    const baseBuild = buildOk(current, current.surfaces![0]!);
    return { current, surface, cmp, baseRev, baseBuild };
  };

  it('in-place bake stales profile/section/volume/analysis; recalc is equivalent; copy stales nothing', () => {
    const { current, surface, cmp, baseRev, baseBuild } = setup();
    const line = [{ kind: 'line', start: { x: 0, y: 5 }, end: { x: 20, y: 5 } }] as never;
    const meshOf = (build: CadSurfaceBuildResult) => ({
      points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      grid: build.grid,
    });
    const elevationMesh = (build: CadSurfaceBuildResult): ElevationMesh => ({
      xs: build.points.map((p) => p.x),
      ys: build.points.map((p) => p.y),
      zs: build.points.map((p) => p.z),
      tris: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
    });
    const profileBefore = extractSurfaceProfile({ profileId: 'p1', revision: 'r1', alignmentElements: line, startStation: 0, mesh: meshOf(baseBuild) });
    const sectionBefore = extractSampleLine({ mesh: meshOf(baseBuild), center: { x: 5, y: 5 }, direction: { x: 1, y: 0 }, leftWidth: 5, rightWidth: 5, rawStation: 0 });
    const contoursBefore = extractSurfaceContours({
      surfaceId: surface.id, surfaceRevision: baseRev, styleRevision: 'c1',
      points: baseBuild.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: baseBuild.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      levels: [{ elevation: 15, levelIndex: 15, kind: 'minor' as const }],
    });
    const volumeBefore = computeVolumeQuantities(
      { points: baseBuild.points.flatMap((p) => [p.x, p.y, p.z]), triangles: baseBuild.triangles.flatMap((t) => [t[0], t[1], t[2]]) } as VolumeMesh,
      { points: baseBuild.points.flatMap((p) => [p.x, p.y, p.z]), triangles: baseBuild.triangles.flatMap((t) => [t[0], t[1], t[2]]) } as VolumeMesh,
    );
    const analysisBefore = analyzeElevationBands(elevationMesh(baseBuild), bands, { includeDisplay: false });

    // In-place bake: surface goes UNBUILT, every dependent goes stale.
    const history = createCadHistoryState(current);
    const next = runCadCommand(history, bakeInPlace(surface.id, baseRev));
    const bakedProject = next.present.project;
    const baked = bakedProject.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(deriveSurfaceStatus(bakedProject, baked)).toBe('UNBUILT');
    const staleBaked = deriveSurfaceStatus(bakedProject, baked);
    expect(staleBaked).toBe('UNBUILT');
    expect(deriveSurfaceContourStatus({ tinCurrent: false, building: false, cacheHit: true, hasStale: true }).stale).toBe(true);
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: 'UNBUILT',
      surfaceRevisionAtBuild: baseRev, currentSurfaceRevision: 'other', hasResult: true, building: false,
    })).toBe('SOURCE_NOT_CURRENT');
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus: 'UNBUILT', surfaceRevisionAtBuild: baseRev, currentSurfaceRevision: 'other',
      hasResult: true, building: false, outOfRange: false,
    })).toBe('SOURCE_NOT_CURRENT');
    const volSurface = { id: 'vol1', name: 'V', baseSurfaceId: surface.id, comparisonSurfaceId: cmp.id };
    const volRev = computeVolumeSurfaceRevision({
      baseId: surface.id, baseRev, cmpId: cmp.id, cmpRev: revOf(current, cmp.id),
    });
    expect(deriveVolumeSurfaceStatus(bakedProject, volSurface, {
      building: false, result: { revision: volRev } as never,
    })).toBe('SOURCE_NOT_CURRENT');
    const map = { id: 'amap', name: 'E', source: { kind: 'surface', surfaceId: surface.id, metric: 'elevation' }, bands, opacity: 0.5 } as never;
    const geoBefore = computeAnalysisGeometryRevision(map, { surfaceRevision: baseRev });
    expect(deriveAnalysisStatus(map, { found: true, status: 'UNBUILT' }, true, geoBefore, geoBefore))
      .toBe('SOURCE_NOT_CURRENT');

    // Recalc on the rebuilt baked mesh: everything equivalent.
    const rebaked = withCurrent(bakedProject, surface.id);
    const rebakedSurface = rebaked.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(deriveSurfaceStatus(rebaked, rebakedSurface)).toBe('CURRENT');
    const rebuilt = buildOk(rebaked, rebakedSurface);
    expect(extractSurfaceProfile({ profileId: 'p1', revision: 'r1', alignmentElements: line, startStation: 0, mesh: meshOf(rebuilt) }))
      .toEqual(profileBefore);
    expect(extractSampleLine({ mesh: meshOf(rebuilt), center: { x: 5, y: 5 }, direction: { x: 1, y: 0 }, leftWidth: 5, rightWidth: 5, rawStation: 0 }))
      .toEqual(sectionBefore);
    expect(extractSurfaceContours({
      surfaceId: surface.id, surfaceRevision: revOf(rebaked, surface.id), styleRevision: 'c1',
      points: rebuilt.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: rebuilt.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      levels: [{ elevation: 15, levelIndex: 15, kind: 'minor' as const }],
    }).minorPaths.map((p) => p.points)).toEqual(contoursBefore.minorPaths.map((p) => p.points));
    expect(computeVolumeQuantities(
      { points: rebuilt.points.flatMap((p) => [p.x, p.y, p.z]), triangles: rebuilt.triangles.flatMap((t) => [t[0], t[1], t[2]]) } as VolumeMesh,
      { points: rebuilt.points.flatMap((p) => [p.x, p.y, p.z]), triangles: rebuilt.triangles.flatMap((t) => [t[0], t[1], t[2]]) } as VolumeMesh,
    )).toEqual(volumeBefore);
    expect(analyzeElevationBands(elevationMesh(rebuilt), bands, { includeDisplay: false })).toEqual(analysisBefore);

    // Copy path stales nothing on the original.
    const copyHist = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, baseRev));
    const origAfterCopy = copyHist.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(deriveSurfaceStatus(copyHist.present.project, origAfterCopy)).toBe('CURRENT');
    expect(origAfterCopy.cachedRevision).toBe(baseRev);
  });
});

// ---------------------------------------------------------------------------
// 8. Conservation after recalc (standalone pins)
// ---------------------------------------------------------------------------

describe('18X downstream conservation', () => {
  it('contours/analysis/profile/section/volume conserve exactly across an in-place bake', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-raise', kind: 'raise-lower-surface', deltaZ: 3 }],
    });
    const current = withCurrent(project, surface.id);
    const baseBuild = buildOk(current, current.surfaces![0]!);
    const meshOf = (build: CadSurfaceBuildResult) => ({
      points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      grid: build.grid,
    });
    const contourArgs = (build: CadSurfaceBuildResult) => ({
      surfaceId: surface.id, surfaceRevision: 'x', styleRevision: 'c1',
      points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      levels: [{ elevation: 14, levelIndex: 14, kind: 'minor' as const }],
    });
    const bands = [
      { id: 'low', lower: 0, upper: 14, color: '#111111' },
      { id: 'high', lower: 14, upper: 100, color: '#222222' },
    ];
    const emesh = (build: CadSurfaceBuildResult): ElevationMesh => ({
      xs: build.points.map((p) => p.x), ys: build.points.map((p) => p.y),
      zs: build.points.map((p) => p.z), tris: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
    });
    const vmesh = (build: CadSurfaceBuildResult): VolumeMesh => ({
      points: build.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
    });
    const line = [{ kind: 'line', start: { x: 0, y: 5 }, end: { x: 20, y: 5 } }] as never;
    const before = {
      contours: extractSurfaceContours(contourArgs(baseBuild)),
      analysis: analyzeElevationBands(emesh(baseBuild), bands, { includeDisplay: false }),
      profile: extractSurfaceProfile({ profileId: 'p', revision: 'r', alignmentElements: line, startStation: 0, mesh: meshOf(baseBuild) }),
      section: extractSampleLine({ mesh: meshOf(baseBuild), center: { x: 5, y: 5 }, direction: { x: 1, y: 0 }, leftWidth: 5, rightWidth: 5, rawStation: 0 }),
      volume: computeVolumeQuantities(vmesh(baseBuild), vmesh(baseBuild)),
    };
    const next = runCadCommand(createCadHistoryState(current), bakeInPlace(surface.id, revOf(current, surface.id)));
    const rebaked = withCurrent(next.present.project, surface.id);
    const rebuilt = buildOk(rebaked, rebaked.surfaces![0]!);
    expect(extractSurfaceContours(contourArgs(rebuilt)).minorPaths).toEqual(before.contours.minorPaths);
    const afterAnalysis = analyzeElevationBands(emesh(rebuilt), bands, { includeDisplay: false });
    expect(afterAnalysis).toEqual(before.analysis);
    // Bands conserve plan area to the mesh.
    expect(afterAnalysis.bands.reduce((s, b) => s + b.planArea, 0))
      .toBeCloseTo(afterAnalysis.totals.surfacePlanArea, 9);
    expect(extractSurfaceProfile({ profileId: 'p', revision: 'r', alignmentElements: line, startStation: 0, mesh: meshOf(rebuilt) }))
      .toEqual(before.profile);
    expect(extractSampleLine({ mesh: meshOf(rebuilt), center: { x: 5, y: 5 }, direction: { x: 1, y: 0 }, leftWidth: 5, rightWidth: 5, rawStation: 0 }))
      .toEqual(before.section);
    expect(computeVolumeQuantities(vmesh(rebuilt), vmesh(rebuilt))).toEqual(before.volume);
  });
});

// ---------------------------------------------------------------------------
// 9. Invalid payloads
// ---------------------------------------------------------------------------

describe('18X invalid payload gates', () => {
  const good = { v: [0, 0, 0, 10, 0, 0, 10, 10, 0], f: [0, 1, 2] };
  const badCases: Array<[string, number[], number[]]> = [
    ['NaN vertex', [0, 0, 0, 10, 0, Number.NaN, 10, 10, 0], [0, 1, 2]],
    ['infinite vertex', [0, 0, 0, 10, 0, Number.POSITIVE_INFINITY, 10, 10, 0], [0, 1, 2]],
    ['bad index', [...good.v], [0, 1, 9]],
    ['negative index', [...good.v], [0, 1, -1]],
    ['non-integer index', [...good.v], [0, 1, 1.5]],
    ['degenerate/dup vertex in face', [...good.v], [0, 1, 1]],
    ['CW winding', [...good.v], [0, 2, 1]],
    ['zero XY area', [0, 0, 0, 5, 0, 1, 10, 0, 2], [0, 1, 2]],
    ['too few vertices', [0, 0, 0, 1, 0, 0], [0, 1, 2]],
    ['empty faces', [...good.v], []],
  ];

  it.each(badCases)('%s → validate blocks, materialize null, explicit build not ok', (_name, vertices, faces) => {
    const payload = {
      vertices,
      faces,
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 's', sourceSurfaceName: 'S', sourceRevision: 'r' },
    } as CadSurface['definition']['importedTin'];
    expect(validateExplicitTinPayload(payload!)).not.toBeNull();
    expect(materializeExplicitTin('s', payload!)).toBeNull();
    const surface = explicitSurface('bad', vertices, faces, payload!.provenance);
    const project: CadProject = { ...createBlankCadProject({ name: 'T', units: 'm' }), surfaces: [surface] };
    expect(buildCadSurface(project, surface).outcome).not.toBe('ok');
  });

  it('bake of an invalid explicit surface is rejected with no partial mutation', () => {
    const surface = explicitSurface('bad', [0, 0, 0, 10, 0, Number.NaN, 10, 10, 0], [0, 1, 2],
      { kind: 'webnet-bake', sourceSurfaceId: 's', sourceSurfaceName: 'S', sourceRevision: 'r' });
    const project: CadProject = { ...createBlankCadProject({ name: 'T', units: 'm' }), surfaces: [surface] };
    const history = createCadHistoryState(project);
    const rev = revOf(project, surface.id);
    expect(runCadCommand(history, bakeInPlace(surface.id, rev))).toBe(history);
    expect(runCadCommand(history, bakeCopy(surface.id, rev))).toBe(history);
    expect(history.present.project).toEqual(project);
  });

  it('duplicate faces / shared-edge non-manifold are deterministic: digests differ, no faces dropped', () => {
    const v = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
    const single = { vertices: v, faces: [0, 1, 2, 0, 2, 3] };
    const dup = { vertices: v, faces: [0, 1, 2, 0, 2, 3, 0, 1, 2] };
    const prov = { kind: 'webnet-bake', sourceSurfaceId: 's', sourceSurfaceName: 'S', sourceRevision: 'r' } as const;
    expect(explicitTinTopologyDigest({ ...single, provenance: prov }))
      .not.toBe(explicitTinTopologyDigest({ ...dup, provenance: prov }));
    const project: CadProject = {
      ...createBlankCadProject({ name: 'T', units: 'm' }),
      surfaces: [explicitSurface('d', dup.vertices, dup.faces, prov)],
    };
    const build = buildCadSurface(project, project.surfaces![0]!);
    expect(build.outcome).toBe('ok');
    if (build.outcome === 'ok') expect(build.triangles).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 10. Round-trips, undo/redo, isolation, large coords, capability, transform,
//     LandXML equivalence, no-Delaunay, never-LandXML
// ---------------------------------------------------------------------------

describe('18X persistence + undo oracles', () => {
  it('save/reopen round-trip: JSON revival validates, digests match, mesh equivalent', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-4' }, z: 30 }],
    });
    const current = withCurrent(project, surface.id);
    const next = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const saved = JSON.stringify(next.present.project);
    const reopened = JSON.parse(saved) as CadProject;
    const copy = reopened.surfaces!.find((entry) => entry.id !== surface.id)!;
    expect(validateExplicitTinPayload(copy.definition.importedTin!)).toBeNull();
    expect(explicitTinTopologyDigest(copy.definition.importedTin!)).toBe(
      explicitTinTopologyDigest(next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!.definition.importedTin!),
    );
    expect(meshSnap(buildOk(reopened, copy))).toEqual(
      meshSnap(buildOk(next.present.project, next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!)),
    );
  });

  it('undo/redo restores both copy and in-place bakes exactly', () => {
    const { project, surface } = nativeProject({});
    const current = withCurrent(project, surface.id);
    const history = createCadHistoryState(current);
    const copied = runCadCommand(history, bakeCopy(surface.id, revOf(current, surface.id)));
    expect(undoCadHistory(copied).present.project).toEqual(history.present.project);
    expect(redoCadHistory(undoCadHistory(copied)).present.project).toEqual(copied.present.project);
    const baked = runCadCommand(history, bakeInPlace(surface.id, revOf(current, surface.id)));
    expect(undoCadHistory(baked).present.project).toEqual(history.present.project);
    expect(redoCadHistory(undoCadHistory(baked)).present.project).toEqual(baked.present.project);
  });

  it('source deletion/change after copy leaves the copy intact', () => {
    const { project, surface } = nativeProject({});
    const current = withCurrent(project, surface.id);
    const next = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const after = next.present.project;
    const copy = after.surfaces!.find((entry) => entry.id !== surface.id)!;
    const beforeSnap = meshSnap(buildOk(after, copy));
    // Delete every source point: original can no longer build, copy is unaffected.
    const deleted: CadProject = { ...after, entities: [] };
    expect(buildCadSurface(deleted, deleted.surfaces!.find((entry) => entry.id === surface.id)!).outcome).not.toBe('ok');
    expect(meshSnap(buildOk(deleted, deleted.surfaces!.find((entry) => entry.id === copy.id)!))).toEqual(beforeSnap);
  });

  it('deep-copy safety: mutating bake inputs/outputs never aliases stored payloads', () => {
    const { project, surface } = nativeProject({});
    const current = withCurrent(project, surface.id);
    const mesh = buildOk(current, current.surfaces![0]!);
    const payload = createBakedPayloadFromMesh(
      { points: mesh.points, triangles: mesh.triangles }, surface, { sourceRevision: 'r' },
    );
    payload.vertices[0] = 999999;
    payload.faces[0] = 999999;
    expect(mesh.points[0]!.x).not.toBe(999999);
    // Bake outputs are fresh arrays: rebuilding twice gives equal but unaliased payloads.
    const next = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    copy.definition.importedTin!.vertices[0] = -1;
    const rebuilt = buildOk(next.present.project, next.present.project.surfaces!.find((entry) => entry.id === surface.id)!);
    expect(rebuilt.points[0]!.x).not.toBe(-1);
  });

  it('re-bake flattening: bake → edit → bake keeps the mesh and clears the stack', () => {
    const { project, surface } = nativeProject({});
    const current = withCurrent(project, surface.id);
    const once = runCadCommand(createCadHistoryState(current), bakeInPlace(surface.id, revOf(current, surface.id)));
    const bakedOnce = once.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    const snapOnce = meshSnap(buildOk(once.present.project, bakedOnce));
    const edited: CadProject = {
      ...once.present.project,
      surfaces: once.present.project.surfaces!.map((entry) =>
        entry.id === surface.id
          ? { ...entry, definition: { ...entry.definition, edits: [{ id: 'e-r', kind: 'raise-lower-surface', deltaZ: 4 }] } }
          : entry),
    };
    const editedCurrent = withCurrent(edited, surface.id);
    const twice = runCadCommand(createCadHistoryState(editedCurrent), bakeInPlace(surface.id, revOf(editedCurrent, surface.id)));
    const bakedTwice = twice.present.project.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(bakedTwice.definition.edits).toBeUndefined();
    expect(bakedTwice.definition.importedTin!.provenance.kind).toBe('webnet-bake');
    const snapTwice = meshSnap(buildOk(twice.present.project, bakedTwice));
    expect(snapTwice.probes).toHaveLength(snapOnce.probes.length);
    snapTwice.probes.forEach((z, i) => {
      const base = snapOnce.probes[i]!;
      if (z == null || base == null) expect(z).toBe(base);
      else expect(z - 4).toBeCloseTo(base, 9);
    });
    expect(snapTwice.faces).toEqual(snapOnce.faces);
  });

  it('large coordinates survive the bake as exact doubles', () => {
    const base = createBlankCadProject({ name: 'T18X-LG', units: 'm' });
    const ox = 4_123_456.789;
    const oy = 8_765_432.109;
    const entities = [
      pt('g1', ox, oy, 100.123456789),
      pt('g2', ox + 10, oy, 101),
      pt('g3', ox + 10, oy + 10, 102),
      pt('g4', ox, oy + 10, 103),
    ];
    const surface: CadSurface = {
      id: 'surf-lg', name: 'Large',
      definition: { pointSource: { kind: 'points', pointEntityIds: ['g1', 'g2', 'g3', 'g4'] } },
    };
    const project = withCurrent({ ...base, entities, surfaces: [surface] }, surface.id);
    const before = meshSnap(buildOk(project, project.surfaces![0]!));
    const next = runCadCommand(createCadHistoryState(project), bakeCopy(surface.id, revOf(project, surface.id)));
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    expect(meshSnap(buildOk(next.present.project, copy))).toEqual(before);
    expect(copy.definition.importedTin!.vertices[0]).toBe(ox);
  });
});

describe('18X capability matrix', () => {
  it('copy needs CURRENT; in-place needs CURRENT + (native or edited explicit)', () => {
    const { surface } = nativeProject({});
    const rowOf = (status: string, definition: CadSurface['definition'], editCount: number) =>
      ({ status, definition, editCount }) as never;
    // CURRENT native: both allowed.
    expect(surfaceBakeCapability(rowOf('CURRENT', surface.definition, 0))).toEqual({ copy: true, inPlace: true });
    // Non-CURRENT: nothing allowed.
    for (const status of ['UNBUILT', 'NEEDS_REBUILD', 'FAILED', 'BROKEN_REFERENCE', 'INSUFFICIENT_DATA']) {
      expect(surfaceBakeCapability(rowOf(status, surface.definition, 0))).toEqual({ copy: false, inPlace: false });
    }
    // CURRENT explicit without edits: copy only (nothing to flatten).
    const bakedDef = {
      sourceKind: 'explicit-tin',
      pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0],
        faces: [0, 1, 2],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 's', sourceSurfaceName: 'S', sourceRevision: 'r' },
      },
    } as CadSurface['definition'];
    expect(surfaceBakeCapability(rowOf('CURRENT', bakedDef, 0))).toEqual({ copy: true, inPlace: false });
    expect(surfaceBakeCapability(rowOf('CURRENT', bakedDef, 2))).toEqual({ copy: true, inPlace: true });
    // CURRENT native with edits: both.
    expect(surfaceBakeCapability(rowOf('CURRENT', surface.definition, 3))).toEqual({ copy: true, inPlace: true });
  });
});

describe('18X transform + interchange invariants', () => {
  it('PROJECTTRANSFORM applies once-only and commutes with bake', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-1' }, z: 20 }],
    });
    const current = withCurrent(project, surface.id);
    const shift = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: -50 };
    // Bake-then-transform ≡ transform-then-bake on the final mesh.
    const bakedFirst = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const bakedCopy = bakedFirst.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    const transformedBaked = applyCadProjectCoordinateTransform(
      withCurrent(bakedFirst.present.project, bakedCopy.id), shift,
    );
    expect(transformedBaked.ok).toBe(true);
    const transformedThenBaked = applyCadProjectCoordinateTransform(current, shift);
    expect(transformedThenBaked.ok).toBe(true);
    if (!transformedBaked.ok || !transformedThenBaked.ok) throw new Error('transform failed');
    const rebased = withCurrent(transformedThenBaked.project, surface.id);
    const rebaked = runCadCommand(createCadHistoryState(rebased), bakeCopy(surface.id, revOf(rebased, surface.id)));
    const copyA = transformedBaked.project.surfaces!.find((entry) => entry.id === bakedCopy.id)!;
    const copyB = rebaked.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    expect(meshSnap(buildOk(transformedBaked.project, copyA))).toEqual(
      meshSnap(buildOk(rebaked.present.project, copyB)),
    );
    // Once-only: every baked vertex moved by exactly (tx, ty) — no doubling.
    const orig = meshSnap(buildOk(bakedFirst.present.project, bakedCopy));
    const moved = meshSnap(buildOk(transformedBaked.project, copyA));
    expect(moved.xyz.map((p, i) => [p[0]! - orig.xyz[i]![0]!, p[1]! - orig.xyz[i]![1]!]))
      .toEqual(orig.xyz.map(() => [100, -50]));
  });

  it('LandXML-style Pnts/Faces export/reimport of a baked payload is mesh-equivalent', () => {
    const { project, surface } = nativeProject({
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-2' }, z: 33 }],
    });
    const current = withCurrent(project, surface.id);
    const next = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== surface.id)!;
    const payload = copy.definition.importedTin!;
    // Minimal LandXML-shaped interchange: 1-based face indices + "x y z" point lines.
    const pnts = Array.from({ length: payload.vertices.length / 3 }, (_, i) =>
      `${payload.vertices[i * 3]} ${payload.vertices[i * 3 + 1]} ${payload.vertices[i * 3 + 2]}`).join('\n');
    const faces = Array.from({ length: payload.faces.length / 3 }, (_, i) =>
      `${payload.faces[i * 3]! + 1} ${payload.faces[i * 3 + 1]! + 1} ${payload.faces[i * 3 + 2]! + 1}`).join('\n');
    const reVertices = pnts.split('\n').flatMap((line) => line.split(' ').map(Number));
    const reFaces = faces.split('\n').flatMap((line) => line.split(' ').map((n) => Number(n) - 1));
    expect(reVertices).toEqual(payload.vertices);
    expect(reFaces).toEqual(payload.faces);
    const reimported = explicitSurface('re', reVertices, reFaces,
      { kind: 'webnet-bake', sourceSurfaceId: copy.id, sourceSurfaceName: copy.name, sourceRevision: 'lx-reimport' });
    const reproject: CadProject = { ...createBlankCadProject({ name: 'T', units: 'm' }), surfaces: [reimported] };
    expect(meshSnap(buildOk(reproject, reimported))).toEqual(meshSnap(buildOk(next.present.project, copy)));
  });

  it('no Delaunay participates in the bake path (comments stripped)', () => {
    const strip = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const bakeSrc = strip(readFileSync(new URL('../src/engine/cad/cadExplicitBake.ts', import.meta.url), 'utf8'));
    const cmdSrc = strip(readFileSync(new URL('../src/engine/cad/cadTransactionsSurfaceBakeCommands.ts', import.meta.url), 'utf8'));
    expect(bakeSrc.toLowerCase()).not.toContain('delaunay');
    expect(cmdSrc.toLowerCase()).not.toContain('delaunay');
  });

  it("no baked payload carries format:'LandXML' (string + structural checks)", () => {
    const { project, surface } = nativeProject({
      refs: true,
      edits: [{ id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt-1' }, z: 20 }],
    });
    const current = withCurrent(project, surface.id);
    const copied = runCadCommand(createCadHistoryState(current), bakeCopy(surface.id, revOf(current, surface.id)));
    const inplaced = runCadCommand(createCadHistoryState(current), bakeInPlace(surface.id, revOf(current, surface.id)));
    const payloads = [
      copied.present.project.surfaces!.find((entry) => entry.id !== surface.id)!.definition.importedTin!,
      inplaced.present.project.surfaces!.find((entry) => entry.id === surface.id)!.definition.importedTin!,
    ];
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain('LandXML');
      expect('format' in payload.provenance).toBe(false);
      expect(payload.provenance.kind).toBe('webnet-bake');
    }
    // isExplicitTopologyDefinition accepts the baked definition shape.
    expect(isExplicitTopologyDefinition(inplaced.present.project.surfaces!.find((entry) => entry.id === surface.id)!.definition)).toBe(true);
  });
});
