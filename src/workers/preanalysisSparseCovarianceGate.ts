/**
 * Production preanalysis sparse covariance gate (immediate verification).
 *
 * Pre-dispatch fail-closed gate plus capture around the native
 * selected-covariance solver. Each engine-issued call is verified
 * immediately against damping, native-value C2, TS selected-solve C1, C3
 * hybrid, and physical gates; only the compact per-system verdict is
 * retained, never the packed design/weight inputs or native results. Peak
 * retained packed-system instrumentation stays at most one by
 * construction (verified synchronously, then dropped). The whole-session
 * atomic fallback lives in the route: any verdict failure discards the
 * mixed outcome and restarts the original request clean in TypeScript.
 *
 * Production-safe: engine sentinel + type imports only. No evidence-only,
 * test-helper, or script imports.
 */
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
  SparseSelectedCovarianceSolver,
} from '../engine/numericalBackend';
import {
  accumulatePackedNormal,
  buildBoundedVerificationQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  evaluateSentinelC3,
  PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
  probeSelectedCovariance,
  validateSentinelPhysical,
  type PreanalysisSparseC1Result,
  type PreanalysisSparseC2Result,
} from '../engine/preanalysisSparseCovarianceSentinel';
import type { Matrix } from '../engine/matrixTypes';
import {
  PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS,
  PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES,
  PreanalysisSparseCapError,
  type PreanalysisCandidateState,
  type PreanalysisGateCaps,
} from './preanalysisSparseAutoRouteCaps';

/** Test-only forced-failure flags (verification-gate exercise). */
export interface PreanalysisGateTestFlags {
  forceC2Failure?: boolean;
  forcePhysicalFailure?: boolean;
}

/** Compact per-system verdict: reasons empty means pass. */
export interface PreanalysisCovarianceVerdict {
  index: number;
  parameterCount: number;
  reasons: string[];
  warnings: string[];
}

export interface CapturedCovarianceCall {
  input: SparseSelectedCovarianceInput;
  result: SparseSelectedCovarianceResult | null;
  threw: boolean;
}

const copyCovarianceInput = (
  input: SparseSelectedCovarianceInput,
): SparseSelectedCovarianceInput => ({
  design: {
    rowOffsets: Int32Array.from(input.design.rowOffsets),
    columns: Int32Array.from(input.design.columns),
    values: Float64Array.from(input.design.values),
  },
  weights: {
    rows: Int32Array.from(input.weights.rows),
    columns: Int32Array.from(input.weights.columns),
    values: Float64Array.from(input.weights.values),
  },
  observationEquationCount: input.observationEquationCount,
  parameterCount: input.parameterCount,
  queryRows: Int32Array.from(input.queryRows),
  queryColumns: Int32Array.from(input.queryColumns),
});

/** Header gate: thrown delegates, parameter range, and damping. */
const checkSystemHeader = (
  call: CapturedCovarianceCall,
  index: number,
): { tag: string; n: number; early: PreanalysisCovarianceVerdict | null } => {
  const tag = `system ${index + 1}`;
  const n = call.input.parameterCount;
  const early = (
    reasons: string[],
  ): PreanalysisCovarianceVerdict => ({ index, parameterCount: n, reasons, warnings: [] });
  if (call.threw || call.result == null) {
    return {
      tag,
      n,
      early: early([`${tag}: native covariance produced no values (it threw; fail-closed)`]),
    };
  }
  if (n <= 0 || n > PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT) {
    return {
      tag,
      n,
      early: early([
        `${tag}: parameterCount ${n} outside 1..${PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT} (fail-closed)`,
      ]),
    };
  }
  const damping = call.result.damping ?? Number.NaN;
  if (!Number.isFinite(damping) || damping !== 0) {
    return { tag, n, early: early([`${tag}: damping=${damping} (undamped required)`]) };
  }
  return { tag, n, early: null };
};

/** Accumulates dense N from the packed inputs (fail-closed). */
const accumulateGateNormal = (
  call: CapturedCovarianceCall,
  tag: string,
): { normal: Matrix | null; reasons: string[] } => {
  try {
    return {
      normal: accumulatePackedNormal({
        design: call.input.design,
        weights: call.input.weights,
        observationEquationCount: call.input.observationEquationCount,
        parameterCount: call.input.parameterCount,
      }),
      reasons: [],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      normal: null,
      reasons: [`${tag}: normal accumulation threw fail-closed: ${detail}`.slice(0, 200)],
    };
  }
};

/** C2 over the captured native production values (complete columns only). */
const judgeProductionC2 = (
  normal: Matrix,
  call: CapturedCovarianceCall,
  tag: string,
): { prodC2: PreanalysisSparseC2Result; warnings: string[] } => {
  const warnings: string[] = [];
  const prodValues = Array.from(call.result?.covariance ?? []);
  const prodC2 = evaluateSentinelC2(
    normal,
    call.input.queryRows,
    call.input.queryColumns,
    prodValues,
  );
  if (prodC2.perColumnResidual.length === 0) {
    warnings.push(
      `${tag}: production C2 has no complete column (${prodC2.reasons.join('; ').slice(0, 160)}); bounded verification decides`,
    );
  }
  return { prodC2, warnings };
};

