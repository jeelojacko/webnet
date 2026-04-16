import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';

import {
  CANADIAN_CRS_TEST_CATALOG,
  formatCanadianCrsCatalogReport,
} from '../src/engine/canadianCrsTestCatalog';
import { inverseENToGeodetic, projectGeodeticToEN } from '../src/engine/geodesy';
import { getCrsDefinition } from '../src/engine/crsCatalog';
import { runSyntheticCrsAdjustmentTest } from '../src/engine/runSyntheticCrsAdjustmentTest';

describe('Canadian CRS synthetic harness catalog', () => {
  it('keeps required metadata and deterministic ordering for every Canadian test CRS', () => {
    expect(CANADIAN_CRS_TEST_CATALOG.length).toBeGreaterThan(20);
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

describe('Canadian CRS synthetic adjustment smoke harness', () => {
  it('recovers projected truth across the current Canada-first CRS support surface', () => {
    CANADIAN_CRS_TEST_CATALOG.forEach((row, index) => {
      const synthetic = runSyntheticCrsAdjustmentTest({
        crsId: row.webnetCrsId,
        seed: 4100 + index,
      });
      expect(synthetic.result.success, `${row.id} failed solve\n${synthetic.result.logs.join('\n')}`).toBe(true);
      expect(
        synthetic.metrics.maxHorizontalErrorM,
        `${row.id} max horizontal error too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.02);
      expect(
        synthetic.metrics.rmsHorizontalErrorM,
        `${row.id} RMS horizontal error too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.01);
      expect(
        synthetic.metrics.residualRms,
        `${row.id} residual RMS too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.01);
      if (
        synthetic.metrics.leafHorizontalSigmaM != null &&
        synthetic.metrics.mainAverageHorizontalSigmaM != null
      ) {
        expect(
          synthetic.metrics.leafHorizontalSigmaM,
          `${row.id} weak leaf precision did not stay weaker than tied main points`,
        ).toBeGreaterThanOrEqual(synthetic.metrics.mainAverageHorizontalSigmaM);
      }
    });
  });
});
