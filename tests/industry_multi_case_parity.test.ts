import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import { normalizeIndustryParityCaseText } from '../src/engine/industryParityText';
import { ACTIVE_INDUSTRY_PARITY_CASE, INDUSTRY_PARITY_CASES } from '../src/industryParityCases';

const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const extractSection = (text: string, startMarker: string, endMarker: string): string => {
  const normalized = normalizeLineEndings(text);
  const start = normalized.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = normalized.slice(start);
  const end = slice.indexOf(endMarker);
  expect(end).toBeGreaterThanOrEqual(0);
  return slice.slice(0, end).trimEnd();
};

const dmsToDecimalDegrees = (dms: string): number => {
  const [degToken, minToken, secToken] = dms.split('-');
  const deg = Number.parseFloat(degToken);
  const minutes = Number.parseFloat(minToken);
  const seconds = Number.parseFloat(secToken);
  return deg + minutes / 60 + seconds / 3600;
};

const extractGeodeticRows = (
  text: string,
  startMarker: string,
  endMarker: string,
): Map<string, { latitudeDms: string; longitudeDms: string; height: number }> => {
  const section = extractSection(text, startMarker, endMarker);
  const rows = new Map<string, { latitudeDms: string; longitudeDms: string; height: number }>();
  normalizeLineEndings(section)
    .split('\n')
    .slice(4)
    .forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return;
      const stationId = parts[0];
      const latitudeDms = parts[1];
      const longitudeDms = parts[2];
      const height = Number.parseFloat(parts[3]);
      if (
        !stationId ||
        !latitudeDms.includes('-') ||
        !longitudeDms.includes('-') ||
        !Number.isFinite(height)
      ) {
        return;
      }
      rows.set(stationId, { latitudeDms, longitudeDms, height });
    });
  return rows;
};

const extractCoordinateRows = (
  text: string,
  startMarker: string,
  endMarker: string,
): Map<string, { northing: number; easting: number; elevation: number }> => {
  const section = extractSection(text, startMarker, endMarker);
  const rows = new Map<string, { northing: number; easting: number; elevation: number }>();
  normalizeLineEndings(section)
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const stationMatch = trimmed.match(/^([A-Za-z0-9_-]+)/);
      if (!stationMatch) return;
      const numericTokens = trimmed.match(/-?\d+\.\d+/g);
      if (!numericTokens || numericTokens.length < 3) return;
      rows.set(stationMatch[1], {
        northing: Number.parseFloat(numericTokens[0]),
        easting: Number.parseFloat(numericTokens[1]),
        elevation: Number.parseFloat(numericTokens[2]),
      });
    });
  return rows;
};

