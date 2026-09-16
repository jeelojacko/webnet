import { describe, expect, it } from 'vitest';

import { createRunResultsTextBuilder } from '../src/engine/runResultsTextBuilder';
import {
  baseInput,
  baseRunDiagnostics,
  LSAEngine,
  renderReport,
} from './reportAdjustmentLayout/reportAdjustmentLayoutTestSupport';

/**
 * Phase 14F §§6,20,21,25: logical QC hierarchy.
 * Browser Band A and the text report must both flow
 * Adjustment Summary -> Local -> Reliability -> Stochastic -> LOO -> Systematic,
 * with coordinates/observation tables after the QC chain.
 */
describe('QC report section order', () => {
  it('orders browser Band A as summary -> local -> reliability -> stochastic -> LOO -> systematic', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: result.observations[0]?.id ?? 1,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        baseStdRes: 2.4,
        status: 'ok',
      },
    ] as any;

    const html = renderReport(result);
    const idx = (label: string) => {
      const at = html.indexOf(label);
      expect(at, `missing browser section: ${label}`).toBeGreaterThan(-1);
      return at;
    };
    const summary = idx('Adjustment Summary');
    const local = idx('Local testing');
    const reliability = idx('Reliability');
    const stochastic = idx('Stochastic model diagnostics');
    const loo = idx('LEAVE-ONE-OUT INFLUENCE');
    const systematic = idx('SYSTEMATIC PATTERN DIAGNOSTICS');
    expect(summary).toBeLessThan(local);
    expect(local).toBeLessThan(reliability);
    expect(reliability).toBeLessThan(stochastic);
    expect(stochastic).toBeLessThan(loo);
    expect(loo).toBeLessThan(systematic);
  });

  it('orders text QC headers as residual -> reliability -> stochastic -> LOO -> systematic -> observations', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: result.observations[0]?.id ?? 1,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        baseStdRes: 2.4,
        status: 'ok',
      },
    ] as any;

    const { buildResultsText } = createRunResultsTextBuilder({
      settings: { units: 'm', listingShowLostStations: true } as any,
      parseSettings: { descriptionReconcileMode: 'first', descriptionAppendDelimiter: ' | ' } as any,
      runDiagnostics: {
        ...baseRunDiagnostics,
        autoSideshotEnabled: false,
        autoAdjustEnabled: false,
        autoAdjustStdResThreshold: 4,
        autoAdjustMaxCycles: 3,
        autoAdjustMaxRemovalsPerCycle: 1,
        gpsLoopCheckEnabled: false,
        levelLoopToleranceBaseMm: 0,
        levelLoopTolerancePerSqrtKmMm: 4,
        gpsAddHiHtEnabled: false,
        gpsAddHiHtHiM: 0,
        gpsAddHiHtHtM: 0,
        prismEnabled: false,
        prismOffset: 0,
        prismScope: 'global',
        descriptionReconcileMode: 'first',
        descriptionAppendDelimiter: ' | ',
        suspectImpactMode: 'auto',
        averageGeoidHeight: 0,
        coordSystemDiagnostics: [],
        coordSystemWarningMessages: [],
        geoidSourceFormat: 'builtin',
        geoidSourceResolvedFormat: 'builtin',
        geoidSourceFallbackUsed: false,
        parseCompatibilityMode: 'strict',
        ambiguousCount: 0,
        legacyFallbackCount: 0,
        strictRejectCount: 0,
        rewriteSuggestionCount: 0,
        parseModeMigrated: true,
        parity: false,
      } as any,
      levelLoopCustomPresets: [],
      buildRunDiagnostics: (() => {
        throw new Error('not used when runDiagnostics is provided');
      }) as any,
    });
    const text = buildResultsText(result as any);
    const idx = (label: string) => {
      const at = text.indexOf(label);
      expect(at, `missing text section: ${label}`).toBeGreaterThan(-1);
      return at;
    };
    const residual = idx('--- Residual Diagnostics ---');
    const reliability = idx('--- Reliability (MDB / External) ---');
    const stochastic = idx('--- Stochastic Model Diagnostics ---');
    const loo = idx('--- Leave-One-Out Influence / What-if Exclusion ---');
    const systematic = idx('--- Systematic Pattern Diagnostics ---');
    const observations = idx('--- Observations & Residuals ---');
    expect(residual).toBeLessThan(reliability);
    expect(reliability).toBeLessThan(stochastic);
    expect(stochastic).toBeLessThan(loo);
    expect(loo).toBeLessThan(systematic);
    expect(systematic).toBeLessThan(observations);
  });
});
