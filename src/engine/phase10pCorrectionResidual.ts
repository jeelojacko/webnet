/**
 * Phase 10P matrix-free correction-residual candidate (test-only, no routing).
 *
 * STUDY ONLY — never imported by production code. Evaluates whether a
 * cheap normal-residual check `r = N·dx − u` can substitute for any part of
 * the S3 dense-rebuild oracle without weakening acceptance. S3 stays
 * authoritative throughout; this module only *records* a candidate verdict
 * next to it (shadow mode).
 *
 * Math (sign-proven against `matrixSparse.ts` + `adjustmentIteration.ts`):
 * - Production accumulates `N[a,b] += A[a]·Pii·A[b]` on the diagonal and
 *   BOTH orientations `A_i·w·A_j + A_j·w·A_i` on off-diagonals, with
 *   `rhs[a] += A[a]·P·L` for both `(i,j)` residual pairings.
 * - Matrix-free equivalent: `t = A·dx`, `z = P·t`, `lhs = Aᵀ·z`,
 *   `y = P·w`, `u = Aᵀ·y`, `r = lhs − u`, where every `P·v` applies the
 *   packed upper-triangle entries EXACTLY once per orientation:
 *   diag `(r,r,v): z[r] += v·t[r]`; off-diag `(r,c,v): z[r] += v·t[c]`
 *   AND `z[c] += v·t[r]`. A derivation test in the 10P evidence suite
 *   pins `lhs`/`u` against dense-oracle `N`/`u` elementwise.
 * - Residual alone CANNOT see damping or conditioning: a damped solve of a
 *   nearby system also has a small residual. Any strategy that drops the
 *   damping/metadata or condition checks is expected to false-accept —
 *   the scorecard must show it (see S1).
 *
 * Weight-shape contract: operates directly on packed upper-triangle
 * entries, so every structured shape the 10N path can emit is supported
 * exactly. Anything unrecognized throws fail-closed (legacy S3 decides).
 */
import { performance } from 'node:perf_hooks';

import type { Phase7b7CapturedSystem } from './phase7b7DenseRebuild';
import { SPARSE_CONDITION_THRESHOLD } from './sparseNormalCondition';

export interface Phase10pResidualMetrics {
  residualNorm: number;
  rhsNorm: number;
  dxNorm: number;
  /** ||r|| / max(1, ||u||): scale-free acceptance signal. */
  relativeResidual: number;
  maxAbsResidual: number;
  equationCount: number;
  parameterCount: number;
}

export interface Phase10pResidualTiming {
  /** t = A·dx plus y = P·w (packed apply, no dense P). */
  forwardMs: number;
  /** lhs = Aᵀ·z plus u = Aᵀ·y plus r = lhs − u. */
  transposeMs: number;
  totalMs: number;
}

export interface Phase10pResidualResult {
  residual: number[];
  metrics: Phase10pResidualMetrics;
  timing: Phase10pResidualTiming;
}

const norm2 = (values: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
};

/**
 * Applies symmetric packed upper-triangle weights to a vector: out = P·v.
 * Exact weight semantics — diag once, off-diag in both orientations.
 * Throws fail-closed on shape mismatch.
 */
export const applyPackedWeights = (
  system: Phase10pSystemShape,
  vector: ArrayLike<number>,
  out: number[],
): void => {
  const m = system.observationEquationCount;
  if (vector.length !== m || out.length !== m) {
    throw new Error(
      `Packed weight apply needs length ${m} (got ${vector.length}/${out.length}).`,
    );
  }
  out.fill(0);
  const { rows, columns, values } = system.weights;
  if (rows.length !== columns.length || rows.length !== values.length) {
    throw new Error('Packed weight input has inconsistent rows, columns, and values.');
  }
  for (let k = 0; k < values.length; k += 1) {
    const row = rows[k] ?? -1;
    const column = columns[k] ?? -1;
    const value = values[k] ?? Number.NaN;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= m || column >= m) {
      throw new Error(`Packed weight entry ${k} out of range (fail-closed).`);
    }
    if (!Number.isFinite(value)) throw new Error(`Packed weight entry ${k} non-finite (fail-closed).`);
    if (row === column) {
      out[row] += value * (vector[row] ?? 0);
    } else {
      out[row] += value * (vector[column] ?? 0);
      out[column] += value * (vector[row] ?? 0);
    }
  }
};

export interface Phase10pSystemShape {
  design: { rowOffsets: ArrayLike<number>; columns: ArrayLike<number>; values: ArrayLike<number> };
  weights: { rows: ArrayLike<number>; columns: ArrayLike<number>; values: ArrayLike<number> };
  misclosures: ArrayLike<number>;
  observationEquationCount: number;
  parameterCount: number;
}

const asShape = (system: Phase7b7CapturedSystem): Phase10pSystemShape => system;

