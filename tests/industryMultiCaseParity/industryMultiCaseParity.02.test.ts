import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  buildIndustryStyleListingText,
  INDUSTRY_PARITY_CASES,
  extractSection,
  extractAdjustedGpsVectorRows,
  buildCaseResult,
} from './industryMultiCaseParityTestSupport';

describe('industry multi-case parity foundation', () => {
  it(
    'keeps the GNSS adjusted vector rows on the local-topocentric display frame used by the stored reference',
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

      const currentRows = extractAdjustedGpsVectorRows(
        listing,
        'Adjusted GPS Vector Observations (Meters)',
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
      );
      const expectedRows = extractAdjustedGpsVectorRows(
        readFileSync(INDUSTRY_PARITY_CASES.gnss.fixtureOutputPath, 'utf-8'),
        'Adjusted GPS Vector Observations (Meters)',
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
      );

      for (const label of [
        'V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc',
        'V24 PostProcessed 28-APR-2025 11:47:00.0 session_2_processed.asc',
        'V62 PostProcessed 02-MAY-2025 13:57:30.0 session_6_export_v7.asc',
      ]) {
        const current = currentRows.get(label);
        const expected = expectedRows.get(label);
        expect(current, `missing current adjusted GNSS vector row for ${label}`).toBeDefined();
        expect(expected, `missing expected adjusted GNSS vector row for ${label}`).toBeDefined();
        if (!current || !expected) continue;

        expect(current.from).toBe(expected.from);
        expect(current.to).toBe(expected.to);
        expect(Math.abs((current.dN?.value ?? 0) - (expected.dN?.value ?? 0))).toBeLessThan(0.001);
        expect(Math.abs((current.dE?.value ?? 0) - (expected.dE?.value ?? 0))).toBeLessThan(0.001);
        expect(Math.abs((current.dU?.value ?? 0) - (expected.dU?.value ?? 0))).toBeLessThan(0.005);
        expect(Math.abs((current.dN?.residual ?? 0) - (expected.dN?.residual ?? 0))).toBeLessThan(
          0.001,
        );
        expect(Math.abs((current.dE?.residual ?? 0) - (expected.dE?.residual ?? 0))).toBeLessThan(
          0.001,
        );
      }

      const v27 = currentRows.get('V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc');
      expect(v27?.dU?.stdErr).toBeCloseTo(0.0023, 4);
      expect(listing).not.toContain('Delta-U               -35.5344');
    },
    120000,
  );

  it('keeps the fixed GNSS control station visible as a zero ellipse row in the precision section', () => {
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

    const stationEllipseSection = extractSection(
      listing,
      'Station Coordinate Error Ellipses (Meters)',
      'Relative Error Ellipses (Meters)',
    );
    expect(stationEllipseSection).toContain(
      'FRDN                      0.000000      0.000000       0-00       0.000000',
    );
  });

  it(
    'matches the traverse startup statistical summary within the current parity tolerances',
    () => {
      const withStartupDefaults = buildCaseResult('traverse');
      expect(withStartupDefaults.success).toBe(true);
      expect(withStartupDefaults.statisticalSummary).toBeDefined();
      const statisticalSummary = withStartupDefaults.statisticalSummary!;

      const directions = statisticalSummary.byGroup.find((row) => row.label === 'Directions');
      const distances = statisticalSummary.byGroup.find((row) => row.label === 'Distances');
      const bearings = statisticalSummary.byGroup.find((row) => row.label === 'Az/Bearings');
      const zenith = statisticalSummary.byGroup.find((row) => row.label === 'Zenith');
      expect(directions?.count).toBe(451);
      expect(distances?.count).toBe(451);
      expect(bearings?.count).toBe(1);
      expect(directions?.sumSquares ?? Number.NaN).toBeCloseTo(248.927, 0);
      expect(directions?.errorFactor ?? Number.NaN).toBeCloseTo(0.838, 2);
      expect(distances?.sumSquares ?? Number.NaN).toBeCloseTo(96.93, 0);
      expect(distances?.errorFactor ?? Number.NaN).toBeCloseTo(0.523, 2);
      expect(bearings?.sumSquares ?? Number.NaN).toBeCloseTo(0, 6);
      expect(zenith).toBeDefined();
      expect(zenith?.sumSquares ?? Number.NaN).toBeCloseTo(807.697, 0);
      expect(zenith?.errorFactor ?? Number.NaN).toBeCloseTo(1.51, 2);

      const horizDistance = (fromId: string, toId: string) =>
        Math.hypot(
          (withStartupDefaults.stations[toId]?.x ?? 0) - (withStartupDefaults.stations[fromId]?.x ?? 0),
          (withStartupDefaults.stations[toId]?.y ?? 0) - (withStartupDefaults.stations[fromId]?.y ?? 0),
        );
      expect(horizDistance('GPS5', 'GPS2')).toBeCloseTo(287.2716, 1);
      expect(horizDistance('GPS5', '100')).toBeCloseTo(544.5315, 1);
    },
    120000,
  );

  it(
    'keeps traverse bearings and measured observation headings separated in the industry listing',
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

      expect(listing).toContain('Project Library Instrument S9');
      expect(listing).toContain('Project Library Instrument SX12');
      expect(listing).toContain('Project Library Instrument TS11');
      expect(listing).toContain('Number of Entered Stations (Meters) = 7');
      expect(listing).toContain('Unused Stations');
      expect(listing).toContain('FRDN');
      expect(listing).toContain('BROD');
      expect(listing).toContain('Number of Measured Distance Observations (Meters) = 451');
      expect(listing).toContain(
        'From       To            Distance   StdErr      HI      HT  Comb Grid  Type',
      );
      expect(listing).toContain(
        '100        APOG          106.8333   0.0038   0.000   0.000  0.9998416   S',
      );
      expect(listing).toContain(
        '100        PEAT           30.1874   0.0037   0.000   0.000  0.9998422   S',
      );
      expect(listing).toContain(
        '119        GPS6          108.8124   0.0030   0.000   0.000  0.9998485   S',
      );
      expect(listing).toContain('Number of Zenith Observations (DMS) = 451');
      expect(listing).toContain('From       To              Zenith      StdErr      HI      HT');
      expect(listing).toContain(
        '100        PEAT         92-29-12.58     30.00   0.000   0.000',
      );
      expect(listing).toContain(
        '101        PEAT         95-59-38.21      8.15   0.000   0.000',
      );
      expect(listing).toContain('Number of Measured Direction Observations (DMS) = 451');
      expect(listing).toContain('From       To            Direction      StdErr     t-T');
      expect(listing).toContain('Set 1');
      expect(listing).toContain('100        APOG          0-00-00.00       4.16    0.00');
      expect(listing).toContain('100        PEAT        301-35-57.60      14.53   -0.00');
      expect(listing).toContain('101        PEAT          0-00-00.00      15.76    0.00');
      expect(listing).toContain('102        APOG          0-00-00.00       5.79    0.01');
      expect(listing).toContain('102        103         203-28-17.40       5.85   -0.01');
      expect(listing).toContain('103        104         130-00-58.95       2.56   -0.01');
      expect(listing).toContain('105        106           0-00-00.00       3.70   -0.00');
      expect(listing).toContain('116        GPS3          0-00-00.00       7.53    0.00');
      expect(listing).toContain('Number of Grid Azimuth/Bearing Observations (DMS) = 1');
      expect(listing).toContain('From       To            Bearing       StdErr');
      expect(listing).toContain('GPS5');
      expect(listing).toContain('GPS2');
      expect(listing).toContain('N36-50-16.60W');
      expect(listing).toContain('FIXED');
      expect(listing).toContain('Adjusted Measured Distance Observations (Meters)');
      expect(listing).toContain('Adjusted Measured Direction Observations (DMS)');
      expect(listing).not.toContain('Active Project Instrument Defaults');
    },
    120000,
  );

});
