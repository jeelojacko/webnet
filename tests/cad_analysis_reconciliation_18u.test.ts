/**
 * Phase 18U QA — session-level conservation/reconciliation pins.
 *
 * Engine-level oracles already pin band math; these pins lock the SESSION
 * plumbing against INDEPENDENT measures (never the engine's own totals):
 * elevation/slope band areas sum to the cached source mesh areas measured
 * directly from triangles, depth band cut/fill sums to `computeVolumeQuantities`
 * on the same cached meshes, and the depth crossing-plane oracle is
 * bit-identical to 18I (same clip + fan-integrate path, exact-decimal case).
 */
import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand, CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions.types';
import { generateAnalysisBands } from '../src/engine/cad/cadAnalysisMaps';
import { computeDepthBands } from '../src/engine/cad/surfaceAnalysis/depthBands';
import { analyzeElevationBands } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import {
  createCadAnalysisControlPlane,
  type CadAnalysisControlPlane,
} from '../src/cad-app/shell/cadAnalysisAdapters';
import {
  buildCadAnalysisSnapshot,
  type CadAnalysisSnapshot,
} from '../src/cad-app/shell/cadAnalysisSnapshot';

let seq = 0;

const pt = (stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt-${(seq += 1)}`,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'analysis-reconcile-project',
  name: 'analysis-reconcile',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

const fixture = () => {
  seq = 0;
  const a = pt('A', 0, 0, 0);
  const b = pt('B', 10, 0, 4);
  const c = pt('C', 10, 10, 8);
  const d = pt('D', 0, 10, 12);
  const base = [pt('E', 0, 0, 0), pt('F', 10, 0, 0), pt('G', 10, 10, 0), pt('H', 0, 10, 0)];
  const cmp = [pt('I', 0, 0, 2), pt('J', 10, 0, 2), pt('K', 10, 10, 2), pt('L', 0, 10, 2)];
  const project = baseProject([a, b, c, d, ...base, ...cmp]);
  project.surfaces = [
    {
      id: 'srf-1',
      name: 'Pond',
      definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
      cachedRevision: null,
    },
    {
      id: 'srf-base',
      name: 'Base',
      definition: { pointSource: { kind: 'points', pointEntityIds: base.map((p) => p.id) } },
      cachedRevision: null,
    },
    {
      id: 'srf-cmp',
      name: 'Design',
      definition: { pointSource: { kind: 'points', pointEntityIds: cmp.map((p) => p.id) } },
      cachedRevision: null,
    },
  ];
  project.volumeSurfaces = [
    { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'srf-base', comparisonSurfaceId: 'srf-cmp' },
  ];
  const tinCache = createCadSurfaceCache('18u-reconcile');
  const revisions = new Map<string, string>();
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') throw new Error('fixture mesh failed');
    tinCache.set(surface.id, built.revision, {
      revision: built.revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
    revisions.set(surface.id, built.revision);
  }
  return { project, tinCache, revisions };
};

const run = (project: CadProject, command: CadCommand): CadProject => {
  const result = executeCadCommand(
    { project, selection: createCadSelectionState(project, []) } as CadWorkspaceSnapshot,
    command,
  );
  if (!result) throw new Error('command failed');
  return result.nextSnapshot.project;
};

/** Independent mesh measure straight from cached triangles (never the analysis engine). */
const meshAreas = (tinCache: CadSurfaceCache, surfaceId: string, revision: string) => {
  const mesh = tinCache.get(surfaceId, revision);
  if (!mesh) throw new Error('mesh missing');
  let plan = 0;
  let area3D = 0;
  for (const tri of mesh.triangles) {
    const [p, q, r] = [mesh.points[tri[0]]!, mesh.points[tri[1]]!, mesh.points[tri[2]]!];
    plan += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
    const ux = q.x - p.x;
    const uy = q.y - p.y;
    const uz = q.z - p.z;
    const vx = r.x - p.x;
    const vy = r.y - p.y;
    const vz = r.z - p.z;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area3D += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return { plan, area3D };
};

const planeOf = (
  getProject: () => CadProject,
  tinCache: CadSurfaceCache,
): CadAnalysisControlPlane =>
  createCadAnalysisControlPlane({
    drawingId: 'd1',
    getProject,
    getDrawingId: () => 'd1',
    tinCache,
    notify: () => undefined,
    onStateChange: () => undefined,
  });

const snapOf = (
  project: CadProject,
  tinCache: CadSurfaceCache,
  plane: CadAnalysisControlPlane,
  mapId: string,
): CadAnalysisSnapshot =>
  buildCadAnalysisSnapshot(
    project,
    tinCache,
    createCadSurfaceVolumeCache('18u-reconcile'),
    plane.cache,
    mapId,
    null,
  );

const bandsOf = (count: number, lower: number, upper: number) => {
  const generated = generateAnalysisBands(count, lower, upper);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
};

describe('18U legend move (command-level; no canvas drag — legends are pointer-events none)', () => {
  it('ANALYSIS_LEGEND_MOVE relocates the insertion without touching the analysis revision', () => {
    const { project, tinCache } = fixture();
    let live = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Elev',
      source: { kind: 'surface', surfaceId: 'srf-1', metric: 'elevation' },
      bands: bandsOf(3, 0, 12),
    } as CadCommand);
    const mapId = live.analysisMaps![0]!.id;
    live = run(live, {
      key: 'ANALYSIS_LEGEND_CREATE',
      legend: { id: 'lg-1', analysisId: mapId, insertionX: 0, insertionY: 0 },
    } as CadCommand);
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    const before = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(before.status).toBe('CURRENT');
    live = run(live, { key: 'ANALYSIS_LEGEND_MOVE', legendId: 'lg-1', x: 5, y: 7 } as CadCommand);
    const moved = live.analysisLegends!.find((entry) => entry.id === 'lg-1')!;
    expect(moved.insertionX).toBe(5);
    expect(moved.insertionY).toBe(7);
    const after = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(after.status).toBe('CURRENT');
    expect(after.revision).toBe(before.revision);
  });
});

describe('18U session reconciliation pins', () => {
  it('elevation band Σplan/Σ3D equals the cached source mesh areas', () => {
    const { project, tinCache, revisions } = fixture();
    let live = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Elev',
      source: { kind: 'surface', surfaceId: 'srf-1', metric: 'elevation' },
      bands: bandsOf(3, 0, 12),
    } as CadCommand);
    const plane = planeOf(() => live, tinCache);
    const mapId = live.analysisMaps![0]!.id;
    plane.requestCalculate(mapId);
    const row = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(row.status).toBe('CURRENT');
    const mesh = meshAreas(tinCache, 'srf-1', revisions.get('srf-1')!);
    const sumPlan = row.bands.reduce((s, b) => s + (b.planArea ?? 0), 0);
    const sum3D = row.bands.reduce((s, b) => s + (b.area3D ?? 0), 0);
    expect(sumPlan).toBeCloseTo(mesh.plan, 9);
    expect(sum3D).toBeCloseTo(mesh.area3D, 9);
    expect(row.classifiedArea).toBeCloseTo(mesh.plan, 9);
  });

  it('slope band Σplan equals the cached source mesh plan area', () => {
    const { project, tinCache, revisions } = fixture();
    let live = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Slope',
      source: { kind: 'surface', surfaceId: 'srf-1', metric: 'slope-percent' },
      bands: bandsOf(3, 0, 1000),
    } as CadCommand);
    const plane = planeOf(() => live, tinCache);
    const mapId = live.analysisMaps![0]!.id;
    plane.requestCalculate(mapId);
    const row = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(row.status).toBe('CURRENT');
    const mesh = meshAreas(tinCache, 'srf-1', revisions.get('srf-1')!);
    const sumPlan = row.bands.reduce((s, b) => s + (b.planArea ?? 0), 0);
    expect(sumPlan).toBeCloseTo(mesh.plan, 9);
    expect(row.classifiedArea).toBeCloseTo(mesh.plan, 9);
  });

  it('depth band Σcut/Σfill/Σnet equals computeVolumeQuantities on the cached meshes', () => {
    const { project, tinCache, revisions } = fixture();
    let live = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Depth',
      source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
      bands: bandsOf(4, -1, 3),
    } as CadCommand);
    const plane = planeOf(() => live, tinCache);
    const mapId = live.analysisMaps![0]!.id;
    plane.requestCalculate(mapId);
    const row = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(row.status).toBe('CURRENT');
    const toVolumeMesh = (surfaceId: string) => {
      const mesh = tinCache.get(surfaceId, revisions.get(surfaceId)!)!;
      return {
        points: mesh.points.flatMap((p) => [p.x, p.y, p.z]),
        triangles: mesh.triangles.flat(),
      };
    };
    const volume = computeVolumeQuantities(toVolumeMesh('srf-base'), toVolumeMesh('srf-cmp')).quantities;
    const sum = (pick: (_b: (typeof row.bands)[number]) => number | null) =>
      row.bands.reduce((s, b) => s + (pick(b) ?? 0), 0);
    expect(sum((b) => b.planArea)).toBeCloseTo(volume.cutArea + volume.fillArea, 9);
    expect(sum((b) => b.cutVolume)).toBeCloseTo(volume.cutVolume, 9);
    expect(sum((b) => b.fillVolume)).toBeCloseTo(volume.fillVolume, 9);
    expect(sum((b) => b.netVolume)).toBeCloseTo(volume.netVolume, 9);
  });

  it('constant delta exactly on a shared edge is owned once (upper band), totals still reconcile', () => {
    const flat = (pts: number[][], tris: number[][]) => ({
      points: pts.flat(),
      triangles: tris.flat(),
    });
    const corners = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = flat(corners.map(([x, y]) => [x, y, 0]), [[0, 1, 2], [0, 2, 3]]);
    const cmp = flat(corners.map(([x, y]) => [x, y, 2]), [[0, 1, 2], [0, 2, 3]]);
    const volume = computeVolumeQuantities(base, cmp).quantities;
    const result = computeDepthBands(base, cmp, [
      { id: 'low', lower: 1, upper: 2 },
      { id: 'high', lower: 2, upper: 3 },
    ]);
    const low = result.bands.find((b) => b.bandId === 'low')!;
    const high = result.bands.find((b) => b.bandId === 'high')!;
    expect(low.planArea).toBe(0);
    expect(high.planArea).toBeCloseTo(100, 9);
    expect(result.totals.classifiedArea).toBeCloseTo(100, 9);
    expect(result.totals.fillVolume).toBeCloseTo(volume.fillVolume, 9);
    expect(result.totals.netVolume).toBeCloseTo(volume.netVolume, 9);
  });

  it('flat elevation exactly on a shared edge is owned once (upper band)', () => {
    const mesh = {
      xs: [0, 10, 10, 0],
      ys: [0, 0, 10, 10],
      zs: [4, 4, 4, 4],
      tris: [0, 1, 2, 0, 2, 3],
    };
    const result = analyzeElevationBands(
      mesh,
      [
        { id: 'low', lower: 0, upper: 4 },
        { id: 'high', lower: 4, upper: 8 },
      ],
      { includeDisplay: true },
    );
    expect(result.bands[0]!.planArea).toBe(0);
    expect(result.bands[1]!.planArea).toBeCloseTo(100, 9);
    expect(result.totals.classifiedPlanArea).toBeCloseTo(100, 9);
    expect(result.totals.unclassifiedPlanArea).toBeCloseTo(0, 12);
  });

  it('depth crossing-plane oracle is bit-identical to 18I computeVolumeQuantities', () => {
    const flat = (pts: number[][], tris: number[][]) => ({
      points: pts.flat(),
      triangles: tris.flat(),
    });
    const corners = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = flat(corners.map(([x, y]) => [x, y, 0]), [[0, 1, 2], [0, 2, 3]]);
    const cmp = flat(corners.map(([x, y]) => [x, y, 0.3 * x - 1.5]), [[0, 1, 2], [0, 2, 3]]);
    const volume = computeVolumeQuantities(base, cmp).quantities;
    const result = computeDepthBands(base, cmp, [
      { id: 'cut', lower: -2, upper: 0 },
      { id: 'fill', lower: 0, upper: 2 },
    ]);
    expect(result.totals.cutVolume).toBe(volume.cutVolume);
    expect(result.totals.fillVolume).toBe(volume.fillVolume);
    expect(result.totals.netVolume).toBe(volume.netVolume);
  });
});
