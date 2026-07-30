import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  RAD_TO_DEG,
  SEC_TO_RAD,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it('applies industry-standard centering inflation to slope distances', () => {
    const input = [
      '.3D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! ! !',
      'C B 4 3 12 ! ! !',
      'D A-B 13.0000 0.010',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const dist = result.observations.find((obs) => obs.type === 'dist');
    expect(dist).toBeDefined();
    const sigma = (engine as any).effectiveStdDev(dist);
    const d = 5;
    const s = 13;
    const e = 12;
    const expected = Math.sqrt(
      0.01 ** 2 + (d / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (e / s) ** 2 * 0.02 ** 2,
    );
    expect(sigma).toBeCloseTo(expected, 12);
  });

  it('applies industry-standard centering inflation to zeniths in radians', () => {
    const input = [
      '.3D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! ! !',
      'C B 4 3 12 ! ! !',
      'V A-B 22.619865 1.0',
    ].join('\n');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const zenith = result.observations.find((obs) => obs.type === 'zenith');
    expect(zenith).toBeDefined();
    const sigma = (engine as any).effectiveStdDev(zenith);
    const d = 5;
    const s = 13;
    const e = 12;
    const baseRad = 1 * SEC_TO_RAD;
    const centeringRad =
      Math.sqrt((e / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (d / s) ** 2 * 0.02 ** 2) / s;
    const expected = Math.sqrt(baseRad ** 2 + centeringRad ** 2);
    expect(sigma).toBeCloseTo(expected, 12);
  });

  it('matches the fixture-locked centering geometry reference case', () => {
    const input = readFileSync('tests/fixtures/centering_geometry_reference.dat', 'utf-8');
    const instrumentLibrary = {
      TS: {
        code: 'TS',
        desc: 'TS',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0.03,
        tgtCentr_m: 0.04,
        vertCentr_m: 0.02,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const engine = new LSAEngine({ input, maxIterations: 5, instrumentLibrary });
    const result = engine.solve();
    const dist = result.observations.find((obs) => obs.type === 'dist');
    const zenith = result.observations.find((obs) => obs.type === 'zenith');

    expect(dist).toBeDefined();
    expect(zenith).toBeDefined();

    const sigmaDist = (engine as any).effectiveStdDev(dist);
    const sigmaZen = (engine as any).effectiveStdDev(zenith);
    const d = 5;
    const s = 13;
    const e = 12;
    const expectedDist = Math.sqrt(
      0.01 ** 2 + (d / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (e / s) ** 2 * 0.02 ** 2,
    );
    const expectedZen = Math.sqrt(
      (1 * SEC_TO_RAD) ** 2 +
        (Math.sqrt((e / s) ** 2 * (0.03 ** 2 + 0.04 ** 2) + 2 * (d / s) ** 2 * 0.02 ** 2) / s) ** 2,
    );

    expect(sigmaDist).toBeCloseTo(expectedDist, 12);
    expect(sigmaZen).toBeCloseTo(expectedZen, 12);
  });

  it('uses initial approximate geometry for parity-profile angle centering sigmas', () => {
    const input = readFileSync('tests/fixtures/industry_standard_reference_case.dat', 'utf-8');
    const instrumentLibrary = {
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
    const currentResult = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.001,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: '__INDUSTRY_DEFAULT__',
        directionSetMode: 'raw',
        robustMode: 'none',
        tsCorrelationEnabled: false,
        clusterDetectionEnabled: false,
        geometryDependentSigmaReference: 'current',
      },
    }).solve();
    const parityResult = new LSAEngine({
      input,
      maxIterations: 15,
      convergenceThreshold: 0.001,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: '__INDUSTRY_DEFAULT__',
        directionSetMode: 'raw',
        robustMode: 'none',
        tsCorrelationEnabled: false,
        clusterDetectionEnabled: false,
        geometryDependentSigmaReference: 'initial',
      },
    }).solve();

    const currentAngle = currentResult.observations.find(
      (obs) => obs.type === 'angle' && obs.at === '3' && obs.from === '4' && obs.to === '2000',
    );
    const parityAngle = parityResult.observations.find(
      (obs) => obs.type === 'angle' && obs.at === '3' && obs.from === '4' && obs.to === '2000',
    );

    expect(currentAngle?.weightingStdDev).toBeDefined();
    expect(parityAngle?.weightingStdDev).toBeDefined();
    expect((currentAngle?.weightingStdDev ?? 0) * RAD_TO_DEG * 3600).toBeCloseTo(5.6498, 3);
    expect((parityAngle?.weightingStdDev ?? 0) * RAD_TO_DEG * 3600).toBeCloseTo(5.21, 2);
  });

  it('applies the tiny industry-parity angular sigma calibration only to non-explicit angular weights', () => {
    const input = [
      '.2D',
      'C AT 0 0 0 ! !',
      'C FROM 100 0 0 ! !',
      'C TO 0 100 0 ! !',
      'A AT-FROM-TO 090-00-00',
    ].join('\n');
    const instrumentLibrary = {
      TEST: {
        code: 'TEST',
        desc: 'Parity calibration isolate',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0,
        tgtCentr_m: 0,
        vertCentr_m: 0,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const currentEngine = new LSAEngine({
      input,
      maxIterations: 4,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'TEST',
        geometryDependentSigmaReference: 'current',
      },
    });
    const currentResult = currentEngine.solve();
    const parityEngine = new LSAEngine({
      input,
      maxIterations: 4,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'TEST',
        geometryDependentSigmaReference: 'initial',
      },
    });
    const parityResult = parityEngine.solve();

    const currentAngle = currentResult.observations.find((obs) => obs.type === 'angle');
    const parityAngle = parityResult.observations.find((obs) => obs.type === 'angle');
    const currentSigma = (currentEngine as any).effectiveStdDev(currentAngle);
    const paritySigma = (parityEngine as any).effectiveStdDev(parityAngle);

    expect(Number.isFinite(currentSigma)).toBe(true);
    expect(Number.isFinite(paritySigma)).toBe(true);
    expect(paritySigma / currentSigma).toBeCloseTo(
      1.0001,
      6,
    );
  });

  it('keeps explicit angular sigma overrides unchanged in the parity calibration path', () => {
    const input = [
      '.2D',
      'C AT 0 0 0 ! !',
      'C FROM 100 0 0 ! !',
      'C TO 0 100 0 ! !',
      'A AT-FROM-TO 090-00-00 4',
    ].join('\n');
    const instrumentLibrary = {
      TEST: {
        code: 'TEST',
        desc: 'Parity calibration isolate',
        edm_const: 0,
        edm_ppm: 0,
        hzPrecision_sec: 1,
        dirPrecision_sec: 1,
        azBearingPrecision_sec: 1,
        vaPrecision_sec: 1,
        instCentr_m: 0,
        tgtCentr_m: 0,
        vertCentr_m: 0,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const currentEngine = new LSAEngine({
      input,
      maxIterations: 4,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'TEST',
        geometryDependentSigmaReference: 'current',
      },
    });
    const currentResult = currentEngine.solve();
    const parityEngine = new LSAEngine({
      input,
      maxIterations: 4,
      instrumentLibrary,
      parseOptions: {
        currentInstrument: 'TEST',
        geometryDependentSigmaReference: 'initial',
      },
    });
    const parityResult = parityEngine.solve();

    const currentAngle = currentResult.observations.find((obs) => obs.type === 'angle');
    const parityAngle = parityResult.observations.find((obs) => obs.type === 'angle');
    const currentSigma = (currentEngine as any).effectiveStdDev(currentAngle);
    const paritySigma = (parityEngine as any).effectiveStdDev(parityAngle);

    expect(Number.isFinite(currentSigma)).toBe(true);
    expect(Number.isFinite(paritySigma)).toBe(true);
    expect(paritySigma).toBeCloseTo(currentSigma, 12);
  });

  it('captures prism correction source and magnitude metadata from fixture offsets', () => {
    const input = readFileSync('tests/fixtures/prism_phase3_offsets.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 12 }).solve();
    const prismRows = result.observations.filter(
      (obs) =>
        (obs.type === 'dist' || obs.type === 'zenith') && Math.abs(obs.prismCorrectionM ?? 0) > 0,
    );
    expect(prismRows.length).toBeGreaterThanOrEqual(3);
    expect(prismRows.some((obs) => obs.prismScope === 'global')).toBe(true);
    expect(prismRows.some((obs) => obs.prismScope === 'set')).toBe(true);

    const setDist = result.observations.find(
      (obs) => obs.type === 'dist' && (obs.setId ?? '') === 'SET1',
    );
    expect(setDist).toBeDefined();
    expect(setDist?.prismCorrectionM).toBeCloseTo(0.5, 10);

    const offDist = result.observations.find(
      (obs) => obs.type === 'dist' && (obs.sourceLine ?? 0) === 13,
    );
    expect(offDist).toBeDefined();
    expect(Math.abs(offDist?.prismCorrectionM ?? 0)).toBe(0);
    expect(result.logs.some((l) => l.includes('Prism correction active'))).toBe(true);
  });

});
