import { describe, expect, it } from 'vitest';

import {
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  getCrsDefinition,
  resolveCrsDefinition,
} from '../src/engine/crsCatalog';
import { inverseENToGeodetic, projectGeodeticToEN } from '../src/engine/geodesy';

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

    expect(inverse).not.toBeNull();
    expect(inverse?.latDeg ?? Number.NaN).toBeCloseTo(46.72, 7);
    expect(inverse?.lonDeg ?? Number.NaN).toBeCloseTo(-66.64, 7);
  });
});
