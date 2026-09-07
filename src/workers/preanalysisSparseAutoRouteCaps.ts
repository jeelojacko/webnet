/**
 * Shared preanalysis sparse auto-route caps and typed abort.
 *
 * Leaf module (no engine/worker imports) so both the route and the
 * immediate-verify covariance gate share one canonical fail-closed abort
 * type with working `instanceof` checks and no import cycle.
 */
import {
  PREANALYSIS_SPARSE_PLANNING_SYSTEM_CAP,
  PREANALYSIS_SPARSE_UNKNOWN_CAP,
} from '../engine/preanalysisSparseSessionPolicy';

/** Enforced unknown cap (station unknowns at eligibility; params at runtime). */
export const PREANALYSIS_SPARSE_ROUTE_MAX_UNKNOWN_COUNT = PREANALYSIS_SPARSE_UNKNOWN_CAP;

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
