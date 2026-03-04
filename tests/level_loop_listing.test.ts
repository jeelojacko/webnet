import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';

describe('industry listing leveling loop diagnostics', () => {
  it('renders the differential leveling loop section when loop closures are present', () => {
    const input = readFileSync('tests/fixtures/level_loop_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const text = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: true,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'input',
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
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
      },
    );

    expect(text).toContain('Differential Leveling Loop Diagnostics');
    expect(text).toContain(
      'observations=5, loops=2, pass=0, warn=2, totalLength=4.100km, warnLength=5.200km, tolerance=0.00mm+4.00mm*sqrt(km)',
    );
    expect(text).toContain('LL-1');
    expect(text).toContain('LL-2');
    expect(text).toContain('WarnLoops');
    expect(text).toContain('Status');
    expect(text).toContain('Closure');
    expect(text).toContain('mm/sqrt(km)');
  });
});
