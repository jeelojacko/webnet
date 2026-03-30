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

  it('makes the traverse case the active startup default with the expected grid settings and instruments', () => {
    expect(ACTIVE_INDUSTRY_PARITY_CASE.id).toBe('traverse');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults).toBeDefined();

    const startup = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults!;
    expect(startup.input).toContain('#Traverse Only');
    expect(startup.input).toContain('#-------------------------------CONTROL----------------------------------#');
    expect(startup.input).not.toContain('Project Option Settings');
    expect(startup.settingsPatch.convergenceLimit).toBe(0.01);
    expect(startup.parseSettingsPatch.coordMode).toBe('3D');
    expect(startup.parseSettingsPatch.coordSystemMode).toBe('grid');
    expect(startup.parseSettingsPatch.crsId).toBe('CA_NAD83_NB83_STEREO_DOUBLE');
    expect(startup.parseSettingsPatch.order).toBe('NE');
    expect(startup.parseSettingsPatch.lonSign).toBe('west-positive');
    expect(startup.parseSettingsPatch.applyCurvatureRefraction).toBe(true);
    expect(startup.parseSettingsPatch.verticalReduction).toBe('curvref');
    expect(startup.parseSettingsPatch.refractionCoefficient).toBe(0.07);
    expect(startup.selectedInstrument).toBe('TRAV_DEFAULT');
    expect(Object.keys(startup.projectInstruments).sort()).toEqual([
      'S9',
      'SX12',
      'TRAV_DEFAULT',
      'TS11',
    ]);
  });

  it('keeps the copied leveling reference output available for future exact normalized text parity work', () => {
    const outputText = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const normalized = normalizeIndustryParityCaseText(outputText, INDUSTRY_PARITY_CASES.leveling);

    expect(normalized).toContain('Adjusted Elevations and Error Propagation');
    expect(normalized).toContain('Adjusted Differential Level Observations');
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
        'OOP                  -0-06-15.17    0.99985407    0.99998983    0.99984390',
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

      const relationshipSection = extractSection(
        listing,
        'Adjusted Bearings (DMS) and Horizontal Distances (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      );
      expect(relationshipSection).toContain(
        '100        124         N30-42-40.57E     81.2553    5.60  0.0025   31.1297',
      );
      expect(relationshipSection).toContain(
        '101        102         S28-48-29.69E     33.4146   11.04  0.0023   69.8674',
      );
      expect(relationshipSection).not.toContain('GPS5       GPS2        N36-50-16.60W');
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
