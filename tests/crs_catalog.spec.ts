import { describe, expect, it } from 'vitest';

import {
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  getCrsDefinition,
  resolveCrsDefinition,
} from '../src/engine/crsCatalog';
import { computeGridFactors, inverseENToGeodetic, projectGeodeticToEN } from '../src/engine/geodesy';

describe('Canada CRS catalog (Phase 2 expansion)', () => {
  it('keeps default UTM id and includes MTM + provincial entries', () => {
    expect(resolveCrsDefinition().id).toBe(DEFAULT_CANADA_CRS_ID);

    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_01')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_10')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE')).toBe(
      true,
    );
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT')).toBe(
      true,
    );
  });

  it('resolves CRS by canonical id and EPSG aliases', () => {
    const byId = getCrsDefinition('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    const byEpsgToken = getCrsDefinition('EPSG:2953');
    const byEpsgNumeric = getCrsDefinition('2953');

    expect(byId?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgToken?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgNumeric?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
  });

  it('exposes projection parameters, datum-op support metadata, and area-of-use bounds', () => {
    const nb = getCrsDefinition('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(nb).toBeDefined();
    expect((nb?.projParams.length ?? 0) > 0).toBe(true);
    expect(nb?.supportedDatumOps.primary.length).toBeGreaterThan(0);
    expect(nb?.areaOfUseBounds).toBeDefined();
  });

  it('projects and inverses geodetic positions with NB stereographic double projection', () => {
    const forward = projectGeodeticToEN({
      latDeg: 46.72,
      lonDeg: -66.64,
      originLatDeg: 46.5,
      originLonDeg: -66.5,
      model: 'local-enu',
      coordSystemMode: 'grid',
      crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
    });

    expect(Number.isFinite(forward.east)).toBe(true);
    expect(Number.isFinite(forward.north)).toBe(true);
    expect(forward.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');

    const inverse = inverseENToGeodetic({
      east: forward.east,
      north: forward.north,
      originLatDeg: 46.5,
      originLonDeg: -66.5,
      model: 'local-enu',
      coordSystemMode: 'grid',
      crsId: 'EPSG:2953',
    });

    expect('failureReason' in inverse).toBe(false);
    if ('failureReason' in inverse) return;
    expect(inverse.latDeg).toBeCloseTo(46.72, 7);
    expect(inverse.lonDeg).toBeCloseTo(-66.64, 7);
  });

  it('uses closed-form factor formulas for TM/stereographic and numeric fallback for other families', () => {
    const utm = computeGridFactors(46.72, -66.64, 'CA_NAD83_CSRS_UTM_20N');
    expect(utm).not.toBeNull();
    expect(utm?.source).toBe('projection-formula');

    const nbStereo = computeGridFactors(46.72, -66.64, 'CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(nbStereo).not.toBeNull();
    expect(nbStereo?.source).toBe('projection-formula');

    const lambert = computeGridFactors(50.0, -85.0, 'CA_NAD83_CSRS_ON_MNR_LAMBERT');
    expect(lambert).not.toBeNull();
    expect(lambert?.source).toBe('numerical-fallback');
    expect(lambert?.diagnostics.includes('FACTOR_APPROXIMATION_USED')).toBe(true);
  });
});
