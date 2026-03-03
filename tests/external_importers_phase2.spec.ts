import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getExternalImporters, importExternalInput } from '../src/engine/importers';
import { parseInput } from '../src/engine/parse';

const jobXmlFixture = readFileSync('tests/fixtures/jobxml_sample.jxl', 'utf-8');
const jobXmlMeasurementFixture = readFileSync('tests/fixtures/jobxml_measurement_sample.jxl', 'utf-8');
const jobXmlTrimbleFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_station_setup_sample.jxl',
  'utf-8',
);
const fieldGeniusFixture = readFileSync('tests/fixtures/fieldgenius_sample.raw', 'utf-8');

describe('Phase 2 external importers', () => {
  it('registers JobXML and FieldGenius importers in the generic registry', () => {
    const ids = getExternalImporters().map((importer) => importer.id);
    expect(ids).toContain('jobxml');
    expect(ids).toContain('fieldgenius-raw');
  });

  it('imports JobXML reduced points and preserves unsupported measurement records in the trace log', () => {
    const imported = importExternalInput(jobXmlFixture, 'jobxml_sample.jxl');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('jobxml');
    expect(imported.notice?.title).toBe('Imported JobXML dataset');
    expect(imported.notice?.detailLines[0]).toContain('Imported 2 points');
    expect(imported.notice?.detailLines[1]).toContain('Warnings: 1');
    expect(imported.dataset?.controlStations).toHaveLength(2);
    expect(imported.dataset?.observations).toHaveLength(0);
    expect(imported.dataset?.trace).toHaveLength(1);
    expect(imported.text).toContain(".ORDER EN");
    expect(imported.text).toContain("C STN1 5000.0000 1000.0000 100.0000 'SETUP");
    expect(imported.text).toContain(
      'PH GPS_1 44.653429353 -63.582441392 123.4560 0.0080 0.0100 0.0150 -0.2500',
    );
    expect(imported.text).toContain(
      '# WARNING line 23 [PointRecord] JobXML measurement-style point SHOT_1 was not converted because the station, target, or direction context could not be resolved.',
    );

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN1).toBeDefined();
    expect(parsed.stations.GPS_1).toBeDefined();
    expect(parsed.stations.GPS_1.heightType).toBe('ellipsoid');
    expect(parsed.stations.GPS_1.constraintCorrXY).toBeCloseTo(-0.25, 8);
  });

  it('converts JobXML station and measurement records when setup context is resolvable', () => {
    const imported = importExternalInput(jobXmlMeasurementFixture, 'jobxml_measurement_sample.jxl');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('jobxml');
    expect(imported.notice?.detailLines[0]).toContain('Imported 2 points and 1 observation');
    expect(imported.dataset?.controlStations).toHaveLength(2);
    expect(imported.dataset?.observations).toHaveLength(1);
    expect(imported.dataset?.trace).toHaveLength(0);
    expect(imported.text).toContain('[PointRecord] converted to M');
    expect(imported.text).toContain('M STN1-BS1-SHOT_1 045-07-24.2 100.0000 95.0000 1.5000/1.8000');

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN1).toBeDefined();
    expect(parsed.stations.BS1).toBeDefined();
    expect(parsed.stations.SHOT_1).toBeDefined();
    expect(
      parsed.observations.some(
        (obs) =>
          obs.type === 'angle' &&
          'at' in obs &&
          obs.at === 'STN1' &&
          obs.from === 'BS1' &&
          obs.to === 'SHOT_1',
      ),
    ).toBe(true);
    expect(
      parsed.observations.some(
        (obs) => obs.type === 'dist' && 'from' in obs && obs.from === 'STN1' && obs.to === 'SHOT_1',
      ),
    ).toBe(true);
    expect(
      parsed.observations.some(
        (obs) => obs.type === 'zenith' && 'from' in obs && obs.from === 'STN1' && obs.to === 'SHOT_1',
      ),
    ).toBe(true);
  });

  it('imports Trimble-style station setup JobXML using reduced points, MTA preference, and face-based backsight circles', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('jobxml');
    expect(imported.notice?.detailLines[0]).toContain('Imported 4 points and 6 observations');
    expect(imported.dataset?.controlStations).toHaveLength(4);
    expect(imported.dataset?.observations).toHaveLength(6);
    expect(imported.dataset?.trace).toHaveLength(0);

    const measurementObs = imported.dataset?.observations.filter(
      (obs) => obs.kind === 'measurement',
    );
    expect(measurementObs).toHaveLength(6);
    expect(measurementObs?.[0]).toMatchObject({
      kind: 'measurement',
      atId: '1',
      fromId: '1000',
      toId: '1000',
      hiM: 1.65,
      htM: 1.55,
      sourceMeta: {
        classification: 'BackSight',
        setupType: 'StationSetup',
      },
    });
    expect(measurementObs?.[1]).toMatchObject({
      kind: 'measurement',
      atId: '1',
      fromId: '1000',
      toId: '1000',
      hiM: 1.65,
      htM: 1.55,
      sourceMeta: {
        method: 'MEANTURNEDANGLE',
        setupType: 'StationSetup',
      },
    });
    expect(measurementObs?.[2]).toMatchObject({
      kind: 'measurement',
      atId: '1',
      fromId: '1000',
      toId: '2',
      hiM: 1.65,
      htM: 1.692,
    });
    expect(measurementObs?.[2].angleDeg).toBeCloseTo(286.85797317135, 8);
    expect(measurementObs?.[2].distanceM).toBeCloseTo(22.25735, 8);
    expect(measurementObs?.[2].verticalMode).toBe('zenith');
    expect(measurementObs?.[2].verticalValue).toBeCloseTo(89.9556732, 8);

    expect(measurementObs?.[5]).toMatchObject({
      kind: 'measurement',
      atId: '1',
      fromId: '1000',
      toId: 'CHK1',
      hiM: 1.65,
      htM: 1.8,
    });
    expect(measurementObs?.[5].angleDeg).toBeCloseTo(6.72612497135, 8);
    expect(measurementObs?.[5].distanceM).toBeCloseTo(100, 8);

    expect(imported.text).toContain('M 1-1000-1000');
    expect(imported.text).toContain('M 1-1000-2');
    expect(imported.text).toContain('1.6500/1.6920');
    expect(imported.text).toContain('M 1-1000-CHK1');
    expect(imported.text).not.toContain('OBS03-DEL');

    const parsed = parseInput(imported.text);
    expect(parsed.stations['1']).toBeDefined();
    expect(parsed.stations['1000']).toBeDefined();
    expect(parsed.stations['2']).toBeDefined();
    expect(parsed.stations.CHK1).toBeDefined();
    expect(
      parsed.observations.filter(
        (obs) =>
          obs.type === 'angle' &&
          'at' in obs &&
          obs.at === '1' &&
          obs.from === '1000' &&
          (obs.to === '1000' || obs.to === '2' || obs.to === 'CHK1'),
      ),
    ).toHaveLength(6);
  });

  it('imports core FieldGenius setup and shot records into normalized WebNet observations with trace comments', () => {
    const imported = importExternalInput(fieldGeniusFixture, 'fieldgenius_sample.raw');

    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('fieldgenius-raw');
    expect(imported.notice?.title).toBe('Imported FieldGenius dataset');
    expect(imported.notice?.detailLines[0]).toContain('Imported 4 points and 3 observations');
    expect(imported.notice?.detailLines[1]).toContain('Warnings: 2');
    expect(imported.text).toContain("C STN1 5000.0000 1000.0000 100.0000 'SETUP");
    expect(imported.text).toContain('# Imported source line 4 [SS] converted to M');
    expect(imported.text).toContain('M STN1-BS1-P1 045-07-24.2 100.0000 95.0000 1.5000/1.8000');
    expect(imported.text).toContain('# Imported source line 5 [SS] converted to B');
    expect(imported.text).toContain('B STN1 P2 135.0000');
    expect(imported.text).toContain('# Imported source line 5 [SS] converted to D');
    expect(imported.text).toContain('D STN1 P2 50.0000 1.5000/1.6000');
    expect(imported.text).toContain('# WARNING line 6 [GS] Point record missing East/North coordinates and was skipped. raw=GS,PN=GPS1');
    expect(imported.text).toContain(
      '# WARNING line 7 [XX] Unsupported FieldGenius record type was not converted. raw=XX,DATA=UNSUPPORTED',
    );

    const parsed = parseInput(imported.text);
    expect(parsed.stations.STN1).toBeDefined();
    expect(parsed.stations.BS1).toBeDefined();
    expect(parsed.stations.P1).toBeDefined();
    expect(parsed.stations.P2).toBeDefined();
    expect(parsed.observations.some((obs) => obs.type === 'angle')).toBe(true);
    expect(parsed.observations.some((obs) => obs.type === 'dist' && 'to' in obs && obs.to === 'P1')).toBe(
      true,
    );
    expect(parsed.observations.some((obs) => obs.type === 'bearing' && 'to' in obs && obs.to === 'P2')).toBe(
      true,
    );
  });
});
