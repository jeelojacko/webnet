import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  buildIndustryStyleListingText,
  INDUSTRY_PARITY_CASES,
  extractSection,
  extractSectionToEnd,
  extractFixedRowTableSection,
  parseStationEllipseRows,
  parseRelativeEllipseRows,
  parseRawDistanceRows,
  collectMeasuredDirectionRows,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it('keeps the camp design preanalysis listing aligned with the stored Traverse_Only reference across the overlapping preanalysis sections', () => {
    const startup = INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults;
    expect(startup).toBeDefined();

    const result = buildCaseResult('campDesignPreanalysis');
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.preanalysisMode).toBe(true);
    expect(result.parseState?.runMode).toBe('preanalysis');

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: startup?.settingsPatch.maxIterations ?? 10,
        convergenceLimit: startup?.settingsPatch.convergenceLimit,
        precisionReportingMode: 'industry-standard',
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: true,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'stdResidual',
        listingObservationLimit: 9999,
      },
      {
        coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
        order: startup?.parseSettingsPatch.order ?? 'EN',
        angleUnits: startup?.parseSettingsPatch.angleUnits ?? 'dms',
        angleStationOrder: startup?.parseSettingsPatch.angleStationOrder ?? 'atfromto',
        deltaMode: startup?.parseSettingsPatch.deltaMode ?? 'slope',
        refractionCoefficient: startup?.parseSettingsPatch.refractionCoefficient ?? 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
        currentInstrumentCode: startup?.selectedInstrument,
        currentInstrumentDesc: startup?.projectInstruments[startup?.selectedInstrument ?? '']?.desc,
        currentInstrumentLevStdMmPerKm:
          startup?.projectInstruments[startup?.selectedInstrument ?? '']?.levStd_mmPerKm,
        verticalDeflectionNorthSec: startup?.parseSettingsPatch.verticalDeflectionNorthSec ?? 0,
        verticalDeflectionEastSec: startup?.parseSettingsPatch.verticalDeflectionEastSec ?? 0,
        projectInstrumentLibrary: startup?.projectInstruments,
      },
    );

    const referenceOutput = readFileSync(
      INDUSTRY_PARITY_CASES.campDesignPreanalysis.fixtureOutputPath,
      'utf-8',
    );
    expect(readFileSync(INDUSTRY_PARITY_CASES.campDesignPreanalysis.fixtureInputPath, 'utf-8')).toContain(
      '#Traverse Only',
    );
    expect(listing).toContain('STAR*NET Run Mode                   : Preanalysis');
    expect(listing).toContain('Coordinate System                   : UTM83-19');
      expect(listing).toContain('Longitude Sign Convention           : Positive West');
      expect(listing).toContain('Input/Output Coordinate Order       : East-North');
      expect(listing).toContain('Data File List     1. Traverse_Only.dat');
      expect(listing).toContain('Project Default Instrument');
      expect(listing).toContain('Project Library Instrument SX12');
      expect(listing).not.toContain('Project Library Instrument S9');
      expect(listing).toContain('\f');

    const referenceDistanceSection = extractFixedRowTableSection(
      referenceOutput,
      'Measured Distance Observations (Meters)',
      244,
    );
    const currentDistanceSection = extractFixedRowTableSection(
      listing,
      'Measured Distance Observations (Meters)',
      244,
    );
    const referenceDistanceRows = parseRawDistanceRows(referenceDistanceSection);
    const currentDistanceRows = parseRawDistanceRows(currentDistanceSection);
    expect(currentDistanceRows).toHaveLength(referenceDistanceRows.length);
    const groupDistanceRows = (rows: ReturnType<typeof parseRawDistanceRows>) =>
      rows.reduce<Record<string, ReturnType<typeof parseRawDistanceRows>>>((acc, row) => {
        const key = [row.from, row.to].sort().join('\t');
        (acc[key] ??= []).push(row);
        return acc;
      }, {});
    const referenceDistanceGroups = groupDistanceRows(referenceDistanceRows);
    const currentDistanceGroups = groupDistanceRows(currentDistanceRows);
    expect(Object.keys(currentDistanceGroups)).toEqual(Object.keys(referenceDistanceGroups));
    Object.entries(referenceDistanceGroups).forEach(([key, expectedRows]) => {
      const currentRows = currentDistanceGroups[key];
      expect(currentRows, `missing current distance group ${key}`).toBeDefined();
      expectedRows.forEach((expected) => {
        const match = currentRows.find(
          (row) =>
            Math.abs(row.distance - expected.distance) <= 0.002 &&
            Math.abs(row.stdErr - expected.stdErr) <= 0.0002 &&
            Math.abs(row.hi - expected.hi) <= 0.001 &&
            Math.abs(row.ht - expected.ht) <= 0.001 &&
            Math.abs(row.combinedFactor - expected.combinedFactor) <= 0.000001 &&
            row.type === expected.type,
        );
        expect(match, `missing matching distance row in group ${key}`).toBeDefined();
      });
    });

    const referenceDirectionRows = collectMeasuredDirectionRows(
      referenceOutput,
      'Measured Direction Observations (DMS)',
      244,
    );
    const currentDirectionRows = collectMeasuredDirectionRows(
      listing,
      'Measured Direction Observations (DMS)',
      244,
    );
    expect(currentDirectionRows).toHaveLength(referenceDirectionRows.length);
    referenceDirectionRows.forEach((expected, index) => {
      const current = currentDirectionRows[index];
      expect(current).toBeDefined();
      expect(current?.from).toBe(expected.from);
      expect(current?.to).toBe(expected.to);
      expect(current?.directionDms).toBe(expected.directionDms);
      expect(Math.abs((current?.stdErrSec ?? 0) - expected.stdErrSec)).toBeLessThanOrEqual(0.02);
      expect(Math.abs((current?.tt ?? 0) - expected.tt)).toBeLessThanOrEqual(0.05);
    });

    const referenceStationEllipseSection = extractSection(
      referenceOutput,
      'Station Coordinate Error Ellipses (Meters)',
      'Relative Error Ellipses (Meters)',
    );
    const currentStationEllipseSection = extractSection(
      listing,
      'Station Coordinate Error Ellipses (Meters)',
      'Relative Error Ellipses (Meters)',
    );
    const referenceStationEllipseRows = parseStationEllipseRows(referenceStationEllipseSection);
    const currentStationEllipseRows = parseStationEllipseRows(currentStationEllipseSection);
    expect(currentStationEllipseRows).toHaveLength(referenceStationEllipseRows.length);
    const referenceStationEllipseMap = new Map(
      referenceStationEllipseRows.map((row) => [row.stationId, row] as const),
    );
    currentStationEllipseRows.forEach((row) => {
      const expected = referenceStationEllipseMap.get(row.stationId);
      expect(expected, `missing reference station ellipse row ${row.stationId}`).toBeDefined();
      expect(Math.abs(row.major - (expected?.major ?? 0))).toBeLessThanOrEqual(0.05);
      expect(Math.abs(row.minor - (expected?.minor ?? 0))).toBeLessThanOrEqual(0.05);
    });

    const referenceRelativeEllipseSection = extractSection(
      referenceOutput,
      'Relative Error Ellipses (Meters)',
      'End of File',
    );
    const currentRelativeEllipseSection = extractSectionToEnd(
      listing,
      'Relative Error Ellipses (Meters)',
    );
    const referenceRelativeEllipseRows = parseRelativeEllipseRows(referenceRelativeEllipseSection);
    const currentRelativeEllipseRows = parseRelativeEllipseRows(currentRelativeEllipseSection);
    const referenceRelativeEllipseMap = new Map(
      referenceRelativeEllipseRows.map((row) => [`${row.from}\t${row.to}`, row] as const),
    );
    const currentRelativeEllipseMap = new Map(
      currentRelativeEllipseRows.map((row) => [`${row.from}\t${row.to}`, row] as const),
    );
    ([
      ['GPS2', 'GPS5'],
      ['109', '114'],
      ['129', 'PITA'],
      ['119', '120'],
    ] as const).forEach(([from, to]) => {
      const key: `${string}\t${string}` = `${from}\t${to}`;
      const current = currentRelativeEllipseMap.get(key);
      const expected = referenceRelativeEllipseMap.get(key);
      expect(current, `missing current relative ellipse row ${from}-${to}`).toBeDefined();
      expect(expected, `missing reference relative ellipse row ${from}-${to}`).toBeDefined();
      expect(Math.abs((current?.major ?? 0) - (expected?.major ?? 0))).toBeLessThanOrEqual(0.05);
      expect(Math.abs((current?.minor ?? 0) - (expected?.minor ?? 0))).toBeLessThanOrEqual(0.05);
    });

  }, 120000);

});
