/**
 * Phase 12G — production GNSS worker-route tests.
 *
 * Small jobs stay TypeScript; kill-switch OFF is byte-identical TS; a
 * qualifying synthetic network takes the eligible path through stub
 * solvers (or documents fallback reasons); native failure reruns clean TS.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../src/engine/gnssBaselineAdjust';
import { buildGnssSessionInput } from '../src/engine/gnssWorkspaceSession';
import { buildGnssSampleNetwork } from '../src/engine/gnssSampleNetwork';
import {
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../src/workers/gnssBaselineNativeR2BRoute';
import { generateAuditNetwork } from '../scripts/gnss/gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from '../scripts/gnss/gnssNativeArchitectureAudit';
import { countingBlockSolver, countingCorrectionSolver } from './helpers/sparseTestStubs';

afterEach(() => {
  setGnssNativeR2BRouteEnabled(true);
});

describe('gnss production worker route', () => {
  it('routes a small job to typescript with worker-context reasons', async () => {
    const input = buildGnssSessionInput(buildGnssSampleNetwork(), {});
    const attempt = await runGnssBaselineWithNativeR2B(input);
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.reasons.join('; ')).toMatch(/worker context|perf floor/);
  });

  it('kill-switch OFF is byte-identical to plain TypeScript', async () => {
    setGnssNativeR2BRouteEnabled(false);
    const input = buildGnssSessionInput(buildGnssSampleNetwork(), {});
    const attempt = await runGnssBaselineWithNativeR2B(input, { isWorker: true });
    const oracle = runGnssBaselineAdjustment(input);
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join('; ')).toMatch(/kill switch/);
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });

  it('qualifying synthetic takes the eligible path through stub solvers', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('ring', 76, 7));
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      isWorker: true,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    const oracle = runGnssBaselineAdjustment(input);
    expect(attempt.result.dof).toBe(oracle.dof);
    expect(attempt.result.statistics.length).toBe(oracle.statistics.length);
    if (attempt.route === 'typescript') {
      expect(attempt.reasons.length).toBeGreaterThan(0);
    } else {
      expect(attempt.route).toBe('native-sparse-selected-qxx');
      expect(attempt.result.routeProvenance).toBe('native-sparse-selected-qxx');
    }
  });

  it('native failure reruns clean TypeScript', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = buildGnssAdjustInput(generateAuditNetwork('ring', 76, 7));
    const throwingBlocks = {
      ...countingBlockSolver(),
      queryBlocks: (): never => {
        throw new Error('stub block failure');
      },
    };
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      isWorker: true,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: throwingBlocks,
    });
    const oracle = runGnssBaselineAdjustment(input);
    expect(attempt.route).toBe('typescript');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});
