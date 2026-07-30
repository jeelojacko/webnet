import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it('includes setup-level residual quality diagnostics for blunder screening', () => {
    const input = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C U 100 80 0',
      'D C1-U 128.060 0.002',
      'D C2-U 128.065 0.002',
      'A U-C1-C2 102-40-00.0 1.5',
      'A U-C2-C1 257-20-00.0 1.5',
      'A U-C1-C2 102-41-20.0 1.5',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 12 });
    const result = engine.solve();
    const setup = result.setupDiagnostics?.find((s) => s.station === 'U');
    expect(setup).toBeDefined();
    expect((setup?.stdResCount ?? 0) > 0).toBe(true);
    expect(setup?.rmsStdRes).toBeDefined();
    expect(setup?.maxStdRes).toBeDefined();
    expect(setup?.localFailCount).toBeGreaterThanOrEqual(0);
    expect(setup?.worstObsType).toBeDefined();
    expect(setup?.worstObsStations).toContain('U-');
  });

  it('reports traverse closure ratio diagnostics', () => {
    const input = [
      'C OCC 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'TB OCC BS',
      'T P 090.0000 100.0 0.0 1.0 0.005 5.0',
      'TE OCC 180.0000 100.0 0.0 1.0 0.005 5.0',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 8 });
    const result = engine.solve();
    expect(result.traverseDiagnostics).toBeDefined();
    expect(result.traverseDiagnostics?.closureCount).toBeGreaterThan(0);
    expect(result.traverseDiagnostics?.totalTraverseDistance).toBeGreaterThan(0);
    expect(result.traverseDiagnostics?.linearPpm).toBeDefined();
    expect(result.traverseDiagnostics?.thresholds).toBeDefined();
    expect(result.traverseDiagnostics?.loops?.length).toBeGreaterThan(0);
  });

  it('reports residual diagnostics summary for blunder screening', () => {
    const input = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C U 100 80 0',
      'D C1-U 128.060 0.002',
      'D C2-U 128.065 0.002',
      'A U-C1-C2 102-40-00.0 1.5',
      'A U-C2-C1 257-20-00.0 1.5',
      'A U-C1-C2 102-41-20.0 1.5',
    ].join('\n');
    const engine = new LSAEngine({ input, maxIterations: 12 });
    const result = engine.solve();
    expect(result.residualDiagnostics).toBeDefined();
    expect((result.residualDiagnostics?.observationCount ?? 0) > 0).toBe(true);
    expect((result.residualDiagnostics?.withStdResCount ?? 0) > 0).toBe(true);
    expect(result.residualDiagnostics?.byType.length).toBeGreaterThan(0);
    expect(result.residualDiagnostics?.criticalT).toBeGreaterThan(0);
  });

  it('solves the 2D triangulation-trilateration example with auto-created stations', () => {
    const input = readFileSync('tests/fixtures/triangulation_trilateration_2d.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 20 }).solve();
    expect(result.stations['4']).toBeDefined();
    expect(result.stations['5']).toBeDefined();
    expect(result.stations['6']).toBeDefined();
    expect(Number.isFinite(result.stations['4'].x)).toBe(true);
    expect(Number.isFinite(result.stations['4'].y)).toBe(true);
    expect(Number.isFinite(result.stations['5'].x)).toBe(true);
    expect(Number.isFinite(result.stations['5'].y)).toBe(true);
    expect(Number.isFinite(result.stations['6'].x)).toBe(true);
    expect(Number.isFinite(result.stations['6'].y)).toBe(true);
    expect(result.logs.some((l) => l.includes('Auto-created station 4'))).toBe(true);
  });

  it('applies map scale reduction to horizontal distances when map mode is on', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const scaledInput = ['.MAPMODE ON', '.MAPSCALE 0.9996', baseInput].join('\n');
    const noScale = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withScale = new LSAEngine({ input: scaledInput, maxIterations: 10 }).solve();
    expect(withScale.stations.B.x).toBeGreaterThan(noScale.stations.B.x + 0.03);
    expect(withScale.logs.some((l) => l.includes('Map reduction active'))).toBe(true);
  });

  it('applies .ROTATION to bearing/azimuth observations in solve geometry', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const rotatedInput = ['.ROTATION 10', baseInput].join('\n');

    const base = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const rotated = new LSAEngine({ input: rotatedInput, maxIterations: 10 }).solve();

    expect(rotated.stations.B.x).toBeLessThan(base.stations.B.x - 1);
    expect(rotated.stations.B.y).toBeLessThan(base.stations.B.y - 10);
    expect((rotated.parseState?.rotationAngleRad ?? 0) * (180 / Math.PI)).toBeCloseTo(10, 10);
  });

  it('persists .LOSTSTATIONS metadata flags through solve results', () => {
    const input = [
      '.2D',
      '.LOSTSTATIONS B',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    expect(result.parseState?.lostStationIds).toEqual(['B']);
    expect(result.stations.B).toBeDefined();
    expect(result.stations.B.lost).toBe(true);
    expect(result.stations.A.lost ?? false).toBe(false);
    expect(result.logs.some((l) => l.includes('Lost stations flagged'))).toBe(true);
  });

  it('applies QFIX constants to fixed-sigma weighting and changes SEUW sensitivity', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 30 0',
      'D A-P 67.0820 !',
      'D B-P 50.2000 !',
      'B A-P 063-26-06.0 !',
    ].join('\n');
    const tight = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { qFixLinearSigmaM: 1e-9, qFixAngularSigmaSec: 1e-9 },
    }).solve();
    const relaxed = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { qFixLinearSigmaM: 0.01, qFixAngularSigmaSec: 30 },
    }).solve();

    expect(tight.seuw).toBeGreaterThan(relaxed.seuw);
    const tightDist = tight.observations.find(
      (o) => o.type === 'dist' && o.sigmaSource === 'fixed',
    );
    const relaxedDist = relaxed.observations.find(
      (o) => o.type === 'dist' && o.sigmaSource === 'fixed',
    );
    expect(tightDist?.stdDev ?? 0).toBeCloseTo(1e-9, 12);
    expect(relaxedDist?.stdDev ?? 0).toBeCloseTo(0.01, 10);
  });

  it('removes weighted control constraints from components marked free with per-component *', () => {
    const weighted = new LSAEngine({
      input: [
        '.3D',
        'C A 0 0 0 0.010 0.010 0.010',
        'C B 100 0 0 ! ! !',
        'C P 60 40 10',
        'D B-P 56.5685425 0.005',
        'B B-P 123-41-24.1 2',
        'G A P 60 40 0.010 0.010',
      ].join('\n'),
      maxIterations: 10,
    }).solve();
    const freed = new LSAEngine({
      input: [
        '.3D',
        'C A 0 0 0 0.010 0.010 0.010 * * *',
        'C B 100 0 0 ! ! !',
        'C P 60 40 10',
        'D B-P 56.5685425 0.005',
        'B B-P 123-41-24.1 2',
        'G A P 60 40 0.010 0.010',
      ].join('\n'),
      maxIterations: 10,
    }).solve();

    expect(weighted.controlConstraints?.count ?? 0).toBeGreaterThan(0);
    expect(freed.controlConstraints?.count ?? 0).toBe(0);
  });

  it('applies global prism correction to modeled distance residuals', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n');
    const off = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const on = new LSAEngine({
      input: ['.PRISM ON 0.25', baseInput].join('\n'),
      maxIterations: 10,
    }).solve();
    expect(off.stations.B.x - on.stations.B.x).toBeGreaterThan(0.2);
    expect(on.logs.some((l) => l.includes('Prism correction active'))).toBe(true);
  });

  it('limits prism set-scope corrections to set-tagged distance rows', () => {
    const base = [
      '.2D',
      'I TS TestInst 0 0 1 1',
      'C A 0 0 0 ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
    ].join('\n');
    const noSet = new LSAEngine({
      input: ['.PRISM SET 0.50', base, 'D A-B 100.0000 0.001'].join('\n'),
      maxIterations: 10,
    }).solve();
    const setTagged = new LSAEngine({
      input: ['.PRISM SET 0.50', base, 'D TS SET1 A B 100.0000 0.001'].join('\n'),
      maxIterations: 10,
    }).solve();
    expect(noSet.stations.B.x).toBeCloseTo(100, 2);
    expect(setTagged.stations.B.x).toBeLessThan(noSet.stations.B.x - 0.3);
    const taggedDist = setTagged.observations.find(
      (o) => o.type === 'dist' && (o.setId ?? '') === 'SET1',
    );
    expect(taggedDist).toBeDefined();
    expect(taggedDist?.prismCorrectionM).toBeCloseTo(0.5, 10);
  });

  it('applies prism correction in zenith weighting when centering inflation is active', () => {
    const input = [
      '.I TS',
      'C A 0 0 0 ! ! !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
      'V A-B 90.0000 1.0',
      'V A-B 89.9000 1.0',
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
        instCentr_m: 0,
        tgtCentr_m: 0,
        vertCentr_m: 1.0,
        elevDiff_const_m: 0,
        elevDiff_ppm: 0,
        gpsStd_xy: 0,
        levStd_mmPerKm: 0,
      },
    };
    const off = new LSAEngine({ input, maxIterations: 8, instrumentLibrary }).solve();
    const on = new LSAEngine({
      input: `.PRISM ON 50\n${input}`,
      maxIterations: 8,
      instrumentLibrary,
    }).solve();
    const zenOff = off.observations.filter((o) => o.type === 'zenith');
    const zenOn = on.observations.filter((o) => o.type === 'zenith');
    expect(zenOff.length).toBe(2);
    expect(zenOn.length).toBe(2);
    expect(zenOff.every((obs) => Math.abs(obs.prismCorrectionM ?? 0) === 0)).toBe(true);
    expect(zenOn.every((obs) => Math.abs(obs.prismCorrectionM ?? 0) > 0)).toBe(true);
    expect(on.logs.some((l) => l.includes('zenithRows=2'))).toBe(true);
  });

  it('keeps horizontal-distance centering inflation unchanged', () => {
    const input = [
      '.2D',
      '.I TS',
      '.ADDC ON',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'D A-B 100.0000 0.002',
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
        instCentr_m: 0.003,
        tgtCentr_m: 0.004,
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
    const expected = Math.sqrt(0.002 ** 2 + 0.003 ** 2 + 0.004 ** 2);
    expect(sigma).toBeCloseTo(expected, 12);
  });

});
