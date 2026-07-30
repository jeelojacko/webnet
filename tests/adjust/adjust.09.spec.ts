import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  RAD_TO_DEG,
  readFileSync,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it(
    'runs the provisional data-check stage and falls back to reduced-direction consistency when geometry remains weak',
    () => {
      const input = readFileSync('tests/fixtures/industry_case_combined_input.txt', 'utf-8');

      const result = new LSAEngine({
        input,
        maxIterations: 8,
        parseOptions: { runMode: 'data-check', coordMode: '3D' },
      }).solve();

      const directionRows = result.observations.filter((obs) => obs.type === 'direction');
      expect(directionRows.length).toBeGreaterThan(100);

      const maxDirectionResidualArcSec = directionRows.reduce(
        (max, obs) => Math.max(max, Math.abs((obs.residual ?? 0) * RAD_TO_DEG * 3600)),
        0,
      );
      expect(maxDirectionResidualArcSec).toBeLessThan(5);
      expect(
        result.logs.some((line) => line.includes('Data Check provisional approximation: updated')),
      ).toBe(true);

      const fallbackRows = directionRows.filter(
        (obs) =>
          (obs.rawCount ?? 0) > 0 &&
          Math.abs(obs.obs - (obs.calc ?? Number.NaN)) < 1e-12 &&
          (obs.stdRes == null || !Number.isFinite(obs.stdRes)),
      );
      expect(fallbackRows.length).toBeGreaterThan(20);
    },
    15000,
  );

  it('enforces blunder-detect mode overrides with explicit diagnostics', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 50 60 0',
      'D A-U 78.102 0.003',
      'D B-U 78.102 0.003',
      'A U-A-B 78-30-00.0 1.0',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        runMode: 'blunder-detect',
        coordMode: '2D',
        autoAdjustEnabled: true,
        robustMode: 'huber',
        autoSideshotEnabled: true,
        clusterDetectionEnabled: true,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.runMode).toBe('blunder-detect');
    const diagCodes = new Set(
      (result.parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
    );
    expect(diagCodes.has('BLUNDER_DISALLOWS_AUTOADJUST')).toBe(true);
    expect(diagCodes.has('BLUNDER_DISALLOWS_ROBUST')).toBe(true);
    expect(diagCodes.has('BLUNDER_SKIPS_AUTOSIDESHOT')).toBe(true);
    expect(diagCodes.has('BLUNDER_SKIPS_CLUSTER')).toBe(true);
    expect(result.logs.some((line) => line.includes('[BLUNDER_DISALLOWS_AUTOADJUST]'))).toBe(true);
    expect(result.logs.some((line) => line.includes('[BLUNDER_DISALLOWS_ROBUST]'))).toBe(true);
  });

  it('reruns blunder-detect as iterative deweighting without removing observations', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 100 100 0',
      'D A-C 141.421 0.005',
      'D B-C 100.000 0.005',
      'A C-A-B 95-00-00 5',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: { runMode: 'blunder-detect', coordMode: '2D' },
    }).solve();

    const cycleLines = result.logs.filter((line) => line.startsWith('Blunder cycle '));
    expect(result.parseState?.runMode).toBe('blunder-detect');
    expect(cycleLines.length).toBeGreaterThan(1);
    expect(cycleLines.some((line) => line.includes('deweight obs'))).toBe(true);
    expect(cycleLines.some((line) => line.includes('newSigma='))).toBe(true);
    expect(result.observations).toHaveLength(3);
    expect(result.observations.map((obs) => obs.id)).toEqual([0, 1, 2]);
  });

  it('runs auto-adjust cycles in direct engine solves and reports removed observations', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 0 100 0 ! !',
      'C D 100 100 0',
      'D A-D 141.421 0.005',
      'D B-D 110.000 0.005',
      'D C-D 100.000 0.005',
      'A D-A-B 95-00-00 5',
      'A D-C-B 90-00-00 5',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        runMode: 'adjustment',
        coordMode: '2D',
        autoAdjustEnabled: true,
        autoAdjustStdResThreshold: 1.5,
        autoAdjustMaxCycles: 3,
        autoAdjustMaxRemovalsPerCycle: 1,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.autoAdjustEnabled).toBe(true);
    expect(result.autoAdjustDiagnostics?.enabled).toBe(true);
    expect(result.autoAdjustDiagnostics?.cycles.length).toBeGreaterThan(1);
    expect(result.autoAdjustDiagnostics?.removed).toHaveLength(1);
    expect(result.autoAdjustDiagnostics?.removed[0]?.obsId).toBe(3);
    expect(result.logs.some((line) => line.startsWith('Auto-adjust cycle 1:'))).toBe(true);
  });

  it('hard-fails blunder-detect mode for leveling-only datasets with compatibility diagnostics', () => {
    const input = ['C A 0 0 100.000 ! ! !', 'C B 0 0 100.900', 'L A-B 0.9000 0.25'].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: { runMode: 'blunder-detect' },
    }).solve();

    expect(result.success).toBe(false);
    expect(result.parseState?.runMode).toBe('blunder-detect');
    const levelOnlyDiag = (result.parseState?.runModeCompatibilityDiagnostics ?? []).find(
      (diag) => diag.code === 'BLUNDER_LEVELING_ONLY',
    );
    expect(levelOnlyDiag).toBeDefined();
    expect(levelOnlyDiag?.severity).toBe('error');
    expect(result.logs.some((line) => line.includes('[BLUNDER_LEVELING_ONLY]'))).toBe(true);
  });

  it('computes post-adjusted sideshot coordinates/precision when azimuth reference exists', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_known.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    expect(result.sideshots?.length).toBeGreaterThan(0);
    const side = result.sideshots?.find((s) => s.to === 'SH');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
    expect(side?.sigmaE).toBeDefined();
    expect(side?.sigmaN).toBeDefined();
  });

  it('reports sideshot limitation when target azimuth reference is unavailable', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_missing_az.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHMISS');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(false);
    expect(side?.note?.includes('azimuth unavailable')).toBe(true);
  });

  it('uses explicit SS azimuth to compute coordinates without target approximation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_explicit_az.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHAZ');
    expect(side).toBeDefined();
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.azimuthSource).toBe('explicit');
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
  });

  it('uses setup-based SS horizontal angle with backsight orientation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_setup_hz.dat', 'utf-8');
    const engine = new LSAEngine({ input, maxIterations: 10 });
    const result = engine.solve();
    const side = result.sideshots?.find((s) => s.to === 'SHSET');
    expect(side).toBeDefined();
    expect(side?.azimuthSource).toBe('setup');
    expect(side?.hasAzimuth).toBe(true);
    expect(side?.easting).toBeDefined();
    expect(side?.northing).toBeDefined();
    expect(Math.abs((side?.easting ?? 0) - 10)).toBeLessThan(0.25);
    expect(Math.abs(side?.northing ?? 0)).toBeLessThan(0.25);
  });

  it('detects non-redundant M-record auto-sideshot candidates and excludes control targets', () => {
    const input = [
      '.2D',
      '.ORDER EN ATFROMTO',
      'C O 0 0 0 ! !',
      'C BS 100 0 0 ! !',
      'C CTRL 40 80 0 ! !',
      'M O-BS-U1 063-26-06.0 89.4427',
      'M O-BS-CTRL 063-26-06.0 89.4427',
    ].join('\n');

    const result = new LSAEngine({ input, maxIterations: 10 }).solve();
    const diag = result.autoSideshotDiagnostics;
    expect(diag?.enabled).toBe(true);
    expect(diag?.evaluatedCount).toBe(2);
    expect(diag?.excludedControlCount).toBe(1);
    expect(diag?.candidateCount).toBe(1);
    expect(diag?.candidates[0].occupy).toBe('O');
    expect(diag?.candidates[0].backsight).toBe('BS');
    expect(diag?.candidates[0].target).toBe('U1');
    expect(result.logs.some((l) => l.includes('Auto-sideshot detection (M-lines)'))).toBe(true);
  });

  it('supports disabling auto-sideshot detection via parse options', () => {
    const input = [
      '.2D',
      'C O 0 0 0 ! !',
      'C BS 100 0 0 ! !',
      'M O-BS-U1 090-00-00.0 100.000',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 10,
      parseOptions: { autoSideshotEnabled: false },
    }).solve();
    expect(result.autoSideshotDiagnostics).toBeUndefined();
    expect(result.logs.some((l) => l.includes('Auto-sideshot detection (M-lines): disabled'))).toBe(
      true,
    );
  });

  it('keeps observation count, chi-square, and sideshot coordinates stable across auto-sideshot toggle', () => {
    const input = readFileSync('tests/fixtures/auto_sideshot_phase4.dat', 'utf-8');
    const on = new LSAEngine({
      input,
      maxIterations: 20,
      parseOptions: { autoSideshotEnabled: true },
    }).solve();
    const off = new LSAEngine({
      input,
      maxIterations: 20,
      parseOptions: { autoSideshotEnabled: false },
    }).solve();

    expect(on.observations.length).toBe(off.observations.length);
    expect(on.dof).toBe(off.dof);
    expect(on.chiSquare).toBeDefined();
    expect(off.chiSquare).toBeDefined();
    expect(on.chiSquare?.T ?? 0).toBeCloseTo(off.chiSquare?.T ?? 0, 8);
    expect(on.chiSquare?.varianceFactor ?? 0).toBeCloseTo(off.chiSquare?.varianceFactor ?? 0, 8);

    const shOn = on.sideshots?.find((s) => s.to === 'SH');
    const shOff = off.sideshots?.find((s) => s.to === 'SH');
    expect(shOn).toBeDefined();
    expect(shOff).toBeDefined();
    expect(shOn?.easting ?? 0).toBeCloseTo(shOff?.easting ?? 0, 8);
    expect(shOn?.northing ?? 0).toBeCloseTo(shOff?.northing ?? 0, 8);
    expect(shOn?.sigmaE ?? 0).toBeCloseTo(shOff?.sigmaE ?? 0, 8);
    expect(shOn?.sigmaN ?? 0).toBeCloseTo(shOff?.sigmaN ?? 0, 8);

    expect(on.autoSideshotDiagnostics?.candidateCount ?? 0).toBeGreaterThan(0);
    expect(off.autoSideshotDiagnostics).toBeUndefined();
  });

  it('converges a weak but recoverable network through the damping path', () => {
    const input = readFileSync('tests/fixtures/regularized_recoverable_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 20 }).solve();

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(
      result.logs.some((line) =>
        line.includes('normal-equation factorization required diagonal damping'),
      ),
    ).toBe(true);
    expect(result.logs.some((line) => line.includes('Normal equation solve failed'))).toBe(false);
    expect(result.dof).toBe(1);
    expect(Number.isFinite(result.stations.P1.x)).toBe(true);
    expect(Number.isFinite(result.stations.P1.y)).toBe(true);
    expect(Number.isFinite(result.stations.P2.x)).toBe(true);
    expect(Number.isFinite(result.stations.P2.y)).toBe(true);
  });
});
