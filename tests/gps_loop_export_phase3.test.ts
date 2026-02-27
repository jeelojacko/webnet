import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';

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
  listingObservationLimit: 500,
};

const listingParseSettings = {
  coordMode: '2D' as const,
  order: 'EN' as const,
  angleUnits: 'dms' as const,
  angleStationOrder: 'atfromto' as const,
  deltaMode: 'horiz' as const,
  refractionCoefficient: 0.13,
};

const listingRunDiagnostics = {
  solveProfile: 'webnet' as const,
  angleCenteringModel: 'geometry-aware-correlated-rays' as const,
  defaultSigmaCount: 0,
  defaultSigmaByType: '',
  stochasticDefaultsSummary: 'inst=S9',
  rotationAngleRad: 0,
};

describe('GPS loop diagnostics export phase 3', () => {
  it('renders PASS loop diagnostics in industry-style listing export for known-pass dataset', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase3_pass.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      listingSettings,
      listingParseSettings,
      listingRunDiagnostics,
    );

    expect(listing).toContain('GPS Loop Check');
    expect(listing).toContain('(vectors=3, loops=1, pass=1, warn=0)');
    expect(listing).toContain('GPS Loop Diagnostics');
    expect(listing).toContain('pass=1, warn=0');
    expect(listing).toMatch(/\bPASS\b/);
  });

  it('renders WARN loop diagnostics in industry-style listing export for known-fail dataset', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase3_fail.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      listingSettings,
      listingParseSettings,
      listingRunDiagnostics,
    );

    expect(listing).toContain('GPS Loop Check');
    expect(listing).toContain('(vectors=3, loops=1, pass=0, warn=1)');
    expect(listing).toContain('GPS Loop Diagnostics');
    expect(listing).toContain('pass=0, warn=1');
    expect(listing).toMatch(/\bWARN\b/);
  });
});