const buildCaseResult = (caseId: keyof typeof INDUSTRY_PARITY_CASES) => {
  const startup = INDUSTRY_PARITY_CASES[caseId].startupDefaults;
  expect(startup).toBeDefined();

  return new LSAEngine({
    input: startup?.input ?? '',
    maxIterations: 15,
    convergenceThreshold: startup?.settingsPatch.convergenceLimit ?? 0.001,
    instrumentLibrary: startup?.projectInstruments,
    parseOptions: {
      currentInstrument: startup?.selectedInstrument,
      coordSystemMode: startup?.parseSettingsPatch.coordSystemMode,
      crsId: startup?.parseSettingsPatch.crsId,
      coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
      order: startup?.parseSettingsPatch.order ?? 'EN',
      deltaMode: startup?.parseSettingsPatch.deltaMode ?? 'slope',
      angleStationOrder: startup?.parseSettingsPatch.angleStationOrder ?? 'atfromto',
      lonSign: startup?.parseSettingsPatch.lonSign ?? 'west-negative',
      applyCurvatureRefraction: startup?.parseSettingsPatch.applyCurvatureRefraction,
      verticalReduction: startup?.parseSettingsPatch.verticalReduction,
      refractionCoefficient: startup?.parseSettingsPatch.refractionCoefficient,
      verticalDeflectionNorthSec: startup?.parseSettingsPatch.verticalDeflectionNorthSec,
      verticalDeflectionEastSec: startup?.parseSettingsPatch.verticalDeflectionEastSec,
    },
  }).solve();
};

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

  it('makes the GNSS case the active startup default with the expected grid settings and input text', () => {
    expect(ACTIVE_INDUSTRY_PARITY_CASE.id).toBe('gnss');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults).toBeDefined();

    const startup = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults!;
    expect(startup.input).toContain('# Made by Maryn');
    expect(startup.input).toContain('.GPS WEIGHT COVARIANCE');
    expect(startup.input).toContain("G0 'V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc");
    expect(startup.input).not.toContain('Project Option Settings');
    expect(startup.settingsPatch.convergenceLimit).toBe(0.01);
    expect(startup.parseSettingsPatch.coordMode).toBe('3D');
    expect(startup.parseSettingsPatch.coordSystemMode).toBe('grid');
    expect(startup.parseSettingsPatch.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(startup.parseSettingsPatch.order).toBe('NE');
    expect(startup.parseSettingsPatch.lonSign).toBe('west-positive');
    expect(startup.parseSettingsPatch.verticalDeflectionNorthSec).toBeCloseTo(-2.91, 6);
    expect(startup.parseSettingsPatch.verticalDeflectionEastSec).toBeCloseTo(-1.46, 6);
    expect(startup.parseSettingsPatch.applyCurvatureRefraction).toBe(true);
    expect(startup.parseSettingsPatch.verticalReduction).toBe('curvref');
    expect(startup.parseSettingsPatch.refractionCoefficient).toBe(0.07);
    expect(startup.selectedInstrument).toBe('');
    expect(Object.keys(startup.projectInstruments)).toEqual([]);
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
          listingSortObservationsBy: 'residual',
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
        'Control Component Status',
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
        expect(Math.abs(current.elevation - expected.elevation)).toBeLessThan(0.005);
      });

      const currentGeodeticRows = extractGeodeticRows(
        listing,
        'Geodetic Position Summary',
        'Grid/Combined Factor Diagnostics',
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
        expect(Math.abs(current.height - expected.height)).toBeLessThan(0.005);
      });

      expect(maxHorizontalDifferenceM).toBeLessThan(0.002);
      expect(listing).toContain(
        'Coordinate System Mode                : GRID (CRS=CA_NAD83_CSRS_NB_STEREO_DOUBLE)',
      );
      expect(listing).toContain('GPS1     045-56-45.725038  066-38-39.557738');
      expect(listing).not.toContain('GPS1     045-56-45.725038  -066-38-39.557738');
    },
    120000,
  );

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
          listingSortObservationsBy: 'residual',
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
        '101        PEAT         95-59-38.21      8.14   0.000   0.000',
      );
      expect(listing).toContain('Number of Measured Direction Observations (DMS) = 451');
      expect(listing).toContain('From       To            Direction      StdErr     t-T');
      expect(listing).toContain('Set 1');
      expect(listing).toContain('100        APOG          0-00-00.00       4.16    0.00');
      expect(listing).toContain('100        PEAT        301-35-57.60      14.53   -0.00');
      expect(listing).toContain('101        PEAT          0-00-00.00      15.74    0.00');
      expect(listing).toContain('102        APOG          0-00-00.00       5.79    0.01');
      expect(listing).toContain('102        103         203-28-17.40       5.85   -0.01');
      expect(listing).toContain('103        104         130-00-58.95       2.56   -0.01');
      expect(listing).toContain('105        106           0-00-00.00       3.70   -0.01');
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

      expect(
        extractSection(
          listing,
          'Number of Measured Distance Observations (Meters) = 451',
          'Number of Zenith Observations (DMS) = 451',
        ),
      ).toBe(
        extractSection(
          referenceOutput,
          'Number of Measured Distance Observations (Meters) = 451',
          'Number of Zenith Observations (DMS) = 451',
        ),
      );

      expect(
        extractSection(
          listing,
          'Number of Zenith Observations (DMS) = 451',
          'Number of Measured Direction Observations (DMS) = 451',
        ),
      ).toBe(
        extractSection(
          referenceOutput,
          'Number of Zenith Observations (DMS) = 451',
          'Number of Measured Direction Observations (DMS) = 451',
        ),
      );

      expect(
        extractSection(
          listing,
          'Number of Measured Direction Observations (DMS) = 451',
          'Number of Grid Azimuth/Bearing Observations (DMS) = 1',
        ),
      ).toBe(
        extractSection(
          referenceOutput,
          'Number of Measured Direction Observations (DMS) = 451',
          'Number of Grid Azimuth/Bearing Observations (DMS) = 1',
        ),
      );
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
          listingSortObservationsBy: 'residual',
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
      expect(convergenceSection).toContain(
        'OOP                  -0-06-15.17    0.99985407    0.99998983    0.99984389',
      );
      expect(convergenceSection).toContain(
        'GPS2                 -0-06-00.89    0.99985398    0.99999409    0.99984807',
      );
      expect(convergenceSection).toContain(
        'APOG                 -0-06-15.04    0.99985428    0.99998704    0.99984133',
      );

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
        '100                  7438248.0386   2488864.0004     76.4664',
      );
      expect(adjustedCoordinateSection).toContain(
        'PEAT                 7438221.9759   2488879.1638     75.1619',
      );

      const geodeticSummarySection = extractSection(
        listing,
        'Geodetic Position Summary',
        'Convergence Angles (DMS) and Grid Factors at Stations',
      );
      expect(geodeticSummarySection).toContain('Longitude (DMS)');
      expect(geodeticSummarySection).toContain(
        'OOP      045-56-45.725022  066-38-39.557772          64.8821  ELLIP',
      );
      expect(geodeticSummarySection).not.toContain('-066-38-39.557772');

      const relationshipSection = extractSection(
        listing,
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      );
      expect(relationshipSection).toContain(
        '100        124         N30-42-40.60E     81.2618    5.60  0.0025   31.1321',
      );
      expect(relationshipSection).toContain(
        '101        102         S28-48-29.60E     33.4174   11.04  0.0023   69.8727',
      );
      expect(relationshipSection).toContain('109        GPS2        S09-35-23.55E');
      expect(relationshipSection).not.toContain('GPS5       GPS2        N36-50-16.60W');

      expect(listing).toContain('Relative Error Ellipses (Meters)');
      expect(listing).toContain(
        'Stations                Semi-Major    Semi-Minor   Azimuth of     Vertical',
      );
      expect(listing).toContain(
        '100        124            0.002535     0.002199      38-02     0.001534',
      );
      expect(listing).toContain(
        '116        GPS3           0.002917     0.002829      99-44     0.001526',
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
      expect(adjustedDirectionSection.indexOf('Set 24')).toBeGreaterThan(
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
          listingSortObservationsBy: 'residual',
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
      expect(listing).toContain('OOP      045-56-45.725022  066-38-39.557772');
      expect(listing).not.toContain('OOP      045-56-45.725022  -066-38-39.557772');
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
          listingSortObservationsBy: 'residual',
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
      expect(listing).toContain('GPS5                7438251.1419      2489408.5228     44.6935');
      expect(listing).toContain('OOP                 7438438.7334      2488810.2371     64.8718');
      expect(listing).toContain('GPS2                7438481.0553      2489236.2881     37.7045');
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
        listingSortObservationsBy: 'residual',
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
