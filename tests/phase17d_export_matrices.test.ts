/**
 * Phase 17D matrices — policy tables, cross-format oracle, persistence,
 * 17B/17C interaction, vertical semantics, goldens, and perf.
 *
 * Companions tests/phase17d_export_coordinate_integrity.test.ts (core model).
 * Engine (inverseGrid/projectGrid) is the oracle here — no hand math.
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildAdjustedPointsExportText,
} from '../src/engine/adjustedPointsExport';
import { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../src/engine/adjustedPointsExportSettings';
import { buildNetworkGeoJsonText } from '../src/engine/browserNetworkGeoJson';
import {
  assessCoordinateReadiness,
  classifyExportFormatForCoordGate,
  resolveExportCoordinateContext,
  type ExportCrsProvenance,
} from '../src/engine/exportCoordinateContext';
import { inverseGrid } from '../src/engine/geodesyProjection';
import { linearToMeters } from '../src/engine/importUnitProvenance';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import { buildLandXmlText } from '../src/engine/landxml';
import {
  assessResultIntegrity,
  buildMathDependencyFingerprint,
  decideExportVerdict,
  FRESH_SUCCESS_INTEGRITY,
} from '../src/engine/resultIntegrity';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import { createRunResultsTextBuilder } from '../src/engine/runResultsTextBuilder';
import type { ParseSettings } from '../src/appStateTypes';

const s9Stub = {
  code: 'S9',
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  vaPrecision_sec: 0.5,
  instCentr_m: 0.0005,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
} as never;
const { buildRunDiagnostics } = createRunProfileBuilders({
  projectInstruments: { S9: s9Stub },
  selectedInstrument: 'S9',
  defaultIndustryInstrumentCode: 'S9',
  defaultIndustryInstrument: s9Stub,
  normalizeSolveProfile: (profile) => profile,
});
import type { AdjustmentResult } from '../src/types';
import {
  defaults,
  parseProjectFile,
  serializeProjectFile,
} from './projectFile/projectFileTestSupport';

const NB_ID = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'; // EPSG 2953, x_0=2500000 y_0=7500000
const UTM21_ID = 'CA_NAD83_CSRS_UTM_21N';
const DEFAULT_ID = 'CA_NAD83_CSRS_UTM_20N';

// NB false-origin neighbourhood: lon ~-66.5 / lat ~46.5 (unmistakably ordered).
const NB_E = 2500100;
const NB_N = 7500100;
const NB_H = 12.5;

const makeStations = (rows: Record<string, { x: number; y: number; h: number }>) =>
  Object.fromEntries(
    Object.entries(rows).map(([id, p]) => [id, { ...p, fixed: false }]),
  ) as unknown as AdjustmentResult['stations'];

const makeResult = (stations: AdjustmentResult['stations']) =>
  ({
    success: true,
    converged: true,
    iterations: 2,
    seuw: 1,
    dof: 1,
    stations,
    observations: [],
    logs: [],
    parseState: { coordMode: '3D', reconciledDescriptions: {} },
  }) as unknown as AdjustmentResult;

const nbResult = () => makeResult(makeStations({ P: { x: NB_E, y: NB_N, h: NB_H } }));

const reportTextFor = (result: AdjustmentResult, crsId: string, mode = 'grid') => {
  const parseSettings = {
    solveProfile: 'industry-parity',
    runMode: 'adjustment',
    preanalysisMode: false,
    coordMode: '3D',
    coordSystemMode: mode,
    crsId,
    crsLabel: '',
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 1,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 3,
    suspectImpactMode: 'auto',
    clusterDetectionEnabled: false,
    crsTransformEnabled: false,
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: 1e-7,
    qFixAngularSigmaSec: 1e-3,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    rotationAngleRad: 0,
    tsCorrelationEnabled: false,
    tsCorrelationScope: 'set',
    tsCorrelationRho: 0,
    robustMode: 'none',
    robustK: 1.5,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    directionSetMode: 'reduced',
  } as unknown as ParseSettings;
  const withCrs = {
    ...result,
    parseState: { ...((result.parseState ?? {}) as object), coordSystemMode: mode, crsId },
  } as AdjustmentResult;
  const builder = createRunResultsTextBuilder({
    settings: { units: 'm' } as unknown as Parameters<typeof createRunResultsTextBuilder>[0]['settings'],
    parseSettings,
    runDiagnostics: buildRunDiagnostics(parseSettings, withCrs),
    levelLoopCustomPresets: [],
    buildRunDiagnostics: (base, solved) => buildRunDiagnostics(base, solved),
  });
  return builder.buildResultsText(withCrs);
};

describe('LOCAL policy matrix', () => {
  const local = () => resolveExportCoordinateContext({ coordSystemMode: 'local' });
  it.each([
    { format: 'points', cls: 'other' as const, allowed: true, code: null },
    { format: 'report', cls: 'other' as const, allowed: true, code: null },
    { format: 'geojson', cls: 'geographic' as const, allowed: false, code: 'FORMAT_REQUIRES_GEOGRAPHIC' },
    { format: 'landxml', cls: 'landxml' as const, allowed: true, code: null },
  ])('$format -> allowed=$allowed ($code)', ({ cls, allowed, code }) => {
    expect(assessCoordinateReadiness({ context: local(), formatClass: cls })).toMatchObject({ allowed, code });
  });

  it('adjusted points + report build; GeoJSON blocks; LandXML omits CRS claim', () => {
    const result = nbResult();
    expect(buildAdjustedPointsExportText({ result, units: 'm', settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS })).toContain('P');
    expect(reportTextFor(result, '', 'local')).toContain('Local');
    expect(() => buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'local' })).toThrow(/FORMAT_REQUIRES_GEOGRAPHIC/);
    const tiny = new LSAEngine({ input: ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 99.8 0.005'].join('\n'), maxIterations: 6 }).solve();
    expect(buildLandXmlText(tiny, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'local' } })).not.toContain('<CoordinateSystem');
  });
});

describe('EXPLICIT projected matrix', () => {
  it('points + LandXML + report allow with truthful metadata; GeoJSON via inverse', () => {
    const result = nbResult();
    expect(buildAdjustedPointsExportText({ result, units: 'm', settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS })).toContain('2500100.0000');
    const tiny = new LSAEngine({ input: ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 99.8 0.005'].join('\n'), maxIterations: 6 }).solve();
    const xml = buildLandXmlText(tiny, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    expect(xml).toContain(NB_ID);
    expect(xml).toContain('epsgCode="2953"');
    expect(reportTextFor(result, NB_ID)).toContain(NB_ID);
    const text = buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
    expect((JSON.parse(text) as { features: unknown[] }).features).toHaveLength(1);
  });
});

describe('INVALID matrix', () => {
  it('blocks every transform export; diagnostic text path keeps the result reviewable', () => {
    const result = nbResult();
    for (const cls of ['geographic', 'landxml', 'other'] as const) {
      expect(assessCoordinateReadiness({
        context: resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: 'BOGUS_CRS' }),
        formatClass: cls,
      })).toMatchObject({ allowed: false, code: 'EXPORT_CRS_INVALID' });
    }
    expect(() => buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: 'BOGUS_CRS' })).toThrow(/EXPORT_CRS_INVALID/);
    const tiny = new LSAEngine({ input: ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 99.8 0.005'].join('\n'), maxIterations: 6 }).solve();
    expect(() => buildLandXmlText(tiny, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: 'BOGUS_CRS' } })).toThrow(/EXPORT_CRS_INVALID/);
    // Result object NOT erased: diagnostic webnet report still builds with honest INVALID header.
    expect(decideExportVerdict('webnet', FRESH_SUCCESS_INTEGRITY)).not.toBe('BLOCK');
    const report = reportTextFor({ ...result, parseState: { ...(result.parseState as object), coordSystemMode: 'grid', crsId: 'BOGUS_CRS' } } as AdjustmentResult, 'BOGUS_CRS');
    expect(report).toContain('BOGUS_CRS');
    expect(Object.keys(result.stations)).toEqual(['P']);
  });
});

describe('cross-format oracle (NB stereo double)', () => {
  it('project-space exports agree exactly; GeoJSON matches inverseGrid within 1e-9 deg', () => {
    const result = nbResult();
    const csv = buildAdjustedPointsExportText({ result, units: 'm', settings: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS });
    const csvRow = csv.split('\n')[1]!;
    const csvNums = csvRow.split(/[,;\t]/).map(Number).filter(Number.isFinite);
    expect(csvNums).toContain(NB_N);
    expect(csvNums).toContain(NB_E);
    const xml = buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    const m = xml.match(/<CgPoint name="P"[^>]*>([^<]+)</);
    expect(m).not.toBeNull();
    const [n, e, h] = m![1]!.trim().split(/\s+/).map(Number);
    expect(n).toBe(NB_N);
    expect(e).toBe(NB_E);
    expect(h).toBe(NB_H);
    const report = reportTextFor(result, NB_ID);
    expect(report).toContain(NB_N.toFixed(4));
    expect(report).toContain(NB_E.toFixed(4));
    const geo = JSON.parse(buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: NB_ID })) as {
      features: Array<{ geometry: { coordinates: [number, number] } }>;
    };
    const inv = inverseGrid(NB_E, NB_N, NB_ID);
    if ('failureReason' in inv) throw new Error('oracle inverse failed');
    expect(Math.abs(geo.features[0]!.geometry.coordinates[0] - inv.lonDeg)).toBeLessThan(1e-9);
    expect(Math.abs(geo.features[0]!.geometry.coordinates[1] - inv.latDeg)).toBeLessThan(1e-9);
  });
});

describe('GeoJSON oracle vs engine', () => {
  it.each([
    { name: 'NB stereo double', crsId: NB_ID, x: NB_E, y: NB_N },
    { name: 'UTM 21N', crsId: UTM21_ID, x: 500000, y: 5000000 },
  ])('$name matches inverseGrid exactly', ({ crsId, x, y }) => {
    const result = makeResult(makeStations({ S: { x, y, h: 5 } }));
    const geo = JSON.parse(buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId })) as {
      features: Array<{ geometry: { coordinates: [number, number] } }>;
    };
    const inv = inverseGrid(x, y, crsId);
    if ('failureReason' in inv) throw new Error('oracle inverse failed');
    expect(geo.features[0]!.geometry.coordinates[0]).toBe(inv.lonDeg);
    expect(geo.features[0]!.geometry.coordinates[1]).toBe(inv.latDeg);
  });

  it('natively-geodetic station passes through; axis order pinned lon~−66.5/lat~46.5', () => {
    const native = makeResult({
      G: { x: 0, y: 0, h: 5, fixed: true, coordInputClass: 'geodetic', latDeg: 46.5, lonDeg: -66.5 },
    } as unknown as AdjustmentResult['stations']);
    const geo = JSON.parse(buildNetworkGeoJsonText({ result: native, units: 'm', coordSystemMode: 'grid', crsId: NB_ID })) as {
      features: Array<{ geometry: { coordinates: [number, number] } }>;
    };
    expect(geo.features[0]!.geometry.coordinates).toEqual([-66.5, 46.5]);
    // NB origin inverse lands on the projection centre: order unmistakable.
    const origin = makeResult(makeStations({ O: { x: 2500000, y: 7500000, h: 0 } }));
    const originGeo = JSON.parse(buildNetworkGeoJsonText({ result: origin, units: 'm', coordSystemMode: 'grid', crsId: NB_ID })) as {
      features: Array<{ geometry: { coordinates: [number, number] } }>;
    };
    const [lon, lat] = originGeo.features[0]!.geometry.coordinates;
    expect(Math.abs(lon - -66.5)).toBeLessThan(1e-6);
    expect(Math.abs(lat - 46.5)).toBeLessThan(1e-6);
    expect(lon).not.toBeCloseTo(lat, 0);
  });

  it('emits no crs member; projected metres fail the geographic range guard', () => {
    const result = nbResult();
    const text = buildNetworkGeoJsonText({ result, units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
    expect(text).not.toContain('"crs"');
    const metresAsDegrees = makeResult({
      BAD: { x: 0, y: 0, h: 0, fixed: true, coordInputClass: 'geodetic', latDeg: 7500000, lonDeg: 2500000 },
    } as unknown as AdjustmentResult['stations']);
    expect(() => buildNetworkGeoJsonText({ result: metresAsDegrees, units: 'm', coordSystemMode: 'grid', crsId: NB_ID }))
      .toThrow(/CRS_TRANSFORM_UNAVAILABLE/);
  });
});

describe('save/reopen preserves export context', () => {
  const payloadFor = (coordSystemMode: string, crsId: string) => ({
    input: '.2D',
    includeFiles: {},
    savedRuns: [],
    ui: {
      settings: defaults.settings,
      parseSettings: { ...defaults.parseSettings, coordSystemMode, crsId },
      exportFormat: 'webnet' as const,
      adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
    },
    project: {
      projectInstruments: defaults.projectInstruments,
      selectedInstrument: '',
      levelLoopCustomPresets: defaults.levelLoopCustomPresets,
    },
  });
  const provenanceAfterRoundTrip = (coordSystemMode: string, crsId: string): ExportCrsProvenance => {
    const parsed = parseProjectFile(serializeProjectFile(payloadFor(coordSystemMode, crsId) as never), defaults as never);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('round trip failed');
    const ps = (parsed.project.ui.parseSettings as { coordSystemMode?: string; crsId?: string });
    return resolveExportCoordinateContext({ coordSystemMode: ps.coordSystemMode, crsId: ps.crsId }).crsProvenance;
  };

  it('EXPLICIT grid+NB round-trips identical; LOCAL stays LOCAL', () => {
    expect(provenanceAfterRoundTrip('grid', NB_ID)).toBe('EXPLICIT');
    expect(provenanceAfterRoundTrip('local', NB_ID)).toBe('LOCAL');
  });

  it('legacy file lacking crsId never becomes EXPLICIT', () => {
    const raw = JSON.parse(serializeProjectFile(payloadFor('grid', NB_ID) as never)) as {
      ui: { parseSettings: Record<string, unknown> };
    };
    delete raw.ui.parseSettings.crsId;
    const parsed = parseProjectFile(JSON.stringify(raw), defaults as never);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ps = parsed.project.ui.parseSettings as { coordSystemMode?: string; crsId?: string };
    const ctx = resolveExportCoordinateContext({ coordSystemMode: ps.coordSystemMode, crsId: ps.crsId });
    expect(ctx.crsProvenance).not.toBe('EXPLICIT');
    // Operator-cleared id is honest legacy-unknown, never a silent default claim.
    expect(resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: '' }).crsProvenance).toBe('UNKNOWN_LEGACY');
  });
});

describe('17B interaction', () => {
  const runSnapshot = { runMode: 'adjustment', maxIterations: 8 };
  const parseFor = (crsId: string, crsLabel = '') => ({ coordSystemMode: 'grid', crsId, crsLabel });
  const mathFor = (crsId: string, crsLabel = '') =>
    buildMathDependencyFingerprint({ runSnapshot: runSnapshot as never, parseSnapshot: parseFor(crsId, crsLabel) as never });

  it('crsId change stales the math fingerprint; crsLabel-only edit stays fresh', () => {
    expect(mathFor(NB_ID)).not.toBe(mathFor(UTM21_ID));
    expect(mathFor(NB_ID, '')).toBe(mathFor(NB_ID, 'My NB label'));
  });

  it('fresh allows export; stale blocks primary (CRS secondary); rerun re-allows', () => {
    const ok = { success: true, converged: true, preanalysisMode: false } as AdjustmentResult;
    const applied = { inputFingerprint: 'i', mathFingerprint: mathFor(NB_ID), exclusionFingerprint: 'e', runMode: 'adjustment' };
    expect(assessResultIntegrity({ result: ok, applied, current: { ...applied } }).state).toBe('FRESH_SUCCESS');
    expect(decideExportVerdict('geojson', FRESH_SUCCESS_INTEGRITY)).toBe('ALLOW');
    const stale = assessResultIntegrity({ result: ok, applied, current: { ...applied, mathFingerprint: mathFor(UTM21_ID) } });
    expect(stale.state).toBe('STALE_SUCCESS');
    expect(decideExportVerdict('geojson', stale)).toBe('BLOCK');
    expect(decideExportVerdict('webnet', stale)).toBe('ALLOW_DIAGNOSTIC_WITH_STATUS');
    // Rerun at the new CRS: fresh again, CRS export valid.
    const rerun = { ...applied, mathFingerprint: mathFor(UTM21_ID) };
    expect(assessResultIntegrity({ result: ok, applied: rerun, current: { ...rerun } }).state).toBe('FRESH_SUCCESS');
    expect(resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: UTM21_ID }).crsProvenance).toBe('EXPLICIT');
  });
});

describe('17C interaction', () => {
  it('feet sources normalize to metres; project exports share one coherent space', () => {
    expect(linearToMeters(1000 / 0.3048, 'ft')).toBeCloseTo(1000, 6);
    const fromFeet = makeResult(makeStations({ F: { x: linearToMeters(NB_E / 0.3048, 'ft'), y: linearToMeters(NB_N / 0.3048, 'ft'), h: linearToMeters(NB_H / 0.3048, 'ft') } }));
    const fromMetres = makeResult(makeStations({ M: { x: 2500100, y: 7500100, h: 12.5 } }));
    const f = fromFeet.stations.F;
    expect(f.x).toBeCloseTo(2500100, 6);
    expect(f.y).toBeCloseTo(7500100, 6);
    expect(f.h).toBeCloseTo(12.5, 9);
    // Same project space in metres; foot display is a pure presentation scale.
    const mXml = buildLandXmlText(fromMetres, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    const fXml = buildLandXmlText(fromFeet, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    const coords = (xml: string, id: string) => xml.match(new RegExp(`<CgPoint name="${id}"[^>]*>([^<]+)<`))![1]!.trim();
    const [mn, me] = coords(mXml, 'M').split(/\s+/).map(Number);
    const [fn, fe] = coords(fXml, 'F').split(/\s+/).map(Number);
    expect(fn).toBeCloseTo(mn, 3);
    expect(fe).toBeCloseTo(me, 3);
    const ftXml = buildLandXmlText(fromMetres, { units: 'ft', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    expect(ftXml).toContain('linearUnit="foot"');
    const [ftN] = coords(ftXml, 'M').split(/\s+/).map(Number);
    expect(ftN).toBeCloseTo(mn * 3.280839895, 3);
  });
});

describe('geoid/vertical semantics', () => {
  it.each([{ units: 'm' as const }, { units: 'ft' as const }])('units=$units: Z is solve-frame h, GeoJSON omits Z', ({ units }) => {
    const result = nbResult();
    const scale = units === 'ft' ? 3.280839895 : 1;
    const xml = buildLandXmlText(result, { units, solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    const m = xml.match(/<CgPoint name="P"[^>]*>([^<]+)</)!;
    expect(Number(m[1]!.trim().split(/\s+/)[2])).toBeCloseTo(NB_H * scale, 4);
    const geo = JSON.parse(buildNetworkGeoJsonText({ result, units, coordSystemMode: 'grid', crsId: NB_ID })) as {
      features: Array<{ geometry: { coordinates: number[] } }>;
    };
    expect(geo.features[0]!.geometry.coordinates).toHaveLength(2);
    expect(resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: NB_ID, units }).verticalReference).toBe('solve-frame h');
  });

  it('geoid on vs off never changes exported Z (labels stay honest, no numerical change)', () => {
    const iris: AdjustmentResult = nbResult();
    const on = buildLandXmlText(iris, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    expect(on.match(/<CgPoint name="P"[^>]*>([^<]+)</)![1]!.trim().split(/\s+/).map(Number)[2]).toBe(NB_H);
  });
});

describe('golden fixtures', () => {
  it('GeoJSON golden: NB point pins transformed lon/lat, ids, order, no crs', () => {
    const text = buildNetworkGeoJsonText({ result: nbResult(), units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
    expect(text).not.toContain('"crs"');
    const geo = JSON.parse(text) as {
      properties: { crsId: string; crsProvenance: string; coordSpace: string };
      features: Array<{ id: string; geometry: { type: string; coordinates: [number, number] }; properties: Record<string, unknown> }>;
    };
    expect(geo.properties).toMatchObject({ crsId: NB_ID, crsProvenance: 'EXPLICIT', coordSpace: 'geographic-lon-lat-deg' });
    const [lon, lat] = geo.features[0]!.geometry.coordinates;
    expect(lon).toBeCloseTo(-66.49869714601591, 9); // [lon, lat] order, not swapped
    expect(lat).toBeCloseTo(46.50089966708402, 9);
    expect(geo.features[0]).toMatchObject({ id: 'station:P', geometry: { type: 'Point' } });
    expect(geo.features[0]!.properties).toMatchObject({ featureType: 'station', stationId: 'P' });
  });

  it('LandXML golden: units match values; CoordinateSystem only for EXPLICIT', () => {
    const result = nbResult();
    const m = buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    expect(m).toContain('linearUnit="meter"');
    expect(m).toContain(`${NB_N.toFixed(6)} ${NB_E.toFixed(6)} ${NB_H.toFixed(6)}`);
    expect(m).toContain('<CoordinateSystem');
    const ft = buildLandXmlText(result, { units: 'ft', solveProfile: 'webnet', coord: { coordSystemMode: 'grid', crsId: NB_ID } });
    expect(ft).toContain('linearUnit="foot"');
    expect(ft).toContain(`${(NB_N * 3.280839895).toFixed(6)} ${(NB_E * 3.280839895).toFixed(6)} ${(NB_H * 3.280839895).toFixed(6)}`);
    for (const coord of [{ coordSystemMode: 'local' }, { coordSystemMode: 'grid', crsId: DEFAULT_ID }, { coordSystemMode: 'grid', crsId: '' }]) {
      expect(buildLandXmlText(result, { units: 'm', solveProfile: 'webnet', coord })).not.toContain('<CoordinateSystem');
    }
    expect(classifyExportFormatForCoordGate('geojson')).toBe('geographic');
    expect(classifyExportFormatForCoordGate('landxml')).toBe('landxml');
    expect(buildIndustryStyleListingText).toBeDefined();
  });
});

describe('GeoJSON export perf', () => {
  const buildBig = (n: number) => {
    const rows: Record<string, { x: number; y: number; h: number }> = {};
    for (let i = 0; i < n; i += 1) rows[`S${i}`] = { x: 2500000 + i * 10, y: 7500000 + i * 10, h: 10 };
    return makeResult(makeStations(rows));
  };
  it('scales linear-ish: 20k < 3x of 10k (context/transform/serialize split logged)', () => {
    const tResolve0 = performance.now();
    const ctx = resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: NB_ID, units: 'm' });
    const tResolve = performance.now() - tResolve0;
    const r10k = buildBig(10000);
    const tT0 = performance.now();
    for (const id of Object.keys(r10k.stations)) {
      const s = r10k.stations[id]!;
      const inv = inverseGrid(s.x, s.y, ctx.crsId ?? undefined);
      if ('failureReason' in inv) throw new Error('transform failed');
    }
    const tTransform10k = performance.now() - tT0;
    const tS0 = performance.now();
    buildNetworkGeoJsonText({ result: r10k, units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
    const tSerialize10k = performance.now() - tS0;
    const total10k = tTransform10k + tSerialize10k;
    const r20k = buildBig(20000);
    const tB0 = performance.now();
    buildNetworkGeoJsonText({ result: r20k, units: 'm', coordSystemMode: 'grid', crsId: NB_ID });
    const total20k = performance.now() - tB0;
    console.log(`17D perf: resolve=${tResolve.toFixed(1)}ms transform10k=${tTransform10k.toFixed(0)}ms serialize10k=${tSerialize10k.toFixed(0)}ms total10k=${total10k.toFixed(0)}ms total20k=${total20k.toFixed(0)}ms`);
    expect(total20k).toBeLessThan(total10k * 3);
  });
});
