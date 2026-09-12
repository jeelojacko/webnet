/**
 * Phase 10P diagnostic-only S3 cost split (test-only, no routing).
 *
 * STUDY ONLY — never imported by production code. Replays the S3
 * every-iteration oracle math with wall-clock probes on each phase so the
 * study can attribute S3 cost without changing oracle decisions:
 *
 * - copy/materialize: packed input deep copy (as the capture solver does)
 * - dense-P build: packed upper triangle → dense P
 * - normal accumulation: production `accumulateNormalEquationsFromSparseRows`
 * - dense factorize: scale + damped Cholesky (production helpers, timed)
 * - dense solve: triangular solve + unscale (production helpers, timed)
 * - compare: per-param finite diff + max diff (S3 §exact loop)
 * - condition: TS-packed `estimateSparseNormalCondition` (timed alone)
 * - aggregation: max-tracking + reason assembly
 *
 * Bit-identity contract: the dense correction produced here must equal the
 * production `solvePhase7b7DenseSystem` output bit-for-bit on every
 * studied system (pinned by the 10P derivation test), so the split
 * measures the SAME decisions S3 makes.
 *
 * S3 purpose split (§1), mapped from `verifySparseAutoRouteSystems`:
 * - A provenance/coverage: truncation + zero/count-mismatch gates
 * - B finite: throw/missing + per-param finite diff
 * - C correction-value: max diff vs tolerance (1e-9)
 * - D normal-consistency: the dense rebuild itself (unpack + P + N + solve)
 * - E conditioning: finite condition + threshold-excess warn-only + agreement
 * - F damping/SPD: damping finite && === 0
 */
import { performance } from 'node:perf_hooks';

import {
  matrixIsFinite,
  scaleNormalMatrix,
  scaleNormalRhs,
  unscaleNormalSolution,
} from './adjustNormalMatrixHelpers';
import { accumulateNormalEquationsFromSparseRows } from './matrixSparse';
import { choleskyDecomposeWithDamping, solveSPDFromCholesky } from './matrixCholesky';
import {
  solvePhase7b7DenseSystem,
  unpackPhase7b7DenseWeights,
  unpackPhase7b7DesignRows,
  type Phase7b7CapturedSystem,
} from './phase7b7DenseRebuild';
import { estimateSparseNormalCondition } from './sparseNormalCondition';

export interface Phase10pS3PhaseMs {
  copyMs: number;
  densePBuildMs: number;
  accumulateMs: number;
  factorizeMs: number;
  solveMs: number;
  compareMs: number;
  conditionMs: number;
  aggregateMs: number;
  totalMs: number;
  /** 100·(sum of phases)/totalMs — must stay ≥ 95 (attribution contract). */
  attributionPct: number;
}

export interface Phase10pS3Split {
  phases: Phase10pS3PhaseMs;
  denseCorrection: number[];
  maxCorrectionDiff: number;
  damping: number;
  conditionEstimate: number | undefined;
  /** Bit-identity vs the production oracle rebuild (required true). */
  bitIdenticalOracle: boolean;
}

const copySystem = (system: Phase7b7CapturedSystem): Phase7b7CapturedSystem => ({
  design: {
    rowOffsets: Int32Array.from(system.design.rowOffsets),
    columns: Int32Array.from(system.design.columns),
    values: Float64Array.from(system.design.values),
  },
  weights: {
    rows: Int32Array.from(system.weights.rows),
    columns: Int32Array.from(system.weights.columns),
    values: Float64Array.from(system.weights.values),
  },
  misclosures: Float64Array.from(system.misclosures),
  observationEquationCount: system.observationEquationCount,
  parameterCount: system.parameterCount,
});

/**
 * Times every S3 phase over one captured system + sparse correction.
 * `sparseCorrection` is the flat native correction (length = params).
 */
export const measureS3CostSplit = (
  system: Phase7b7CapturedSystem,
  sparseCorrection: ArrayLike<number>,
): Phase10pS3Split => {
  const totalStart = performance.now();
  let t = performance.now();
  const copied = copySystem(system);
  const copyMs = performance.now() - t;

  t = performance.now();
  const rows = unpackPhase7b7DesignRows(copied.design);
  const denseP = unpackPhase7b7DenseWeights(copied.weights, copied.observationEquationCount);
  const densePBuildMs = performance.now() - t;

  t = performance.now();
  const residuals = Array.from(copied.misclosures, (value) => [value]);
  const { normal, rhs } = accumulateNormalEquationsFromSparseRows(
    rows,
    residuals,
    denseP,
    copied.parameterCount,
  );
  const accumulateMs = performance.now() - t;

  t = performance.now();
  const scaled = scaleNormalMatrix(normal);
  const scaledU = scaleNormalRhs(rhs, scaled.scale);
  const factorization = choleskyDecomposeWithDamping(scaled.scaled);
  const damping = factorization.damping;
  const factorizeMs = performance.now() - t;

  t = performance.now();
  const scaledCorrection = solveSPDFromCholesky(factorization.factor, scaledU);
  if (!matrixIsFinite(scaledCorrection)) throw new Error('S3 split: non-finite scaled correction.');
  const correction2d = unscaleNormalSolution(scaledCorrection, scaled.scale);
  const denseCorrection = correction2d.map((row) => row[0] ?? Number.NaN);
  const solveMs = performance.now() - t;

  t = performance.now();
  let worst = 0;
  let nonfinite = false;
  for (let param = 0; param < copied.parameterCount; param += 1) {
    const diff = Math.abs((denseCorrection[param] ?? Number.NaN) - (sparseCorrection[param] ?? Number.NaN));
    if (!Number.isFinite(diff)) { nonfinite = true; break; }
    worst = Math.max(worst, diff);
  }
  const maxCorrectionDiff = nonfinite ? Number.POSITIVE_INFINITY : worst;
  const compareMs = performance.now() - t;

  t = performance.now();
  let conditionEstimate: number | undefined;
  try {
    const packed = estimateSparseNormalCondition(
      copied.design,
      copied.weights,
      copied.parameterCount,
    );
    if (Number.isFinite(packed)) conditionEstimate = packed;
  } catch {
    conditionEstimate = undefined;
  }
  const conditionMs = performance.now() - t;

  t = performance.now();
  const oracle = solvePhase7b7DenseSystem(copied);
  let bitIdenticalOracle = oracle.length === denseCorrection.length;
  if (bitIdenticalOracle) {
    for (let i = 0; i < oracle.length; i += 1) {
      if (oracle[i] !== denseCorrection[i]) { bitIdenticalOracle = false; break; }
    }
  }
  const aggregateMs = performance.now() - t;
  const totalMs = performance.now() - totalStart;
  const accounted = copyMs + densePBuildMs + accumulateMs + factorizeMs + solveMs + compareMs + conditionMs + aggregateMs;
  return {
    phases: {
      copyMs, densePBuildMs, accumulateMs, factorizeMs, solveMs,
      compareMs, conditionMs, aggregateMs, totalMs,
      attributionPct: totalMs > 0 ? (100 * accounted) / totalMs : 100,
    },
    denseCorrection,
    maxCorrectionDiff,
    damping,
    conditionEstimate,
    bitIdenticalOracle,
  };
};
