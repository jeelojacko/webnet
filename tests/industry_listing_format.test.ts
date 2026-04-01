import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import type { InstrumentLibrary, ParseOptions } from '../src/types';

const expectedHeadings = JSON.parse(
  readFileSync('tests/fixtures/industry_listing_phase5_expected_headings.json', 'utf-8'),
) as string[];

const parseOptions: Partial<ParseOptions> = {
  units: 'm',
  coordMode: '2D',
  order: 'NE',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  deltaMode: 'horiz',
  mapMode: 'off',
  normalize: true,
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  directionSetMode: 'raw',
  clusterDetectionEnabled: false,
};

const INDUSTRY_FALLBACK_LIBRARY: InstrumentLibrary = {
  __INDUSTRY_DEFAULT__: {
    code: '__INDUSTRY_DEFAULT__',
    desc: 'Industry Standard default instrument',
    edm_const: 0.001,
    edm_ppm: 1,
    hzPrecision_sec: 0.5,
    dirPrecision_sec: 0.5,
    azBearingPrecision_sec: 0.5,
    vaPrecision_sec: 0.5,
    instCentr_m: 0.0005,
    tgtCentr_m: 0,
    vertCentr_m: 0,
    elevDiff_const_m: 0,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 0,
  },
};

const buildIndustryReferenceListing = (): string => {
  const input = readFileSync('tests/fixtures/industry_standard_reference_case.dat', 'utf-8');
  const result = new LSAEngine({
    input,
    maxIterations: 15,
    convergenceThreshold: 0.001,
    instrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
    parseOptions: {
      currentInstrument: '__INDUSTRY_DEFAULT__',
      directionSetMode: 'raw',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      clusterDetectionEnabled: false,
      geometryDependentSigmaReference: 'initial',
    },
  }).solve();

  expect(result.success).toBe(true);

  return buildIndustryStyleListingText(
    result,
    {
      maxIterations: 15,
      units: 'm',
      precisionReportingMode: 'industry-standard',
      listingShowCoordinates: true,
      listingShowObservationsResiduals: true,
      listingShowErrorPropagation: true,
      listingShowProcessingNotes: false,
      listingShowAzimuthsBearings: true,
      listingSortCoordinatesBy: 'input',
      listingSortObservationsBy: 'residual',
      listingObservationLimit: 500,
    },
    {
      coordMode: '2D',
      order: 'EN',
      angleUnits: 'dms',
      angleStationOrder: 'atfromto',
      deltaMode: 'slope',
      refractionCoefficient: 0.13,
    },
    {
      solveProfile: 'industry-parity',
      angleCenteringModel: 'geometry-aware-correlated-rays',
      defaultSigmaCount: 0,
      defaultSigmaByType: '',
      stochasticDefaultsSummary: 'inst=__INDUSTRY_DEFAULT__',
      rotationAngleRad: 0,
    },
  );
};