/** t = A·dx directly from packed CSR design rows (no dense A). */
export const multiplyPackedDesign = (
  system: Phase10pSystemShape,
  dx: ArrayLike<number>,
  out: number[],
): void => {
  const m = system.observationEquationCount;
  const n = system.parameterCount;
  if (dx.length !== n || out.length !== m) {
    throw new Error(`Design multiply needs dx ${n} / out ${m} (got ${dx.length}/${out.length}).`);
  }
  const { rowOffsets, columns, values } = system.design;
  if (rowOffsets.length !== m + 1) throw new Error('Design row offsets fail-closed.');
  for (let row = 0; row < m; row += 1) {
    const start = rowOffsets[row] ?? -1;
    const end = rowOffsets[row + 1] ?? -1;
    if (start < 0 || end < start) throw new Error(`Design row ${row} offsets fail-closed.`);
    let sum = 0;
    for (let k = start; k < end; k += 1) {
      const column = columns[k] ?? -1;
      if (column < 0 || column >= n) throw new Error(`Design column ${k} fail-closed.`);
      sum += (values[k] ?? 0) * (dx[column] ?? 0);
    }
    out[row] = sum;
  }
};

/** lhs = Aᵀ·v directly from packed CSR design rows (no dense A). */
export const multiplyPackedDesignTranspose = (
  system: Phase10pSystemShape,
  vector: ArrayLike<number>,
  out: number[],
): void => {
  const m = system.observationEquationCount;
  const n = system.parameterCount;
  if (vector.length !== m || out.length !== n) {
    throw new Error(`Design transpose needs vector ${m} / out ${n} (got ${vector.length}/${out.length}).`);
  }
  out.fill(0);
  const { rowOffsets, columns, values } = system.design;
  for (let row = 0; row < m; row += 1) {
    const start = rowOffsets[row] ?? -1;
    const end = rowOffsets[row + 1] ?? -1;
    if (start < 0 || end < start) throw new Error(`Design row ${row} offsets fail-closed.`);
    const scale = vector[row] ?? 0;
    if (scale === 0) continue;
    for (let k = start; k < end; k += 1) {
      const column = columns[k] ?? -1;
      if (column < 0 || column >= n) throw new Error(`Design column ${k} fail-closed.`);
      out[column] += (values[k] ?? 0) * scale;
    }
  }
};

/**
 * Matrix-free normal residual `r = N·dx − u` via `t = A·dx`, `z = P·t`,
 * `lhs = Aᵀ·z`, `y = P·w`, `u = Aᵀ·y`. Never materializes N, P, or A.
 */
export const computeMatrixFreeResidual = (
  system: Phase7b7CapturedSystem,
  dx: ArrayLike<number>,
): Phase10pResidualResult => {
  const shape = asShape(system);
  const m = shape.observationEquationCount;
  const n = shape.parameterCount;
  if (dx.length !== n) throw new Error(`Residual needs dx length ${n} (got ${dx.length}).`);
  const forwardStart = performance.now();
  const t = new Array<number>(m).fill(0);
  multiplyPackedDesign(shape, dx, t);
  const z = new Array<number>(m).fill(0);
  applyPackedWeights(shape, t, z);
  const y = new Array<number>(m).fill(0);
  applyPackedWeights(shape, shape.misclosures, y);
  const forwardMs = performance.now() - forwardStart;
  const transposeStart = performance.now();
  const lhs = new Array<number>(n).fill(0);
  multiplyPackedDesignTranspose(shape, z, lhs);
  const u = new Array<number>(n).fill(0);
  multiplyPackedDesignTranspose(shape, y, u);
  const residual = lhs.map((value, i) => value - (u[i] ?? 0));
  const transposeMs = performance.now() - transposeStart;
  const residualNorm = norm2(residual);
  const rhsNorm = norm2(u);
  const dxNorm = norm2(dx);
  let maxAbsResidual = 0;
  for (const value of residual) maxAbsResidual = Math.max(maxAbsResidual, Math.abs(value));
  return {
    residual,
    metrics: {
      residualNorm,
      rhsNorm,
      dxNorm,
      relativeResidual: residualNorm / Math.max(1, rhsNorm),
      maxAbsResidual,
      equationCount: m,
      parameterCount: n,
    },
    timing: { forwardMs, transposeMs, totalMs: forwardMs + transposeMs },
  };
};

export interface Phase10pCandidateOptions {
  /** Study-only acceptance tolerance on the relative residual (default 1e-9, swept in §11). */
  tolerance?: number;
  /** Keep the damping==0 gate (default true; disabling is expected to false-accept). */
  requireUndamped?: boolean;
  /** Keep the finite-condition gate (default true; disabling is expected to false-accept). */
  requireFiniteCondition?: boolean;
  conditionThreshold?: number;
}

export interface Phase10pCandidateVerdict {
  pass: boolean;
  reasons: string[];
  metrics: Phase10pResidualMetrics;
  timing: Phase10pResidualTiming;
}

