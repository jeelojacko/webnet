/**
 * Phase 17D — CRS export coordinate integrity.
 *
 * Pins the derived coordinate-context model (no parallel CRS truth), the
 * stable gate codes, strict GeoJSON geographic output, honest LandXML CRS
 * claims, and honest industry-listing CRS display (no silent default).
 */
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildNetworkGeoJsonText } from '../src/engine/browserNetworkGeoJson';
import {
  assessCoordinateReadiness,
  resolveExportCoordinateContext,
} from '../src/engine/exportCoordinateContext';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import { buildLandXmlText } from '../src/engine/landxml';
import type { AdjustmentResult } from '../src/types';

const EXPLICIT_ID = 'CA_NAD83_CSRS_UTM_21N';
const DEFAULT_ID = 'CA_NAD83_CSRS_UTM_20N';

describe('export coordinate context resolution', () => {
  it('resolves LOCAL for local mode', () => {
    const ctx = resolveExportCoordinateContext({ coordSystemMode: 'local', crsId: DEFAULT_ID });
    expect(ctx.crsProvenance).toBe('LOCAL');
    expect(ctx.crsId).toBeNull();
    expect(ctx.coordinateKind).toBe('local');
  });

  it('resolves UNKNOWN_LEGACY for grid without an id', () => {
    const ctx = resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: '' });
    expect(ctx.crsProvenance).toBe('UNKNOWN_LEGACY');
    expect(ctx.crsId).toBeNull();
  });

  it('resolves INVALID for an unresolvable id (never silent-fallback)', () => {
    const ctx = resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: 'BOGUS_CRS' });
    expect(ctx.crsProvenance).toBe('INVALID');
  });

  it('resolves PROJECT_DEFAULT for the default id and EXPLICIT otherwise', () => {
    expect(
      resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: DEFAULT_ID }).crsProvenance,
    ).toBe('PROJECT_DEFAULT');
    const explicit = resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: EXPLICIT_ID });
    expect(explicit.crsProvenance).toBe('EXPLICIT');
    expect(explicit.crsId).toBe(EXPLICIT_ID);
  });
});

describe('coordinate readiness gate codes', () => {
  const ctxFor = (provenance: string) => {
    if (provenance === 'LOCAL') return resolveExportCoordinateContext({ coordSystemMode: 'local' });
    if (provenance === 'UNKNOWN_LEGACY') {
      return resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: '' });
    }
    if (provenance === 'INVALID') {
      return resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: 'BOGUS_CRS' });
    }
    return resolveExportCoordinateContext({ coordSystemMode: 'grid', crsId: EXPLICIT_ID });
  };

  it('blocks GeoJSON for LOCAL / UNKNOWN with stable codes', () => {
    expect(
      assessCoordinateReadiness({ context: ctxFor('LOCAL'), formatClass: 'geographic' }),
    ).toMatchObject({ allowed: false, code: 'FORMAT_REQUIRES_GEOGRAPHIC' });
    expect(
      assessCoordinateReadiness({ context: ctxFor('UNKNOWN_LEGACY'), formatClass: 'geographic' }),
    ).toMatchObject({ allowed: false, code: 'CRS_UNKNOWN' });
  });

  it('blocks INVALID everywhere with EXPORT_CRS_INVALID', () => {
    for (const formatClass of ['geographic', 'landxml', 'other'] as const) {
      expect(assessCoordinateReadiness({ context: ctxFor('INVALID'), formatClass })).toMatchObject({
        allowed: false,
        code: 'EXPORT_CRS_INVALID',
      });
    }
  });

  it('allows local/unknown for non-geographic formats (honest labels, no CRS claim)', () => {
    expect(
      assessCoordinateReadiness({ context: ctxFor('LOCAL'), formatClass: 'landxml' }).allowed,
    ).toBe(true);
    expect(
      assessCoordinateReadiness({ context: ctxFor('UNKNOWN_LEGACY'), formatClass: 'other' }).allowed,
    ).toBe(true);
  });
});

const gridStations = {
  A: { x: 500000, y: 5000000, h: 10, fixed: true },
  B: { x: 500100, y: 5000100, h: 11, fixed: false },
} as unknown as AdjustmentResult['stations'];

const gridResult = {
  success: true,
  converged: true,
  iterations: 2,
  seuw: 1,
  dof: 1,
  stations: gridStations,
  observations: [],
  logs: [],
  parseState: { coordMode: '3D', reconciledDescriptions: {} },
} as unknown as AdjustmentResult;

