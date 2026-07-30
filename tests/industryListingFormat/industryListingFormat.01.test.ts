import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  LSAEngine,
  buildIndustryStyleListingText,
  expectedHeadings,
  parseOptions,
  buildIndustryReferenceListing,
} from './industryListingFormatTestSupport';

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

    let lastIndex = -1;
    expectedHeadings.forEach((heading) => {
      const idx = listing.indexOf(heading);
      expect(idx, `missing heading: ${heading}`).toBeGreaterThan(-1);
      expect(idx, `heading order regression near: ${heading}`).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    });

    expect(listing).not.toContain('Processing Notes');
    expect(listing).not.toContain('Observation Weighting Traceability');
    expect(listing).toContain(
      'From       To               Azimuth    Distance       95% RelConfidence',
    );
    expect(listing).toContain(
      '                                                    Azi    Dist       PPM',
    );
    expect(listing).toContain('Station                 Semi-Major    Semi-Minor   Azimuth of');
    expect(listing).toContain('Stations                Semi-Major    Semi-Minor   Azimuth of          RLA(2D)        PPM');
    expect(listing).toContain('From       To               Axis          Axis     Major Axis                            1:____');
    expect(listing).toMatch(/Convergence Limit; Max Iterations\s+:\s+0\.010000; 25/);

    // Lock coordinate/std-dev spacing to prevent merged numeric columns.
    expect(listing).toMatch(/^\s*1\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*1\s+-\s+\d+\.\d{6}\s+\d+\.\d{6}\s*$/m);

    // Lock key relative-ellipse formatting and fixed-to-adjusted relationship rows.
    expect(listing).toMatch(
      /^\s*1\s+2\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s+1:\d[\d,]*\s+\d+\.\d{2}\s*$/m,
    );
    expect(listing).toMatch(
      /^\s*(?:77\s+1000|1000\s+77)\s+\d+\.\d{6}\s+\d+\.\d{6}\s+\d{1,3}-\d{2}\s+1:\d[\d,]*\s+\d+\.\d{2}\s*$/m,
    );
  });

  it('prints adjusted values and normalized StdRes values in industry observation tables', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('Stations  Distance  Residual  StdErr  StdRes  File:Line');
    expect(listing).toContain('2-200       4.2657    0.0037  0.0011    3.3*');
  });

  it('computes PPM confidence from full adjusted distance while printing the exact 95 percent scale', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('1          2             270-07-30.7    22.2571   37.14   0.0010    44.2475');
    expect(listing).toContain('2          2000          000-02-36.8     5.4484   40.86   0.0017   308.7738');
  });

  it('prefers connected-pair direction for azimuth and relative-ellipse sections', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toContain('10         9             091-00-17.1     8.1147');
    expect(listing).toContain('1          1000          343-16-07.7     4.7264');
    expect(listing).toContain('200        3             176-03-08.5     4.0998');
    expect(listing).toContain('2000       3             176-56-39.7     5.2802');
    expect(listing).toContain('10         9              0.004');
    expect(listing).toContain('200        3              0.002');
    expect(listing).toContain('2000       3              0.003');
  });

  it('prints zero-size ellipse azimuths as 0-00', () => {
    const listing = buildIndustryReferenceListing();

    expect(listing).toMatch(/1000\s+235\s+0\.000000\s+0\.000000\s+0-00/);
  });

  it('renders control-component traceability for fixed, free, and weighted control rows', () => {
    const input = [
      '.3D',
      'C A 0 0 10 0.010 0.020 0.030 ! *',
      'C B 100 0 10 ! ! !',
      'C P 60 40 10',
      'D B-P 56.5685425 0.005',
      'B B-P 123-41-24.1 2',
      'G A P 60 40 0.010 0.010',
    ].join('\n');
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
        coordMode: '3D',
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

    expect(listing).toContain('Control Component Status');
    expect(listing).toMatch(/^\s*A\s+-\s+N=FREE E=FIXED H=WEIGHTED\s*$/m);
    expect(listing).toMatch(/^\s*B\s+-\s+N=FIXED E=FIXED H=FIXED\s*$/m);
  });

  it('renders effective distance for angles and lateral residual distance for directions', () => {
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

    expect(listing).toContain(
      'Stations  Angle        Residual  Distance  StdErr  StdRes  File:Line',
    );
    expect(listing).toContain(
      'Stations  Direction    Residual  Distance  StdErr  StdRes  File:Line',
    );
    expect(listing).toMatch(/^\s*O-BS-P\s+.+\s+.+\s+100\.0000\s+.+\s+.+\s+1:9\s*$/m);
    expect(listing).toMatch(/^\s*O-P\s+.+\s+.+\s+0\.0000\s+.+\s+.+\s+1:11\s*$/m);
  });

  it('formats grid geodetic rows in DMS and adds vertical precision columns for 3D listings', () => {
    const input = [
      '.3D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 100.0000 ! ! !',
      'C B 2500100.0000 7500000.0000 100.0000 ! ! !',
      'C P 2500050.0000 7500040.0000 102.0000',
      'B A-P 51.3401917459 1.0',
      'D A-P 64.06246951 0.005',
      'Z A-P 88.21008939 5.0',
      'B B-P 308.6598082541 1.0',
      'D B-P 64.06246951 0.005',
      'Z B-P 88.21008939 5.0',
    ].join('\n');
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

    expect(listing).not.toContain('Observation Weighting Traceability');
    expect(listing).toContain('Adjusted Positions and Ellipsoid Heights (Meters)');
    expect(listing).toContain('Latitude');
    expect(listing).toContain('Longitude');
    expect(listing).toMatch(/^\s*A\s+\d{2}-\d{2}-\d{2}\.\d{6}\s+-\d{2}-\d{2}-\d{2}\.\d{6}\s+100\.0000\s*$/m);
    expect(listing).toContain('Station Coordinate Standard Deviations (Meters)');
    expect(listing).toMatch(/Station\s+Description\s+N\s+E\s+Elev/);
    expect(listing).toContain('Station Coordinate Error Ellipses (Meters)');
    expect(listing).toContain('Azimuth of       Elev');
  });

  it('keeps centerInflation details on a single instrument-settings row', () => {
    const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0', 'B A-B 090.0000 1.0', 'D A-B 100 0.005'].join(
      '\n',
    );
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
        stochasticDefaultsSummary:
          'inst=S9 dist=0.0010m+1.000ppm hz=0.500" va=0.500" centering=0.00050/0.00000m edm=additive centerInflation=ON(explicit=OFF)',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toMatch(/Centering Inflation\s+:\s+ON\(explicit=OFF\)/);
    expect(listing).not.toContain('Setting explicit');
  });

});
