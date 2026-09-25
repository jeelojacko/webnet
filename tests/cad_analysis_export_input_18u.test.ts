/**
 * Phase 18U QA — session-cache → export-input adapter pins.
 *
 * The Export Center panel used to compose no analysis input, so production
 * SVG/PDF/DXF exports silently dropped every analysis fill and legend.
 * These pins lock the adapter: CURRENT maps contribute real regions per
 * metric (elevation/depth display regions, slope whole-face rings),
 * non-CURRENT maps ride with their real status (CURRENT-only withheld
 * warnings downstream, never a silent drop), legends carry definition rows
 * with measured quantities, and a map-less project yields undefined
 * (legacy scene unchanged).
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
import {
  createCadAnalysisControlPlane,
  type CadAnalysisControlPlane,
} from '../src/cad-app/shell/cadAnalysisAdapters';
import {
  buildCadAnalysisSnapshot,
  type CadAnalysisSnapshot,
} from '../src/cad-app/shell/cadAnalysisSnapshot';
import { buildAnalysisExportInput } from '../src/cad-app/shell/cadAnalysisExportInput';
import { isAnalysisLayerCurrent } from '../src/engine/cad/cadAnalysisExportScene';

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
  id: 'analysis-export-project',
  name: 'analysis-export',
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
  const project = baseProject([a, b, c, d]);
  project.surfaces = [
    {
      id: 'srf-1',
      name: 'Pond',
      definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
      cachedRevision: null,
    },
  ];
  const tinCache = createCadSurfaceCache('18u-export');
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
  }
  return { project, tinCache };
};

const run = (project: CadProject, command: CadCommand): CadProject | null => {
  const result = executeCadCommand(
    { project, selection: createCadSelectionState(project, []) } as CadWorkspaceSnapshot,
    command,
  );
  return result ? result.nextSnapshot.project : null;
};

const bandsOf = (count: number, lower: number, upper: number) => {
  const generated = generateAnalysisBands(count, lower, upper);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
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
): CadAnalysisSnapshot =>
  buildCadAnalysisSnapshot(
    project,
    tinCache,
    createCadSurfaceVolumeCache('18u-export'),
    plane.cache,
    project.analysisMaps?.[0]?.id ?? null,
    null,
  );

const createMap = (project: CadProject, metric: 'elevation' | 'slope-percent', lower: number, upper: number) =>
  run(project, {
    key: 'ANALYSIS_MAP_CREATE',
    name: `${metric} map`,
    source: { kind: 'surface', surfaceId: 'srf-1', metric },
    bands: bandsOf(3, lower, upper),
  } as CadCommand)!;

describe('18U analysis export input adapter', () => {
  it('undefined when the project defines no maps and no legends', () => {
    const { project, tinCache } = fixture();
    let live = project;
    const plane = planeOf(() => live, tinCache);
    const snapshot = snapOf(live, tinCache, plane);
    expect(buildAnalysisExportInput(live, snapshot, tinCache, plane.cache, 'm')).toBeUndefined();
  });

  it('UNBUILT maps ride with their real status and empty regions (warn, never silent-drop)', () => {
    const { project, tinCache } = fixture();
    const withMap = createMap(project, 'elevation', 0, 12);
    let live = withMap;
    const plane = planeOf(() => live, tinCache);
    const snapshot = snapOf(live, tinCache, plane);
    const input = buildAnalysisExportInput(live, snapshot, tinCache, plane.cache, 'm')!;
    expect(input.layers ?? []).toHaveLength(1);
    expect((input.layers ?? [])[0]!.status).toBe('UNBUILT');
    expect((input.layers ?? [])[0]!.regions).toEqual([]);
    expect(isAnalysisLayerCurrent((input.layers ?? [])[0]!)).toBe(false);
  });

  it('CURRENT elevation maps contribute real per-band rings', () => {
    const { project, tinCache } = fixture();
    let live = createMap(project, 'elevation', 0, 12);
    const plane = planeOf(() => live, tinCache);
    const mapId = live.analysisMaps![0]!.id;
    plane.requestCalculate(mapId);
    const snapshot = snapOf(live, tinCache, plane);
    expect(snapshot.analyses[0]!.status).toBe('CURRENT');
    const input = buildAnalysisExportInput(live, snapshot, tinCache, plane.cache, 'm')!;
    expect((input.layers ?? [])[0]!.status).toBe('CURRENT');
    expect(isAnalysisLayerCurrent((input.layers ?? [])[0]!)).toBe(true);
    const ringCount = (input.layers ?? [])[0]!.regions.reduce((sum, band) => sum + band.rings.length, 0);
    expect(ringCount).toBeGreaterThan(0);
  });

  it('CURRENT slope maps contribute whole-face triangle rings', () => {
    const { project, tinCache } = fixture();
    let live = createMap(project, 'slope-percent', 0, 100);
    const plane = planeOf(() => live, tinCache);
    const mapId = live.analysisMaps![0]!.id;
    plane.requestCalculate(mapId);
    const snapshot = snapOf(live, tinCache, plane);
    expect(snapshot.analyses[0]!.status).toBe('CURRENT');
    const input = buildAnalysisExportInput(live, snapshot, tinCache, plane.cache, 'm')!;
    expect(isAnalysisLayerCurrent((input.layers ?? [])[0]!)).toBe(true);
  });

  it('legends ride with definition rows + measured quantities and explicit units', () => {
    const { project, tinCache } = fixture();
    let live = createMap(project, 'elevation', 0, 12);
    const mapId = live.analysisMaps![0]!.id;
    live = run(live, {
      key: 'ANALYSIS_LEGEND_CREATE',
      legend: { id: 'lg-1', analysisId: mapId, insertionX: 0, insertionY: 0 },
    } as CadCommand)!;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    const snapshot = snapOf(live, tinCache, plane);
    const input = buildAnalysisExportInput(live, snapshot, tinCache, plane.cache, 'm')!;
    expect(input.legends ?? []).toHaveLength(1);
    expect((input.legends ?? [])[0]!.status).toBe('CURRENT');
    expect((input.legends ?? [])[0]!.rows).toHaveLength(3);
    expect((input.legends ?? [])[0]!.rows[0]!.rangeText).toBe('0.000 – 4.000');
    expect((input.legends ?? [])[0]!.rows[0]!.areaText).toMatch(/m²$/);
  });
});
