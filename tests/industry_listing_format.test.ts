import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import type { ParseOptions } from '../src/types';

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
    expect(listing).toContain('From       To               Azimuth    Distance       95% RelConfidence');
    expect(listing).toContain('                                                    Azi    Dist       PPM');
    expect(listing).toContain('Station                 Semi-Major    Semi-Minor   Azimuth of');
    expect(listing).toContain('Stations                Semi-Major    Semi-Minor   Azimuth of');
    expect(listing).toContain('From       To               Axis          Axis     Major Axis');

    // Lock coordinate/std-dev spacing to prevent merged numeric columns.
    expect(listing).toMatch(/^\s*1\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*1\s+-\s+\d+\.\d{6}\s+\d+\.\d{6}\s*$/m);

    // Lock key relative-ellipse formatting and fixed-to-adjusted relationship rows.
    expect(listing).toMatch(/^\s*1\s+2\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m);
    expect(listing).toMatch(/^\s*1000\s+77\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m);
  });

  it('renders effective-distance column values for adjusted angle/direction rows', () => {
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

    expect(listing).toContain('EffDist (Meters)');
    expect(listing).toMatch(/^\s*O-BS-P\s+.+\s+.+\s+100\.0000\s+.+\s+.+\s+1:9\s*$/m);
    expect(listing).toMatch(/^\s*O-P\s+.+\s+.+\s+100\.0000\s+.+\s+.+\s+1:11\s*$/m);
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
    const baseInput = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'B A-B 090.0000 1.0', 'D A-B 100.0000 0.001'].join(
      '\n',
    );
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
    const rotatedListing = buildListing(rotatedResult, rotatedResult.parseState?.rotationAngleRad ?? 0);

    expect(baseListing).toContain('Plan Rotation                      : OFF');
    expect(rotatedListing).toContain('Plan Rotation                      : ON (10.000000 deg)');

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
    expect(listingShown).toContain('Show Lost Stations in Output      : ON');
    expect(listingHidden).toContain('Show Lost Stations in Output      : OFF');
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
});