describe('strict GeoJSON output', () => {
  it('emits [lon, lat] with no Z and no deprecated crs member', () => {
    const text = buildNetworkGeoJsonText({
      result: gridResult,
      units: 'm',
      coordSystemMode: 'grid',
      crsId: EXPLICIT_ID,
    });
    const geoJson = JSON.parse(text) as {
      features: Array<{ geometry: { coordinates: number[] } }>;
    };
    for (const feature of geoJson.features) {
      expect(feature.geometry.coordinates).toHaveLength(2);
      const [lon, lat] = feature.geometry.coordinates;
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
    expect(text).not.toContain('"crs"');
  });

  it('emits natively-geodetic stations directly after range validation', () => {
    const native = {
      ...gridResult,
      stations: {
        G: {
          x: 0,
          y: 0,
          h: 5,
          fixed: true,
          coordInputClass: 'geodetic',
          latDeg: 45,
          lonDeg: -66,
        },
      } as unknown as AdjustmentResult['stations'],
    } as unknown as AdjustmentResult;
    const text = buildNetworkGeoJsonText({
      result: native,
      units: 'm',
      coordSystemMode: 'grid',
      crsId: EXPLICIT_ID,
    });
    const geoJson = JSON.parse(text) as {
      features: Array<{ geometry: { coordinates: number[] } }>;
    };
    expect(geoJson.features[0]?.geometry.coordinates).toEqual([-66, 45]);
  });

  it('blocks LOCAL / UNKNOWN / INVALID with stable codes', () => {
    expect(() =>
      buildNetworkGeoJsonText({ result: gridResult, units: 'm', coordSystemMode: 'local' }),
    ).toThrow(/FORMAT_REQUIRES_GEOGRAPHIC/);
    expect(() =>
      buildNetworkGeoJsonText({
        result: gridResult,
        units: 'm',
        coordSystemMode: 'grid',
        crsId: '',
      }),
    ).toThrow(/CRS_UNKNOWN/);
    expect(() =>
      buildNetworkGeoJsonText({
        result: gridResult,
        units: 'm',
        coordSystemMode: 'grid',
        crsId: 'BOGUS_CRS',
      }),
    ).toThrow(/EXPORT_CRS_INVALID/);
  });
});

describe('LandXML CRS honesty', () => {
  const tinyInput = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 99.8 0.005'].join('\n');
  const solved = new LSAEngine({ input: tinyInput, maxIterations: 6 }).solve();

  it('adds <CoordinateSystem> only for EXPLICIT from registry metadata', () => {
    const xml = buildLandXmlText(solved, {
      units: 'm',
      solveProfile: 'webnet',
      coord: { coordSystemMode: 'grid', crsId: EXPLICIT_ID },
    });
    expect(xml).toContain('<CoordinateSystem');
    expect(xml).toContain(EXPLICIT_ID);
    expect(xml).not.toContain('WKT');
  });

  it('omits any CRS claim for LOCAL / default-grid without pretending', () => {
    const local = buildLandXmlText(solved, {
      units: 'm',
      solveProfile: 'webnet',
      coord: { coordSystemMode: 'local' },
    });
    expect(local).not.toContain('<CoordinateSystem');
    const projectDefault = buildLandXmlText(solved, {
      units: 'm',
      solveProfile: 'webnet',
      coord: { coordSystemMode: 'grid', crsId: DEFAULT_ID },
    });
    expect(projectDefault).not.toContain('<CoordinateSystem');
  });

  it('blocks INVALID instead of substituting', () => {
    expect(() =>
      buildLandXmlText(solved, {
        units: 'm',
        solveProfile: 'webnet',
        coord: { coordSystemMode: 'grid', crsId: 'BOGUS_CRS' },
      }),
    ).toThrow(/EXPORT_CRS_INVALID/);
  });
});

describe('industry listing honest CRS display', () => {
  const tinyInput = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'D A-B 99.8 0.005'].join('\n');
  const solved = new LSAEngine({ input: tinyInput, maxIterations: 6 }).solve();
  const settings = {
    maxIterations: 10,
    units: 'm' as const,
    listingShowCoordinates: true,
    listingShowObservationsResiduals: false,
    listingShowErrorPropagation: false,
    listingShowProcessingNotes: false,
    listingShowAzimuthsBearings: false,
    listingSortCoordinatesBy: 'name' as const,
    listingSortObservationsBy: 'input' as const,
    listingObservationLimit: 200,
  };
  const parseSettings = {
    coordMode: '2D' as const,
    order: 'EN' as const,
    angleUnits: 'dms' as const,
    angleStationOrder: 'atfromto' as const,
    deltaMode: 'horiz' as const,
    refractionCoefficient: 0.13,
  };
  const runDiag = {
    solveProfile: 'webnet' as const,
    angleCenteringModel: 'geometry-aware-correlated-rays' as const,
    defaultSigmaCount: 0,
    defaultSigmaByType: '',
    stochasticDefaultsSummary: 'inst=S9',
    rotationAngleRad: 0,
  };

  it('prints LOCAL for local mode instead of a silent default id', () => {
    const listing = buildIndustryStyleListingText(solved, settings, parseSettings, runDiag);
    expect(listing).toContain('(CRS=LOCAL)');
    expect(listing).not.toContain(`(CRS=${DEFAULT_ID})`);
  });

  it('prints UNKNOWN for grid without an id and INVALID for a bogus id', () => {
    const gridNoId = {
      ...solved,
      parseState: { ...solved.parseState, coordSystemMode: 'grid' as const, crsId: undefined },
    } as unknown as AdjustmentResult;
    expect(buildIndustryStyleListingText(gridNoId, settings, parseSettings, runDiag)).toContain(
      '(CRS=UNKNOWN)',
    );
    const gridBogus = {
      ...solved,
      parseState: { ...solved.parseState, coordSystemMode: 'grid' as const, crsId: 'BOGUS_CRS' },
    } as unknown as AdjustmentResult;
    expect(buildIndustryStyleListingText(gridBogus, settings, parseSettings, runDiag)).toContain(
      '(CRS=INVALID(BOGUS_CRS))',
    );
  });
});
