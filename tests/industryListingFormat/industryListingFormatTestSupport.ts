import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

export { readFileSync };
export { LSAEngine } from '../../src/engine/adjust';
export { buildIndustryStyleListingText } from '../../src/engine/industryListing';
import { LSAEngine } from '../../src/engine/adjust';
import { buildIndustryStyleListingText } from '../../src/engine/industryListing';
import type { InstrumentLibrary, ParseOptions } from '../../src/types';

export const expectedHeadings = JSON.parse(
  readFileSync('tests/fixtures/industry_listing_phase5_expected_headings.json', 'utf-8'),
) as string[];

export const parseOptions: Partial<ParseOptions> = {
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

export const INDUSTRY_FALLBACK_LIBRARY: InstrumentLibrary = {
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

export const buildIndustryReferenceListing = (): string => {
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
      listingSortObservationsBy: 'stdResidual',
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

