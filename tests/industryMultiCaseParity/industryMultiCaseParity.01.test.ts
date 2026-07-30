import { describe, expect, it } from 'vitest';
import {
  existsSync,
  readFileSync,
  buildIndustryStyleListingText,
  normalizeIndustryParityCaseText,
  ACTIVE_INDUSTRY_PARITY_CASE,
  INDUSTRY_PARITY_CASES,
  extractSection,
  dmsToDecimalDegrees,
  normalizeAzimuthDifferenceDeg,
  parseConvergenceRow,
  parseRelationshipRow,
  parseObservationStatisticRow,
  extractGeodeticRows,
  extractCoordinateRows,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it('registers committed fixture paths for each manual industry case', () => {
    Object.values(INDUSTRY_PARITY_CASES).forEach((spec) => {
      expect(existsSync(spec.fixtureInputPath), `${spec.id} input fixture should exist`).toBe(true);
      expect(existsSync(spec.fixtureOutputPath), `${spec.id} output fixture should exist`).toBe(
        true,
      );
    });
  });

  it('normalizes only the volatile header lines required by the parity workflow', () => {
    const raw = [
      'MicroSurvey STAR*NET-PRO Version 13.0.2.5829',
      'Run Date: Thu May  1 2025 11:15:46',
      '      Project Folder     C:\\TEMP\\CASE',
      '      Data File List  1. Level_Adjustment.dat',
      '      Project Units                       : Meters',
    ].join('\n');

    const normalized = normalizeIndustryParityCaseText(raw, ACTIVE_INDUSTRY_PARITY_CASE);

    expect(normalized).toContain('MicroSurvey STAR*NET-PRO Version <normalized>');
    expect(normalized).toContain('Run Date: <normalized>');
    expect(normalized).toContain('Project Folder     <normalized>');
    expect(normalized).toContain('Data File List  <normalized>');
    expect(normalized).toContain('Project Units                       : Meters');
  });

  it('makes the camp design preanalysis case the active startup default with the expected grid settings, instruments, and input text', () => {
    expect(ACTIVE_INDUSTRY_PARITY_CASE.id).toBe('campDesignPreanalysis');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults).toBeDefined();

      const startup = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults!;
      expect(startup.input).toContain('# 2025 Suvery Design Pre-Analysis');
      expect(startup.input).toContain('B GPS2-GPS5 N60-29-49.36W !');
      expect(startup.projectName).toBe('CAMP_DESIGN');
      expect(startup.projectRunFiles?.[0]?.name).toContain('Traverse_Only.dat');
    expect(startup.input).toContain('DB 128');
    expect(startup.input).not.toContain('Project Option Settings');
    expect(startup.settingsPatch.convergenceLimit).toBe(0.01);
    expect(startup.settingsPatch.maxIterations).toBe(10);
    expect(startup.parseSettingsPatch.coordMode).toBe('3D');
    expect(startup.parseSettingsPatch.coordSystemMode).toBe('grid');
    expect(startup.parseSettingsPatch.crsId).toBe('CA_NAD83_CSRS_UTM_19N');
    expect(startup.parseSettingsPatch.order).toBe('EN');
    expect(startup.parseSettingsPatch.runMode).toBe('preanalysis');
    expect(startup.parseSettingsPatch.preanalysisMode).toBe(true);
    expect(startup.parseSettingsPatch.lonSign).toBe('west-positive');
    expect(startup.parseSettingsPatch.applyCurvatureRefraction).toBe(true);
    expect(startup.parseSettingsPatch.verticalReduction).toBe('curvref');
    expect(startup.parseSettingsPatch.refractionCoefficient).toBe(0.07);
    expect(startup.selectedInstrument).toBe('CAMP_DEFAULT');
    expect(Object.keys(startup.projectInstruments)).toEqual(['CAMP_DEFAULT', 'S9', 'SX12']);
  });

  it('keeps the copied leveling reference output available for future exact normalized text parity work', () => {
    const outputText = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const normalized = normalizeIndustryParityCaseText(outputText, INDUSTRY_PARITY_CASES.leveling);

    expect(normalized).toContain('Adjusted Elevations and Error Propagation');
    expect(normalized).toContain('Adjusted Differential Level Observations');
  });

  it(
    'keeps the GNSS coordinate and geodetic rows aligned with the stored industry reference under the CSRS NB contract',
    () => {
      const startup = INDUSTRY_PARITY_CASES.gnss.startupDefaults;
      expect(startup).toBeDefined();

      const result = buildCaseResult('gnss');
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

      const currentCoordinateRows = extractCoordinateRows(
        listing,
        'Adjusted Coordinates (Meters)',
        'Adjusted Positions and Ellipsoid Heights (Meters)',
      );
      const expectedCoordinateRows = extractCoordinateRows(
        readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
        'Adjusted Coordinates (Meters)',
        'Adjusted Positions and Ellipsoid Heights (Meters)',
      );
      expect(currentCoordinateRows.size).toBe(expectedCoordinateRows.size);

      currentCoordinateRows.forEach((current, stationId) => {
        const expected = expectedCoordinateRows.get(stationId);
        expect(expected, `missing expected coordinate row for ${stationId}`).toBeDefined();
        if (!expected) return;
        expect(Math.abs(current.northing - expected.northing)).toBeLessThan(0.001);
        expect(Math.abs(current.easting - expected.easting)).toBeLessThan(0.001);
        expect(Math.abs(current.elevation - expected.elevation)).toBeLessThan(0.001);
      });

      const currentGeodeticRows = extractGeodeticRows(
        listing,
        'Adjusted Positions and Ellipsoid Heights (Meters)',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );
      const expectedGeodeticRows = extractGeodeticRows(
        readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
        'Adjusted Positions and Ellipsoid Heights (Meters)',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );
      expect(currentGeodeticRows.size).toBe(expectedGeodeticRows.size);

      let maxHorizontalDifferenceM = 0;
      currentGeodeticRows.forEach((current, stationId) => {
        const expected = expectedGeodeticRows.get(stationId);
        expect(expected, `missing expected geodetic row for ${stationId}`).toBeDefined();
        if (!expected) return;

        const currentLatitudeDeg = dmsToDecimalDegrees(current.latitudeDms);
        const currentLongitudeDeg = dmsToDecimalDegrees(current.longitudeDms);
        const expectedLatitudeDeg = dmsToDecimalDegrees(expected.latitudeDms);
        const expectedLongitudeDeg = dmsToDecimalDegrees(expected.longitudeDms);
        const averageLatitudeRad = ((currentLatitudeDeg + expectedLatitudeDeg) / 2) * (Math.PI / 180);
        const northDifferenceM = (currentLatitudeDeg - expectedLatitudeDeg) * 111132.92;
        const eastDifferenceM =
          (currentLongitudeDeg - expectedLongitudeDeg) *
          111412.84 *
          Math.cos(averageLatitudeRad);
        maxHorizontalDifferenceM = Math.max(
          maxHorizontalDifferenceM,
          Math.hypot(northDifferenceM, eastDifferenceM),
        );
        expect(Math.abs(current.height - expected.height)).toBeLessThan(0.001);
      });

      expect(maxHorizontalDifferenceM).toBeLessThan(0.002);
      expect(listing).toContain('Project Folder and Data Files');
      expect(listing).toContain('Coordinate System                   : NewBrunswick83');
      expect(listing).toContain('GPS Vector Standard Error Factors   : None');
      expect(listing).not.toContain('Instrument Standard Error Settings');
      expect(listing).toContain('Adjusted Station Information');
      expect(listing).toContain('Adjusted Positions and Ellipsoid Heights (Meters)');
      expect(listing).toContain('GPS1     45-56-45.725039  66-38-39.557739');
      expect(listing).not.toContain('GPS1     45-56-45.725039  -66-38-39.557739');

      const convergenceSection = extractSection(
        listing,
        'Convergence Angles (DMS) and Grid Factors at Stations',
        'Adjusted Observations and Residuals',
      );
      const expectedConvergenceSection = extractSection(
        readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
        'Convergence Angles (DMS) and Grid Factors at Stations',
        'Adjusted Observations and Residuals',
      );
      for (const stationId of ['GPS1', 'GPS4', 'GPS6']) {
        const current = parseConvergenceRow(convergenceSection, stationId);
        const expected = parseConvergenceRow(expectedConvergenceSection, stationId);
        expect(Math.abs(current.convergenceSec - expected.convergenceSec)).toBeLessThan(0.05);
        expect(Math.abs(current.gridScale - expected.gridScale)).toBeLessThan(0.0000002);
        expect(Math.abs(current.elevationFactor - expected.elevationFactor)).toBeLessThan(0.00000002);
        expect(Math.abs(current.combinedFactor - expected.combinedFactor)).toBeLessThan(0.0000002);
      }

      const relationshipSection = extractSection(
        listing,
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Error Propagation',
      );
      const expectedRelationshipSection = extractSection(
        readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Error Propagation',
      );
      for (const [from, to] of [
        ['FRDN', 'GPS1'],
        ['GPS2', 'GPS6'],
        ['GPS4', 'GPS5'],
      ] as const) {
        const current = parseRelationshipRow(relationshipSection, from, to);
        const expected = parseRelationshipRow(expectedRelationshipSection, from, to);
        expect(normalizeAzimuthDifferenceDeg(current.bearingDeg, expected.bearingDeg) * 3600).toBeLessThan(0.1);
        expect(Math.abs(current.gridDistance - expected.gridDistance)).toBeLessThan(0.0002);
        expect(Math.abs((current.groundDistance ?? 0) - (expected.groundDistance ?? 0))).toBeLessThan(0.0002);
        expect(Math.abs(current.bearingConfidenceSec - expected.bearingConfidenceSec)).toBeLessThan(0.05);
        expect(Math.abs(current.distanceConfidence - expected.distanceConfidence)).toBeLessThan(0.0002);
        expect(Math.abs(current.ppm - expected.ppm)).toBeLessThan(0.2);
      }
    },
    120000,
  );

  it('keeps the GNSS adjustment statistical summary aligned with the industry equation-count contract', () => {
    const startup = INDUSTRY_PARITY_CASES.gnss.startupDefaults;
    expect(startup).toBeDefined();

    const result = buildCaseResult('gnss');
    expect(result.success).toBe(true);
    expect(result.statisticalSummary?.totalCount).toBe(45);

    const gpsSummary = result.statisticalSummary?.byGroup.find((row) => row.label === 'GPS');
    expect(gpsSummary?.count).toBe(45);
    expect(gpsSummary?.sumSquares ?? Number.NaN).toBeGreaterThan(40);
    expect(gpsSummary?.errorFactor ?? Number.NaN).toBeGreaterThan(1);

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

    expect(listing).toContain('Number of Observations                : 45');
    expect(listing).toContain('Number of Unknowns                    : 18');
    expect(listing).toContain('Number of Redundant Obs               : 27');

    const currentStats = extractSection(
      listing,
      'Adjustment Statistical Summary',
      'The Chi-Square Test at 5.00% Level',
    );
    const expectedStats = extractSection(
      readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
      'Adjustment Statistical Summary',
      'The Chi-Square Test at 5.00% Level',
    );
    const currentGpsRow = parseObservationStatisticRow(currentStats, 'GPS Deltas');
    const expectedGpsRow = parseObservationStatisticRow(expectedStats, 'GPS Deltas');

    expect(currentGpsRow.count).toBe(expectedGpsRow.count);
    expect(currentGpsRow.sumSquares).toBeCloseTo(40.853, 3);
    expect(currentGpsRow.errorFactor).toBeCloseTo(1.23, 3);
    expect(Math.abs(currentGpsRow.sumSquares - expectedGpsRow.sumSquares)).toBeLessThan(0.35);
    expect(Math.abs(currentGpsRow.errorFactor - expectedGpsRow.errorFactor)).toBeLessThan(0.01);
  });

});
