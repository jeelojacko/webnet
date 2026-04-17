import { describe, expect, it } from 'vitest';

import {
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  getCrsDefinition,
  resolveCrsDefinition,
} from '../src/engine/crsCatalog';
import {
  computeClassicTraverseLegacyDisplayGridFactors,
  computeGridFactors,
  inverseClassicTraverseDisplayGeodetic,
  inverseENToGeodetic,
  projectGeodeticToEN,
} from '../src/engine/geodesy';

describe('Canada CRS catalog (Phase 2 expansion)', () => {
  it('keeps default UTM id and includes MTM + provincial entries', () => {
    expect(resolveCrsDefinition().id).toBe(DEFAULT_CANADA_CRS_ID);

    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_01')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MTM_10')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE')).toBe(
      true,
    );
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_4')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_5')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_SK_ATS')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MB_3TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_TM')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_MNR_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_3TM_117W')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_10TM_FOREST')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_ALBERS')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT')).toBe(true);
    expect(CANADA_CRS_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29')).toBe(true);
  });

  it('resolves CRS by canonical id and EPSG aliases', () => {
    const byId = getCrsDefinition('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    const byEpsgToken = getCrsDefinition('EPSG:2953');
    const byEpsgNumeric = getCrsDefinition('2953');
    const byUtmV8 = getCrsDefinition('EPSG:22810');
    const byAb3tm = getCrsDefinition('EPSG:22764');
    const byQcLambert = getCrsDefinition('EPSG:3799');
    const byNsMtm4 = getCrsDefinition('8082');
    const byNsMtm5 = getCrsDefinition('EPSG:8083');
    const bySkAts = getCrsDefinition('CA_NAD83_CSRS_SK_ATS');
    const byMb3tm = getCrsDefinition('CA_NAD83_CSRS_MB_3TM');
    const byNu = getCrsDefinition('CA_NAD83_CSRS_NU_STEREOGRAPHIC');
    const byYt = getCrsDefinition('CA_NAD83_CSRS_YT_TM');
    const byNt = getCrsDefinition('CA_NAD83_CSRS_NT_TM');
    const byQcMunicipal = getCrsDefinition('EPSG:6622');
    const byAbForest = getCrsDefinition('EPSG:3402');
    const byYtAlbers = getCrsDefinition('EPSG:3579');
    const byNtLambert = getCrsDefinition('EPSG:3581');
    const byCaAtlas = getCrsDefinition('EPSG:3979');
    const byOnTeranet = getCrsDefinition('EPSG:5321');
    const byArctic = getCrsDefinition('EPSG:6103');

    expect(byId?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgToken?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byEpsgNumeric?.id).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(byUtmV8?.id).toBe('CA_NAD83_CSRS_UTM_10N');
    expect(byAb3tm?.id).toBe('CA_NAD83_CSRS_AB_3TM_117W');
    expect(byQcLambert?.id).toBe('CA_NAD83_CSRS_QC_LAMBERT');
    expect(byNsMtm4?.id).toBe('CA_NAD83_CSRS_NS_MTM_2010_4');
    expect(byNsMtm5?.id).toBe('CA_NAD83_CSRS_NS_MTM_2010_5');
    expect(bySkAts?.id).toBe('CA_NAD83_CSRS_SK_ATS');
    expect(byMb3tm?.id).toBe('CA_NAD83_CSRS_MB_3TM');
    expect(byNu?.id).toBe('CA_NAD83_CSRS_NU_STEREOGRAPHIC');
    expect(byYt?.id).toBe('CA_NAD83_CSRS_YT_TM');
    expect(byNt?.id).toBe('CA_NAD83_CSRS_NT_TM');
    expect(byQcMunicipal?.id).toBe('CA_NAD83_CSRS_QC_MUNICIPAL_LCC');
    expect(byAbForest?.id).toBe('CA_NAD83_CSRS_AB_10TM_FOREST');
    expect(byYtAlbers?.id).toBe('CA_NAD83_CSRS_YT_ALBERS');
    expect(byNtLambert?.id).toBe('CA_NAD83_CSRS_NT_LAMBERT');
    expect(byCaAtlas?.id).toBe('CA_NAD83_CSRS_CA_ATLAS_LAMBERT');
    expect(byOnTeranet?.id).toBe('CA_NAD83_CSRS_ON_TERANET_LAMBERT');
    expect(byArctic?.id).toBe('CA_NAD83_CSRS_ARCTIC_LCC_3_29');
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

  it('uses closed-form factor formulas for TM and projection-formula support for the CSRS NB stereographic definition', () => {
    const utm = computeGridFactors(46.72, -66.64, 'CA_NAD83_CSRS_UTM_20N');
    expect(utm).not.toBeNull();
    expect(utm?.source).toBe('projection-formula');

    const nbCsrs = computeGridFactors(
      45.94603498341826,
      -66.64432272768907,
      'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
    );
    expect(nbCsrs).not.toBeNull();
    expect(nbCsrs?.source).toBe('projection-formula');
    expect((nbCsrs?.gridScaleFactor ?? 0)).toBeCloseTo(0.99993613, 6);
    expect((nbCsrs?.convergenceAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(-169.83115474, 3);

    const lambert = computeGridFactors(50.0, -85.0, 'CA_NAD83_CSRS_ON_MNR_LAMBERT');
    expect(lambert).not.toBeNull();
    expect(lambert?.source).toBe('numerical-fallback');
    expect(lambert?.diagnostics.includes('FACTOR_APPROXIMATION_USED')).toBe(true);
  });

  it('exposes the legacy NB83 display contract used to derive the tiny traverse listing residuals', () => {
    const latDeg = 45.94603498341826;
    const lonDeg = -66.64432272768907;

    const parityNbCsrs = computeGridFactors(latDeg, lonDeg, 'CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    const legacyDisplay = computeClassicTraverseLegacyDisplayGridFactors(latDeg, lonDeg);

    expect(parityNbCsrs).not.toBeNull();
    expect(legacyDisplay).not.toBeNull();

    const gridPpmDelta =
      ((legacyDisplay?.gridScaleFactor ?? 0) - (parityNbCsrs?.gridScaleFactor ?? 0)) * 1e6;
    expect(gridPpmDelta).toBeCloseTo(-82.2056, 1);
    expect(Number.isFinite(legacyDisplay?.convergenceAngleRad ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(parityNbCsrs?.convergenceAngleRad ?? Number.NaN)).toBe(true);
    expect(
      Math.abs((legacyDisplay?.convergenceAngleRad ?? 0) - (parityNbCsrs?.convergenceAngleRad ?? 0)),
    ).toBeGreaterThan(0.1);
  });

  it('exposes the classic traverse geodetic display inverse used by the NB83 parity listing', () => {
    const displayInverse = inverseClassicTraverseDisplayGeodetic(2488810.236, 7438438.733);

    expect(displayInverse).not.toBeNull();
    expect(displayInverse?.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(displayInverse?.latDeg ?? Number.NaN).toBeCloseTo(45.9460347294, 7);
    expect(displayInverse?.lonDeg ?? Number.NaN).toBeCloseTo(-66.6443216077, 7);
  });
});
