import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  getExternalImporters,
  importExternalInput,
  parseDbxTextExport,
  parseFieldGenius,
  parseJobXml,
  parseRw5Dataset,
  parseTrimbleSurveyReport,
} from '../src/engine/importers';
import { parseTerrestrialCoordinateCsv } from '../src/engine/terrestrialCsvImport';
import { parseInput } from '../src/engine/parse';
import { splitImportedCodeDescription } from '../src/engine/importers/shared';

const surveyFixture = readFileSync('tests/fixtures/trimble_survey_report_sample.htm', 'utf-8');
const jobxmlFixture = readFileSync('tests/fixtures/jobxml_measurement_sample.jxl', 'utf-8');

const RW5_CODED = [
  'JB,NM,CODED',
  'MO,AD0,UN0,SF1.0000',
  'OC,OPSTN1,N 1000.0000,E 5000.0000,EL100.0000,--SETUP',
  'SP,PNBS1,N 900.0000,E 5000.0000,EL99.5000,FCBM,--Bench mark',
  'BK,OPSTN1,BPBS1',
  'LS,HI1.5000,HR1.8000',
  'SS,OPSTN1,FPP1,AR45.1234,SD100.0000,ZE95.0000,FCTP,--Trail edge',
].join('\n');

describe('Phase 13D importer code/description normalization', () => {
  it('separates RW5 shot feature codes from descriptions with raw preserved', () => {
    const dataset = parseRw5Dataset(RW5_CODED, 'coded.rw5', 'carlson');
    expect(dataset).not.toBeNull();
    const shot = dataset!.observations.find(
      (obs) => 'toId' in obs && obs.toId === 'P1',
    );
    expect(shot?.description).toBe('Trail edge');
    expect(shot?.feature?.codes?.[0]).toMatchObject({ code: 'TP', role: 'both' });
    expect(shot?.feature?.rawCodeText).toBe('TP');
    expect(shot?.feature?.description).toBe('Trail edge');
  });

  it('splits RW5 control codes from descriptions without collapsing', () => {
    const dataset = parseRw5Dataset(RW5_CODED, 'coded.rw5', 'carlson');
    const station = dataset!.controlStations.find((station) => station.stationId === 'BS1');
    expect(station?.description).toBe('Bench mark');
    expect(station?.feature?.codes?.[0]?.code).toBe('BM');
    expect(station?.feature?.rawCodeText).toBe('BM');
  });

  it('carries FieldGenius shot codes and descriptions', () => {
    const input = [
      'OC,PN=STN1,E=5000.000,N=1000.000,Z=100.000,HI=1.500',
      'BK,PN=BS1,E=5000.000,N=900.000,Z=99.500',
      'SS,PN=P9,E=5070.000,N=1070.000,Z=99.100,HA=45.1234,SD=100.000,VA=95.0000,HT=1.800,CODE=TRL,DESC=Trail',
    ].join('\n');
    const dataset = parseFieldGenius(input, 'coded.raw');
    const shot = dataset!.observations.find((obs) => 'toId' in obs && obs.toId === 'P9');
    expect(shot?.description).toBe('Trail');
    expect(shot?.feature?.codes?.[0]).toMatchObject({ code: 'TRL', role: 'both' });
  });

  it('carries DBX observation and point codes with descriptions', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<DBXSurveyExport>
  <Points>
    <Point name="STN9"><Northing>3000.0</Northing><Easting>7000.0</Easting><Elevation>75.0</Elevation><Code>CTRL</Code><Description>Control mark</Description></Point>
    <Point name="BS9"><Northing>2900.0</Northing><Easting>7000.0</Easting><Elevation>74.5</Elevation></Point>
  </Points>
  <Setups><Setup id="SET1"><OccupyPoint>STN9</OccupyPoint><BacksightPoint>BS9</BacksightPoint></Setup></Setups>
  <Observations>
    <Observation setupId="SET1"><TargetPoint>P9</TargetPoint><HorizontalAngle>45.0</HorizontalAngle><SlopeDistance>80.0</SlopeDistance><Zenith>92.5</Zenith><Code>SS</Code><Description>Side shot</Description></Observation>
  </Observations>
</DBXSurveyExport>`;
    const dataset = parseDbxTextExport(input, 'coded.dbx');
    expect(dataset).not.toBeNull();
    const point = dataset!.controlStations.find((station) => station.stationId === 'STN9');
    expect(point?.description).toBe('Control mark');
    expect(point?.feature?.codes?.[0]?.code).toBe('CTRL');
    const shot = dataset!.observations.find((obs) => 'toId' in obs && obs.toId === 'P9');
    expect(shot?.description).toBe('Side shot');
    expect(shot?.feature?.codes?.[0]).toMatchObject({ code: 'SS', role: 'both' });
  });

  it('leaves survey-report shots empty when no Code column value exists', () => {
    const dataset = parseTrimbleSurveyReport(surveyFixture, 'trimble_survey_report_sample.htm');
    expect(dataset).not.toBeNull();
    const shot = dataset!.observations.find((obs) => 'toId' in obs && obs.toId === '235');
    expect(shot?.description).toBeUndefined();
    expect(shot?.feature).toBeUndefined();
  });

  it('carries survey-report shot codes when the Code column is populated', () => {
    const coded = surveyFixture
      .split('<th width="9%" align="left">Code</th>\n        <td width="11%" align="right"></td>')
      .join('<th width="9%" align="left">Code</th>\n        <td width="11%" align="right">TRL</td>');
    const dataset = parseTrimbleSurveyReport(coded, 'coded.htm');
    const shots = dataset!.observations.filter((obs) => 'toId' in obs && obs.toId === '235');
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot.feature?.codes?.[0]).toMatchObject({ code: 'TRL', role: 'both' });
    }
  });

  it('splits JobXML measurement codes from descriptive text and preserves point raws', () => {
    const coded = jobxmlFixture.replace(
      '<TargetID>T1</TargetID>',
      '<TargetID>T1</TargetID>\n      <Code>TRL</Code>\n      <Description>Trail edge</Description>',
    );
    const dataset = parseJobXml(coded, 'coded.jxl');
    expect(dataset).not.toBeNull();
    const station = dataset!.controlStations.find((s) => s.stationId === 'STN1');
    expect(station?.description).toBe('SETUP');
    expect(station?.feature?.codes?.[0]?.code).toBe('SETUP');
    expect(station?.feature?.rawCodeText).toBe('SETUP');
    const shot = dataset!.observations.find((obs) => 'toId' in obs && obs.toId === 'SHOT_1');
    expect(shot?.description).toBe('Trail edge');
    expect(shot?.feature?.codes?.[0]).toMatchObject({ code: 'TRL', role: 'both' });
  });

  it('leaves description-only records without feature codes', () => {
    const split = splitImportedCodeDescription(undefined, 'Trail edge', 7);
    expect(split.description).toBe('Trail edge');
    expect(split.feature).toBeUndefined();
  });

  it('preserves raw whitespace while canonical codes match trimmed', () => {
    const split = splitImportedCodeDescription('  EP  ', '  Edge  ', 3);
    expect(split.feature?.codes?.[0]).toMatchObject({ code: 'EP', rawCode: '  EP  ', role: 'both' });
    expect(split.feature?.rawCodeText).toBe('  EP  ');
    expect(split.description).toBe('Edge');
  });

  it('does not invent FieldGenius shot codes from descriptions alone', () => {
    const input = [
      'OC,PN=STN1,E=5000.000,N=1000.000,Z=100.000,HI=1.500',
      'BK,PN=BS1,E=5000.000,N=900.000,Z=99.500',
      'SS,PN=P9,E=5070.000,N=1070.000,Z=99.100,HA=45.1234,SD=100.000,VA=95.0000,HT=1.800,DESC=Trail',
    ].join('\n');
    const dataset = parseFieldGenius(input, 'desc-only.raw');
    const shot = dataset!.observations.find((obs) => 'toId' in obs && obs.toId === 'P9');
    expect(shot?.description).toBe('Trail');
    expect(shot?.feature).toBeUndefined();
  });

  it('keeps RW5 numerical outputs unchanged after normalization', () => {
    const imported = importExternalInput(RW5_CODED, 'coded.rw5');
    expect(imported.detected).toBe(true);
    expect(imported.text).toContain('M STN1-BS1-P1 045-12-34.0 100.0000 095-00-00.0 1.5000/1.8000');
    const reparsed = parseInput(imported.text);
    expect(reparsed.observations.length).toBeGreaterThan(0);
    expect(reparsed.stations.BS1).toBeDefined();
  });
});

describe('Phase 13D terrestrial coordinate CSV', () => {
  it('imports generic aliased headers with explicit units and no N/E swap', () => {
    const csv = 'ID,N,E,H,CODE,DESC\nA1,1000.0,5000.0,100.0,CTRL,Control mark\nA2,900.0,5000.0,99.5,BM,Bench';
    const dataset = parseTerrestrialCoordinateCsv(csv, { units: 'm' }, 'pts.csv');
    expect(dataset).not.toBeNull();
    const a1 = dataset!.controlStations.find((station) => station.stationId === 'A1');
    expect(a1?.northM).toBe(1000.0);
    expect(a1?.eastM).toBe(5000.0);
    expect(a1?.heightM).toBe(100.0);
    expect(a1?.description).toBe('Control mark');
    expect(a1?.feature?.codes?.[0]).toMatchObject({ code: 'CTRL', role: 'both' });
  });

  it('supports the Trimble Access preset and manual column mapping', () => {
    const access = 'Point Name,Point Code,Northing,Easting,Elevation\nT1,TP,2000.0,6000.0,50.0';
    const preset = parseTerrestrialCoordinateCsv(access, { units: 'm', preset: 'trimble-access' }, 'access.csv');
    expect(preset?.controlStations[0]?.stationId).toBe('T1');
    expect(preset?.controlStations[0]?.feature?.codes?.[0]?.code).toBe('TP');

    const odd = 'Punkt,Hoch,Rechts\nM1,3000.0,7000.0';
    const mapped = parseTerrestrialCoordinateCsv(
      odd,
      { units: 'm', columnMapping: { id: 'Punkt', northing: 'Hoch', easting: 'Rechts' } },
      'odd.csv',
    );
    expect(mapped?.controlStations[0]?.stationId).toBe('M1');
    expect(mapped?.controlStations[0]?.northM).toBe(3000.0);
    expect(mapped?.controlStations[0]?.eastM).toBe(7000.0);
  });

  it('scales explicit non-meter units and rejects unknown units or missing columns', () => {
    const mm = 'Point,Northing,Easting\nM1,1000000.0,5000000.0';
    expect(parseTerrestrialCoordinateCsv(mm, { units: 'mm' }, 'mm.csv')?.controlStations[0]?.northM).toBe(1000.0);
    expect(parseTerrestrialCoordinateCsv(mm, { units: 'furlongs' }, 'x.csv')).toBeNull();
    expect(parseTerrestrialCoordinateCsv('Point,Northing\nM1,1000.0', { units: 'm' }, 'x.csv')).toBeNull();
  });

  it('registers in the generic importer registry with a meter default', () => {
    const ids = getExternalImporters().map((importer) => importer.id);
    expect(ids).toContain('terrestrial-csv');
    const csv = 'Point,Northing,Easting\nR1,1000.0,5000.0';
    const imported = importExternalInput(csv, 'pts.csv');
    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('terrestrial-csv');
    expect(imported.text).toContain('C R1 5000.0000 1000.0000 0.0000');
  });
});
