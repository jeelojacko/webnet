/**
 * Shared preanalysis sparse auto-route caps and typed abort.
 *
 * Leaf module (no engine/worker imports) so both the route and the
 * immediate-verify covariance gate share one canonical fail-closed abort
 * type with working `instanceof` checks and no import cycle.
 */
import {
  PREANALYSIS_SPARSE_PARAMETER_CAP,
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP,
} from '../engine/preanalysisSparseSessionPolicy';

/** Enforced station-unknown cap (static eligibility + whole-session unknown check). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS = PREANALYSIS_SPARSE_STATION_UNKNOWN_CAP;

/** @deprecated Station-unknown cap only; never use for runtime parameter gates. */
export const PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT = PREANALYSIS_SPARSE_ROUTE_MAX_STATION_UNKNOWNS;

/**
 * Enforced runtime per-system parameter cap (correction/covariance
 * pre-dispatch gates + verifier). Phase 9B: 256 (split from the
 * station-unknown cap above; station stays 128, runtime is 256).
 */
export const PREANALYSIS_SPARSE_ROUTE_MAX_PARAMETERS = PREANALYSIS_SPARSE_PARAMETER_CAP;

/** Enforced per-session planning-system cap (captured covariance calls). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_PLANNING_SYSTEMS = PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP;

/** Capture bound for selected-covariance calls (fail-closed truncation). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_CAPTURED_CALLS = 512;

/**
 * Backstop bound on native re-verification entries per system. The route
 * never issues all-pairs queries: verification uses at most
 * PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT (16) complete columns.
 * Exceeding this backstop fails closed.
 */
export const PREANALYSIS_SPARSE_ROUTE_MAX_VERIFICATION_QUERIES = 16384;

/**
 * Typed fail-closed abort thrown BEFORE delegating to the native solver.
 * The engine converts solver throws into recorded dense fallbacks (or lets
 * them propagate); either way the route discards the mixed outcome and
 * performs exactly one clean TypeScript restart, so this error never
 * carries correction/covariance authority.
 */
export class PreanalysisSparseCapError extends Error {
  readonly routeReason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'PreanalysisSparseCapError';
    this.routeReason = reason;
  }
}

/** Identifies the typed pre-dispatch abort (no string matching needed). */
export const isPreanalysisSparseCapError = (error: unknown): error is PreanalysisSparseCapError =>
  error instanceof PreanalysisSparseCapError;

/**
 * Shared candidate state: the correction gate counts one planning system
 * per native correction entry (first native entry per planning solve) and
 * the covariance gate pairs each covariance call to a started system.
 */
export interface PreanalysisCandidateState {
  systemsStarted: number;
  aborted: boolean;
  abortReason: string | null;
}

/** Creates fresh candidate state for one routed session attempt. */
export const createPreanalysisCandidateState = (): PreanalysisCandidateState => ({
  systemsStarted: 0,
  aborted: false,
  abortReason: null,
});

export interface PreanalysisGateCaps {
  maxSystems: number;
  maxParameters: number;
}
