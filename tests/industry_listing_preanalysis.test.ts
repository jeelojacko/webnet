import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import type { InstrumentLibrary } from '../src/types';

const PREANALYSIS_TEST_LIBRARY: InstrumentLibrary = {
  S9: {
    code: 'S9',
    desc: 'Test instrument',
    edm_const: 0.001,
    edm_ppm: 1,
    hzPrecision_sec: 1,
    dirPrecision_sec: 1,
    azBearingPrecision_sec: 1,
    vaPrecision_sec: 1,
    instCentr_m: 0.0005,
    tgtCentr_m: 0.0005,
    vertCentr_m: 0.0005,
    elevDiff_const_m: 0.001,
    elevDiff_ppm: 0,
    gpsStd_xy: 0,
    levStd_mmPerKm: 1.5,
  },
};

describe('industry listing preanalysis output', () => {
  it('uses the trimmed classic preanalysis section set and omits adjusted observation residual tables', () => {
    const input = [
      '.3D',
      'C A 0 0 0 ! ! !',
      'C B 100 0 0 ! ! !',
      'C P 60 40 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      instrumentLibrary: PREANALYSIS_TEST_LIBRARY,
      parseOptions: { preanalysisMode: true, coordMode: '3D', currentInstrument: 'S9' },
    }).solve();

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
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'stdResidual',
        listingObservationLimit: 200,
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
        projectInstrumentLibrary: PREANALYSIS_TEST_LIBRARY,
      },
    );

    expect(listing).toContain('STAR*NET Run Mode');
    expect(listing).toContain('Preanalysis');
    expect(listing).toContain('Summary of Inconsistent Descriptions');
    expect(listing).toContain('Station Coordinate Standard Deviations');
    expect(listing).toContain('Relative Error Ellipses');
    expect(listing).toContain('Partially Fixed');
    expect(listing).not.toContain('Predicted Station Coordinate Standard Deviations');
    expect(listing).not.toContain('Predicted Relative Error Ellipses');
    expect(listing).not.toContain('Adjustment Statistical Summary');
    expect(listing).not.toContain('Adjusted Coordinates (Meters)');
    expect(listing).not.toContain('Control Component Status');
    expect(listing).not.toContain('Geodetic Position Summary');
    expect(listing).not.toContain('Weak Geometry Cues');
    expect(listing).not.toContain('Adjusted Distance Observations');
    expect(listing).not.toContain('Adjusted Angle Observations');
  });
});

