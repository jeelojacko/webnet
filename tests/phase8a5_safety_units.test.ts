/**
 * Phase 8A.5 pure unit coverage (TEST/EVIDENCE ONLY, no worker, no WASM).
 *
 * Covers the deterministic corpus generators and the P0-P4 strategy
 * evaluators, including false admit/reject accounting and the covariance
 * physical-validity gate.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPhase8a5GeneratedCorpus,
  buildChainStarInput,
  buildGpsNetworkInput,
} from '../src/engine/phase8a5PreanalysisSafetyCorpus';
import {
  buildSentinelEvidence,
  evaluatePhase8a5Strategies,
  validateCovariancePhysical,
  PHASE8A5_CONDITION_THRESHOLD,
} from '../src/engine/phase8a5SafetyStrategies';
import type { AdjustmentResult } from '../src/typesAdjustmentResult';

const strategyArgs = (overrides: Record<string, unknown> = {}) => ({
  staticAdmit: true,
  staticReasons: [],
  conditionEstimate: 42,
  correctionOracles: [],
  physicalValid: true,
  physicalReasons: [],
  sentinel: buildSentinelEvidence({ available: false, comparison: null }),
  groundTruth: true,
  groundTruthNote: 'unit',
  ...overrides,
});

describe('phase 8A.5 generated corpus', () => {
  it('builds exactly 34 deterministic cases covering every family', () => {
    const first = buildPhase8a5GeneratedCorpus();
    const second = buildPhase8a5GeneratedCorpus();
    expect(first.length).toBe(34);
    expect(second).toEqual(first);
    const families = new Set(first.map((c) => c.family));
    for (const family of [
      'size-chain',
      'size-gps',
      'weight-sweep',
      'condition',
      'redundant',
      'rank-experimental',
      'exclusion',
    ] as const) {
      expect(families.has(family), `missing family ${family}`).toBe(true);
    }
    const ids = first.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the 8/16/32/48/64/96/128/256 size ladder with distinct inputs', () => {
    const corpus = buildPhase8a5GeneratedCorpus();
    const ladder = corpus.filter((c) => c.family === 'size-chain');
    expect(ladder.map((c) => c.id)).toEqual([
      'p-size-chain-008',
      'p-size-chain-016',
      'p-size-chain-032',
      'p-size-chain-048',
      'p-size-chain-064',
      'p-size-chain-096',
      'p-size-chain-128',
      'p-size-chain-256',
    ]);
    const inputs = new Set(ladder.map((c) => c.input));
    expect(inputs.size).toBe(ladder.length);
  });

  it('marks rank and exclusion cases with their expected kinds', () => {
    const corpus = buildPhase8a5GeneratedCorpus();
    const byId = Object.fromEntries(corpus.map((c) => [c.id, c]));
    expect(byId['p-rank-floating']?.expectedKind).toBe('experimental-rank');
    expect(byId['p-excl-3d']?.expectedKind).toBe('experimental-3d');
    expect(byId['p-excl-gps-cov']?.expectedKind).toBe('experimental-gps-covariance');
    expect(byId['p-excl-robust']?.expectedKind).toBe('ineligible-robust');
    expect(byId['p-excl-tscorr']?.expectedKind).toBe('ineligible-ts-correlation');
  });

  it('generates deterministic chain and gps inputs', () => {
    expect(buildChainStarInput(4)).toBe(buildChainStarInput(4));
    expect(buildGpsNetworkInput(4)).toBe(buildGpsNetworkInput(4));
    expect(buildChainStarInput(4)).not.toBe(buildChainStarInput(8));
  });
});

describe('phase 8A.5 safety strategies', () => {
  it('gates P1 on the condition threshold and counts a false reject', () => {
    const { strategies, falseRejects, falseAdmits } = evaluatePhase8a5Strategies(
      strategyArgs({ conditionEstimate: PHASE8A5_CONDITION_THRESHOLD * 1e3 }),
    );
    const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
    expect(byId.P0?.admit).toBe(true);
    expect(byId.P1?.admit).toBe(false);
    expect(byId.P1?.reasons.some((r) => r.includes('exceeds'))).toBe(true);
    expect(falseRejects).toContain('P1');
    expect(falseAdmits).toEqual([]);
  });

  it('fails P2 closed without correction evidence while P0 still admits', () => {
    const { strategies, falseRejects } = evaluatePhase8a5Strategies(strategyArgs());
    const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
    expect(byId.P0?.admit).toBe(true);
    expect(byId.P2?.admit).toBe(false);
    expect(byId.P2?.reasons.some((r) => r.includes('no correction systems'))).toBe(true);
    expect(falseRejects).toContain('P2');
  });

  it('admits P2 on clean oracle evidence and P3 on a clean sentinel', () => {
    const sentinel = buildSentinelEvidence({
      available: true,
      comparison: {
        maxCovarianceRelativeDiff: 1e-9,
        maxRelativeCovarianceRelativeDiff: 1e-9,
        maxRelativePrecisionRelativeDiff: 1e-9,
      },
    });
    expect(sentinel.sentinelPass).toBe(true);
    const { strategies, falseAdmits, falseRejects } = evaluatePhase8a5Strategies(
      strategyArgs({
        correctionOracles: [
          { available: true, maxCorrectionDiff: 1e-12, damping: 0, conditionEstimate: 10 },
        ],
        sentinel,
      }),
    );
    const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
    for (const id of ['P0', 'P1', 'P2', 'P3', 'P4'] as const) {
      expect(byId[id]?.admit, id).toBe(true);
    }
    expect(falseAdmits).toEqual([]);
    expect(falseRejects).toEqual([]);
  });

  it('counts a false admit when every gate passes but the contract failed', () => {
    const sentinel = buildSentinelEvidence({
      available: true,
      comparison: {
        maxCovarianceRelativeDiff: 1e-9,
        maxRelativeCovarianceRelativeDiff: 1e-9,
        maxRelativePrecisionRelativeDiff: 1e-9,
      },
    });
    const { falseAdmits } = evaluatePhase8a5Strategies(
      strategyArgs({
        correctionOracles: [
          { available: true, maxCorrectionDiff: 1e-12, damping: 0, conditionEstimate: 10 },
        ],
        sentinel,
        groundTruth: false,
      }),
    );
    expect(falseAdmits).toEqual(['P0', 'P1', 'P2', 'P3', 'P4']);
  });

  it('rejects a non-physical covariance block at P3 and P4 only', () => {
    const bad = {
      stationCovariances: [{ stationId: 'P', sigmaE: -0.001, sigmaN: 0.002 }],
      relativePrecision: [],
      relativeCovariances: [],
    } as unknown as AdjustmentResult;
    const checked = validateCovariancePhysical(bad);
    expect(checked.valid).toBe(false);
    const { strategies } = evaluatePhase8a5Strategies(
      strategyArgs({ physicalValid: checked.valid, physicalReasons: checked.reasons }),
    );
    const byId = Object.fromEntries(strategies.map((s) => [s.id, s]));
    expect(byId.P0?.admit).toBe(true);
    expect(byId.P1?.admit).toBe(true);
    expect(byId.P3?.admit).toBe(false);
    expect(byId.P4?.admit).toBe(false);
  });

  it('accepts a physical 2D covariance block without sigmaH', () => {
    const good = {
      stationCovariances: [{ stationId: 'P', sigmaE: 0.001, sigmaN: 0.002 }],
      relativePrecision: [{ from: 'A', to: 'P', sigmaN: 0.001, sigmaE: 0.001, sigmaDist: 0.001 }],
      relativeCovariances: [],
    } as unknown as AdjustmentResult;
    expect(validateCovariancePhysical(good).valid).toBe(true);
  });
});
