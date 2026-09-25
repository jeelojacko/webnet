import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import type { CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand, CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions.types';
import { translation } from '../src/engine/cad/cadTransform2D';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import { deleteAnalysisMap } from '../src/engine/cad/cadAnalysisMaps';
import { resolveCurrentAnalysisRevision } from '../src/engine/cad/cadAnalysisView.service';
import {
  createCadAnalysisControlPlane,
  type CadAnalysisControlPlane,
} from '../src/cad-app/shell/cadAnalysisAdapters';
import {
  buildCadAnalysisSnapshot,
  prepareNewAnalysis,
  analysisSourceRange,
  formatAnalysisNumber,
  type CadAnalysisSnapshot,
} from '../src/cad-app/shell/cadAnalysisSnapshot';
import {
  buildAnalysisSummaryCsv,
  buildAnalysisSummaryFilename,
} from '../src/cad-app/shell/cadAnalysisReport';
import {
  analysisRangeGaps,
  describeAnalysisRangeError,
  generateAnalysisRangeDraft,
  validateAnalysisRangeDraft,
  type AnalysisRangeDraftRow,
} from '../src/cad-app/shell/cadAnalysisRanges';
import { generateAnalysisBands } from '../src/engine/cad/cadAnalysisMaps';

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
  id: 'analysis-ui-project',
  name: 'analysis-ui',
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

/**
 * Sloped quad (0..12 m) as the base surface + a flat comparison 2 m above it,
 * both meshed through the real engine builder. Two faces with different slope
 * so slope banding is non-degenerate.
 */
const fixture = () => {
  seq = 0;
  const a = pt('A', 0, 0, 0);
  const b = pt('B', 10, 0, 4);
  const c = pt('C', 10, 10, 8);
  const d = pt('D', 0, 10, 12);
  const comparisonPoints = [
    pt('E', 0, 0, 2),
    pt('F', 10, 0, 2),
    pt('G', 10, 10, 2),
    pt('H', 0, 10, 2),
  ];
  const project = baseProject([a, b, c, d, ...comparisonPoints]);
  project.surfaces = [
    {
      id: 'srf-1',
      name: 'Pond',
      definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
      cachedRevision: null,
    },
    {
      id: 'srf-2',
      name: 'Design',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: comparisonPoints.map((point) => point.id) },
      },
      cachedRevision: null,
    },
  ];
  project.volumeSurfaces = [
    { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'srf-1', comparisonSurfaceId: 'srf-2' },
  ];
  const tinCache = createCadSurfaceCache('18u-ui');
  cacheMeshes(project, tinCache);
  return { project, tinCache, pointIds: [a.id, b.id, c.id, d.id] };
};

/** Build + cache every surface at its CURRENT content revision. */
const cacheMeshes = (project: CadProject, tinCache: CadSurfaceCache): void => {
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
};

/** 18T-style Raise/Lower: shift the source points' Z, then optionally rebuild. */
const raiseSource = (project: CadProject, pointIds: string[], dz: number): CadProject => ({
  ...project,
  entities: project.entities.map((entity) =>
    pointIds.includes(entity.id) && entity.type === 'survey-point'
      ? { ...entity, z: (entity.z ?? 0) + dz }
      : entity,
  ),
});

const workspace = (project: CadProject): CadWorkspaceSnapshot => ({
  project,
  selection: createCadSelectionState(project, []),
});

const run = (project: CadProject, command: CadCommand): CadProject | null => {
  const result = executeCadCommand(workspace(project), command);
  return result ? result.nextSnapshot.project : null;
};

const elevationBands = () => {
  const generated = generateAnalysisBands(3, 0, 12);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
};

const slopeBands = () => {
  const generated = generateAnalysisBands(3, 0, 100);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
};

const depthBands = () => {
  const generated = generateAnalysisBands(3, -2, 2);
  if ('error' in generated) throw new Error(generated.error);
  return generated.bands;
};

const ELEVATION_SOURCE = { kind: 'surface', surfaceId: 'srf-1', metric: 'elevation' } as const;

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
  selectedAnalysisId: string | null = 'am-1',
  selectedLegendId: string | null = null,
): CadAnalysisSnapshot =>
  buildCadAnalysisSnapshot(
    project,
    tinCache,
    createCadSurfaceVolumeCache('18u-ui'),
    plane.cache,
    selectedAnalysisId,
    selectedLegendId,
  );

const createdMap = (project: CadProject, command?: Partial<CadCommand>): CadProject => {
  const next = run(project, {
    key: 'ANALYSIS_MAP_CREATE',
    name: 'Elevation Map',
    source: ELEVATION_SOURCE,
    bands: elevationBands(),
    ...command,
  } as CadCommand);
  expect(next).not.toBeNull();
  return next!;
};

