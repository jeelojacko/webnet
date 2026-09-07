/**
 * Phase 8A focused helper tests (TEST/EVIDENCE ONLY).
 *
 * Pure, fast unit coverage for the evidence helpers in
 * `src/engine/preanalysisSparseEvidence.ts`: the >128 unknown cap, the
 * parse-failure path, truncated-capture fail-closure, the S2
 * single-reason gate, and full `relativeCovariances` value comparison.
 * No worker, no WASM, no production imports.
 */
import { describe, expect, it } from 'vitest';

import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import {
  classifyPreanalysisSparseEvidence,
  comparePreanalysisContract,
  evaluatePreanalysisStrategies,
  PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT,
} from '../src/engine/preanalysisSparseEvidence';

const evidenceOpts = { coordMode: '2D' as const, robustMode: 'none', tsCorrelationEnabled: false };

const buildManyStationInput = (freeCount: number): string => {
  const lines = ['.2D', 'C FIX1 0 0 0 ! ! !', 'C FIX2 100 0 0 ! ! !'];
  for (let i = 0; i < freeCount; i += 1) {
    lines.push(`C U${i} ${10 + i} ${20 + i} 0`);
  }
  return lines.join('\n');
};

const baseResult = (): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    stations: {},
    observations: [],
    logs: [],
    seuw: 1,
    dof: 2,
    condition: { estimate: 1.5, threshold: 1e6, flagged: false },
    preanalysisMode: true,
    preanalysisImpactDiagnostics: {},
  }) as unknown as AdjustmentResult;

describe('phase 8A evidence helpers', () => {
  it('rejects corpora above the unknown-count cap', () => {
    const input = buildManyStationInput(PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT + 2);
    const result = classifyPreanalysisSparseEvidence(input, evidenceOpts);
    expect(result.eligible).toBe(false);
    expect(result.kind).toBe('eligible-2d');
    expect(result.unknownCount).toBeGreaterThan(PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT);
    expect(result.reasons.some((r) => r.includes('exceeds evidence cap'))).toBe(true);
  });

  it('records eligibility parse failures fail-closed', () => {
    const result = classifyPreanalysisSparseEvidence(null as unknown as string, evidenceOpts);
    expect(result.eligible).toBe(false);
    expect(result.unknownCount).toBeNull();
    expect(result.reasons.some((r) => r.startsWith('eligibility parse failed'))).toBe(true);
  });

  it('fails S3 closed on truncated capture while S2 still passes', () => {
    const oracle = { maxCorrectionDiff: 0, damping: 0, conditionEstimate: 1.5 };
    const strategies = evaluatePreanalysisStrategies({
      contractPass: true,
      contractReasons: [],
      solveCount: 2,
      capturedSystemCount: 2,
      truncated: true,
      oracles: [oracle, oracle],
    });
    const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
    expect(byId.S2?.pass).toBe(true);
    expect(byId.S3?.pass).toBe(false);
    expect(byId.S3?.reasons.some((r) => r.includes('capture truncated'))).toBe(true);
  });

  it('reports a single fail-closed reason for a missing second system', () => {
    const strategies = evaluatePreanalysisStrategies({
      contractPass: true,
      contractReasons: [],
      solveCount: 0,
      capturedSystemCount: 0,
      truncated: false,
      oracles: [],
    });
    const s2 = strategies.find((s) => s.id === 'S2');
    expect(s2?.pass).toBe(false);
    expect(s2?.reasons.filter((r) => r.startsWith('system 2:'))).toHaveLength(1);
    expect(s2?.reasons.some((r) => r.includes('fewer than two'))).toBe(false);
  });

  it('compares relativeCovariances values, not just pair order', () => {
    const pair = {
      from: 'A',
      to: 'P',
      connected: true,
      connectionTypes: ['dist'],
      cEE: 1e-6,
      cEN: 2e-7,
      cNN: 3e-6,
      sigmaE: 0.001,
      sigmaN: 0.002,
    };
    const ref = { ...baseResult(), relativeCovariances: [pair] };
    const same = {
      ...baseResult(),
      relativeCovariances: [{ ...pair, connectionTypes: [...pair.connectionTypes] }],
    };
    const matching = comparePreanalysisContract(ref, same);
    expect(matching.pass).toBe(true);
    expect(matching.maxRelativeCovarianceDiff).toBe(0);

    const drifted = {
      ...baseResult(),
      relativeCovariances: [{ ...pair, cEE: pair.cEE + 0.01 }],
    };
    const compared = comparePreanalysisContract(ref, drifted);
    expect(compared.pass).toBe(false);
    expect(compared.reasons.some((r) => r.includes('relativeCovariances[A-P].cEE'))).toBe(true);
    expect(compared.maxRelativeCovarianceDiff).toBeGreaterThan(0);
    expect(compared.maxRelativeCovarianceRelativeDiff).toBeGreaterThan(0);
  });
});