/** Bounded deterministic native re-verification through the raw delegate. */
const runBoundedVerification = (
  normal: Matrix,
  call: CapturedCovarianceCall,
  delegate: SparseSelectedCovarianceSolver,
  tag: string,
  n: number,
): { pass: boolean | null; reasons: string[]; warnings: string[] } => {
  const reasons: string[] = [];
  const warnings: string[] = [];
  try {
    const bounded = buildBoundedVerificationQueries(n, PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT);
    if (bounded.rows.length > PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES) {
      reasons.push(
        `${tag}: verification needs ${bounded.rows.length} entries, exceeding backstop ${PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES} (fail-closed)`,
      );
      return { pass: null, reasons, warnings };
    }
    const verification = delegate.querySelected({
      design: call.input.design,
      weights: call.input.weights,
      observationEquationCount: call.input.observationEquationCount,
      parameterCount: n,
      queryRows: bounded.rows,
      queryColumns: bounded.columns,
    });
    if (!Number.isFinite(verification.damping) || verification.damping !== 0) {
      reasons.push(
        `${tag}: verification native damping=${verification.damping} (undamped required)`,
      );
      return { pass: null, reasons, warnings };
    }
    const evaluated = evaluateSentinelC2(
      normal,
      bounded.rows,
      bounded.columns,
      Array.from(verification.covariance),
    );
    warnings.push(
      `${tag}: bounded verification cols=${bounded.verifiedColumns.length} checked=${evaluated.perColumnResidual.length} residual=${evaluated.maxResidual.toExponential(2)}`,
    );
    if (!evaluated.pass) {
      reasons.push(
        `${tag}: C2 rejects verification native values: ${evaluated.reasons.join('; ').slice(0, 200)}`,
      );
    }
    return { pass: evaluated.pass, reasons, warnings };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`${tag}: verification native query threw fail-closed: ${detail}`.slice(0, 200));
    return { pass: null, reasons, warnings };
  }
};

