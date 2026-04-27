import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';

describe('industry listing preanalysis output', () => {
  it('switches to predicted-precision sections and omits adjusted observation residual tables', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 40 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
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
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dms',
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

    expect(listing).toContain('Run Purpose');
    expect(listing).toContain('Preanalysis / Predicted Precision');
    expect(listing).toContain('Predicted Station Coordinate Standard Deviations');
    expect(listing).toContain('Predicted Relative Error Ellipses');
    expect(listing).toContain('Weak Geometry Cues');
    expect(listing).not.toContain('Adjusted Distance Observations');
    expect(listing).not.toContain('Adjusted Angle Observations');
  });
});