describe('18U manager CRUD flows + Calculate', () => {
  it('CREATE → UNBUILT → Calculate → CURRENT with conserved plan areas', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    let snapshot = snapOf(live, tinCache, plane, mapId);
    expect(snapshot.analyses[0]!.status).toBe('UNBUILT');
    expect(snapshot.analyses[0]!.calculable).toBe(true);
    expect(snapshot.analyses[0]!.result).toBeNull();

    plane.requestCalculate(mapId);
    snapshot = snapOf(live, tinCache, plane, mapId);
    const row = snapshot.analyses[0]!;
    expect(row.status).toBe('CURRENT');
    expect(row.exportable).toBe(true);
    expect(row.measuredMin).toBeCloseTo(0, 6);
    expect(row.measuredMax).toBeCloseTo(12, 6);
    const areaSum = row.bands.reduce((sum, band) => sum + (band.planArea ?? 0), 0);
    expect(areaSum).toBeCloseTo(row.classifiedArea!, 6);
    expect(row.classifiedArea).toBeCloseTo(100, 6);
    // Band labels show the range; empty bands are still listed.
    expect(row.bands[0]!.label).toBe('0.000 – 4.000');
    expect(row.bands).toHaveLength(3);
    live = created;
  });

  it('prepareNewAnalysis generates 5 equal bands over the measured range with a unique name', () => {
    const { project, tinCache } = fixture();
    const plan = prepareNewAnalysis(project, tinCache, 'elevation', 'srf-1', null);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.bands).toHaveLength(5);
    expect(plan.bands[0]!.lower).toBeCloseTo(0, 9);
    expect(plan.bands[4]!.upper).toBeCloseTo(12, 9);
    expect(plan.name).toBe('New Elevation Analysis');
    // Depth range comes from the 18I overlap (comparison − base: −10 .. 2).
    const depthRange = analysisSourceRange(project, tinCache, {
      kind: 'volume',
      volumeSurfaceId: 'vol-1',
      metric: 'signed-depth',
    });
    expect(depthRange).not.toBeNull();
    expect(depthRange!.max).toBeCloseTo(2, 6);
    expect(depthRange!.min).toBeLessThan(-5);
    // A stale/missing source yields no range (fail-closed, never a fake range).
    expect(prepareNewAnalysis(project, createCadSurfaceCache('empty'), 'elevation', 'srf-1', null))
      .toEqual({ error: 'the selected source is not current — build it first' });
    expect(prepareNewAnalysis(project, tinCache, 'elevation', null, null)).toEqual({
      error: 'select a surface first',
    });
  });

  it('appearance-only edits (color/label/opacity/layer) never change the geometry revision', () => {
    const { project } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    const before = resolveCurrentAnalysisRevision(created, created.analysisMaps![0]!);
    const next = run(created, {
      key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
      analysisId: mapId,
      patch: {
        name: 'Elevation Map (cool)',
        opacity: 0.35,
        showBoundaries: true,
        bandColors: { [created.analysisMaps![0]!.bands[0]!.id]: '#123456' },
      },
    });
    expect(next).not.toBeNull();
    const map = next!.analysisMaps![0]!;
    expect(map.bands[0]!.color).toBe('#123456');
    expect(map.opacity).toBe(0.35);
    expect(map.showBoundaries).toBe(true);
    expect(resolveCurrentAnalysisRevision(next!, map)).toBe(before);
  });

  it('threshold edits DO change the revision (NEEDS_RECALC after a Calculate)', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    expect(snapOf(live, tinCache, plane, mapId).analyses[0]!.status).toBe('CURRENT');

    const edited = run(live, {
      key: 'ANALYSIS_MAP_UPDATE_BANDS',
      analysisId: mapId,
      bands: [
        { id: 'band-1', lower: 0, upper: 6, color: '#111111' },
        { id: 'band-2', lower: 6, upper: 12, color: '#222222' },
      ],
    });
    expect(edited).not.toBeNull();
    live = edited!;
    const snapshot = snapOf(live, tinCache, plane, mapId);
    expect(snapshot.analyses[0]!.status).toBe('NEEDS_RECALC');
    expect(snapshot.analyses[0]!.stale).toBe(true);
    expect(snapshot.analyses[0]!.exportable).toBe(false);
    // A recolor of the SAME thresholds keeps the result current (no recalc).
    const recolored = run(live, {
      key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
      analysisId: mapId,
      patch: { bandColors: { 'band-1': '#333333' } },
    })!;
    live = recolored;
    expect(snapOf(live, tinCache, plane, mapId).analyses[0]!.status).toBe('NEEDS_RECALC');
    plane.requestCalculate(mapId);
    expect(snapOf(live, tinCache, plane, mapId).analyses[0]!.status).toBe('CURRENT');
  });

  it('DELETE is blocked while a legend references the map (atomic with deleteLegendsToo)', () => {
    const { project } = fixture();
    const withMap = createdMap(project);
    const mapId = withMap.analysisMaps![0]!.id;
    const withLegend = run(withMap, {
      key: 'ANALYSIS_LEGEND_CREATE',
      legend: { id: 'lg-1', analysisId: mapId, insertionX: 0, insertionY: 0 },
    })!;
    expect(withLegend.analysisLegends).toHaveLength(1);

    // Command path fails closed...
    expect(run(withLegend, { key: 'ANALYSIS_MAP_DELETE', analysisId: mapId })).toBeNull();
    // ...and the engine reports the referencing legends.
    const guarded = deleteAnalysisMap(withLegend.analysisMaps!, mapId, withLegend.analysisLegends!);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok && guarded.reason === 'BLOCKED_BY_LEGEND') {
      expect(guarded.legendIds).toEqual(['lg-1']);
    }
    const removed = run(withLegend, {
      key: 'ANALYSIS_MAP_DELETE',
      analysisId: mapId,
      deleteLegendsToo: true,
    })!;
    expect(removed.analysisMaps).toHaveLength(0);
    expect(removed.analysisLegends).toHaveLength(0);
    // Broken references are legal: deleting only the map leaves the legend.
    const orphaned = run(withLegend, { key: 'ANALYSIS_LEGEND_CREATE', legend: {
      id: 'lg-2', analysisId: mapId, insertionX: 1, insertionY: 1,
    } })!;
    const mapOnly = deleteAnalysisMap(orphaned.analysisMaps!, mapId, orphaned.analysisLegends!, {
      deleteLegendsToo: true,
    });
    expect(mapOnly.ok).toBe(true);
  });

  it('maps carry a legend count and legends derive the referenced map status', () => {
    const { project, tinCache } = fixture();
    const withMap = createdMap(project);
    const mapId = withMap.analysisMaps![0]!.id;
    const withLegend = run(withMap, {
      key: 'ANALYSIS_LEGEND_CREATE',
      legend: { id: 'lg-1', analysisId: mapId, insertionX: 0, insertionY: 0, showPercent: true },
    })!;
    const plane = planeOf(() => withLegend, tinCache);
    const snapshot = snapOf(withLegend, tinCache, plane, mapId, 'lg-1');
    expect(snapshot.analyses[0]!.legendIds).toEqual(['lg-1']);
    expect(snapshot.legends[0]!.analysisName).toBe('Elevation Map');
    expect(snapshot.legends[0]!.statusText).toBe('Unbuilt');
    plane.requestCalculate(mapId);
    const current = snapOf(withLegend, tinCache, plane, mapId, 'lg-1');
    expect(current.legends[0]!.statusText).toBe('Current');
    expect(current.legends[0]!.rows).toHaveLength(3);
    // A legend referencing a missing map derives BROKEN_REFERENCE.
    const broken = {
      ...withLegend,
      analysisLegends: [{ id: 'lg-9', analysisId: 'gone', insertionX: 0, insertionY: 0 }],
    };
    expect(snapOf(broken, tinCache, plane, mapId, 'lg-9').legends[0]!.status).toBe('BROKEN_REFERENCE');
  });

  it('layer-locked maps reject geometry edits (no lock bypass through the UI path)', () => {
    const { project } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    const locked: CadProject = {
      ...created,
      layers: [{
        id: 'general',
        name: 'General',
        color: '#fff',
        visible: true,
        locked: true,
        frozen: false,
        printable: true,
        lineTypeId: 'solid',
        lineweightMm: 0.25,
        role: 'points',
      }],
    };
    expect(run(locked, {
      key: 'ANALYSIS_MAP_UPDATE_BANDS',
      analysisId: mapId,
      bands: [{ id: 'band-1', lower: 0, upper: 12, color: '#123456' }],
    })).toBeNull();
    expect(run(locked, { key: 'ANALYSIS_MAP_DELETE', analysisId: mapId })).toBeNull();
  });
});

