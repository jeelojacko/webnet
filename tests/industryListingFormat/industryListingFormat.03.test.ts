import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  LSAEngine,
  buildIndustryStyleListingText,
} from './industryListingFormatTestSupport';

describe('industry listing phase 5 formatting locks', () => {
  it('reports plan rotation in project options and changes rotated output coordinates', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const rotatedInput = ['.ROTATION 10', baseInput].join('\n');
    const baseResult = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const rotatedResult = new LSAEngine({ input: rotatedInput, maxIterations: 10 }).solve();

    const buildListing = (result: ReturnType<LSAEngine['solve']>, rotationAngleRad: number) =>
      buildIndustryStyleListingText(
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
          rotationAngleRad,
        },
      );

    const baseListing = buildListing(baseResult, baseResult.parseState?.rotationAngleRad ?? 0);
    const rotatedListing = buildListing(
      rotatedResult,
      rotatedResult.parseState?.rotationAngleRad ?? 0,
    );

    expect(baseListing).toMatch(/Plan Rotation\s+:\s+OFF/);
    expect(rotatedListing).toMatch(/Plan Rotation\s+:\s+ON \(10\.000000 deg\)/);

    const coordRow = (listing: string, stationId: string): [number, number] => {
      const match = listing.match(
        new RegExp(`^\\s*${stationId}\\s+\\S+\\s+(-?\\d+\\.\\d{4})\\s+(-?\\d+\\.\\d{4})\\s*$`, 'm'),
      );
      expect(match).toBeTruthy();
      return [Number.parseFloat(match?.[1] ?? '0'), Number.parseFloat(match?.[2] ?? '0')];
    };

    const [baseN, baseE] = coordRow(baseListing, 'B');
    const [rotN, rotE] = coordRow(rotatedListing, 'B');
    expect(Math.abs(rotN - baseN)).toBeGreaterThan(1);
    expect(Math.abs(rotE - baseE)).toBeGreaterThan(0.5);
  });

  it('reports geoid/grid diagnostics in project options when enabled', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.GEOID ON NGS-DEMO',
      '.GEOID INTERP BILINEAR',
      '.GEOID HEIGHT ON ORTHOMETRIC',
      'P ORG 40.000000 -105.000000 0 ! !',
      'PH TGT 40.001000 -104.999000 120.000',
      'B ORG-TGT 045.000000 1.0',
      'D ORG-TGT 120.0000 0.005',
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
        solveProfile: 'webnet',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('Geoid/Grid Model');
    expect(listing).toContain('ON (NGS-DEMO, BILINEAR, loaded=YES)');
    expect(listing).toContain('Geoid Metadata');
    expect(listing).toContain('Geoid Height Conversion');
    expect(listing).toContain('ON (ORTHOMETRIC');
  });

  it('reports geoid checkpoint conversion diagnostics with converted/skipped counts', () => {
    const input = readFileSync('tests/fixtures/geoid_phase3_checkpoints.dat', 'utf-8');
    const result = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: {
        geoidHeightConversionEnabled: true,
        geoidOutputHeightDatum: 'orthometric',
      },
    }).solve();
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
        angleUnits: 'dd',
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

    expect(listing).toContain('Geoid/Grid Model');
    expect(listing).toContain('ON (NGS-DEMO, BILINEAR, loaded=YES)');
    expect(listing).toContain('Geoid Height Conversion');
    expect(listing).toContain('ON (ORTHOMETRIC, converted=1, skipped=1)');
  });

  it('shows lost-station diagnostics and supports listing visibility filter', () => {
    const input = [
      '.2D',
      '.LOSTSTATIONS B',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const listingShown = buildIndustryStyleListingText(
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
    const listingHidden = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 10,
        units: 'm',
        listingShowLostStations: false,
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

    expect(listingShown).toContain('Lost Stations');
    expect(listingShown).toContain('1 (B)');
    expect(listingShown).toMatch(/Show Lost Stations in Output\s+:\s+ON/);
    expect(listingHidden).toMatch(/Show Lost Stations in Output\s+:\s+OFF/);
    expect(listingShown).toMatch(/^\s*B\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listingHidden).not.toMatch(/^\s*B\s+-\s+-?\d+\.\d{4}\s+-?\d+\.\d{4}\s*$/m);
    expect(listingShown).toContain('A-B');
    expect(listingHidden).not.toContain('A-B');
  });

  it('reports CRS projection/scale/convergence diagnostics in listing project options', () => {
    const input = [
      '.2D',
      '.UNITS METERS DD',
      '.CRS ON ENU SiteGrid',
      '.CRS SCALE 0.99960000',
      '.CRS CONVERGENCE 0.250000',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
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
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toContain('CRS / Projection');
    expect(listing).toContain('ON (local-enu, label="SiteGrid")');
    expect(listing).toContain('CRS Grid-Ground Scale');
    expect(listing).toContain('ON (0.99960000)');
    expect(listing).toContain('CRS Convergence');
    expect(listing).toContain('ON (0.250000 deg)');
  });

});
