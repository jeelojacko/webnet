import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  LSAEngine,
  buildIndustryStyleListingText,
  INDUSTRY_FALLBACK_LIBRARY,
} from './industryListingFormatTestSupport';

describe('industry listing phase 5 formatting locks', () => {
  it('keeps GNSS vector input and adjusted vector sections visible when generic adjusted-observation rows are hidden', () => {
    const input = readFileSync('tests/fixtures/industry_case_gnss_input.txt', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.01,
      parseOptions: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
      },
    }).solve();

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 15,
        units: 'm',
        precisionReportingMode: 'industry-standard',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: false,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 9999,
      },
      {
        coordMode: '3D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'slope',
        refractionCoefficient: 0.07,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        gnssVectorFrameDefault: 'gridNEU',
        gnssFrameConfirmed: false,
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
      },
    );

    expect(listing).toContain('Summary of Unadjusted Input Observations');
    expect(listing).toContain('Number of GPS Vector Observations (Meters) = 15');
    expect(listing).toContain('Adjusted Observations and Residuals');
    expect(listing).toContain('Adjusted GPS Vector Observations (Meters)');
    expect(listing).toContain('(V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc)');
    expect(listing).toContain('FRDN              Delta-N              1109.0403');
    expect(listing).not.toContain('Adjusted Angle Observations');
  });

  it('uses the compact GNSS listing path for live app parity-current runs even when a default instrument library is loaded', () => {
    const input = readFileSync('tests/fixtures/industry_case_gnss_input.txt', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.01,
      instrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
      parseOptions: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
      },
    }).solve();

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        precisionReportingMode: 'industry-standard',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: true,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'stdResidual',
        listingObservationLimit: 60,
      },
      {
        coordMode: '3D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'slope',
        refractionCoefficient: 0.07,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        gnssVectorFrameDefault: 'gridNEU',
        gnssFrameConfirmed: false,
        verticalDeflectionNorthSec: 0,
        verticalDeflectionEastSec: 0,
        projectInstrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
      },
    );

    expect(listing).toContain('Number of GPS Vector Observations (Meters) = 15');
    expect(listing).toContain('Adjusted GPS Vector Observations (Meters)');
    expect(listing).toContain('(V27 PostProcessed 28-APR-2025 12:21:00.0 session_1_processed.asc)');
    expect(listing).not.toContain('Instrument Standard Error Settings');
    expect(listing).not.toContain('Unused Stations');
    expect(listing).not.toContain('Number of Measured Distance Observations (Meters) = 0');
  });

  it('prefers solved parse-state vertical deflection over stale run diagnostics in the listing header', () => {
    const input = readFileSync('tests/fixtures/industry_case_gnss_input.txt', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.01,
      parseOptions: {
        coordMode: '3D',
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        order: 'NE',
        deltaMode: 'slope',
        angleStationOrder: 'atfromto',
        lonSign: 'west-positive',
        applyCurvatureRefraction: true,
        verticalReduction: 'curvref',
        refractionCoefficient: 0.07,
        verticalDeflectionNorthSec: -2.91,
        verticalDeflectionEastSec: -1.46,
      },
    }).solve();

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 15,
        units: 'm',
        precisionReportingMode: 'industry-standard',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: true,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'stdResidual',
        listingObservationLimit: 60,
      },
      {
        coordMode: '3D',
        order: 'NE',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        deltaMode: 'slope',
        refractionCoefficient: 0.07,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
        coordSystemMode: 'grid',
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        gnssVectorFrameDefault: 'gridNEU',
        gnssFrameConfirmed: false,
        verticalDeflectionNorthSec: 0,
        verticalDeflectionEastSec: 0,
        projectInstrumentLibrary: INDUSTRY_FALLBACK_LIBRARY,
      },
    );

    expect(listing).toContain('Vertical Deflection                 : N=-2.910 E=-1.460 (Seconds)');
    expect(listing).not.toContain('Vertical Deflection                 : N=0.000 E=0.000 (Seconds)');
  });
});
