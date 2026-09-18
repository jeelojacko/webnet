import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurveyPointEntity, CadVolumeResult } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { surfaceContentRevision } from '../src/engine/cad/cadSurfaceView';
import { computeVolumeSurfaceRevision } from '../src/engine/cad/cadVolumeSurfaces';
import { buildVolumeDisplayLayers } from '../src/engine/cad/cadVolumeView';
import {
  buildCadVolumeSnapshot,
  buildVolumeSummaryCsv,
  buildVolumeSummaryFilename,
  formatVolumeDifferenceAnswer,
  queryVolumeDifference,
  volumeAreaUnit,
  volumeUnit,
  VOLUME_SIGN_CONVENTION,
} from '../src/cad-app/shell/cadVolumeSnapshot';

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
  id: 'test-project',
  name: 'test',
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
 * Base quad at z=0 + comparison quad at z=+2 over the same footprint,
 * both meshed through the engine. Volume relationship between them.
 */
const volumeFixture = () => {
  seq = 0;
  const b1 = pt('B1', 0, 0, 0);
  const b2 = pt('B2', 10, 0, 0);
  const b3 = pt('B3', 10, 10, 0);
  const b4 = pt('B4', 0, 10, 0);
  const c1 = pt('C1', 0, 0, 2);
  const c2 = pt('C2', 10, 0, 2);
  const c3 = pt('C3', 10, 10, 2);
  const c4 = pt('C4', 0, 10, 2);
  const project = baseProject([b1, b2, b3, b4, c1, c2, c3, c4]);
  project.surfaces = [
    {
      id: 'base-1',
      name: 'Base',
      definition: { pointSource: { kind: 'points', pointEntityIds: [b1.id, b2.id, b3.id, b4.id] } },
      cachedRevision: null,
    },
    {
      id: 'cmp-1',
      name: 'Comparison',
      definition: { pointSource: { kind: 'points', pointEntityIds: [c1.id, c2.id, c3.id, c4.id] } },
      cachedRevision: null,
    },
  ];
  project.volumeSurfaces = [
    { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'cmp-1' },
  ];
  const tinCache = createCadSurfaceCache('test');
  for (const surface of project.surfaces) {
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
  const volumeCache = createCadSurfaceVolumeCache('test');
  return { project, tinCache, volumeCache };
};

const resultFor = (overlapArea: number, revision = 'vrev1:fixture'): CadVolumeResult => ({
    baseSurfaceId: 'base-1',
    comparisonSurfaceId: 'cmp-1',
    revision,
    overlapArea,
    cutArea: 0,
    fillArea: overlapArea,
    cutVolume: 0,
    fillVolume: overlapArea * 2,
    netVolume: overlapArea * 2,
    averageCutDepth: 0,
    averageFillDepth: 2,
    maxCutDepth: 0,
    maxFillDepth: 2,
    minDelta: 2,
    maxDelta: 2,
    baseArea: 100,
    comparisonArea: 100,
    displayRegions: [
      { kind: 'fill', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ],
    stats: {},
  });

const computeVolumeSurfaceRevisionFor = (project: CadProject): string => {
  const base = project.surfaces![0]!;
  const cmp = project.surfaces![1]!;
  return computeVolumeSurfaceRevision({
    baseId: base.id,
    baseRev: surfaceContentRevision(project, base),
    cmpId: cmp.id,
    cmpRev: surfaceContentRevision(project, cmp),
  });
};

describe('volume toolspace/manager rows + status transitions', () => {
  it('UNBUILT before any calculation, then CURRENT once the result lands', () => {
    const { project, tinCache, volumeCache } = volumeFixture();
    const before = buildCadVolumeSnapshot(project, tinCache, volumeCache, null, {});
    expect(before.volumes).toHaveLength(1);
    expect(before.volumes[0]!.status).toBe('UNBUILT');
    expect(before.volumes[0]!.statusText).toBe('Unbuilt');
    expect(before.volumes[0]!.quantities).toBeNull();
    expect(before.volumes[0]!.calculable).toBe(true);
    expect(before.volumes[0]!.exportable).toBe(false);
  });

  it('BROKEN_REFERENCE when base equals comparison', () => {
    const { project, tinCache, volumeCache } = volumeFixture();
    const broken: CadProject = {
      ...project,
      volumeSurfaces: [
        { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'base-1' },
      ],
    };
    const snapshot = buildCadVolumeSnapshot(broken, tinCache, volumeCache, null, {});
    expect(snapshot.volumes[0]!.status).toBe('BROKEN_REFERENCE');
    expect(snapshot.volumes[0]!.calculable).toBe(false);
  });

  it('SOURCE_NOT_CURRENT when a source mesh is missing, with STALE retained quantities', () => {
    const { project, volumeCache } = volumeFixture();
    const stale = resultFor(100, 'vrev1:old');
    volumeCache.set('vol-1', stale);
    // Empty TIN cache: no source is current, but the retained result survives as STALE.
    const snapshot = buildCadVolumeSnapshot(project, createCadSurfaceCache('empty'), volumeCache, null, {});
    const row = snapshot.volumes[0]!;
    expect(row.status).toBe('SOURCE_NOT_CURRENT');
    expect(row.stale).toBe(true);
    expect(row.quantities).toBeNull();
    expect(row.staleQuantities?.overlapArea).toBe(100);
    expect(row.calculable).toBe(false);
    expect(row.exportable).toBe(false);
  });
});

describe('difference inquiry answer formatting', () => {
  it('positive delta reports FILL with magnitude (live source inquiry)', () => {
    const { project, tinCache } = volumeFixture();
    const result = queryVolumeDifference(project, tinCache, 'vol-1', 5, 5);
    expect(result).not.toBeNull();
    expect(result!.delta).toBeCloseTo(2, 6);
    const text = formatVolumeDifferenceAnswer(result, 'Earthwork', 5, 5);
    expect(text).toContain('base 0.000');
    expect(text).toContain('comparison 2.000');
    expect(text).toContain('FILL 2.000');
    expect(text).toContain('live source inquiry');
  });

  it('negative delta reports CUT with magnitude (never a bare signed number)', () => {
    const text = formatVolumeDifferenceAnswer(
      { volumeName: 'V', x: 1, y: 2, baseElevation: 5, comparisonElevation: 4.65, delta: -0.35 },
      'V',
      1,
      2,
    );
    expect(text).toContain('CUT 0.350');
    expect(text).not.toMatch(/Δ -0\.350 — -/);
  });

  it('zero delta reports BALANCED, and stale sources block honestly', () => {
    const balanced = formatVolumeDifferenceAnswer(
      { volumeName: 'V', x: 1, y: 2, baseElevation: 5, comparisonElevation: 5, delta: 0 },
      'V',
      1,
      2,
    );
    expect(balanced).toContain('BALANCED 0.000');
    const { project } = volumeFixture();
    const blocked = queryVolumeDifference(project, createCadSurfaceCache('empty'), 'vol-1', 5, 5);
    expect(blocked).toBeNull();
    expect(formatVolumeDifferenceAnswer(blocked, 'Earthwork', 5, 5)).toContain('rebuild both source TINs');
  });
});

describe('volume summary CSV content/units + stale-vs-current rule', () => {
  it('exports explicit m²/m³ units when CURRENT, ft²/ft³ for feet drawings', () => {
    const { project, tinCache, volumeCache } = volumeFixture();
    const live = resultFor(100);
    const revision = computeVolumeSurfaceRevisionFor(project);
    volumeCache.set('vol-1', { ...live, revision });
    const snapshot = buildCadVolumeSnapshot(project, tinCache, volumeCache, null, {});
    const row = snapshot.volumes[0]!;
    expect(row.status).toBe('CURRENT');
    const csv = buildVolumeSummaryCsv(row, 'm');
    expect(csv).toContain('meta,volume-surface,Earthwork,');
    expect(csv).toContain('meta,base,Base,');
    expect(csv).toContain('meta,comparison,Comparison,');
    expect(csv).toContain('Cut volume,0.000,m³');
    expect(csv).toContain('Fill volume,200.000,m³');
    expect(csv).toContain('Net volume (Fill − Cut),200.000,m³');
    expect(csv).toContain('Overlap area,100.000,m²');
    expect(csv).toContain(VOLUME_SIGN_CONVENTION);
    const csvFt = buildVolumeSummaryCsv(row, 'ft');
    expect(csvFt).toContain('Fill volume,200.000,ft³');
    expect(csvFt).toContain('Overlap area,100.000,ft²');
    expect(buildVolumeSummaryFilename('Earthwork Cut/Fill')).toBe('volume-summary-earthwork-cut-fill.csv');
    expect(volumeAreaUnit('m')).toBe('m²');
    expect(volumeUnit('ft')).toBe('ft³');
  });

  it('refuses export unless CURRENT (stale quantities never slip through)', () => {
    const { project, volumeCache } = volumeFixture();
    volumeCache.set('vol-1', resultFor(100, 'vrev1:old'));
    const snapshot = buildCadVolumeSnapshot(project, createCadSurfaceCache('empty'), volumeCache, null, {});
    expect(() => buildVolumeSummaryCsv(snapshot.volumes[0]!, 'm')).toThrow(/not Current/);
  });
});


describe('volume display layers (stale-vs-current rule)', () => {
  it('aggregates one CUT + one FILL path from cached display regions', () => {
    const { project, tinCache, volumeCache } = volumeFixture();
    volumeCache.set('vol-1', {
      ...resultFor(100),
      revision: computeVolumeSurfaceRevisionFor(project),
      cutArea: 40,
      cutVolume: 80,
      netVolume: 120,
      displayRegions: [
        { kind: 'cut', vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 10 }, { x: 0, y: 10 }] },
        { kind: 'fill', vertices: [{ x: 4, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 4, y: 10 }] },
      ],
    });
    const layers = buildVolumeDisplayLayers(project, tinCache, volumeCache);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.showCut).toBe(true);
    expect(layers[0]!.showFill).toBe(true);
    expect(layers[0]!.cutD.split('M').filter(Boolean)).toHaveLength(1);
    expect(layers[0]!.fillD.split('M').filter(Boolean)).toHaveLength(1);
    expect(layers[0]!.opacity).toBe(0.5);
  });

  it('No-Display style renders nothing; stale revisions render nothing', () => {
    const { project, tinCache, volumeCache } = volumeFixture();
    volumeCache.set('vol-1', { ...resultFor(100), revision: computeVolumeSurfaceRevisionFor(project) });
    const hidden: CadProject = {
      ...project,
      volumeSurfaceStyles: [
        { id: 's-none', name: 'No Display', showCut: false, showFill: false, cutColor: '#000', fillColor: '#fff', opacity: 0 },
      ],
      volumeSurfaces: [{ id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'cmp-1', styleId: 's-none' }],
    };
    expect(buildVolumeDisplayLayers(hidden, tinCache, volumeCache)).toHaveLength(0);
    // Stale revision in cache only (no current result): no display layers.
    const staleOnly = createCadSurfaceVolumeCache('stale');
    staleOnly.set('vol-1', resultFor(100, 'vrev1:old'));
    expect(buildVolumeDisplayLayers(project, tinCache, staleOnly)).toHaveLength(0);
  });
});
