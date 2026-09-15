import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import { rankedSuspects } from '../src/engine/runSessionSuspectImpact';
import { appendTypeAndResidualSections } from '../src/engine/runResultsTextResidualSections';
import type { AdjustmentResult, Observation } from '../src/types';
import type { LocalTestPolicy } from '../src/engine/localTestPolicy';

/** Two fixed control points, one free point, plus a redundant outlier distance. */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

/** Minimal network with dof = 1 (tau degenerates there). */
const TINY_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.0 0.01',
  'D B-P 64.0 0.01',
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

/** Outlier network plus a single-direction set (zero-redundancy equation). */
const SPUR_INPUT = [
  ...OUTLIER_INPUT.split('\n'),
  'DB P',
  'DN A 321-48-05.0 1.0',
  'DE',
].join('\n');

/** Exact 3-4-5 / 6-8-10 geometry: a perfect fit (SEUW = 0) with dof = 2. */
const PERFECT_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 4 0 0 ! !',
  'C C 0 3 0 ! !',
  'C F 6 0 0 ! !',
  'C P 4 3 0',
  'C Q 6 8 0',
  'D A-P 5 0.01',
  'D B-P 3 0.01',
  'D C-P 4 0.01',
  'D A-Q 10 0.01',
  'D F-Q 8 0.01',
  'D B-P 3 0.01',
].join('\n');

const run = (input: string, localTestPolicy?: LocalTestPolicy, excludeIds?: number[]) =>
  solveEngine({
    input,
    maxIterations: 8,
    ...(excludeIds ? { excludeIds: new Set(excludeIds) } : {}),
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      ...(localTestPolicy ? { localTestPolicy } : {}),
    },
  });

describe('local test default legacy behavior', () => {
  it('keeps the historical 3.29 tau verdicts for testable equations', () => {
    const result = run(OUTLIER_INPUT);
    expect(result.localTestSummary).toMatchObject({
      mode: 'legacy-fixed',
      statisticFamily: 'tau',
      criticalValue: 3.29,
      testCount: 4,
      dof: 2,
      available: true,
      robustApproximation: false,
    });
    const byId = new Map(result.observations.map((o) => [o.id, o]));
    expect(byId.get(0)?.stdRes).toBeCloseTo(1.0539571481, 8);
    expect(byId.get(0)?.localTest).toMatchObject({
      critical: 3.29,
      pass: true,
      statisticFamily: 'tau',
      available: true,
    });
    expect(byId.get(0)?.localTest?.statistic).toBeCloseTo(-1.0539571481, 8);
    expect(byId.get(3)?.stdRes).toBeCloseTo(1.3436277507, 8);
    expect(byId.get(3)?.localTest?.pass).toBe(true);
    for (const obs of result.observations) {
      expect(obs.localTest?.pass).toBe(Math.abs(obs.stdRes ?? 0) <= 3.29);
    }
  });
});

describe('local test formal modes', () => {
  it('produces increasing criticals none < sidak < bonferroni on the same network', () => {
    const none = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'none' });
    const sidak = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'sidak' });
    const bono = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'bonferroni' });
    expect(none.localTestSummary?.criticalValue).toBeCloseTo(1.959964, 5);
    const sidakCrit = sidak.localTestSummary?.criticalValue ?? Number.NaN;
    const bonoCrit = bono.localTestSummary?.criticalValue ?? Number.NaN;
    expect(sidakCrit).toBeGreaterThan(none.localTestSummary?.criticalValue ?? 0);
    expect(bonoCrit).toBeGreaterThan(sidakCrit);
    expect(bonoCrit).toBeCloseTo(2.497705, 5);
    for (const result of [none, sidak, bono]) {
      expect(result.localTestSummary?.statisticFamily).toBe('w');
      expect(result.localTestSummary?.testCount).toBe(4);
    }
    // MDB keeps legacy scaling in every mode.
    const legacyMdb = run(OUTLIER_INPUT).observations[0]?.mdb;
    expect(none.observations[0]?.mdb).toBe(legacyMdb);
    expect(bono.observations[0]?.mdb).toBe(legacyMdb);
  });

  it('flips classification predictably when alpha changes', () => {
    const loose = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05 });
    const strict = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.001 });
    const looseObs3 = loose.observations.find((o) => o.id === 3)?.localTest;
    const strictObs3 = strict.observations.find((o) => o.id === 3)?.localTest;
    // |w| = 2.75 sits between the 0.05 (1.96) and 0.001 (3.29) criticals.
    expect(looseObs3?.statistic).toBeCloseTo(2.7455, 3);
    expect(looseObs3?.pass).toBe(false);
    expect(strictObs3?.pass).toBe(true);
  });

  it('marks pope-tau unavailable at tiny dof without failing the run', () => {
    const result = run(TINY_INPUT, { mode: 'pope-tau', alpha: 0.05 });
    expect(result.dof).toBe(1);
    expect(result.localTestSummary?.available).toBe(false);
    expect(result.localTestSummary?.unavailableReason).toBe('dof-too-small');
    for (const obs of result.observations) {
      if (obs.localTest) expect(obs.localTest.pass).toBeNull();
    }
    expect(result.converged).toBe(true);
  });

  it('reduces the test count when observations are excluded', () => {
    const full = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'bonferroni' });
    expect(full.localTestSummary?.testCount).toBe(4);
    const excluded = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'bonferroni' }, [0]);
    expect(excluded.localTestSummary?.testCount).toBe(3);
    expect(excluded.localTestSummary?.criticalValue).toBeLessThan(
      full.localTestSummary?.criticalValue ?? 0,
    );
  });
});

