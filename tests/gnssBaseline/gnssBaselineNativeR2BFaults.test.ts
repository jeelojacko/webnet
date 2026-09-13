/**
 * Phase 12F.3 agent-tier contract, part 2: R2B fallback + fault injection.
 *
 * Every fault below must rerun the identical input through clean
 * TypeScript, returning route 'typescript' with 'typescript-dense'
 * provenance and a whole-structure bit-identical result. No WASM, no
 * campaigns; stub solvers only. Route contract (eligibility, parity,
 * tripwires, isolation) lives in part 1 (gnssBaselineNativeR2B.test.ts).
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type {
  SparseCorrectionSolveInput,
  SparseSelectedBlockInput,
  SparseSelectedBlockResult,
} from '../../src/engine/numericalBackend';
import {
  FillGateError,
  GNSS_NATIVE_R2B_MAX_FACTOR_NNZ,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import { setGnssNativeR1RouteEnabled } from '../../src/workers/gnssBaselineNativeR1Route';
import { generateAuditNetwork } from '../../scripts/gnss/gnssNativeAuditCorpus';
import { buildGnssAdjustInput } from '../../scripts/gnss/gnssNativeArchitectureAudit';
import {
  correctionWithFill,
  countingBlockSolver,
  countingCorrectionSolver,
  type CountingBlockSolver,
} from '../helpers/sparseTestStubs';

beforeEach(() => {
  setGnssNativeR2BRouteEnabled(false);
  setGnssNativeR1RouteEnabled(false);
});

const workerOn = { isWorker: true as const };
const smallBounds = { minParams: 1 };
const ring8 = () => buildGnssAdjustInput(generateAuditNetwork('ring', 8, 7));

const withBlocks = (
  mutate: (_blocks: Float64Array, _input: SparseSelectedBlockInput) => void,
): CountingBlockSolver => {
  const base = countingBlockSolver();
  return {
    ...base,
    queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
      const result = base.queryBlocks(input);
      mutate(result.blocks, input);
      return result;
    },
  };
};

const withStarts = (
  mutate: (_starts: Int32Array, _input: SparseSelectedBlockInput) => void,
): CountingBlockSolver => {
  const base = countingBlockSolver();
  return {
    ...base,
    queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
      const starts = Int32Array.from(input.blockRowStarts);
      mutate(starts, input);
      return base.queryBlocks({ ...input, blockRowStarts: starts });
    },
  };
};

const withMeta = (meta: Partial<SparseSelectedBlockResult>): CountingBlockSolver => {
  const base = countingBlockSolver();
  return {
    ...base,
    queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => ({
      ...base.queryBlocks(input),
      ...meta,
    }),
  };
};

describe('fill gate + fallback contract', () => {
  const expectCleanFallback = async (
    overrides: Parameters<typeof runGnssBaselineWithNativeR2B>[1],
  ): Promise<void> => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ring8();
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      ...smallBounds,
      ...overrides,
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  };

  it('fill gate: below/exact pass, above falls back', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ring8();
    for (const maxFactorNnz of [101, 100]) {
      const attempt = await runGnssBaselineWithNativeR2B(input, {
        ...workerOn,
        ...smallBounds,
        maxFactorNnz,
        correctionSolverOverride: correctionWithFill(100),
        blockSolverOverride: countingBlockSolver(),
      });
      expect(attempt.route).toBe('native-sparse-selected-qxx');
    }
    const oracle = runGnssBaselineAdjustment(input);
    const tripped = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      ...smallBounds,
      maxFactorNnz: 99,
      correctionSolverOverride: correctionWithFill(100),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(tripped.route).toBe('typescript');
    expect(tripped.result.routeProvenance).toBe('typescript-dense');
    expect(JSON.stringify(tripped.result)).toBe(JSON.stringify(oracle));
  });

  it('correction throw => clean-TS restart, bit-identical', async () => {
    const throwing = countingCorrectionSolver();
    throwing.solveFromEquations = (): never => {
      throw new Error('injected correction failure');
    };
    await expectCleanFallback({
      correctionSolverOverride: throwing,
      blockSolverOverride: countingBlockSolver(),
    });
  });

  it('NaN correction => clean-TS restart, bit-identical', async () => {
    const base = countingCorrectionSolver();
    const nanCorrection = {
      ...base,
      solveFromEquations: (input: SparseCorrectionSolveInput) => {
        const good = base.solveFromEquations(input);
        return { ...good, correction: good.correction.map((row) => row.map(() => Number.NaN)) };
      },
    };
    await expectCleanFallback({
      correctionSolverOverride: nanCorrection,
      blockSolverOverride: countingBlockSolver(),
    });
  });

  it('wrong block length => clean-TS restart, bit-identical', async () => {
    const base = countingBlockSolver();
    const long = {
      ...base,
      queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
        const result = base.queryBlocks(input);
        const grown = new Float64Array(result.blocks.length + 9);
        grown.set(result.blocks);
        return { ...result, blocks: grown };
      },
    };
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: long,
    });
  });

  it('missing block => clean-TS restart, bit-identical', async () => {
    const base = countingBlockSolver();
    const short = {
      ...base,
      queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
        const result = base.queryBlocks(input);
        return { ...result, blocks: result.blocks.slice(0, result.blocks.length - 9) };
      },
    };
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: short,
    });
  });

  it('reordered blocks => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withBlocks((blocks, input) => {
        const stride = 9;
        const pairCount = input.blockRowStarts.length;
        const copy = Float64Array.from(blocks);
        for (let slot = 0; slot < pairCount; slot += 1) {
          const from = (pairCount - 1 - slot) * stride;
          blocks.set(copy.subarray(from, from + stride), slot * stride);
        }
      }),
    });
  });

  it('NaN block value => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withBlocks((blocks) => {
        blocks[0] = Number.NaN;
      }),
    });
  });

  it('Infinity block value => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withBlocks((blocks) => {
        blocks[4] = Number.POSITIVE_INFINITY;
      }),
    });
  });

  it('negative variance => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withBlocks((blocks) => {
        blocks[0] = -Math.abs(blocks[0] ?? 1);
      }),
    });
  });

  it('asymmetric diagonal => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withBlocks((blocks) => {
        blocks[1] = (blocks[1] ?? 0) + 1e-3;
      }),
    });
  });

  it('corrupted off-diagonal => clean-TS restart, bit-identical', async () => {
    const base = countingBlockSolver();
    const corrupted = {
      ...base,
      queryBlocks: (input: SparseSelectedBlockInput): SparseSelectedBlockResult => {
        const result = base.queryBlocks(input);
        const blocks = Float64Array.from(result.blocks);
        const firstOff = input.blockRowStarts.findIndex(
          (_, slot) => input.blockRowStarts[slot] !== input.blockColStarts[slot],
        );
        if (firstOff >= 0) blocks[firstOff * 9] = (blocks[firstOff * 9] ?? 0) + 1;
        return { ...result, blocks };
      },
    };
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: corrupted,
    });
  });

  it('corrupted request metadata => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      // First and last request slots query different stations, so swapping
      // their row starts answers every slot with the wrong block.
      blockSolverOverride: withStarts((starts) => {
        const first = starts[0] ?? 0;
        const last = starts[starts.length - 1] ?? first;
        starts[0] = last;
        starts[starts.length - 1] = first;
      }),
    });
  });

  it('impossible station index => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withStarts((starts, input) => {
        starts[0] = input.parameterCount + 5;
      }),
    });
  });

  it('damped blocks meta => clean-TS restart, bit-identical', async () => {
    await expectCleanFallback({
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: withMeta({ dampingAttempts: 1, damping: 0.5 }),
    });
  });

  it('fill-gate trip (FillGateError) => clean-TS restart, bit-identical', async () => {
    expect(FillGateError).toBeDefined();
    await expectCleanFallback({
      correctionSolverOverride: correctionWithFill(GNSS_NATIVE_R2B_MAX_FACTOR_NNZ + 1),
      blockSolverOverride: countingBlockSolver(),
    });
  });

  it('both-endpoints-fixed baseline => clean-TS downgrade, bit-identical', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ring8();
    const first = [...input.baselines].sort((a, b) => a.id - b.id)[0]!;
    const stations = Object.fromEntries(
      Object.entries(input.stations).map(([id, station]) =>
        id === first.from || id === first.to
          ? [id, { ...station, fixed: true, fixedX: true, fixedY: true, fixedH: true }]
          : [id, station],
      ),
    );
    const fixedInput = { ...input, stations };
    const oracle = runGnssBaselineAdjustment(fixedInput);
    const attempt = await runGnssBaselineWithNativeR2B(fixedInput, {
      ...workerOn,
      ...smallBounds,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });

  it('WASM bundle init failure => clean-TS restart, bit-identical', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const input = ring8();
    const oracle = runGnssBaselineAdjustment(input);
    const attempt = await runGnssBaselineWithNativeR2B(input, {
      ...workerOn,
      ...smallBounds,
      loadBundle: () => Promise.reject(new Error('injected WASM missing')),
    });
    expect(attempt.route).toBe('typescript');
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(JSON.stringify(attempt.result)).toBe(JSON.stringify(oracle));
  });
});