describe('industry listing phase 5 formatting locks', () => {
  it('keeps section ordering, spacing, and key row formats stable', () => {
    const input = readFileSync('public/examples/industry-input.txt', 'utf-8');
    const engine = new LSAEngine({
      input,
      maxIterations: 25,
      options: parseOptions,
    });
    const result = engine.solve();

    expect(result.success).toBe(true);

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 25,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'residual',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    let lastIndex = -1;
    expectedHeadings.forEach((heading) => {
      const idx = listing.indexOf(heading);
      expect(idx, `missing heading: ${heading}`).toBeGreaterThan(-1);
      expect(idx, `heading order regression near: ${heading}`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    });

    expect(listing).not.toContain('Processing Notes');
    expect(listing).not.toContain('Observation Weighting Traceability');
    expect(listing).toContain(
      'From       To               Azimuth    Distance       95% RelConfidence',
    );
    expect(listing).toContain(
      '                                                    Azi    Dist       PPM',
    );
    expect(listing).toContain('Station                 Semi-Major    Semi-Minor   Azimuth of');
    expect(listing).toContain('Stations                Semi-Major    Semi-Minor   Azimuth of');
    expect(listing).toContain('From       To               Axis          Axis     Major Axis');
    expect(listing).toMatch(/Convergence Limit; Max Iterations\s+:\s+0\.010000; 25/);

    // Lock coordinate/std-dev spacing to prevent merged numeric columns.
    expect(listing).toMatch(/^\s*1\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*1\s+-\s+\d+\.\d{6}\s+\d+\.\d{6}\s*$/m);

    // Lock key relative-ellipse formatting and fixed-to-adjusted relationship rows.
    expect(listing).toMatch(/^\s*1\s+2\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m);
    expect(listing).toMatch(
      /^\s*(?:77\s+1000|1000\s+77)\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m,
    );
  });

  it('prints adjusted values and normalized StdRes values in industry observation tables', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('Stations  Distance  Residual  StdErr  StdRes  File:Line');
    expect(listing).toContain('2-200       4.2657    0.0037  0.0011    3.3*');
  });

  it('computes PPM confidence from full adjusted distance while printing the exact 95 percent scale', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('1          2             270-07-30.7    22.2571   37.14   0.0010    44.2475');
    expect(listing).toContain('2          2000          000-02-36.8     5.4484   40.86   0.0017   308.7738');
  });

  it('prefers connected-pair direction for azimuth and relative-ellipse sections', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('10         9             091-00-17.1     8.1147');
    expect(listing).toContain('1          1000          343-16-07.7     4.7264');
    expect(listing).toContain('200        3             176-03-08.5     4.0998');
    expect(listing).toContain('2000       3             176-56-39.7     5.2802');
    expect(listing).toContain('10         9              0.004');
    expect(listing).toContain('200        3              0.002');
    expect(listing).toContain('2000       3              0.003');
  });

  it('prints zero-size ellipse azimuths as 0-00', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('1000       235            0.000000     0.000000       0-00');
  });

  it('renders control-component traceability for fixed, free, and weighted control rows', () => {
    const input = [
      '.3D',
      'C A 0 0 10 0.010 0.020 0.030 ! *',
      'C B 100 0 10 ! ! !',
      'C P 60 40 10',
      'D B-P 56.5685425 0.005',
      'B B-P 123-41-24.1 2',
      'G A P 60 40 0.010 0.010',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '3D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Control Component Status');
    expect(listing).toMatch(/^\s*A\s+-\s+N=FREE E=FIXED H=WEIGHTED\s*$/m);
    expect(listing).toMatch(/^\s*B\s+-\s+N=FIXED E=FIXED H=FIXED\s*$/m);
  });

  it('renders effective distance for angles and lateral residual distance for directions', () => {
    const input = readFileSync('tests/fixtures/effective_distance_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain(
      'Stations  Angle        Residual  Distance  StdErr  StdRes  File:Line',
    );
    expect(listing).toContain(
      'Stations  Direction    Residual  Distance  StdErr  StdRes  File:Line',
    );
    expect(listing).toMatch(/^\s*O-BS-P\s+.+\s+.+\s+100\.0000\s+.+\s+.+\s+1:9\s*$/m);
    expect(listing).toMatch(/^\s*O-P\s+.+\s+.+\s+0\.0000\s+.+\s+.+\s+1:11\s*$/m);
  });

  it('formats grid geodetic rows in DMS and adds vertical precision columns for 3D listings', () => {
    const input = [
      '.3D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 100.0000 ! ! !',
      'C B 2500100.0000 7500000.0000 100.0000 ! ! !',
      'C P 2500050.0000 7500040.0000 102.0000',
      'B A-P 51.3401917459 1.0',
      'D A-P 64.06246951 0.005',
      'Z A-P 88.21008939 5.0',
      'B B-P 308.6598082541 1.0',
      'D B-P 64.06246951 0.005',
      'Z B-P 88.21008939 5.0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).not.toContain('Observation Weighting Traceability');
    expect(listing).toContain('Geodetic Position Summary');
    expect(listing).toContain('Latitude (DMS)');
    expect(listing).toContain('Longitude (DMS)');
    expect(listing).toMatch(/^\s*A\s+0\d{2}-\d{2}-\d{2}\.\d{6}\s+-0\d{2}-\d{2}-\d{2}\.\d{6}\s+100\.0000\s+\S+\s*$/m);
    expect(listing).toContain('Station Coordinate Standard Deviations (Meters)');
    expect(listing).toMatch(/Station\s+Description\s+N\s+E\s+Elev/);
    expect(listing).toContain('Station Coordinate Error Ellipses (Meters)');
    expect(listing).toContain('Azimuth of       Elev');
  });

  it('keeps centerInflation details on a single instrument-settings row', () => {
    const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'B A-B 090.0000 1.0', 'D A-B 100 0.005'].join(
      '\n',
    );
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary:
          'inst=S9 dist=0.0010m+1.000ppm hz=0.500" va=0.500" centering=0.00050/0.00000m edm=additive centerInflation=ON(explicit=OFF)',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toMatch(/Centering Inflation\s+:\s+ON\(explicit=OFF\)/);
    expect(listing).not.toContain('Setting explicit');
  });

  it('renders dedicated GPS sideshot listing section for mixed GPS network datasets', () => {
    const input = readFileSync('tests/fixtures/gps_network_sideshot_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Post-Adjusted GPS Sideshot Vectors');
    expect(listing).toContain('OCC');
    expect(listing).toContain('RTK1');
    expect(listing).toContain('vector');
    expect(listing).not.toContain('Post-Adjusted Sideshots (TS)');
  });

  it('renders auto-adjust diagnostics section when present', () => {
    const input = readFileSync('public/examples/industry-input.txt', 'utf-8');
    const engine = new LSAEngine({
      input,
      maxIterations: 25,
      options: parseOptions,
    });
    const result = engine.solve();
    result.autoAdjustDiagnostics = {
      enabled: true,
      threshold: 4,
      maxCycles: 3,
      maxRemovalsPerCycle: 1,
      minRedundancy: 0.05,
      stopReason: 'no-candidates',
      cycles: [
        { cycle: 1, seuw: result.seuw, maxAbsStdRes: 4.2, removals: [] },
        { cycle: 2, seuw: result.seuw, maxAbsStdRes: 2.1, removals: [] },
      ],
      removed: [
        {
          obsId: 101,
          type: 'dist',
          stations: '1-2',
          sourceLine: 88,
          stdRes: 4.2,
          redundancy: 0.45,
          reason: 'std-res',
        },
      ],
    };

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 25,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'residual',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Auto-Adjust Diagnostics');
    expect(listing).toContain('Removed Observations');
    expect(listing).toContain('101');
    expect(listing).toContain('Line');
  });

  it('annotates adjusted-observation rows for auto-sideshot candidate observations', () => {
    const input = readFileSync('public/examples/industry-input.txt', 'utf-8');
    const engine = new LSAEngine({
      input,
      maxIterations: 25,
      options: parseOptions,
    });
    const result = engine.solve();
    const angleObs = result.observations.find((o) => o.type === 'angle');
    const distObs = result.observations.find((o) => o.type === 'dist');
    expect(angleObs).toBeDefined();
    expect(distObs).toBeDefined();

    result.autoSideshotDiagnostics = {
      enabled: true,
      threshold: 0.1,
      evaluatedCount: 1,
      excludedControlCount: 0,
      candidateCount: 1,
      candidates: [
        {
          sourceLine: angleObs?.sourceLine,
          occupy: angleObs?.type === 'angle' ? angleObs.at : 'UNKNOWN',
          backsight: angleObs?.type === 'angle' ? angleObs.from : 'UNKNOWN',
          target: angleObs?.type === 'angle' ? angleObs.to : 'UNKNOWN',
          angleObsId: angleObs?.id ?? -1,
          distObsId: distObs?.id ?? -1,
          angleRedundancy: 0.01,
          distRedundancy: 0.01,
          minRedundancy: 0.01,
          maxAbsStdRes: 0.5,
        },
      ],
    };

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 25,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'residual',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('[auto-ss]');
  });

  it('annotates adjusted distance rows with prism correction source and magnitude', () => {
    const input = readFileSync('public/examples/industry-input.txt', 'utf-8');
    const engine = new LSAEngine({
      input,
      maxIterations: 25,
      options: parseOptions,
    });
    const result = engine.solve();
    const distObs = result.observations.find((o) => o.type === 'dist');
    expect(distObs).toBeDefined();
    if (distObs?.type === 'dist') {
      distObs.prismCorrectionM = 0.25;
      distObs.prismScope = 'global';
    }

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 25,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'residual',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toMatch(/\[prism global \+0\.2500(?:m|Meters)\]/);
  });

  it('reports plan rotation in project options and changes rotated output coordinates', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const rotatedInput = ['.ROTATION 10', baseInput].join('\n');
    const baseResult = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const rotatedResult = new LSAEngine({ input: rotatedInput, maxIterations: 10 }).solve();

    const buildListing = (result: ReturnType<LSAEngine['solve']>, rotationAngleRad: number) =>
      buildIndustryStyleListingText(
        result,
        {
          maxIterations: 10,
          units: 'm',
          listingShowCoordinates: true,
          listingShowObservationsResiduals: true,
          listingShowErrorPropagation: true,
          listingShowProcessingNotes: false,
          listingShowAzimuthsBearings: true,
          listingSortCoordinatesBy: 'name',
          listingSortObservationsBy: 'name',
          listingObservationLimit: 500,
        },
        {
          coordMode: '2D',
          order: 'EN',
          angleUnits: 'dms',
          angleStationOrder: 'atfromto',
          deltaMode: 'horiz',
          refractionCoefficient: 0.13,
        },
        {
          solveProfile: 'industry-parity',
          angleCenteringModel: 'geometry-aware-correlated-rays',
          defaultSigmaCount: 0,
          defaultSigmaByType: '',
          stochasticDefaultsSummary: 'inst=S9',
          rotationAngleRad,
        },
      );

    const baseListing = buildListing(baseResult, baseResult.parseState?.rotationAngleRad ?? 0);
    const rotatedListing = buildListing(
      rotatedResult,
      rotatedResult.parseState?.rotationAngleRad ?? 0,
    );

    expect(baseListing).toMatch(/Plan Rotation\s+:\s+OFF/);
    expect(rotatedListing).toMatch(/Plan Rotation\s+:\s+ON \(10\.000000 deg\)/);

    const coordRow = (listing: string, stationId: string): [number, number] => {
      const match = listing.match(
        new RegExp(`^\\s*${stationId}\\s+\\S+\\s+(-?\\d+\\.\\d{4})\\s+(-?\\d+\\.\\d{4})\\s*$`, 'm'),
      );
      expect(match).toBeTruthy();
      return [Number.parseFloat(match?.[1] ?? '0'), Number.parseFloat(match?.[2] ?? '0')];
    };

    const [baseN, baseE] = coordRow(baseListing, 'B');
    const [rotN, rotE] = coordRow(rotatedListing, 'B');
    expect(Math.abs(rotN - baseN)).toBeGreaterThan(1);
    expect(Math.abs(rotE - baseE)).toBeGreaterThan(0.5);
  });

  it('reports geoid/grid diagnostics in project options when enabled', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.GEOID ON NGS-DEMO',
      '.GEOID INTERP BILINEAR',
      '.GEOID HEIGHT ON ORTHOMETRIC',
      'P ORG 40.000000 -105.000000 0 ! !',
      'PH TGT 40.001000 -104.999000 120.000',
      'B ORG-TGT 045.000000 1.0',
      'D ORG-TGT 120.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Geoid/Grid Model');
    expect(listing).toContain('ON (NGS-DEMO, BILINEAR, loaded=YES)');
    expect(listing).toContain('Geoid Metadata');
    expect(listing).toContain('Geoid Height Conversion');
    expect(listing).toContain('ON (ORTHOMETRIC');
  });

  it('reports geoid checkpoint conversion diagnostics with converted/skipped counts', () => {
    const input = readFileSync('tests/fixtures/geoid_phase3_checkpoints.dat', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'orthometric',
      },
    }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '3D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'slope',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Geoid/Grid Model');
    expect(listing).toContain('ON (NGS-DEMO, BILINEAR, loaded=YES)');
    expect(listing).toContain('Geoid Height Conversion');
    expect(listing).toContain('ON (ORTHOMETRIC, converted=1, skipped=1)');
  });

  it('shows lost-station diagnostics and supports listing visibility filter', () => {
    const input = [
      '.2D',
      '.LOSTSTATIONS B',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listingShown = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );
    const listingHidden = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: false,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listingShown).toContain('Lost Stations');
    expect(listingShown).toContain('1 (B)');
    expect(listingShown).toMatch(/Show Lost Stations in Output\s+:\s+ON/);
    expect(listingHidden).toMatch(/Show Lost Stations in Output\s+:\s+OFF/);
    expect(listingShown).toMatch(/^\s*B\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listingHidden).not.toMatch(/^\s*B\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listingShown).toContain('A-B');
    expect(listingHidden).not.toContain('A-B');
  });

  it('reports CRS projection/scale/convergence diagnostics in listing project options', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS ON ENU SiteGrid',
      '.CRS SCALE 0.99960000',
      '.CRS CONVERGENCE 0.250000',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('CRS / Projection');
    expect(listing).toContain('ON (local-enu, label="SiteGrid")');
    expect(listing).toContain('CRS Grid-Ground Scale');
    expect(listing).toContain('ON (0.99960000)');
    expect(listing).toContain('CRS Convergence');
    expect(listing).toContain('ON (0.250000 deg)');
  });

  it('shows CRS / Projection as ON for projected-only NB grid jobs', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 0 ! !',
      'C B 2500800.0000 7500000.0000 0',
      'B A-B 090.0000 1.0',
      'D A-B 800.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toMatch(
      /Coordinate System Mode\s+:\s+GRID \(CRS=CA_NAD83_CSRS_NB_STEREO_DOUBLE\)/,
    );
    expect(listing).toMatch(/CRS \/ Projection\s+: ON/);
  });

  it('applies append-style description reconciliation in listing output rows', () => {
    const input = [
      '.2D',
      '.DESC APPEND /',
      "C A 0 0 0 ! ! 'Alpha",
      "E A 10.0 0.01 ! 'Beta",
      "C B 100 0 0 ! ! 'Beta Point",
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );
    expect(listing).toContain('Description Reconciliation');
    expect(listing).toContain('APPEND (delimiter="/")');
    expect(listing).toContain('Description Reconciliation Summary');
    expect(listing).toMatch(/^\s*A\s+Alpha\/Beta\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*A\s+2\s+2\s+YES\s+Alpha\[3\]; Beta\[4\]\s*$/m);
  });

  it('reports active QFIX constants in project option settings', () => {
    const input = [
      '.2D',
      '.QFIX 0.01 3.0',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 !',
      'D A-B 100.0000 !',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );
    expect(listing).toContain('QFIX (Linear/Angular)');
    expect(listing).toMatch(/1\.000000e-2\s+Meters/);
    expect(listing).toMatch(/3\.000000e\+0"/);
  });

  it('surfaces GPS AddHiHt preprocessing diagnostics for positive/negative/default-height vectors', () => {
    const input = readFileSync('tests/fixtures/gps_addhight_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '3D',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'slope',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('GPS AddHiHt Defaults');
    expect(listing).toContain('GPS AddHiHt Preprocess');
    expect(listing).toContain('vectors=3');
    expect(listing).toContain('adjusted=2');
    expect(listing).toContain('+1/-1/neutral=1');
    expect(listing).toContain('defaultZero=1');
    expect(listing).toContain('missingHeight=0');
  });

  it('surfaces GPS rover offset diagnostics and listing rows', () => {
    const input = readFileSync('tests/fixtures/gps_offset_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 6 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 6,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 200,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('GPS Rover Offsets');
    expect(listing).toContain('GPS Rover Offset Observations');
    expect(listing).toContain('1:5');
    expect(listing).toContain('1:6');
    expect(listing).toContain('2.0000');
  });
});