describe('legacy custom critical contract', () => {
  it('honors a persisted custom legacy-fixed critical for verdicts and summary while MDB stays fixed', () => {
    const def = run(OUTLIER_INPUT);
    expect(def.localTestSummary?.criticalValue).toBe(3.29);

    const custom = run(OUTLIER_INPUT, { mode: 'legacy-fixed', critical: 1 });
    expect(custom.localTestSummary).toMatchObject({
      mode: 'legacy-fixed',
      criticalValue: 1,
      legacyCritical: 1,
    });
    for (const obs of custom.observations) {
      expect(obs.localTest?.critical).toBe(1);
      expect(obs.localTest?.pass).toBe(Math.abs(obs.localTest?.statistic ?? 0) <= 1);
    }
    // The tightened threshold actually flags where the default does not.
    const customFails = custom.observations.filter((o) => o.localTest?.pass === false).length;
    const defFails = def.observations.filter((o) => o.localTest?.pass === false).length;
    expect(customFails).toBeGreaterThan(defFails);
    // MDB keeps the fixed legacy 3.29 detection scaling in every mode.
    expect(custom.observations[0]?.mdb).toBe(def.observations[0]?.mdb);
  });
});

describe('null local-test semantics in selectors and text', () => {
  it('marks null-verdict rows as not failed in suspect ranking', () => {
    const res = {
      observations: [
        {
          id: 1,
          type: 'dist',
          from: 'A',
          to: 'B',
          stdRes: 5.5,
          localTest: { critical: 3.29, pass: null },
          sourceLine: 10,
        },
        {
          id: 2,
          type: 'dist',
          from: 'B',
          to: 'C',
          stdRes: 1.2,
          localTest: { critical: 3.29, pass: false },
          sourceLine: 11,
        },
      ],
    } as AdjustmentResult;
    const rows = rankedSuspects(res);
    expect(rows.find((r) => r.obsId === 1)?.localFail).toBe(false);
    expect(rows.find((r) => r.obsId === 2)?.localFail).toBe(true);
  });

  it('renders family-aware Critical lines with the derived run value', () => {
    const formal = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05 });
    const formalLines: string[] = [];
    appendTypeAndResidualSections({
      lines: formalLines,
      res: formal,
      context: { linearUnit: 'm', unitScale: 1, isPreanalysis: false },
    });
    const formalCritical = formalLines.find((line) => line.startsWith('Critical'));
    expect(formalCritical).toContain('Critical |w| threshold:');
    expect(formalCritical).toContain((formal.localTestSummary?.criticalValue ?? 0).toFixed(2));
    expect(formalCritical).not.toContain('|t|');

    const legacy = run(OUTLIER_INPUT);
    const legacyLines: string[] = [];
    appendTypeAndResidualSections({
      lines: legacyLines,
      res: legacy,
      context: { linearUnit: 'm', unitScale: 1, isPreanalysis: false },
    });
    const legacyCritical = legacyLines.find((line) => line.startsWith('Critical'));
    expect(legacyCritical).toContain('Critical |τ| threshold: 3.29');
  });

  it('renders unavailable Pope critical as - (never NaN) at dof<=1', () => {
    const tiny = run(TINY_INPUT, { mode: 'pope-tau', alpha: 0.05 });
    expect(tiny.dof).toBe(1);
    expect(tiny.localTestSummary?.available).toBe(false);
    // NaN is never kept as an effective diagnostics threshold.
    expect(Number.isFinite(tiny.residualDiagnostics?.criticalT)).toBe(true);
    const lines: string[] = [];
    appendTypeAndResidualSections({
      lines,
      res: tiny,
      context: { linearUnit: 'm', unitScale: 1, isPreanalysis: false },
    });
    const critical = lines.find((line) => line.startsWith('Critical'));
    expect(critical).toContain('Critical |τ| threshold: -');
    expect(critical).not.toContain('NaN');
  });
});

