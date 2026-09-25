// Phase 18U analysis-map model: revision/appearance split, band validation,
// status matrix, legend reference guard, WNCAD round-trip, transform.
import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_BAND_PALETTE,
  backfillAnalysisMaps,
  createAnalysisMap,
  deleteAnalysisMap,
  duplicateAnalysisMap,
  generateAnalysisBands,
  isAnalysisSourceValid,
  updateAnalysisAppearance,
  updateAnalysisBands,
  validateAnalysisBands,
} from '../src/engine/cad/cadAnalysisMaps';
import {
  createAnalysisLegend,
  deleteAnalysisLegend,
  deriveAnalysisLegendStatus,
  moveAnalysisLegend,
  transformAnalysisLegendInsertion,
} from '../src/engine/cad/cadAnalysisLegends';
import { computeAnalysisGeometryRevision } from '../src/engine/cad/cadAnalysisRevision';
import { deriveAnalysisStatus } from '../src/engine/cad/cadAnalysisStatus';
import { MAX_ANALYSIS_BANDS, type CadAnalysisBand, type CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import { applyPoint, rotationAbout } from '../src/engine/cad/cadTransform2D';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const surface = { kind: 'surface', surfaceId: 'surf-1', metric: 'elevation' } as const;

const band = (id: string, lower: number, upper: number, color = '#123456'): CadAnalysisBand => ({
  id,
  lower,
  upper,
  color,
});

const makeMap = (overrides: Partial<CadAnalysisMap> = {}): CadAnalysisMap => ({
  id: 'amap-1',
  name: 'Elevation Bands',
  source: surface,
  bands: [band('b1', 100, 105), band('b2', 105, 110), band('b3', 110, 115)],
  opacity: 0.6,
  ...overrides,
});

const asMaps = (result: CadAnalysisMap[] | { error: string }): CadAnalysisMap[] => {
  if (!Array.isArray(result)) throw new Error(`expected maps, got ${result.error}`);
  return result;
};

describe('18U analysis revision excludes appearance', () => {
  it('recoloring/labelling/opacity/name changes keep the geometry revision', () => {
    const map = makeMap();
    const sourceRevisions = { surfaceRevision: 'srev1:aaaa1111' };
    const base = computeAnalysisGeometryRevision(map, sourceRevisions);
    expect(base.startsWith('arev1:')).toBe(true);
    const recolored: CadAnalysisMap = {
      ...map,
      name: 'Renamed',
      opacity: 0.1,
      showBoundaries: true,
      layerId: 'surfaces',
      description: 'appearance only',
      bands: map.bands.map((entry) => ({ ...entry, color: '#ffffff', label: 'custom' })),
    };
    expect(computeAnalysisGeometryRevision(recolored, sourceRevisions)).toBe(base);
    // Band array order is cosmetic: the threshold SET is the identity.
    const reordered: CadAnalysisMap = {
      ...map,
      bands: [...map.bands].reverse(),
    };
    expect(computeAnalysisGeometryRevision(reordered, sourceRevisions)).toBe(base);
  });

  it('threshold, metric, source id, and source revision changes all move the revision', () => {
    const map = makeMap();
    const revisions = { surfaceRevision: 'srev1:aaaa1111' };
    const base = computeAnalysisGeometryRevision(map, revisions);
    const movedThreshold: CadAnalysisMap = {
      ...map,
      bands: [band('b1', 100, 104), band('b2', 104, 110), band('b3', 110, 115)],
    };
    expect(computeAnalysisGeometryRevision(movedThreshold, revisions)).not.toBe(base);
    const otherMetric: CadAnalysisMap = {
      ...map,
      source: { kind: 'surface', surfaceId: 'surf-1', metric: 'slope-percent' },
    };
    expect(computeAnalysisGeometryRevision(otherMetric, revisions)).not.toBe(base);
    const otherSource: CadAnalysisMap = {
      ...map,
      source: { kind: 'surface', surfaceId: 'surf-2', metric: 'elevation' },
    };
    expect(computeAnalysisGeometryRevision(otherSource, revisions)).not.toBe(base);
    expect(
      computeAnalysisGeometryRevision(map, { surfaceRevision: 'srev1:bbbb2222' }),
    ).not.toBe(base);
    // Volume sources identity-switch on the relationship revision.
    const volume = makeMap({
      source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
    });
    expect(
      computeAnalysisGeometryRevision(volume, { volumeRevision: 'vrev1:1111' }),
    ).not.toBe(computeAnalysisGeometryRevision(volume, { volumeRevision: 'vrev1:2222' }));
  });

  it('appearance-only CRUD returns the same geometry revision', () => {
    const maps = [makeMap()];
    const revisions = { surfaceRevision: 'srev1:aaaa1111' };
    const before = computeAnalysisGeometryRevision(maps[0]!, revisions);
    const recolored = asMaps(
      updateAnalysisAppearance(maps, 'amap-1', {
        name: 'Recolored',
        opacity: 0.25,
        bandColors: { b1: '#000000' },
        bandLabels: { b2: 'mid' },
      }),
    );
    expect(computeAnalysisGeometryRevision(recolored[0]!, revisions)).toBe(before);
    const rebuilt = asMaps(
      updateAnalysisBands(maps, 'amap-1', { bands: [band('b1', 100, 108), band('b2', 108, 115)] }),
    );
    expect(computeAnalysisGeometryRevision(rebuilt[0]!, revisions)).not.toBe(before);
  });
});

describe('18U band validation', () => {
  it('accepts touching bands and gaps, rejects overlap', () => {
    expect(validateAnalysisBands([band('a', 0, 10), band('b', 10, 20)])).toBeNull();
    expect(validateAnalysisBands([band('a', 0, 10), band('b', 12, 20)])).toBeNull();
    expect(validateAnalysisBands([band('a', 0, 10), band('b', 9, 20)])).toBe('ANALYSIS_BAND_OVERLAP');
  });

  it('rejects non-finite edges, empty/inverted ranges, duplicates, and oversize sets', () => {
    expect(validateAnalysisBands([])).toBe('ANALYSIS_BANDS_EMPTY');
    expect(validateAnalysisBands([band('a', 0, Number.NaN)])).toBe('ANALYSIS_BAND_NON_FINITE');
    expect(validateAnalysisBands([band('a', 5, 5)])).toBe('ANALYSIS_BAND_RANGE');
    expect(validateAnalysisBands([band('a', 5, 4)])).toBe('ANALYSIS_BAND_RANGE');
    expect(validateAnalysisBands([band('a', 0, 1), band('a', 1, 2)])).toBe(
      'ANALYSIS_BAND_ID_DUPLICATE',
    );
    const tooMany = Array.from({ length: MAX_ANALYSIS_BANDS + 1 }, (_, index) =>
      band(`b${index}`, index, index + 1),
    );
    expect(validateAnalysisBands(tooMany)).toBe('ANALYSIS_BANDS_TOO_MANY');
  });

  it('create rejects invalid definitions and accepts valid ones', () => {
    expect(createAnalysisMap([], makeMap({ bands: [band('a', 0, 10), band('b', 5, 20)] }))).toEqual({
      error: 'ANALYSIS_BAND_OVERLAP',
    });
    expect(
      createAnalysisMap([], makeMap({ source: { kind: 'volume', volumeSurfaceId: '', metric: 'signed-depth' } })),
    ).toEqual({ error: 'ANALYSIS_SOURCE_INVALID' });
    const maps = asMaps(createAnalysisMap([], makeMap()));
    expect(maps).toHaveLength(1);
    expect(isAnalysisSourceValid(maps[0]!.source)).toBe(true);
  });

  it('generateAnalysisBands shares exact edges, validates, and cycles the seed palette', () => {
    const generated = generateAnalysisBands(4, 0, 20, 0);
    if ('error' in generated) throw new Error(generated.error);
    expect(generated.thresholds).toHaveLength(5);
    expect(generated.bands).toHaveLength(4);
    expect(generated.bands[0]!.upper).toBe(generated.bands[1]!.lower);
    expect(generated.bands[3]!.upper).toBe(20);
    expect(validateAnalysisBands(generated.bands)).toBeNull();
    expect(generated.bands[0]!.color).toBe(ANALYSIS_BAND_PALETTE[0]);
    const seeded = generateAnalysisBands(2, 0, 10, 3);
    if ('error' in seeded) throw new Error(seeded.error);
    expect(seeded.bands[0]!.color).toBe(ANALYSIS_BAND_PALETTE[3]);
    expect(generateAnalysisBands(0, 0, 10)).toEqual({ error: 'ANALYSIS_BAND_COUNT' });
    expect(generateAnalysisBands(3, 10, 10)).toEqual({ error: 'ANALYSIS_BAND_RANGE' });
  });
});

describe('18U derived analysis status', () => {
  const geometryRevision = 'arev1:aaaa1111';
  const map = makeMap();
  const currentSource = { found: true, status: 'CURRENT' as const };

  it('walks the fail-closed precedence chain', () => {
    expect(deriveAnalysisStatus(map, currentSource, false, null, geometryRevision)).toBe('UNBUILT');
    expect(
      deriveAnalysisStatus(map, currentSource, false, null, geometryRevision, { failed: true }),
    ).toBe('FAILED');
    expect(
      deriveAnalysisStatus(map, currentSource, true, geometryRevision, geometryRevision),
    ).toBe('CURRENT');
    expect(
      deriveAnalysisStatus(map, currentSource, true, 'arev1:stale', geometryRevision),
    ).toBe('NEEDS_RECALC');
    expect(
      deriveAnalysisStatus(map, currentSource, true, geometryRevision, geometryRevision, { noData: true }),
    ).toBe('NO_DATA');
    expect(deriveAnalysisStatus(map, { found: false, status: null }, true, geometryRevision, geometryRevision)).toBe(
      'BROKEN_REFERENCE',
    );
    expect(deriveAnalysisStatus(map, { found: true, status: 'UNBUILT' }, true, geometryRevision, geometryRevision)).toBe(
      'SOURCE_NOT_CURRENT',
    );
    expect(deriveAnalysisStatus(map, { found: true, status: null }, true, geometryRevision, geometryRevision)).toBe(
      'SOURCE_NOT_CURRENT',
    );
    expect(
      deriveAnalysisStatus(map, currentSource, true, geometryRevision, geometryRevision, { building: true }),
    ).toBe('BUILDING');
  });
});

describe('18U legend CRUD + reference guard', () => {
  it('blocks map deletion while a legend references it, unless legends go too', () => {
    const maps = [makeMap(), makeMap({ id: 'amap-2', name: 'Slope Bands' })];
    const legends = [
      { id: 'leg-1', analysisId: 'amap-1', insertionX: 0, insertionY: 0 },
      { id: 'leg-2', analysisId: 'amap-2', insertionX: 4, insertionY: 0 },
    ];
    const blocked = deleteAnalysisMap(maps, 'amap-1', legends);
    expect(blocked).toEqual({ ok: false, reason: 'BLOCKED_BY_LEGEND', legendIds: ['leg-1'] });
    const forced = deleteAnalysisMap(maps, 'amap-1', legends, { deleteLegendsToo: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.analysisMaps.map((entry) => entry.id)).toEqual(['amap-2']);
    expect(forced.analysisLegends.map((entry) => entry.id)).toEqual(['leg-2']);
    // Deleting an unreferenced map never touches legends.
    const plain = deleteAnalysisMap(maps, 'amap-2', []);
    expect(plain.ok).toBe(true);
  });

  it('creates/moves/duplicates and derives broken references', () => {
    const created = createAnalysisLegend([], {
      id: 'leg-1',
      analysisId: 'amap-1',
      insertionX: 10,
      insertionY: 20,
    });
    if (!Array.isArray(created)) throw new Error(created.error);
    expect(createAnalysisLegend(created, created[0]!)).toEqual({ error: 'ANALYSIS_LEGEND_ID_TAKEN' });
    const moved = moveAnalysisLegend(created, 'leg-1', 30, 40);
    if (!Array.isArray(moved)) throw new Error(moved.error);
    expect(moved[0]).toMatchObject({ insertionX: 30, insertionY: 40 });
    expect(moveAnalysisLegend(created, 'leg-1', Number.NaN, 0)).toEqual({
      error: 'ANALYSIS_LEGEND_INSERTION',
    });
    const deleted = deleteAnalysisLegend(moved, 'leg-1');
    expect(deleted).toEqual([]);
    expect(deriveAnalysisLegendStatus({ analysisId: 'amap-1' }, null)).toBe('BROKEN_REFERENCE');
    expect(deriveAnalysisLegendStatus({ analysisId: '' }, 'CURRENT')).toBe('BROKEN_REFERENCE');
    expect(deriveAnalysisLegendStatus({ analysisId: 'amap-1' }, 'CURRENT')).toBe('CURRENT');
    const duplicated = asMaps(duplicateAnalysisMap([makeMap()], 'amap-1', 'amap-9', 'Copy'));
    expect(duplicated.map((entry) => entry.id)).toEqual(['amap-1', 'amap-9']);
    expect(duplicated[1]!.bands).toEqual(makeMap().bands);
  });
});

describe('18U WNCAD persistence (definitions only)', () => {
  const withAnalysis = (): CadProject => {
    const drawing = createBlankCadDrawingDocument({ name: 'Analysis Drawing', units: 'm' });
    return {
      ...drawing.project,
      analysisMaps: [
        makeMap({ layerId: 'surfaces', showBoundaries: true, description: 'phase check' }),
        makeMap({
          id: 'amap-2',
          name: 'Depth Bands',
          source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
          bands: [band('v1', -2, 0, '#c85a3f'), band('v2', 0, 2, '#3fa66a')],
        }),
      ],
      analysisLegends: [
        {
          id: 'leg-1',
          analysisId: 'amap-1',
          insertionX: 12.5,
          insertionY: -3.25,
          title: 'Elevation',
          textStyleId: 'text-style-standard',
          swatchWidth: 2,
          rowHeight: 1.5,
          showRange: true,
          showArea: true,
        },
      ],
    };
  };

  it('round-trips definitions, bands, colors, and legend placement exactly', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Analysis Drawing', units: 'm' });
    const project = withAnalysis();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.analysisMaps).toEqual(project.analysisMaps);
    expect(parsed.drawing.project.analysisLegends).toEqual(project.analysisLegends);
  });

  it('persists no derived results (no area/percent/volume/result keys)', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Analysis Drawing', units: 'm' });
    const text = serializeCadDrawingFile({ ...drawing, project: withAnalysis() });
    const raw = JSON.parse(text) as { project: Record<string, unknown> };
    const maps = raw.project['analysisMaps'] as Array<Record<string, unknown>>;
    expect(maps).toHaveLength(2);
    expect(Object.keys(maps[0]!).sort()).toEqual(
      ['bands', 'description', 'id', 'layerId', 'name', 'opacity', 'showBoundaries', 'source'].sort(),
    );
    expect(Object.keys(maps[0]!['bands'] as object)).toEqual(['0', '1', '2']);
    expect((maps[0]!['bands'] as Array<Record<string, unknown>>)[0]).toEqual({
      id: 'b1',
      lower: 100,
      upper: 105,
      color: '#123456',
    });
    expect(Object.keys(maps[1]!['source'] as object).sort()).toEqual(['kind', 'metric', 'volumeSurfaceId']);
  });

  it('opens legacy drawings without the keys with empty analysis tables', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const legacy: CadProject = { ...drawing.project };
    delete legacy.analysisMaps;
    delete legacy.analysisLegends;
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: legacy }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.analysisMaps).toEqual([]);
    expect(parsed.drawing.project.analysisLegends).toEqual([]);
    expect(backfillAnalysisMaps(undefined)).toEqual([]);
  });
});

