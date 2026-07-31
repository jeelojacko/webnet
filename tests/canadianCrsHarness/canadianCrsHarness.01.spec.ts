import { describe, expect, it } from 'vitest';
import {
  proj4,
  CANADIAN_CRS_TEST_CATALOG,
  formatCanadianCrsCatalogReport,
  inverseENToGeodetic,
  projectGeodeticToEN,
  getCrsDefinition,
} from './canadianCrsHarnessTestSupport';

describe('Canadian CRS synthetic harness catalog', () => {
  it('keeps required metadata and deterministic ordering for every Canadian test CRS', () => {
    expect(CANADIAN_CRS_TEST_CATALOG.length).toBeGreaterThan(24);
    expect(CANADIAN_CRS_TEST_CATALOG[0]?.family).toBe('UTM');
    const ids = new Set<string>();
    CANADIAN_CRS_TEST_CATALOG.forEach((row) => {
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.projectionMethod.length).toBeGreaterThan(0);
      expect(row.sourceProvenance.length).toBeGreaterThan(0);
      expect(row.axisOrder).toBe('EN');
      expect(row.units).toBe('metre');
      expect(row.areaOfUse.westLon).toBeLessThan(row.areaOfUse.eastLon);
      expect(row.areaOfUse.southLat).toBeLessThan(row.areaOfUse.northLat);
    });
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_3TM_111W')).toBe(
      true,
    );
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT')).toBe(
      true,
    );
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_4'),
    ).toBe(true);
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_5'),
    ).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_SK_ATS')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_MB_3TM')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NU_STEREOGRAPHIC')).toBe(
      true,
    );
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_TM')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_TM')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC')).toBe(
      true,
    );
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_10TM_FOREST')).toBe(
      true,
    );
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_YT_ALBERS')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NT_LAMBERT')).toBe(true);
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT')).toBe(
      true,
    );
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ON_TERANET_LAMBERT'),
    ).toBe(true);
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_ARCTIC_LCC_3_29'),
    ).toBe(true);
    expect(
      CANADIAN_CRS_TEST_CATALOG.filter((row) => row.family === 'UTM').every(
        (row) => row.status === 'current' && String(row.code ?? '').startsWith('228'),
      ),
    ).toBe(true);
    const qcLambert = CANADIAN_CRS_TEST_CATALOG.find((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT');
    expect(qcLambert?.code).toBe(3799);
    expect(
      qcLambert?.sourceProvenance.some((source) => source.reference.includes('EPSG:3799')),
    ).toBe(true);
  });

  it('formats a report with provenance and projection metadata', () => {
    const report = formatCanadianCrsCatalogReport();
    expect(report).toContain('Canadian CRS synthetic harness catalog');
    expect(report).toContain('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(report).toContain('sources:');
    expect(report).toContain('projection:');
  });
});

describe('Canadian CRS transform validation', () => {
  it('round-trips representative area-of-use centers against direct proj4 projection', () => {
    CANADIAN_CRS_TEST_CATALOG.forEach((row, index) => {
      const def = getCrsDefinition(row.webnetCrsId);
      expect(def).toBeDefined();
      if (!def?.areaOfUseBounds) return;
      const latDeg = def.areaOfUseBounds.minLatDeg + (def.areaOfUseBounds.maxLatDeg - def.areaOfUseBounds.minLatDeg) * 0.5;
      const lonDeg = def.areaOfUseBounds.minLonDeg + (def.areaOfUseBounds.maxLonDeg - def.areaOfUseBounds.minLonDeg) * 0.5;

      const direct = proj4('WGS84', def.proj4, [lonDeg, latDeg]);
      const projected = projectGeodeticToEN({
        latDeg,
        lonDeg,
        originLatDeg: latDeg,
        originLonDeg: lonDeg,
        model: 'local-enu',
        coordSystemMode: 'grid',
        crsId: row.webnetCrsId,
      });

      expect(projected.east, `${row.id} east mismatch at case ${index}`).toBeCloseTo(direct[0], 6);
      expect(projected.north, `${row.id} north mismatch at case ${index}`).toBeCloseTo(direct[1], 6);

      const inverse = inverseENToGeodetic({
        east: projected.east,
        north: projected.north,
        originLatDeg: latDeg,
        originLonDeg: lonDeg,
        model: 'local-enu',
        coordSystemMode: 'grid',
        crsId: row.webnetCrsId,
      });
      expect('failureReason' in inverse, `${row.id} inverse failed`).toBe(false);
      if ('failureReason' in inverse) return;
      expect(inverse.latDeg, `${row.id} lat round-trip mismatch`).toBeCloseTo(latDeg, 7);
      expect(inverse.lonDeg, `${row.id} lon round-trip mismatch`).toBeCloseTo(lonDeg, 7);
    });
  });
});