export interface Phase10pNativeCorrection {
  correction: ArrayLike<number>;
  damping: number;
  conditionEstimate: number | undefined;
}

/**
 * Diagnostic-only candidate verdict over one (system, nativeResult) pair.
 * Test/evidence API only — S3 stays authoritative; the candidate never decides.
 */
export const evaluateCorrectionResidual = (
  system: Phase7b7CapturedSystem,
  native: Phase10pNativeCorrection,
  options: Phase10pCandidateOptions = {},
): Phase10pCandidateVerdict => {
  const {
    tolerance = 1e-9,
    requireUndamped = true,
    requireFiniteCondition = true,
    conditionThreshold = SPARSE_CONDITION_THRESHOLD,
  } = options;
  const reasons: string[] = [];
  if (native.correction.length !== system.parameterCount) {
    return {
      pass: false,
      reasons: ['correction length mismatch (fail-closed)'],
      metrics: {
        residualNorm: Number.POSITIVE_INFINITY, rhsNorm: Number.NaN, dxNorm: Number.NaN,
        relativeResidual: Number.POSITIVE_INFINITY, maxAbsResidual: Number.POSITIVE_INFINITY,
        equationCount: system.observationEquationCount, parameterCount: system.parameterCount,
      },
      timing: { forwardMs: 0, transposeMs: 0, totalMs: 0 },
    };
  }
  let finite = true;
  for (let i = 0; i < native.correction.length; i += 1) {
    if (!Number.isFinite(native.correction[i] ?? Number.NaN)) { finite = false; break; }
  }
  if (!finite) reasons.push('non-finite native correction (fail-closed)');
  let residual: Phase10pResidualResult | null = null;
  try {
    residual = computeMatrixFreeResidual(system, native.correction);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`residual build failed (fail-closed): ${detail}`.slice(0, 200));
  }
  if (residual) {
    if (!Number.isFinite(residual.metrics.relativeResidual)) {
      reasons.push('non-finite residual (fail-closed)');
    } else if (residual.metrics.relativeResidual > tolerance) {
      reasons.push(
        `relative residual ${residual.metrics.relativeResidual.toExponential(2)} exceeds ${tolerance}`,
      );
    }
  }
  if (requireUndamped && (!Number.isFinite(native.damping) || native.damping !== 0)) {
    reasons.push(`damping=${native.damping} (undamped required)`);
  }
  if (requireFiniteCondition) {
    if (native.conditionEstimate == null || !Number.isFinite(native.conditionEstimate)) {
      reasons.push('no finite condition estimate (fail-closed)');
    } else if (native.conditionEstimate > conditionThreshold) {
      // Mirrors production semantics: threshold excess never rejects here
      // either — recorded for the condition-strategy study (§12), not gated.
    }
  }
  const fallbackMetrics: Phase10pResidualMetrics = {
    residualNorm: Number.POSITIVE_INFINITY, rhsNorm: Number.NaN, dxNorm: Number.NaN,
    relativeResidual: Number.POSITIVE_INFINITY, maxAbsResidual: Number.POSITIVE_INFINITY,
    equationCount: system.observationEquationCount, parameterCount: system.parameterCount,
  };
  return {
    pass: reasons.length === 0,
    reasons,
    metrics: residual?.metrics ?? fallbackMetrics,
    timing: residual?.timing ?? { forwardMs: 0, transposeMs: 0, totalMs: 0 },
  };
}

export type Phase10pShadowClass =
  | 'both-pass'
  | 's3-fail-candidate-pass'
  | 's3-pass-candidate-fail'
  | 'both-fail';

/** Shadow-mode classifier: S3 vs candidate on the same system. */
export const classifyShadow = (s3Accepted: boolean, candidatePass: boolean): Phase10pShadowClass => {
  if (s3Accepted && candidatePass) return 'both-pass';
  if (!s3Accepted && candidatePass) return 's3-fail-candidate-pass';
  if (s3Accepted && !candidatePass) return 's3-pass-candidate-fail';
  return 'both-fail';
}

/**
 * Local strategy names (S0–S5) for the diagnostic comparison (§14).
 * S0 is legacy S3 itself (reference); S1–S5 are candidate compositions —
 * none is reachable by production.
 */
export type Phase10pStrategyName = 'S0-legacy-S3' | 'S1-residual-only' | 'S2-residual-plus-first-condition'
  | 'S3-residual-plus-metadata' | 'S4-residual-sampled-condition' | 'S5-first-full-rest-cheap';

export const PHASE10P_STRATEGY_NAMES: Phase10pStrategyName[] = [
  'S0-legacy-S3',
  'S1-residual-only',
  'S2-residual-plus-first-condition',
  'S3-residual-plus-metadata',
  'S4-residual-sampled-condition',
  'S5-first-full-rest-cheap',
];
