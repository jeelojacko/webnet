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
    expect(listing).toMatch(/^\s*1\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*1\s+\d+\.\d{6}\s+\d+\.\d{6}\s*$/m);

    // Lock key relative-ellipse formatting and fixed-to-adjusted relationship rows.
    expect(listing).toMatch(/^\s*1\s+2\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m);
    expect(listing).toMatch(/^\s*1000\s+77\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s*$/m);
  });
});
