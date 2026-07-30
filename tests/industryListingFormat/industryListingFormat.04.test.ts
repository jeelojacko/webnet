import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  LSAEngine,
  buildIndustryStyleListingText,
} from './industryListingFormatTestSupport';

describe('industry listing phase 5 formatting locks', () => {
  it('shows CRS / Projection as ON for projected-only NB grid jobs', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE',
      'C A 2500000.0000 7500000.0000 0 ! !',
      'C B 2500800.0000 7500000.0000 0',
      'B A-B 090.0000 1.0',
      'D A-B 800.0000 0.005',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
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

    expect(listing).toMatch(
      /Coordinate System Mode\s+:\s+GRID \(CRS=CA_NAD83_CSRS_NB_STEREO_DOUBLE\)/,
    );
    expect(listing).toMatch(/CRS \/ Projection\s+: ON/);
  });

  it('applies append-style description reconciliation in listing output rows', () => {
    const input = [
      '.2D',
      '.DESC APPEND /',
      "C A 0 0 0 ! ! 'Alpha",
      "E A 10.0 0.01 ! 'Beta",
      "C B 100 0 0 ! ! 'Beta Point",
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
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
    expect(listing).toContain('Description Reconciliation');
    expect(listing).toContain('APPEND (delimiter="/")');
    expect(listing).toContain('Description Reconciliation Summary');
    expect(listing).toMatch(/^\s*A\s+Alpha\/Beta\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listing).toMatch(/^\s*A\s+2\s+2\s+YES\s+Alpha\[3\]; Beta\[4\]\s*$/m);
  });

  it('reports active QFIX constants in project option settings', () => {
    const input = [
      '.2D',
      '.QFIX 0.01 3.0',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 !',
      'D A-B 100.0000 !',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
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
    expect(listing).toContain('QFIX (Linear/Angular)');
    expect(listing).toMatch(/1\.000000e-2\s+Meters/);
    expect(listing).toMatch(/3\.000000e\+0"/);
  });

  it('surfaces GPS AddHiHt preprocessing diagnostics for positive/negative/default-height vectors', () => {
    const input = readFileSync('tests/fixtures/gps_addhight_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: true,
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'name',
        listingObservationLimit: 500,
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
      },
    );

    expect(listing).toContain('GPS AddHiHt Defaults');
    expect(listing).toContain('GPS AddHiHt Preprocess');
    expect(listing).toContain('vectors=3');
    expect(listing).toContain('adjusted=2');
    expect(listing).toContain('+1/-1/neutral=1');
    expect(listing).toContain('defaultZero=1');
    expect(listing).toContain('missingHeight=0');
  });

  it('surfaces GPS rover offset diagnostics and listing rows', () => {
    const input = readFileSync('tests/fixtures/gps_offset_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 6 }).solve();
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
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 200,
      },
      {
        coordMode: '2D',
        order: 'EN',
        angleUnits: 'dd',
        angleStationOrder: 'atfromto',
        deltaMode: 'horiz',
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

    expect(listing).toContain('GPS Rover Offsets');
    expect(listing).toContain('GPS Rover Offset Observations');
    expect(listing).toContain('1:5');
    expect(listing).toContain('1:6');
    expect(listing).toContain('2.0000');
  });

  it('renders GNSS vertical deflection and vector sections for the GNSS parity fixture', () => {
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

    expect(listing).toContain('Vertical Deflection');
    expect(listing).toContain('N=-2.910 E=-1.460 (Seconds)');
    expect(listing).toContain('Project Folder and Data Files');
    expect(listing).toContain('Coordinate System                   : NewBrunswick83');
    expect(listing).toContain('GPS Vector Standard Error Factors   : None');
    expect(listing).not.toContain('Instrument Standard Error Settings');
    expect(listing).toContain('Inline Option Usage Notes');
    expect(listing).toContain('GPS Vector Factor Default Modified by Inline Option');
    expect(listing).toContain('Summary of Inconsistent Descriptions');
    expect(listing).toContain('Number of Occurrences = 0');
    expect(listing).toContain('Network Stations');
    expect(listing).toContain('Sideshots');
    expect(listing).toContain('Adjusted Station Information');
    expect(listing).toContain('Adjusted Positions and Ellipsoid Heights (Meters)');
    expect(listing).toContain('Convergence Angles (DMS) and Grid Factors at Stations');
    expect(listing).toContain('Project Averages:    -0-06-14.20    0.99985403    0.99999106    0.99984510');
    expect(listing).toContain('Adjusted Observations and Residuals');
    expect(listing).toContain('Number of GPS Vector Observations (Meters) = 15');
    expect(listing).toContain('Adjusted GPS Vector Observations (Meters)');
    expect(listing).toContain('Adjusted Bearings (DMS) and Horizontal Distances (Meters)');
    expect(listing).toContain('Grnd Dist');
    expect(listing).toContain('1843.4310');
    expect(listing).toContain('FRDN       GPS1       N40-59-33.27E   1843.1364    0.11   0.0009');
    expect(listing).toContain('GPS2       GPS3       N24-10-21.39W    537.2212    0.55   0.0017');
    expect(listing).toContain('GPS2       GPS4       S52-16-30.16W    534.4179    0.43   0.0013');
    expect(listing).toContain('GPS2       GPS5       S36-50-16.52E    287.2716    1.13   0.0017');
    expect(listing).toContain('Station                   N              E          Elev');
    expect(listing).not.toContain('Control Component Status');
    expect(listing).toContain('Station                     N             E             Elev');
    expect(listing).toContain('FRDN                    785.7010         0.0007        -0.8381   0.000');
    expect(listing).toContain('GPS4                   1233.8307         0.0015         0.8054   0.000');
    expect(listing).toContain('GPS Deltas      45                 40.853         1.230');
    expect(listing).toContain('Total           45                 40.853         1.230');
    expect(listing).toContain('Delta-U               -35.5106      -0.0004   0.0023    0.2');
    expect(listing).toContain('GPS1                      0.001058      0.000732     168-58       0.003930');
    expect(listing).toContain('GPS6                      0.002761      0.001646     168-00       0.006153');
    expect(listing).toContain('FRDN       GPS6           0.002761      0.001646     168-00       0.006153');
    expect(listing).toContain('GPS2       GPS3           0.001736      0.001347     178-59       0.006569');
    expect(listing).toContain('GPS2       GPS4           0.001395      0.001037      13-04       0.004960');
    expect(listing).toContain('GPS2       GPS5           0.001789      0.001406       1-02       0.006176');
  });

});
