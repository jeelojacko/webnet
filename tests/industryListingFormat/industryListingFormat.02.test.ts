import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  LSAEngine,
  buildIndustryStyleListingText,
  parseOptions,
} from './industryListingFormatTestSupport';

describe('industry listing phase 5 formatting locks', () => {
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

  it('renders the classic sideshot coordinates section for TS sideshots', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_known.dat', 'utf-8');
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
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 200,
      },
      {
        coordMode: '3D',
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

    expect(listing).toContain('Sideshot Coordinates Computed After Adjustment');
    expect(listing).toMatch(/^\s*Station\s+N\s+E\s+Elev\s+Description\s*$/m);
    expect(listing).toMatch(/^\s*SH\s+0\.0000\s+10\.0000\s+0\.0000\s*$/m);
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
        listingSortObservationsBy: 'stdResidual',
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
        listingSortObservationsBy: 'stdResidual',
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
        listingSortObservationsBy: 'stdResidual',
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

});