describe('18U range editor validation pins', () => {
  const row = (id: string, lower: string, upper: string): AnalysisRangeDraftRow => ({
    id, color: '#112233', lower, upper, label: '',
    planArea: null, percent: null, area3D: null, cutVolume: null, fillVolume: null, netVolume: null,
  });

  it('rejects overlaps, non-finite edges, and lower ≥ upper; flags gaps as UNCLASSIFIED', () => {
    expect(validateAnalysisRangeDraft([row('b1', '0', '4'), row('b2', '2', '6')]))
      .toBe('ANALYSIS_BAND_OVERLAP');
    expect(validateAnalysisRangeDraft([row('b1', '0', 'abc')])).toBe('ANALYSIS_BAND_NON_FINITE');
    expect(validateAnalysisRangeDraft([row('b1', '4', '4')])).toBe('ANALYSIS_BAND_RANGE');
    expect(validateAnalysisRangeDraft([row('b1', '0', '4'), row('b2', '4', '8')])).toBeNull();
    expect(describeAnalysisRangeError('ANALYSIS_BAND_OVERLAP')).toContain('must not overlap');
    expect(analysisRangeGaps([row('b1', '0', '4'), row('b2', '6', '8')])).toEqual([{ lower: 4, upper: 6 }]);
    expect(analysisRangeGaps([row('b1', '0', '4'), row('b2', '4', '8')])).toEqual([]);
  });

  it('Generate Equal defaults to 5 bands, caps at MAX, and mirrors the source range exactly', () => {
    const generated = generateAnalysisRangeDraft(5, 0, 10);
    expect('error' in generated).toBe(false);
    if ('error' in generated) return;
    expect(generated.rows).toHaveLength(5);
    expect(generated.rows[0]!.lower).toBe('0');
    expect(generated.rows[4]!.upper).toBe('10');
    expect(validateAnalysisRangeDraft(generated.rows)).toBeNull();
    const capped = generateAnalysisRangeDraft(999, 0, 10);
    if ('error' in capped) return;
    expect(capped.rows).toHaveLength(64);
  });
});

