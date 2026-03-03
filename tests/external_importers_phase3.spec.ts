import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getExternalImporters, importExternalInput } from '../src/engine/importers';
import { parseInput } from '../src/engine/parse';

const carlsonFixture = readFileSync('tests/fixtures/carlson_sample.rw5', 'utf-8');
const tdsFixture = readFileSync('tests/fixtures/tds_sample.raw', 'utf-8');
const dbxFixture = readFileSync('tests/fixtures/dbx_sample.dbx', 'utf-8');

describe('Phase 3 external importers', () => {
  it('registers DBX, Carlson, and TDS importers in the generic registry', () => {
    const ids = getExternalImporters().map((importer) => importer.id);
    expect(ids).toContain('dbx-export');
    expect(ids).toContain('carlson-rw5');
    expect(ids).toContain('tds-raw');
  });

  it('imports Carlson RW5 shots into normalized WebNet observations with traceability', () => {
    const imported = importExternalInput(carlsonFixture, 'carlson_sample.rw5');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('carlson-rw5');
    expect(imported.notice?.title).toBe('Imported Carlson dataset');
    expect(imported.notice?.detailLines[0]).toContain('Imported 2 points and 3 observations');
    expect(imported.notice?.detailLines[1]).toContain('Warnings: 1');
    expect(imported.text).toContain("C STN1 5000.0000 1000.0000 100.0000 'SETUP");
    expect(imported.text).toContain('# Imported source line 7 [SS] converted to M');
    expect(imported.text).toContain('M STN1-BS1-P1 045-12-34.0 100.0000 95.0000 1.5000/1.8000');
    expect(imported.text).toContain('# Imported source line 8 [TR] converted to B');
    expect(imported.text).toContain('B STN1 P2 135.0000');
    expect(imported.text).toContain('# Imported source line 8 [TR] converted to D');
    expect(imported.text).toContain('D STN1 P2 50.0000 1.5000/1.8000');
    expect(imported.text).toContain(
      '# WARNING line 9 [ZZ] Unsupported Carlson/TDS record type was not converted. raw=ZZ,DATA,UNSUPPORTED',
    );

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN1).toBeDefined();
    expect(parsed.stations.BS1).toBeDefined();
    expect(parsed.observations.some((obs) => obs.type === 'angle')).toBe(true);
    expect(
      parsed.observations.some((obs) => obs.type === 'bearing' && 'to' in obs && obs.to === 'P2'),
    ).toBe(true);
  });

  it('imports TDS raw horizontal-distance and delta-height shots as separate D and V records', () => {
    const imported = importExternalInput(tdsFixture, 'tds_sample.raw');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('tds-raw');
    expect(imported.notice?.title).toBe('Imported TDS dataset');
    expect(imported.notice?.detailLines[0]).toContain('Imported 2 points and 3 observations');
    expect(imported.notice?.detailLines[1]).toContain('Warnings: 1');
    expect(imported.text).toContain('# Imported source line 6 [SS] converted to A');
    expect(imported.text).toContain('A STN2-BS2-P3 090-00-00.0');
    expect(imported.text).toContain('# Imported source line 6 [SS] converted to D');
    expect(imported.text).toContain('D STN2 P3 75.0000 1.4000/1.7000');
    expect(imported.text).toContain('# Imported source line 6 [SS] converted to V');
    expect(imported.text).toContain('.DELTA ON');
    expect(imported.text).toContain('V STN2 P3 -1.2500 1.4000/1.7000');

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN2).toBeDefined();
    expect(parsed.stations.BS2).toBeDefined();
    expect(parsed.observations.some((obs) => obs.type === 'angle')).toBe(true);
    expect(
      parsed.observations.some((obs) => obs.type === 'dist' && 'to' in obs && obs.to === 'P3'),
    ).toBe(true);
    expect(
      parsed.observations.some((obs) => obs.type === 'lev' && 'to' in obs && obs.to === 'P3'),
    ).toBe(true);
  });

  it('imports DBX text exports as local/geodetic control plus setup observations', () => {
    const imported = importExternalInput(dbxFixture, 'dbx_sample.dbx');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('dbx-export');
    expect(imported.notice?.title).toBe('Imported DBX dataset');
    expect(imported.notice?.detailLines[0]).toContain('Imported 3 points and 1 observation');
    expect(imported.text).toContain('.ORDER EN');
    expect(imported.text).toContain("C STN3 7000.0000 3000.0000 75.0000 'SETUP");
    expect(imported.text).toContain(
      'PH GPS_3 44.653429353 -63.582441392 123.4560 0.0080 0.0100 0.0150 -0.2500',
    );
    expect(imported.text).toContain('# Imported source line 33 [Observation] converted to M');
    expect(imported.text).toContain('M STN3-BS3-P4 045-07-24.2 80.0000 92.5000 1.6000/1.7000');

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN3).toBeDefined();
    expect(parsed.stations.BS3).toBeDefined();
    expect(parsed.stations.GPS_3).toBeDefined();
    expect(parsed.stations.GPS_3.heightType).toBe('ellipsoid');
    expect(parsed.observations.some((obs) => obs.type === 'angle')).toBe(true);
    expect(
      parsed.observations.some((obs) => obs.type === 'dist' && 'to' in obs && obs.to === 'P4'),
    ).toBe(true);
    expect(
      parsed.observations.some((obs) => obs.type === 'zenith' && 'to' in obs && obs.to === 'P4'),
    ).toBe(true);
  });
});
