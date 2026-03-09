import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0',
  'C C 100 80 0',
  'D A-B 99.800 0.005',
  'D B-C 80.300 0.005',
  'A B-A-C 90-00-20 5',
].join('\n');

const listingSettings = {
  maxIterations: 10,
  units: 'm' as const,
  listingShowCoordinates: true,
  listingShowObservationsResiduals: true,
  listingShowErrorPropagation: true,
  listingShowProcessingNotes: false,
  listingShowAzimuthsBearings: true,
  listingSortCoordinatesBy: 'name' as const,
  listingSortObservationsBy: 'input' as const,
  listingObservationLimit: 200,
};

const listingParseSettings = {
  coordMode: '2D' as const,
  order: 'EN' as const,
  angleUnits: 'dms' as const,
  angleStationOrder: 'atfromto' as const,
  deltaMode: 'horiz' as const,
  refractionCoefficient: 0.13,
};

const listingRunDiag = {
  solveProfile: 'webnet' as const,
  angleCenteringModel: 'geometry-aware-correlated-rays' as const,
  defaultSigmaCount: 0,
  defaultSigmaByType: '',
  stochasticDefaultsSummary: 'inst=S9',
  rotationAngleRad: 0,
};

describe('industry listing run-mode sections', () => {
  it('includes data-check run-purpose and differences section', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'data-check', coordMode: '2D' },
    }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      listingSettings,
      listingParseSettings,
      listingRunDiag,
    );
    expect(listing).toContain('Run Mode');
    expect(listing).toContain('DATA-CHECK');
    expect(listing).toContain('Data Check Only / Approximate Geometry');
    expect(listing).toContain('Data Check Only - Differences from Observations');
  });

  it('includes blunder-detect warning/profile section', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'blunder-detect', coordMode: '2D' },
    }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      listingSettings,
      listingParseSettings,
      listingRunDiag,
    );
    expect(listing).toContain('Run Mode');
    expect(listing).toContain('BLUNDER-DETECT');
    expect(listing).toContain('Blunder Detect Mode');
    expect(listing).toContain('not a replacement for full adjustment QA');
  });
});