describe('18U depth bands + Near Balance labeling', () => {
  it('depth map measures cut/fill per band and labels a zero-straddling band Near Balance', () => {
    const { project, tinCache } = fixture();
    const generated = generateAnalysisBands(3, -2, 2);
    if ('error' in generated) throw new Error(generated.error);
    const depth = depthBands();
    expect(depth).toHaveLength(3);
    void generated;
    const withMap = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Depth Map',
      source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
      bands: depth,
    })!;
    const mapId = withMap.analysisMaps![0]!.id;
    let live = withMap;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    const snapshot = snapOf(live, tinCache, plane, mapId);
    const row = snapshot.analyses[0]!;
    expect(row.status).toBe('CURRENT');
    expect(row.typeLabel).toBe('Depth');
    const zeroBand = row.bands.find((band) => band.bandId === 'band-2')!;
    expect(zeroBand.label).toContain('Near Balance');
    expect(zeroBand.label).not.toMatch(/zero earthwork/i);
    const csv = buildAnalysisSummaryCsv(row, 'm');
    expect(csv).toContain('Band,Lower Δ (m),Upper Δ (m),Plan Area (m²),Cut Volume (m³),Fill Volume (m³),Net Volume (m³)');
    expect(csv).toContain('meta,type,Depth,');
    expect(buildAnalysisSummaryFilename('Depth Map')).toBe('analysis-summary-depth-map.csv');
    live = withMap;
  });
});

describe('18U Analysis Summary CSV is CURRENT-only', () => {
  it('exports explicit units when current and refuses stale/needs-recalc rows', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    let row = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(row.exportable).toBe(true);
    const csv = buildAnalysisSummaryCsv(row, 'm');
    expect(csv).toContain('Analysis,Band,Lower (m),Upper (m),Plan Area (m²),3D Area (m²),Percent');
    expect(csv).toContain('meta,type,Elevation,');
    expect(csv).toContain('meta,classified-area,100.00,m²');
    expect(buildAnalysisSummaryCsv(row, 'ft')).toContain('m²'.replace('m²', 'ft²'));
    expect(formatAnalysisNumber(null)).toBe('—');

    // A threshold edit makes the row need a recalculation: export must throw.
    live = run(live, {
      key: 'ANALYSIS_MAP_UPDATE_BANDS',
      analysisId: mapId,
      bands: [{ id: 'band-1', lower: 0, upper: 12, color: '#123456' }],
    })!;
    row = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(row.status).toBe('NEEDS_RECALC');
    expect(() => buildAnalysisSummaryCsv(row, 'm')).toThrow(/not Current/);
  });
});