describe('18U project transform', () => {
  const point: CadEntity = {
    id: 'pt-1',
    type: 'survey-point',
    layerId: 'points',
    visible: true,
    locked: false,
    stationId: 'A',
    x: 0,
    y: 0,
    z: 42.5,
    pointClass: 'free',
    source: 'parsed-input',
  };

  it('moves legend insertion XY, leaves Z and analysis thresholds identical', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Transform', units: 'm' });
    const project: CadProject = {
      ...drawing.project,
      entities: [point],
      analysisMaps: [makeMap()],
      analysisLegends: [
        { id: 'leg-1', analysisId: 'amap-1', insertionX: 5, insertionY: 7, title: 'Bands' },
      ],
    };
    const transform = rotationAbout(0, 0, 30);
    const result = applyCadProjectCoordinateTransform(project, {
      ...transform,
      tx: 100,
      ty: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = applyPoint({ ...transform, tx: 100, ty: 200 }, { x: 5, y: 7 });
    const legend = result.project.analysisLegends![0]!;
    expect(legend.insertionX).toBeCloseTo(expected.x, 10);
    expect(legend.insertionY).toBeCloseTo(expected.y, 10);
    expect(legend.title).toBe('Bands');
    // Thresholds are metric-space truth: untouched by the frame change.
    expect(result.project.analysisMaps).toEqual(project.analysisMaps);
    const movedPoint = result.project.entities.find((entity) => entity.id === 'pt-1');
    expect(movedPoint?.type).toBe('survey-point');
    if (movedPoint?.type === 'survey-point') expect(movedPoint.z).toBe(42.5);
  });

  it('transform helper keeps appearance fields and only rewrites insertion', () => {
    const legend = {
      id: 'leg-1',
      analysisId: 'amap-1',
      insertionX: 1,
      insertionY: 2,
      swatchWidth: 3,
      rowHeight: 1,
      showPercent: true,
    };
    const moved = transformAnalysisLegendInsertion(legend, { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: -5 });
    expect(moved).toEqual({ ...legend, insertionX: 11, insertionY: -3 });
  });
});