describe('derived critical reporting', () => {
  it('exports the actually derived run critical and family-aware log wording', () => {
    const formal = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05 });
    // Exported Critical is the derived run critical, not the legacy constant.
    expect(formal.residualDiagnostics?.criticalT).toBe(
      formal.localTestSummary?.criticalValue,
    );
    expect(formal.residualDiagnostics?.criticalT).not.toBe(3.29);
    const localLog = formal.logs.find((line) => line.startsWith('Local test:'));
    expect(localLog).toContain('|w|>');
    expect(localLog).toContain(
      (formal.localTestSummary?.criticalValue ?? 0).toFixed(2),
    );
    expect(localLog).not.toContain('|t|>');

    const legacy = run(OUTLIER_INPUT, { mode: 'legacy-fixed', critical: 1 });
    expect(legacy.residualDiagnostics?.criticalT).toBe(1);
    const legacyLog = legacy.logs.find((line) => line.startsWith('Local test:'));
    expect(legacyLog).toContain('|τ|>1.00');
    expect(legacyLog).not.toContain('|t|>');
    // Legacy standardized-residual diagnostic counts keep their |t| wording.
    expect(legacy.logs.some((line) => line.includes('Residual diagnostics: |t|>2='))).toBe(true);
  });
});

describe('review regressions: testability and SEUW gating', () => {
  it('excludes a zero-redundancy spur equation from m with a null verdict', () => {
    const result = run(SPUR_INPUT);
    expect(result.dof).toBe(2);
    // The single direction carries no redundancy; only the 4 real equations count.
    expect(result.localTestSummary?.testCount).toBe(4);
    const dir = result.observations.find((o) => o.type === 'direction')?.localTest;
    expect(dir?.pass).toBeNull();
    expect(dir?.available).toBe(false);
    expect(Number.isFinite(dir?.statistic)).toBe(true);
    for (const obs of result.observations) {
      if (obs.type === 'direction') continue;
      expect(typeof obs.localTest?.pass).toBe('boolean');
      expect(obs.localTest?.available).toBe(true);
    }
    const formal = run(SPUR_INPUT, { mode: 'baarda-w', alpha: 0.05 });
    expect(formal.localTestSummary?.testCount).toBe(4);
    const formalDir = formal.observations.find((o) => o.type === 'direction')?.localTest;
    expect(formalDir?.pass).toBeNull();
    expect(formalDir?.statisticFamily).toBe('w');
  });

  it('gates pope-tau on SEUW=0 while legacy and baarda still judge', () => {
    const pope = run(PERFECT_INPUT, { mode: 'pope-tau', alpha: 0.05 });
    expect(pope.dof).toBe(2);
    expect(pope.seuw).toBe(0);
    expect(pope.localTestSummary?.available).toBe(false);
    expect(pope.localTestSummary?.unavailableReason).toBe('seuw-not-positive');
    for (const obs of pope.observations) {
      expect(obs.localTest?.pass).toBeNull();
    }
    expect(pope.converged).toBe(true);

    const legacy = run(PERFECT_INPUT);
    expect(legacy.localTestSummary?.available).toBe(true);
    expect(legacy.localTestSummary?.criticalValue).toBe(3.29);
    // Well-posed lines pass; the degenerate Q lines stay null, never fail.
    const legacyPasses = new Map(legacy.observations.map((o) => [o.id, o.localTest?.pass]));
    expect([0, 1, 2, 5].map((id) => legacyPasses.get(id))).toEqual([true, true, true, true]);
    expect([3, 4].map((id) => legacyPasses.get(id))).toEqual([null, null]);

    const baarda = run(PERFECT_INPUT, { mode: 'baarda-w', alpha: 0.05 });
    expect(baarda.localTestSummary?.available).toBe(true);
    for (const obs of baarda.observations) {
      expect(obs.localTest?.pass).toBe(obs.id === 3 || obs.id === 4 ? null : true);
    }
  });
});