/** C1: captured native values vs the TS selected-solve reference. */
const judgeSelectedC1 = (
  normal: Matrix,
  call: CapturedCovarianceCall,
  prodValues: number[],
  tag: string,
): { c1: PreanalysisSparseC1Result | null; reasons: string[] } => {
  try {
    if (call.input.queryRows.length === 0) {
      return { c1: null, reasons: [`${tag}: C1 needs at least one queried entry (fail-closed)`] };
    }
    const probe = probeSelectedCovariance(normal, call.input.queryRows, call.input.queryColumns);
    if (probe.damped) {
      return { c1: null, reasons: [`${tag}: TS probe damped (fail-closed)`] };
    }
    const c1 = evaluateSentinelC1(prodValues, probe.values);
    if (!c1.pass) {
      return { c1, reasons: [`${tag}: C1 rejects: ${c1.reasons.join('; ').slice(0, 200)}`] };
    }
    return { c1, reasons: [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { c1: null, reasons: [`${tag}: C1 threw fail-closed: ${detail}`.slice(0, 200)] };
  }
};

/** C3 hybrid over C1 plus production native C2 where complete. */
const judgeHybridC3 = (
  c1: PreanalysisSparseC1Result | null,
  prodC2: PreanalysisSparseC2Result,
  verificationPass: boolean | null,
  tag: string,
): string[] => {
  const c2ForC3 = prodC2.perColumnResidual.length > 0 ? prodC2 : null;
  if (c2ForC3 && verificationPass != null) {
    const c3 = evaluateSentinelC3({ c1, c2: c2ForC3 });
    if (!c3.pass) return [`${tag}: C3 rejects: ${c3.reasons.join('; ').slice(0, 200)}`];
    return [];
  }
  if (verificationPass == null && c2ForC3 == null) {
    return [
      `${tag}: no complete native column (production or verification); full-column coverage required (fail-closed)`,
    ];
  }
  return [];
};

/** Physical validity over native production values plus test-hook faults. */
const judgePhysical = (
  call: CapturedCovarianceCall,
  prodValues: number[],
  tag: string,
  testFlags: PreanalysisGateTestFlags,
): string[] => {
  const physical = validateSentinelPhysical({
    queryRows: call.input.queryRows,
    queryColumns: call.input.queryColumns,
    values: prodValues,
  });
  const reasons: string[] = [];
  if (!physical.valid) {
    reasons.push(`${tag}: physical rejects: ${physical.reasons.join('; ').slice(0, 200)}`);
  }
  if (testFlags.forceC2Failure) reasons.push(`${tag}: forced C2 failure (test hook)`);
  if (testFlags.forcePhysicalFailure) reasons.push(`${tag}: forced physical failure (test hook)`);
  return reasons;
};

/**
 * Verifies one captured covariance system: damping, native-value C2
 * (production values where they cover complete columns plus one bounded
 * deterministic complete-column verification set through the same native
 * delegate), TS diagonal C1 packed-decode check, C3 hybrid, and physical
 * validity. Returns compact reasons (empty = pass) plus warnings.
 */
export const verifyCovarianceSystem = (
  call: CapturedCovarianceCall,
  index: number,
  delegate: SparseSelectedCovarianceSolver,
  testFlags: PreanalysisGateTestFlags = {},
): PreanalysisCovarianceVerdict => {
  const { tag, n, early } = checkSystemHeader(call, index);
  if (early) return early;
  const { normal, reasons: normalReasons } = accumulateGateNormal(call, tag);
  if (!normal) return { index, parameterCount: n, reasons: normalReasons, warnings: [] };
  const reasons: string[] = [];
  const prodValues = Array.from(call.result?.covariance ?? []);
  const { prodC2, warnings } = judgeProductionC2(normal, call, tag);
  if (prodC2.perColumnResidual.length > 0 && !prodC2.pass) {
    reasons.push(
      `${tag}: C2 rejects production native values: ${prodC2.reasons.join('; ').slice(0, 200)}`,
    );
  }
  const verification = runBoundedVerification(normal, call, delegate, tag, n);
  reasons.push(...verification.reasons);
  warnings.push(...verification.warnings);
  const { c1, reasons: c1Reasons } = judgeSelectedC1(normal, call, prodValues, tag);
  reasons.push(...c1Reasons);
  reasons.push(...judgeHybridC3(c1, prodC2, verification.pass, tag));
  reasons.push(...judgePhysical(call, prodValues, tag, testFlags));
  return { index, parameterCount: n, reasons, warnings };
};

/**
 * Pre-dispatch gate plus immediate-verify capture around the native
 * selected-covariance solver. Each call must pair with an already-started
 * correction system (covariance never runs ahead of correction), and
 * over-cap/over-count calls are refused BEFORE delegating. Each delegated
 * system is verified synchronously through the raw delegate and only its
 * compact verdict is retained, so at most one packed system is ever live.
 */
export class PreanalysisGatedCovarianceCapture implements SparseSelectedCovarianceSolver {
  readonly verdicts: PreanalysisCovarianceVerdict[] = [];

  truncated = false;

  maxRetainedPackedSystems = 0;

  private retainedPackedSystems = 0;

  private testFlags: PreanalysisGateTestFlags = {};

  constructor(
    private readonly _delegate: SparseSelectedCovarianceSolver,
    private readonly _state: PreanalysisCandidateState,
    private readonly _caps: PreanalysisGateCaps,
  ) {}

  /** Test-only forced-failure flags (no protocol or user-facing flags). */
  setTestFlags(flags: PreanalysisGateTestFlags): void {
    this.testFlags = { ...flags };
  }

  querySelected(input: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult {
    if (this._state.aborted) {
      throw new PreanalysisSparseCapError(
        this._state.abortReason ?? 'candidate aborted (fail-closed; not delegated)',
      );
    }
    const n = input.parameterCount;
    if (!Number.isInteger(n) || n <= 0 || n > this._caps.maxParameters) {
      const reason =
        `system covariance: parameterCount ${n} exceeds cap ${this._caps.maxParameters} (fail-closed; not delegated)`;
      this.abortCandidate(reason);
      throw new PreanalysisSparseCapError(reason);
    }
    const next = this.verdicts.length + 1;
    if (next > this._caps.maxSystems) {
      const reason =
        `planning systems ${next} exceed cap ${this._caps.maxSystems} (fail-closed; not delegated)`;
      this.abortCandidate(reason);
      throw new PreanalysisSparseCapError(reason);
    }
    if (next > this._state.systemsStarted) {
      const reason =
        `system ${next}: covariance without paired correction entry (fail-closed; not delegated)`;
      this.abortCandidate(reason);
      throw new PreanalysisSparseCapError(reason);
    }
    if (this.verdicts.length >= PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS) {
      this.truncated = true;
      return this._delegate.querySelected(input);
    }
    let call: CapturedCovarianceCall;
    try {
      const result = this._delegate.querySelected(input);
      call = { input: copyCovarianceInput(input), result, threw: false };
    } catch (error) {
      call = { input: copyCovarianceInput(input), result: null, threw: true };
      this.recordVerdictImmediate(call);
      throw error;
    }
    const result = call.result as SparseSelectedCovarianceResult;
    this.recordVerdictImmediate(call);
    return result;
  }

  private recordVerdictImmediate(call: CapturedCovarianceCall): void {
    this.retainedPackedSystems += 1;
    this.maxRetainedPackedSystems = Math.max(
      this.maxRetainedPackedSystems,
      this.retainedPackedSystems,
    );
    try {
      this.verdicts.push(
        verifyCovarianceSystem(call, this.verdicts.length, this._delegate, this.testFlags),
      );
    } finally {
      this.retainedPackedSystems -= 1;
    }
  }

  private abortCandidate(reason: string): void {
    if (!this._state.aborted) {
      this._state.aborted = true;
      this._state.abortReason = reason;
    }
  }
};