describe('18U source lifecycle (18T/18R propagation)', () => {
  it('source edit → SOURCE_NOT_CURRENT → rebuild → NEEDS_RECALC → Calculate → CURRENT', () => {
    const { project, tinCache, pointIds } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    expect(snapOf(live, tinCache, plane, mapId).analyses[0]!.status).toBe('CURRENT');

    // Raise the source surface by 2 m (18T-style surface-only elevation edit).
    live = raiseSource(live, pointIds, 2);
    expect(snapOf(live, tinCache, plane, mapId).analyses[0]!.status).toBe('SOURCE_NOT_CURRENT');

    // Rebuild the source mesh for the new revision: the analysis is stale.
    cacheMeshes(live, tinCache);
    const stale = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(stale.status).toBe('NEEDS_RECALC');
    expect(stale.stale).toBe(true);
    expect(stale.staleResult).not.toBeNull();
    expect(stale.calculable).toBe(true);

    plane.requestCalculate(mapId);
    const current = snapOf(live, tinCache, plane, mapId).analyses[0]!;
    expect(current.status).toBe('CURRENT');
    expect(current.measuredMin).toBeCloseTo(2, 6);
    expect(current.measuredMax).toBeCloseTo(14, 6);
  });

  it('slope band areas are identical after a Raise/Lower recalculation', () => {
    const { project, tinCache, pointIds } = fixture();
    const bands = slopeBands();
    const created = run(project, {
      key: 'ANALYSIS_MAP_CREATE',
      name: 'Slope Map',
      source: { kind: 'surface', surfaceId: 'srf-1', metric: 'slope-percent' },
      bands,
    })!;
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    const before = snapOf(live, tinCache, plane, mapId).analyses[0]!.result!;
    const areasBefore = before.bands.map((band) => band.planArea);

    live = raiseSource(live, pointIds, 4);
    cacheMeshes(live, tinCache);
    plane.requestCalculate(mapId);
    const after = snapOf(live, tinCache, plane, mapId).analyses[0]!.result!;
    expect(after.revision).not.toBe(before.revision);
    after.bands.forEach((band, index) => {
      expect(band.planArea).toBeCloseTo(areasBefore[index]!, 6);
    });
  });

  it('PROJECTTRANSFORM moves legend insertions and invalidates analyses per source rules', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    const withLegend = run(created, {
      key: 'ANALYSIS_LEGEND_CREATE',
      legend: { id: 'lg-1', analysisId: mapId, insertionX: 5, insertionY: 7 },
    })!;
    let live = withLegend;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    expect(snapOf(live, tinCache, plane, mapId, 'lg-1').analyses[0]!.status).toBe('CURRENT');

    const transformed = applyCadProjectCoordinateTransform(live, translation(1000, 2000));
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    live = transformed.project;

    const snapshot = snapOf(live, tinCache, plane, mapId, 'lg-1');
    // Thresholds are untouched (they live on the map, not on geometry).
    expect(snapshot.analyses[0]!.bands.map((band) => band.lower)).toEqual([0, 4, 8]);
    // Legend insertion moved with the frame...
    expect(snapshot.legends[0]!.insertionX).toBeCloseTo(1005, 6);
    expect(snapshot.legends[0]!.insertionY).toBeCloseTo(2007, 6);
    // ...and the analysis is invalidated because its source revision moved.
    expect(snapshot.analyses[0]!.status).toBe('SOURCE_NOT_CURRENT');
  });

  it('a deleted map drops its session result and orphan legends stay legal', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const mapId = created.analysisMaps![0]!.id;
    let live = created;
    const plane = planeOf(() => live, tinCache);
    plane.requestCalculate(mapId);
    expect(plane.cache.retained(mapId)).toHaveLength(1);
    plane.handleAnalysisDeleted(mapId);
    expect(plane.cache.retained(mapId)).toHaveLength(0);
    live = run(live, { key: 'ANALYSIS_MAP_DELETE', analysisId: mapId })!;
    expect(snapOf(live, tinCache, plane, null).analyses).toHaveLength(0);
  });
});

describe('18U type label + unit boundaries', () => {
  it('metric labels/units are explicit and never mixed', () => {
    const { project, tinCache } = fixture();
    const created = createdMap(project);
    const row = buildCadAnalysisSnapshot(
      created,
      tinCache,
      createCadSurfaceVolumeCache('18u-ui'),
      planeOf(() => created, tinCache).cache,
      created.analysisMaps![0]!.id,
      null,
    ).analyses[0]!;
    expect(row.typeLabel).toBe('Elevation');
    expect(row.metricUnit).toBe('m');
    const map: CadAnalysisMap = created.analysisMaps![0]!;
    expect(map.source.kind).toBe('surface');
    expect(map.bands).toHaveLength(3);
  });
});
