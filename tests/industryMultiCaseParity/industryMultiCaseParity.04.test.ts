import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  buildIndustryStyleListingText,
  INDUSTRY_PARITY_CASES,
  normalizeLineEndings,
  extractSection,
  dmsToDecimalDegrees,
  parseClassicAdjustedDistanceRows,
  extractGeodeticRows,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it(
    'applies selected sort mode independently within classic adjusted distance observations',
    () => {
      const startup = INDUSTRY_PARITY_CASES.traverse.startupDefaults;
      expect(startup).toBeDefined();
      const result = buildCaseResult('traverse');
      expect(result.success).toBe(true);
      const buildListing = (sortMode: 'input' | 'residual' | 'stdError' | 'stdResidual') =>
        buildIndustryStyleListingText(
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
            listingSortObservationsBy: sortMode,
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

      const inputListing = buildListing('input');
      const residualListing = buildListing('residual');
      const stdErrorListing = buildListing('stdError');
      const stdResidualListing = buildListing('stdResidual');

      const extractAdjustedDistance = (listing: string) =>
        parseClassicAdjustedDistanceRows(
          extractSection(
            listing,
            'Adjusted Measured Distance Observations (Meters)',
            'Adjusted Zenith Observations (DMS)',
          ),
        );

      const inputRows = extractAdjustedDistance(inputListing);
      const residualRows = extractAdjustedDistance(residualListing);
      const stdErrorRows = extractAdjustedDistance(stdErrorListing);
      const stdResidualRows = extractAdjustedDistance(stdResidualListing);

      expect(inputRows.length).toBeGreaterThan(20);
      expect(residualRows.length).toBe(inputRows.length);
      expect(stdErrorRows.length).toBe(inputRows.length);
      expect(stdResidualRows.length).toBe(inputRows.length);

      const maxResidual = Math.max(...residualRows.map((row) => row.residual));
      const maxStdErr = Math.max(...stdErrorRows.map((row) => row.stdErr));
      const maxStdRes = Math.max(...stdResidualRows.map((row) => row.stdRes));
      expect(residualRows[0].residual).toBeCloseTo(maxResidual, 4);
      expect(stdErrorRows[0].stdErr).toBeCloseTo(maxStdErr, 4);
      expect(stdResidualRows[0].stdRes).toBeCloseTo(maxStdRes, 1);

      const inputResidualTop = inputRows.slice(0, 10).map((row) => row.residual.toFixed(4)).join(',');
      const residualTop = residualRows.slice(0, 10).map((row) => row.residual.toFixed(4)).join(',');
      expect(residualTop).not.toBe(inputResidualTop);
    },
    120000,
  );

  it(
    'keeps the traverse adjusted geodetic rows within sub-millimeter equivalent of the stored reference',
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

      const currentRows = extractGeodeticRows(
        listing,
        'Geodetic Position Summary',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );
      const expectedRows = extractGeodeticRows(
        readFileSync(INDUSTRY_PARITY_CASES.traverse.fixtureOutputPath, 'utf-8'),
        'Adjusted Positions and Ellipsoid Heights (Meters)',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );

      expect(currentRows.size).toBe(expectedRows.size);

      let maxHorizontalDifferenceM = 0;
      currentRows.forEach((current, stationId) => {
        const expected = expectedRows.get(stationId);
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
        const horizontalDifferenceM = Math.hypot(northDifferenceM, eastDifferenceM);

        maxHorizontalDifferenceM = Math.max(maxHorizontalDifferenceM, horizontalDifferenceM);
        expect(current.height).toBeCloseTo(expected.height, 4);
      });

      expect(maxHorizontalDifferenceM).toBeLessThan(0.001);
      expect(listing).toContain('OOP      045-56-45.725025  066-38-39.');
      expect(listing).not.toContain('OOP      045-56-45.725025  -066-38-39.');
    },
    120000,
  );

  it(
    'keeps the traverse top block aligned with the compact industry settings and entered-station summary',
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

      expect(listing).toContain('STAR*NET Run Mode                   : Adjust with Error Propagation');
      expect(listing).toContain('Coordinate System                   : NewBrunswick83');
      expect(listing).toContain('Create Coordinate File              : Yes');
      expect(listing).toContain('                       Instrument Standard Error Settings');
      expect(listing).toContain('Project Default Instrument');
      expect(listing).toContain('Project Library Instrument S9');
      expect(listing).toContain('Project Library Instrument SX12');
      expect(listing).toContain('Project Library Instrument TS11');
      expect(listing).toContain('                    Summary of Unadjusted Input Observations');
      expect(listing).toContain('Number of Entered Stations (Meters) = 7');
      expect(listing).toMatch(/GPS5\s+7438251\.1419\s+2489408\.5228\s+44\.6935/);
      expect(listing).toMatch(/OOP\s+7438438\.7334\s+2488810\.2371\s+64\.8718/);
      expect(listing).toMatch(/GPS2\s+7438481\.0553\s+2489236\.2881\s+37\.7045/);
      expect(listing).toContain('Unused Stations');
      expect(listing).toContain('FRDN');
      expect(listing).toContain('BROD');
      expect(listing).not.toContain('Industry Standard Run Mode');
    },
    120000,
  );

  it('matches the leveling reference listing exactly from project option settings to the file end', () => {
    const startup = INDUSTRY_PARITY_CASES.leveling.startupDefaults;
    expect(startup).toBeDefined();

    const result = buildCaseResult('leveling');
    expect(result.success).toBe(true);

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 15,
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
      },
    );

    const referenceOutput = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const startMarker = 'Project Option Settings';
    const normalizedReferenceOutput = normalizeLineEndings(referenceOutput);
    const normalizedListing = normalizeLineEndings(listing);

    expect(normalizedReferenceOutput.slice(normalizedReferenceOutput.indexOf(startMarker))).toBe(
      normalizedListing.slice(normalizedListing.indexOf(startMarker)),
    );
  });

});
