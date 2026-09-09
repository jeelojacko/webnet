/**
 * Phase 9E fast-path bounded contract (agent tier): eligibility-unit matrix
 * plus the degenerate null-recovery regression.
 *
 * The leveling-only 2D fixture has no observation equations, so covariance
 * recovery returns null and the legacy loop owns the failure contract. The
 * fast default must match the legacy failure exactly (no false success).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getPreanalysisCorrectionFastPathStats,
  isPreanalysisCorrectionFastPathEligible,
  resetPreanalysisCorrectionFastPathStats,
} from '../src/engine/preanalysisCorrectionFastPath';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const eligibleShape = {
  preanalysisMode: true,
  is2D: true,
  debug: false,
  robustMode: 'none',
  maxIterations: 10,
  numParams: 170,
  numObsEquations: 400,
  hasSparseCorrectionSolver: false,
  hasSparseRowProductsSolver: false,
  hasSparseSelectedCovarianceSolver: false,
  hasNormalEquationSolver: false,
};

describe('phase 9E fast-path eligibility and null-recovery contract', () => {
  it('fails closed on unsupported shapes, backends, and degenerate sizes', () => {
    expect(isPreanalysisCorrectionFastPathEligible(eligibleShape)).toBe(true);
    const cases: Array<[string, Partial<typeof eligibleShape>]> = [
      ['non-preanalysis', { preanalysisMode: false }],
      ['3D', { is2D: false }],
      ['debug', { debug: true }],
      ['huber robust', { robustMode: 'huber' }],
      ['other robust', { robustMode: 'danish' }],
      ['zero iterations', { maxIterations: 0 }],
      ['zero params', { numParams: 0 }],
      ['negative params', { numParams: -3 }],
      ['zero equations', { numObsEquations: 0 }],
      ['negative equations', { numObsEquations: -1 }],
      ['sparse correction', { hasSparseCorrectionSolver: true }],
      ['sparse row products', { hasSparseRowProductsSolver: true }],
      ['sparse selected covariance', { hasSparseSelectedCovarianceSolver: true }],
      ['experimental normal solver', { hasNormalEquationSolver: true }],
    ];
    for (const [name, override] of cases) {
      expect(isPreanalysisCorrectionFastPathEligible({ ...eligibleShape, ...override }), name).toBe(
        false,
      );
    }
  });

  it('matches the legacy failure on the degenerate leveling-only 2D fixture', () => {
    const input = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/legacy_leveling_only.dat'),
      'utf-8',
    );
    const makeRequest = () => {
      const base = createRunSessionRequest({ input });
      return createRunSessionRequest({
        input,
        parseSettings: {
          ...base.parseSettings,
          runMode: 'preanalysis',
          preanalysisMode: true,
          coordMode: '2D',
        },
      });
    };
    const strip = (result: AdjustmentResult): unknown => {
      const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
      delete clone.solveTimingProfile;
      if (Array.isArray(clone.logs)) {
        clone.logs = (clone.logs as string[]).filter(
          (line) => !line.startsWith('Solve timing (ms):'),
        );
      }
      return clone;
    };
    resetPreanalysisCorrectionFastPathStats();
    const fast = runAdjustmentSession(makeRequest()).result;
    const fastStats = getPreanalysisCorrectionFastPathStats();
    resetPreanalysisCorrectionFastPathStats();
    const legacy = runAdjustmentSession(makeRequest(), undefined, {
      preanalysisCorrectionFastPath: false,
    }).result;
    const legacyStats = getPreanalysisCorrectionFastPathStats();

    // No false success: both own the same legacy failure contract.
    expect(fast.success).toBe(false);
    expect(legacy.success).toBe(false);
    expect(strip(fast)).toEqual(strip(legacy));
    expect(fastStats.evaluations).toBeGreaterThan(0);
    expect(fastStats.fastSolves).toBe(0);
    expect(fastStats.legacyFallbacks).toBe(fastStats.evaluations);
    expect(legacyStats.fastSolves).toBe(0);
  }, 60000);
});
