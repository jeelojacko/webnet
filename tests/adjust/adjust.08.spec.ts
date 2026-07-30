import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  isPreanalysisWhatIfCandidate,
} from './adjustTestSupport';

describe('LSAEngine', () => {
  it('applies curvature/refraction correction to zenith calculations when enabled', () => {
    const baseInput = [
      'C A 0 0 0 !',
      'C B 10000 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 10000.0000 0.001',
      'V A-B 090.0000 1.0',
    ].join('\n');
    const withCurvRefInput = ['.CURVREF ON', '.REFRACTION 0.13', '.VRED CURVREF', baseInput].join(
      '\n',
    );

    const noCurv = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve();
    const withCurv = new LSAEngine({ input: withCurvRefInput, maxIterations: 10 }).solve();

    const zNoCurv = noCurv.observations.find((o) => o.type === 'zenith');
    const zWithCurv = withCurv.observations.find((o) => o.type === 'zenith');
    expect(zNoCurv?.calc).toBeDefined();
    expect(zWithCurv?.calc).toBeDefined();
    expect(Math.abs(withCurv.stations.B.h - noCurv.stations.B.h)).toBeGreaterThan(1);
    expect(withCurv.logs.some((l) => l.includes('Vertical reduction active'))).toBe(true);
  });

  it('applies TS angular correlation model and reports diagnostics', () => {
    const base = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.2',
      'A U-C2-C3 116-33-55.0 1.2',
      'A U-C3-C1 140-46-10.0 1.2',
      'A U-C1-C2 102-40-06.0 1.2',
    ].join('\n');
    const off = new LSAEngine({ input: base, maxIterations: 12 }).solve();
    const on = new LSAEngine({ input: `.TSCORR SETUP 0.35\n${base}`, maxIterations: 12 }).solve();

    expect(on.tsCorrelationDiagnostics).toBeDefined();
    expect(on.tsCorrelationDiagnostics?.enabled).toBe(true);
    expect(on.tsCorrelationDiagnostics?.scope).toBe('setup');
    expect(on.tsCorrelationDiagnostics?.pairCount).toBeGreaterThan(0);
    expect(on.logs.some((l) => l.includes('TS correlation diagnostics'))).toBe(true);
    expect(on.seuw).not.toBe(off.seuw);
  });

  it('applies robust huber reweighting and reports iteration diagnostics', () => {
    const input = [
      '.AMODE ANGLE',
      '.ROBUST HUBER 1.5',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.0',
      'A U-C2-C3 116-33-55.0 1.0',
      'A U-C3-C1 140-46-10.0 1.0',
      'A U-C1-C2 102-42-30.0 1.0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 12 }).solve();
    expect(result.robustDiagnostics).toBeDefined();
    expect(result.robustDiagnostics?.enabled).toBe(true);
    expect(result.robustDiagnostics?.mode).toBe('huber');
    expect((result.robustDiagnostics?.iterations.length ?? 0) > 0).toBe(true);
    expect(result.robustDiagnostics?.iterations[0]?.maxWeightDelta).toBeDefined();
    expect((result.robustDiagnostics?.iterations[0]?.maxWeightDelta ?? 0) >= 0).toBe(true);
    expect(result.logs.some((l) => l.includes('maxDeltaW='))).toBe(true);
    expect(result.logs.some((l) => l.includes('robust(huber)'))).toBe(true);
  });

  it('bases robust weights on postfit residuals instead of prefit GPS misclosures', () => {
    const input = [
      '.2D',
      '.ROBUST HUBER 1.5',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 1000 1000 0',
      'G GPS A U 50 80 0.01 0.01 0',
      'G GPS B U -50 80 0.01 0.01 0',
    ].join('\n');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();

    expect(result.robustDiagnostics).toBeDefined();
    expect(result.robustDiagnostics?.iterations[0]?.downweightedRows ?? -1).toBe(0);
    expect(result.robustDiagnostics?.iterations[0]?.maxNorm ?? Infinity).toBeLessThan(1e-6);
    expect(result.stations.U.x).toBeCloseTo(50, 6);
    expect(result.stations.U.y).toBeCloseTo(80, 6);
  });

  it('runs preanalysis from planned observations and skips residual-based QC outputs', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 40 0',
      'C Q 40 70 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
      'D A-Q ? 0.003',
      'D B-Q ? 0.003',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    expect(result.converged).toBe(true);
    expect(result.preanalysisMode).toBe(true);
    expect(result.parseState?.preanalysisMode).toBe(true);
    expect(result.parseState?.plannedObservationCount).toBe(5);
    expect(result.seuw).toBeCloseTo(1, 12);
    expect(result.chiSquare).toBeUndefined();
    expect(result.residualDiagnostics).toBeUndefined();
    expect(result.robustDiagnostics).toBeUndefined();
    expect(result.autoSideshotDiagnostics).toBeUndefined();
    expect((result.stationCovariances?.length ?? 0) >= 2).toBe(true);
    expect(result.stationCovariances?.some((row) => row.stationId === 'P')).toBe(true);
    expect(result.relativeCovariances?.some((row) => row.from === 'A' && row.to === 'P')).toBe(
      true,
    );
    expect(result.relativeCovariances?.some((row) => row.from === 'A' && row.to === 'Q')).toBe(
      true,
    );
    expect(result.relativeCovariances?.some((row) => row.from === 'P' && row.to === 'Q')).toBe(
      false,
    );
    expect(result.weakGeometryDiagnostics?.enabled).toBe(true);
    expect(result.logs.some((l) => l.includes('Preanalysis mode'))).toBe(true);
    expect(result.logs.some((l) => l.includes('Preanalysis covariance blocks'))).toBe(true);
    expect(result.logs.some((l) => l.includes('skipping residual-based diagnostics'))).toBe(true);
    expect(result.observations.every((obs) => Math.abs(obs.stdRes ?? 0) < 1e-9)).toBe(true);
    expect((result.stations.P.sE ?? 0) > 0).toBe(true);
    expect((result.stations.P.sN ?? 0) > 0).toBe(true);
  });

  it('uses missing D and A values as planned preanalysis observations instead of skipping them', () => {
    const input = [
      '.2D',
      'C 1 51002 101009 ! !',
      'C 2 51005 101343',
      'C 3 51328 101291',
      'C 4 51416 101073',
      'D 1-2',
      'D 2-3',
      'D 3-4',
      'D 4-1',
      'D 1-3',
      'A 2-1-3',
      'A 3-2-4',
      'A 4-3-1',
      'A 1-4-2',
      'A 1-4-3',
      'B 1-2 ? !',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.plannedObservationCount).toBe(11);
    expect(result.observations.filter((obs) => obs.type === 'dist')).toHaveLength(5);
    expect(result.observations.filter((obs) => obs.type === 'angle')).toHaveLength(5);
    expect(result.observations.filter((obs) => obs.type === 'bearing')).toHaveLength(1);
    expect(result.logs.some((line) => line.includes('Invalid distance'))).toBe(false);
    expect(result.logs.some((line) => line.includes('Invalid angle'))).toBe(false);
    expect(result.stationCovariances?.some((row) => row.stationId === '2')).toBe(true);
    expect(result.stationCovariances?.some((row) => row.stationId === '3')).toBe(true);
    expect(result.relativeCovariances?.length ?? 0).toBeGreaterThan(0);
  });

  it('excludes fixed planned observations from preanalysis what-if candidates', () => {
    const input = [
      '.2D',
      'C 1 51002 101009 ! !',
      'C 2 51005 101343',
      'C 3 51328 101291',
      'C 4 51416 101073',
      'D 1-2',
      'D 2-3',
      'D 3-4',
      'D 4-1',
      'D 1-3',
      'A 2-1-3',
      'A 3-2-4',
      'A 4-3-1',
      'A 1-4-2',
      'A 1-4-3',
      'B 1-2 ? !',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    const bearing = result.observations.find((obs) => obs.type === 'bearing');
    expect(bearing).toBeDefined();
    expect(bearing?.planned).toBe(true);
    expect(bearing?.sigmaSource).toBe('fixed');
    expect(isPreanalysisWhatIfCandidate(bearing!)).toBe(false);

    const candidates = result.observations.filter(isPreanalysisWhatIfCandidate);
    expect(candidates).toHaveLength(10);
    expect(candidates.some((obs) => obs.id === bearing?.id)).toBe(false);
  });

  it('synthesizes missing DB/DM direction-set values from approximate geometry in preanalysis mode', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 40 0',
      'DB A B',
      'DM P',
      'DE',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

    expect(result.preanalysisMode).toBe(true);

    const direction = result.observations.find((obs) => obs.type === 'direction');
    const distance = result.observations.find((obs) => obs.type === 'dist');
    const zenith = result.observations.find((obs) => obs.type === 'zenith');
    expect(direction?.planned).toBe(true);
    expect(distance?.planned).toBe(true);
    expect(zenith?.planned).toBe(true);
    expect(direction?.obs ?? 0).not.toBe(0);
    expect(distance?.obs ?? 0).toBeGreaterThan(0);
    expect(zenith?.obs ?? 0).not.toBe(0);
  });

  it('enforces data-check mode incompatibility matrix with explicit diagnostics', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 50 40 0',
      'D A-U 64.031 0.003',
      'D B-U 64.031 0.003',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        runMode: 'data-check',
        coordMode: '2D',
        autoAdjustEnabled: true,
        robustMode: 'huber',
        autoSideshotEnabled: true,
        clusterDetectionEnabled: true,
      },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.runMode).toBe('data-check');
    const diagCodes = new Set(
      (result.parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
    );
    expect(diagCodes.has('DATACHECK_DISALLOWS_AUTOADJUST')).toBe(true);
    expect(diagCodes.has('DATACHECK_DISALLOWS_ROBUST')).toBe(true);
    expect(diagCodes.has('DATACHECK_SKIPS_AUTOSIDESHOT')).toBe(true);
    expect(diagCodes.has('DATACHECK_SKIPS_CLUSTER')).toBe(true);
    expect(result.logs.some((line) => line.includes('[DATACHECK_DISALLOWS_AUTOADJUST]'))).toBe(
      true,
    );
    expect(result.logs.some((line) => line.includes('[DATACHECK_DISALLOWS_ROBUST]'))).toBe(true);
  });

  it('keeps data-check on the approximate-geometry path instead of a full adjustment solve', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C U 50 40 0',
      'D A-U 64.031 0.003',
      'D B-U 64.031 0.003',
      'A U-A-B 97-00-00.0 1.0',
    ].join('\n');

    const result = new LSAEngine({
      input,
      maxIterations: 8,
      parseOptions: { runMode: 'data-check', coordMode: '2D' },
    }).solve();

    expect(result.success).toBe(true);
    expect(result.parseState?.runMode).toBe('data-check');
    expect(result.iterations).toBe(0);
    expect(result.dof).toBe(0);
    expect(result.seuw).toBe(0);
    expect(result.logs.some((line) => line.includes('no least-squares adjustment'))).toBe(true);
    expect(
      result.logs.some((line) => line.includes('Data Check provisional approximation: running bounded coordinate fit')),
    ).toBe(true);
    expect(
      result.observations.some(
        (obs) => obs.residual != null && Number.isFinite(Math.abs((obs.stdRes ?? 0) as number)),
      ),
    ).toBe(true);
  });

});
