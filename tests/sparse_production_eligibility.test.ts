/**
 * Phase 7A fail-closed sparse production eligibility classifier tests.
 * Pure classifier only: no solver, worker, WASM, or routing involved.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateSparseProductionEligibility,
  type SparseProductionEligibilityInput,
} from '../src/engine/sparseProductionEligibility';

const eligibleBase: SparseProductionEligibilityInput = {
  dimension: '2d',
  unknownCount: 64,
  maxUnknownCount: 256,
  runMode: 'adjustment',
  robustWeighting: false,
  tsCorrelation: false,
  gpsCovarianceWeighting: false,
  wasmAvailable: true,
  workerAvailable: true,
  rankRisk: 'none',
};

describe('evaluateSparseProductionEligibility', () => {
  it('clears a small plain 2D adjustment network with no reasons', () => {
    expect(evaluateSparseProductionEligibility(eligibleBase)).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('clears a 2D network exactly at the size budget', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      unknownCount: 256,
    });
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it('rejects a large 2D network on the size guard', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      unknownCount: 1000,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      'size guard: 1000 unknowns exceed SPARSE_PRODUCTION_MAX_UNKNOWN_COUNT=256',
    ]);
  });

  it('rejects 3D networks pending 3D production clearance', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      dimension: '3d',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["dimension '3d' not cleared for sparse production"]);
  });

  it('rejects robust reweighting', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      robustWeighting: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['robust reweighting not cleared for sparse production']);
  });

  it('rejects TS correlation', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      tsCorrelation: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['TS correlation not cleared for sparse production']);
  });

  it('rejects GPS covariance weighting', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      gpsCovarianceWeighting: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['GPS covariance weighting not cleared for sparse production']);
  });

  it('rejects a missing WASM module', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      wasmAvailable: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['WASM sparse module unavailable']);
  });

  it('rejects an unavailable worker', () => {
    const result = evaluateSparseProductionEligibility({
      ...eligibleBase,
      workerAvailable: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['sparse worker unavailable']);
  });

  it.each(['preanalysis', 'data-check', 'blunder-detect'] as const)(
    'rejects unsupported runMode %s',
    (runMode) => {
      const result = evaluateSparseProductionEligibility({ ...eligibleBase, runMode });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual([
        `unsupported runMode '${runMode}': sparse production requires 'adjustment'`,
      ]);
    },
  );

  it.each(['suspect', 'deficient'] as const)('rejects rank risk %s', (rankRisk) => {
    const result = evaluateSparseProductionEligibility({ ...eligibleBase, rankRisk });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      `rank risk '${rankRisk}': datum/weak-geometry risk not cleared`,
    ]);
  });

  it('emits every reason in fixed order when all gates fail', () => {
    const result = evaluateSparseProductionEligibility({
      dimension: '3d',
      unknownCount: 500,
      maxUnknownCount: 256,
      runMode: 'preanalysis',
      robustWeighting: true,
      tsCorrelation: true,
      gpsCovarianceWeighting: true,
      wasmAvailable: false,
      workerAvailable: false,
      rankRisk: 'deficient',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "unsupported runMode 'preanalysis': sparse production requires 'adjustment'",
      'WASM sparse module unavailable',
      'sparse worker unavailable',
      'robust reweighting not cleared for sparse production',
      'TS correlation not cleared for sparse production',
      'GPS covariance weighting not cleared for sparse production',
      "dimension '3d' not cleared for sparse production",
      'size guard: 500 unknowns exceed SPARSE_PRODUCTION_MAX_UNKNOWN_COUNT=256',
      "rank risk 'deficient': datum/weak-geometry risk not cleared",
    ]);
    // Deterministic: re-evaluation is byte-identical.
    expect(evaluateSparseProductionEligibility({
      dimension: '3d',
      unknownCount: 500,
      maxUnknownCount: 256,
      runMode: 'preanalysis',
      robustWeighting: true,
      tsCorrelation: true,
      gpsCovarianceWeighting: true,
      wasmAvailable: false,
      workerAvailable: false,
      rankRisk: 'deficient',
    })).toEqual(result);
  });
});
