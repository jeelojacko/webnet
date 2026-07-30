import { describe, expect, it } from 'vitest';
import {
  buildIndustryStyleListingText,
  INDUSTRY_PARITY_CASES,
  normalizeLineEndings,
  extractSection,
  parseObservationStatisticRow,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it(
    'keeps the combined parity case convergent with the expected mixed-network default instrument and vertical deflection display',
    () => {
      const startup = INDUSTRY_PARITY_CASES.combined.startupDefaults;
      expect(startup).toBeDefined();

      const result = buildCaseResult('combined');
      expect(result.success).toBe(true);
      expect(result.converged).toBe(true);
      expect(
        result.logs.some((line) => line.includes('mixed coordinate classes')),
      ).toBe(false);

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
          currentInstrumentLevStdMmPerKm:
            startup?.projectInstruments[startup?.selectedInstrument ?? '']?.levStd_mmPerKm,
          verticalDeflectionNorthSec: startup?.parseSettingsPatch.verticalDeflectionNorthSec ?? 0,
          verticalDeflectionEastSec: startup?.parseSettingsPatch.verticalDeflectionEastSec ?? 0,
          projectInstrumentLibrary: startup?.projectInstruments,
        },
      );

      expect(listing).toContain(
        'Vertical Deflection                 : N=-2.910 E=-1.460 (Seconds)',
      );
      expect(listing).toContain('Project Default Instrument');
      expect(listing).toContain('Distances (Constant)              :    0.001000 Meters');
      expect(listing).toContain('Directions                        :    1.000000 Seconds');
      expect(listing).toContain('Differential Levels               :    0.001500 Meters / Km');

      const statisticalSummary = extractSection(
        listing,
        'Statistical Summary',
        'Adjusted Coordinates (Meters)',
      );
      const zeniths = parseObservationStatisticRow(statisticalSummary, 'Zenith');
      const levelData = parseObservationStatisticRow(statisticalSummary, 'Level Data');
      const gpsDeltas = parseObservationStatisticRow(statisticalSummary, 'GPS Deltas');
      const total = parseObservationStatisticRow(statisticalSummary, 'Total');
      expect(zeniths.count).toBe(506);
      expect(zeniths.sumSquares).toBeCloseTo(693.125, 0);
      expect(levelData.count).toBe(60);
      expect(levelData.sumSquares).toBeCloseTo(51.57, 0);
      expect(gpsDeltas.count).toBe(36);
      expect(gpsDeltas.sumSquares).toBeCloseTo(30.608, 0);
      expect(gpsDeltas.errorFactor).toBeCloseTo(1.027, 1);
      expect(total.count).toBe(1615);
      expect(total.sumSquares).toBeCloseTo(1250.713, 0);

      const adjustedGpsVectorSection = extractSection(
        listing,
        'Adjusted GPS Vector Observations (Meters)',
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
      );
      const normalizedAdjustedGpsVectorSection = adjustedGpsVectorSection.replace(/\s+/g, ' ').trim();
      expect(normalizedAdjustedGpsVectorSection).toContain(
        '(V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc)',
      );
      expect(normalizedAdjustedGpsVectorSection).toContain(
        'FRDN Delta-N 1109.0406 -0.0003 0.0005 0.7 1:1804',
      );
      expect(normalizedAdjustedGpsVectorSection).toContain(
        'Delta-U -35.5079 0.0023 0.0035 0.7',
      );
      expect(normalizedAdjustedGpsVectorSection).toContain(
        'GPS6 Delta-N -253.9073 0.0019 0.0040 0.5 1:1863',
      );

      const relationshipSection = extractSection(
        listing,
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      );
      const normalizedRelationshipSection = relationshipSection.replace(/\s+/g, ' ').trim();
      expect(normalizedRelationshipSection).toContain('APOG BROD N13-55-59.45E 841.8814');
      expect(normalizedRelationshipSection).toMatch(
        /(?:PITA TIMS|TIMS PITA)\s+(?:N49-03-55\.15W|S49-03-55\.14E)\s+285\.463[89]/,
      );

      const stationEllipseSection = extractSection(
        listing,
        'Station Coordinate Error Ellipses (Meters)',
        'Relative Error Ellipses (Meters)',
      );
      expect(stationEllipseSection).toContain(
        'FRDN                      0.000000      0.000000       0-00       0.000000',
      );
      expect(stationEllipseSection.replace(/\s+/g, ' ').trim()).toContain(
        'APOG 0.001009 0.000805',
      );
      expect(stationEllipseSection).not.toContain('GPS2');
      expect(stationEllipseSection).not.toContain('100                       ');

      const relativeEllipseSection = extractSection(
        listing,
        'Relative Error Ellipses (Meters)',
        'Cluster Detection Candidates',
      );
      const normalizedRelativeEllipseSection = relativeEllipseSection.replace(/\s+/g, ' ').trim();
      expect(normalizedRelativeEllipseSection).toContain(
        'APOG BROD 0.001639 0.001298',
      );
      expect(normalizedRelativeEllipseSection).toMatch(
        /(?:PITA TIMS|TIMS PITA)\s+0\.003678\s+0\.00320[67]/,
      );
      const selectedRelativeStations = new Set([
        'APOG',
        'BROD',
        'OOP',
        'FM1',
        'GATE',
        'TIMS',
        'PEAT',
        'POT',
        'PITA',
      ]);
      const relativeEllipseRowCount = normalizeLineEndings(relativeEllipseSection)
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(
          (parts) =>
            parts.length >= 6 &&
            selectedRelativeStations.has(parts[0]) &&
            selectedRelativeStations.has(parts[1]) &&
            /^\d+\.\d+$/.test(parts[2]),
        ).length;
      expect(relativeEllipseRowCount).toBe(36);
    },
    120000,
  );

  it('keeps the combined TS sideshot coordinates aligned with the stored industry reference', () => {
    const result = buildCaseResult('combined');
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);

    const expectedRows = [
      { sourceLine: 498, to: 'Chimney', northing: 7438679.1305, easting: 2489065.9085, height: 53.8799 },
      { sourceLine: 507, to: 'Chimney', northing: 7438679.1316, easting: 2489065.9068, height: 53.8781 },
      { sourceLine: 516, to: 'Chimney', northing: 7438679.1310, easting: 2489065.9083, height: 53.8784 },
      { sourceLine: 526, to: 'Meridian', northing: 7438484.5882, easting: 2489095.4001, height: 49.7369 },
      { sourceLine: 533, to: 'Meridian', northing: 7438484.5880, easting: 2489095.3999, height: 49.7369 },
      { sourceLine: 540, to: 'Meridian', northing: 7438484.5889, easting: 2489095.4000, height: 49.7367 },
      { sourceLine: 547, to: 'Meridian', northing: 7438484.5879, easting: 2489095.4000, height: 49.7367 },
      { sourceLine: 574, to: 'Meridian', northing: 7438484.5872, easting: 2489095.3997, height: 49.7367 },
      { sourceLine: 575, to: 'Meridian', northing: 7438484.5877, easting: 2489095.4004, height: 49.7368 },
      { sourceLine: 576, to: 'Meridian', northing: 7438484.5868, easting: 2489095.3990, height: 49.7371 },
      { sourceLine: 611, to: 'Chimney', northing: 7438679.1444, easting: 2489065.9139, height: 54.2852 },
      { sourceLine: 619, to: 'Chimney', northing: 7438679.1463, easting: 2489065.9122, height: 54.2970 },
      { sourceLine: 627, to: 'Chimney', northing: 7438679.1439, easting: 2489065.9152, height: 54.2937 },
    ];

    expectedRows.forEach((expected) => {
      const row = (result.sideshots ?? []).find(
        (candidate) => candidate.mode !== 'gps' && candidate.sourceLine === expected.sourceLine,
      );
      expect(row, `missing sideshot row for line ${expected.sourceLine}`).toBeDefined();
      expect(row?.to).toBe(expected.to);
      expect(Math.abs((row?.northing ?? 0) - expected.northing)).toBeLessThan(0.001);
      expect(Math.abs((row?.easting ?? 0) - expected.easting)).toBeLessThan(0.001);
      expect(Math.abs((row?.height ?? 0) - expected.height)).toBeLessThan(0.001);
    });
  });

  it(
    'renders positional tolerance checks for .PTOL-selected combined-case pairs when project settings enable them',
    () => {
      const startup = INDUSTRY_PARITY_CASES.combined.startupDefaults;
      expect(startup).toBeDefined();

      const result = buildCaseResult('combined', {
        positionalToleranceEnabled: true,
        positionalToleranceConstantMm: 0,
        positionalTolerancePpm: 0,
        positionalToleranceConfidencePercent: 95,
      });
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
          positionalToleranceEnabled: true,
          positionalToleranceConstantMm: 0,
          positionalTolerancePpm: 0,
          positionalToleranceConfidencePercent: 95,
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

      const positionalToleranceSection = extractSection(
        listing,
        'Positional Tolerance Checks (Meters)',
        'Cluster Detection Candidates',
      );
      expect(positionalToleranceSection).toContain('Tolerance = 0.000000 Meters + 0.000 PPM');
      expect(positionalToleranceSection).toContain('Confidence Region = 95.00%');
      expect(positionalToleranceSection).toContain('APOG       BROD');
      expect(positionalToleranceSection).toMatch(/(?:PITA|TIMS)\s+(?:PITA|TIMS)\s+285\.4639/);
      const positionalToleranceRowCount = normalizeLineEndings(positionalToleranceSection)
        .split('\n')
        .filter((line) => /^\s*[A-Za-z0-9_-]+\s+[A-Za-z0-9_-]+\s+\d+\.\d+.*\s(?:PASS|FAIL)\s*$/.test(line))
        .length;
      expect(positionalToleranceRowCount).toBe(36);
      expect(positionalToleranceSection).toContain('FAIL');
    },
    120000,
  );
});
