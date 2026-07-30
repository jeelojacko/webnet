import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  buildIndustryStyleListingText,
  INDUSTRY_PARITY_CASES,
  extractSection,
  normalizeAzimuthDifferenceDeg,
  parseConvergenceRow,
  parseRelationshipRow,
  parseRawDistanceRows,
  parseRawZenithRows,
  parseMeasuredDirectionSection,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it(
    'matches the traverse raw unadjusted distance, zenith, and direction sections line-for-line',
    () => {
      const startup = INDUSTRY_PARITY_CASES.traverse.startupDefaults;
      expect(startup).toBeDefined();

      const result = buildCaseResult('traverse');
      expect(result.success).toBe(true);

      const listing = buildIndustryStyleListingText(
        result,
        {
          maxIterations: 10,
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
          listingSortObservationsBy: 'input',
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
          projectInstrumentLibrary: startup?.projectInstruments,
        },
      );

      const referenceOutput = readFileSync(INDUSTRY_PARITY_CASES.traverse.fixtureOutputPath, 'utf-8');

      const rawDistanceSection = extractSection(
        listing,
        'Number of Measured Distance Observations (Meters) = 451',
        'Number of Zenith Observations (DMS) = 451',
      );
      const expectedRawDistanceSection = extractSection(
        referenceOutput,
        'Number of Measured Distance Observations (Meters) = 451',
        'Number of Zenith Observations (DMS) = 451',
      );
      const rawDistanceRows = parseRawDistanceRows(rawDistanceSection);
      const expectedRawDistanceRows = parseRawDistanceRows(expectedRawDistanceSection);
      expect(rawDistanceRows).toHaveLength(expectedRawDistanceRows.length);
      rawDistanceRows.forEach((row, index) => {
        const expected = expectedRawDistanceRows[index];
        expect(row.from).toBe(expected.from);
        expect(row.to).toBe(expected.to);
        expect(row.distance).toBeCloseTo(expected.distance, 4);
        expect(row.stdErr).toBeCloseTo(expected.stdErr, 4);
        expect(row.hi).toBeCloseTo(expected.hi, 3);
        expect(row.ht).toBeCloseTo(expected.ht, 3);
        expect(Math.abs(row.combinedFactor - expected.combinedFactor)).toBeLessThan(0.0000002);
        expect(row.type).toBe(expected.type);
      });

      const rawZenithSection = extractSection(
        listing,
        'Number of Zenith Observations (DMS) = 451',
        'Number of Measured Direction Observations (DMS) = 451',
      );
      const expectedRawZenithSection = extractSection(
        referenceOutput,
        'Number of Zenith Observations (DMS) = 451',
        'Number of Measured Direction Observations (DMS) = 451',
      );
      const rawZenithRows = parseRawZenithRows(rawZenithSection);
      const expectedRawZenithRows = parseRawZenithRows(expectedRawZenithSection);
      expect(rawZenithRows).toHaveLength(expectedRawZenithRows.length);
      rawZenithRows.forEach((row, index) => {
        const expected = expectedRawZenithRows[index];
        expect(row.from).toBe(expected.from);
        expect(row.to).toBe(expected.to);
        expect(row.zenithDms).toBe(expected.zenithDms);
        expect(Math.abs(row.stdErrSec - expected.stdErrSec)).toBeLessThanOrEqual(0.01);
        expect(row.hi).toBeCloseTo(expected.hi, 3);
        expect(row.ht).toBeCloseTo(expected.ht, 3);
      });

      const rawDirectionSection = extractSection(
        listing,
        'Number of Measured Direction Observations (DMS) = 451',
        'Number of Grid Azimuth/Bearing Observations (DMS) = 1',
      );
      const expectedRawDirectionSection = extractSection(
        referenceOutput,
        'Number of Measured Direction Observations (DMS) = 451',
        'Number of Grid Azimuth/Bearing Observations (DMS) = 1',
      );
      const rawDirectionEntries = parseMeasuredDirectionSection(rawDirectionSection);
      const expectedRawDirectionEntries = parseMeasuredDirectionSection(expectedRawDirectionSection);
      expect(rawDirectionEntries).toHaveLength(expectedRawDirectionEntries.length);
      rawDirectionEntries.forEach((entry, index) => {
        const expected = expectedRawDirectionEntries[index];
        expect(entry.kind).toBe(expected.kind);
        if (entry.kind === 'set' && expected.kind === 'set') {
          expect(entry.label).toBe(expected.label);
          return;
        }
        if (entry.kind === 'row' && expected.kind === 'row') {
          expect(entry.from).toBe(expected.from);
          expect(entry.to).toBe(expected.to);
          expect(entry.directionDms).toBe(expected.directionDms);
          expect(Math.abs(entry.stdErrSec - expected.stdErrSec)).toBeLessThanOrEqual(0.02);
          expect(Math.abs(entry.tt - expected.tt)).toBeLessThanOrEqual(0.01);
          return;
        }
        throw new Error(`direction entry mismatch at index ${index}`);
      });
    },
    120000,
  );

  it(
    'keeps the later traverse listing sections on the industry-style station order, file-line numbering, and fixed-bearing layout',
    () => {
      const startup = INDUSTRY_PARITY_CASES.traverse.startupDefaults;
      expect(startup).toBeDefined();

      const result = buildCaseResult('traverse');
      expect(result.success).toBe(true);

      const listing = buildIndustryStyleListingText(
        result,
        {
          maxIterations: 10,
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
          projectInstrumentLibrary: startup?.projectInstruments,
        },
      );

      const convergenceSection = extractSection(
        listing,
        'Convergence Angles (DMS) and Grid Factors at Stations',
        'Adjusted Measured Distance Observations (Meters)',
      );
      const expectedConvergenceSection = extractSection(
        readFileSync(INDUSTRY_PARITY_CASES.traverse.fixtureOutputPath, 'utf-8'),
        'Convergence Angles (DMS) and Grid Factors at Stations',
        'Adjusted Measured Distance Observations (Meters)',
      );
      for (const stationId of ['OOP', 'GPS2', 'APOG']) {
        const current = parseConvergenceRow(convergenceSection, stationId);
        const expected = parseConvergenceRow(expectedConvergenceSection, stationId);
        expect(Math.abs(current.convergenceSec - expected.convergenceSec)).toBeLessThan(0.05);
        expect(Math.abs(current.gridScale - expected.gridScale)).toBeLessThan(0.0000002);
        expect(Math.abs(current.elevationFactor - expected.elevationFactor)).toBeLessThan(0.00000002);
        expect(Math.abs(current.combinedFactor - expected.combinedFactor)).toBeLessThan(0.0000002);
      }

      const adjustedDistanceSection = extractSection(
        listing,
        'Adjusted Measured Distance Observations (Meters)',
        'Adjusted Zenith Observations (DMS)',
      );
      expect(adjustedDistanceSection).toContain('1:180');
      expect(adjustedDistanceSection).toContain('1:1011');
      expect(adjustedDistanceSection).not.toContain('1:147');

      const adjustedBearingSection = extractSection(
        listing,
        'Adjusted Grid Azimuth/Bearing Observations (DMS)',
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
      );
      expect(adjustedBearingSection).toContain(
        'GPS5       GPS2       N36-50-16.60W    -0-00-00.00      -0.0000    FIXED   0.0      1:15',
      );

      const adjustedCoordinateSection = extractSection(
        listing,
        'Adjusted Coordinates (Meters)',
        'Adjusted Measured Distance Observations (Meters)',
      );
      expect(adjustedCoordinateSection).toContain(
        '100                  7438248.0386   2488864.0001     76.4664',
      );
      expect(adjustedCoordinateSection).toContain(
        'PEAT                 7438221.9759   2488879.1635     75.1619',
      );

      const geodeticSummarySection = extractSection(
        listing,
        'Geodetic Position Summary',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );
      expect(geodeticSummarySection).toContain('Longitude (DMS)');
      expect(geodeticSummarySection).toContain('OOP      045-56-45.725025  066-38-39.');
      expect(geodeticSummarySection).not.toContain('-066-38-39.');

      const relationshipSection = extractSection(
        listing,
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      );
      const expectedRelationshipSection = extractSection(
        readFileSync(INDUSTRY_PARITY_CASES.traverse.fixtureOutputPath, 'utf-8'),
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Relative Error Ellipses (Meters)',
      );
      for (const [from, to] of [
        ['100', '124'],
        ['101', '102'],
        ['109', 'GPS2'],
      ] as const) {
        const current = parseRelationshipRow(relationshipSection, from, to);
        const expected = parseRelationshipRow(expectedRelationshipSection, from, to);
        expect(normalizeAzimuthDifferenceDeg(current.bearingDeg, expected.bearingDeg) * 3600).toBeLessThan(
          0.05,
        );
        expect(Math.abs(current.gridDistance - expected.gridDistance)).toBeLessThan(0.0002);
        expect(Math.abs(current.bearingConfidenceSec - expected.bearingConfidenceSec)).toBeLessThan(
          0.05,
        );
        expect(Math.abs(current.distanceConfidence - expected.distanceConfidence)).toBeLessThan(
          0.0002,
        );
        expect(Math.abs(current.ppm - expected.ppm)).toBeLessThan(0.2);
      }
      expect(relationshipSection).not.toContain('GPS5       GPS2        N36-50-16.60W');

      expect(listing).toContain('Relative Error Ellipses (Meters)');
      expect(listing).toContain(
        'Stations                Semi-Major    Semi-Minor   Azimuth of     Vertical',
      );
      expect(listing).toContain(
        '100        124            0.002535      0.002199      38-02       0.001534',
      );
      expect(listing).toContain(
        '116        GPS3           0.002917      0.002829      99-44       0.001526',
      );

      const adjustedDirectionSection = extractSection(
        listing,
        'Adjusted Measured Direction Observations (DMS)',
        'Adjusted Grid Azimuth/Bearing Observations (DMS)',
      );
      expect(adjustedDirectionSection.indexOf('Set 18')).toBeGreaterThanOrEqual(0);
      expect(adjustedDirectionSection.indexOf('Set 19')).toBeGreaterThan(
        adjustedDirectionSection.indexOf('Set 18'),
      );
      expect(adjustedDirectionSection.indexOf('Set 24')).toBeLessThan(
        adjustedDirectionSection.indexOf('Set 19'),
      );
      expect(adjustedDirectionSection).toContain(
        '103        102         359-59-50.33    -0-00-09.67      -0.0035     5.85   1.7     1:150',
      );
      expect(adjustedDirectionSection).toContain(
        '104        105         176-00-47.18    -0-00-05.42      -0.0035     3.42   1.6     1:197',
      );
      expect(listing).not.toContain('Grid vs Ground Distance Diagnostics');
    },
    120000,
  );

  it(
    'keeps the traverse raw fixed-bearing solve exact and the connected covariance rows near the reference',
    () => {
      const result = buildCaseResult('traverse');
      expect(result.success).toBe(true);

      const from = result.stations.GPS5;
      const to = result.stations.GPS2;
      expect(from).toBeDefined();
      expect(to).toBeDefined();

      let rawAzimuthRad = Math.atan2((to?.x ?? 0) - (from?.x ?? 0), (to?.y ?? 0) - (from?.y ?? 0));
      if (rawAzimuthRad < 0) rawAzimuthRad += 2 * Math.PI;
      const fixedBearingRad = (323 + 9 / 60 + 43.4014 / 3600) * (Math.PI / 180);
      const fixedBearingResidualSec = ((rawAzimuthRad - fixedBearingRad) * 180 * 3600) / Math.PI;
      expect(Math.abs(fixedBearingResidualSec)).toBeLessThan(1e-4);

      const row = result.relativeCovariances?.find(
        (candidate) => candidate.from === '100' && candidate.to === '124',
      );
      expect(row).toBeDefined();

      const confidence95Scale = Math.sqrt(5.991464547107979);
      const oneDimensional95Scale = 1.959963984540054;
      const sigmaAz95Sec = (((row?.sigmaAz ?? 0) * 180) / Math.PI) * 3600 * confidence95Scale;
      const sigmaDist95 = (row?.sigmaDist ?? 0) * confidence95Scale;
      const ellipseMajor95 = (row?.ellipse?.semiMajor ?? 0) * confidence95Scale;
      const ellipseMinor95 = (row?.ellipse?.semiMinor ?? 0) * confidence95Scale;
      const sigmaH95 = (row?.sigmaH ?? 0) * oneDimensional95Scale;

      expect(sigmaAz95Sec).toBeCloseTo(5.6, 2);
      expect(sigmaDist95).toBeCloseTo(0.0025, 4);
      expect(ellipseMajor95).toBeCloseTo(0.002535, 6);
      expect(ellipseMinor95).toBeCloseTo(0.002199, 6);
      expect(sigmaH95).toBeCloseTo(0.001534, 6);
    },
    120000,
  );

});
