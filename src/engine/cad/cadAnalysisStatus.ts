import type { CadSurfaceStatus, VolumeSurfaceStatus } from './cadTypes';
import type { CadAnalysisMap, CadAnalysisStatus } from './cadAnalysisTypes';

/**
 * Phase 18U analysis status derivation (pure; never a persisted flag).
 *
 * Precedence (fail-closed — a stale or unresolvable source can never report
 * CURRENT):
 *   BUILDING > BROKEN_REFERENCE > SOURCE_NOT_CURRENT >
 *   FAILED/UNBUILT (no result) > NEEDS_RECALC > NO_DATA > CURRENT
 *
 * `NO_DATA` is the 18I `NO_OVERLAP` analogue: the source was current and the
 * last successful run measured an empty domain (voids only / zero overlap).
 * It is an explicit session fact, never inferred from missing results.
 */

/** Source resolution + its own derived status. */
export interface AnalysisSourceStatusState {
  /** The referenced surface/volume definition resolves in the project. */
  found: boolean;
  /**
   * The source's own derived status. null = unknown/unavailable — treated as
   * NOT current (fail-closed), never as CURRENT.
   */
  status: CadSurfaceStatus | VolumeSurfaceStatus | null;
}

/** Session-only facts (never persisted). */
export interface AnalysisSessionState {
  /** Worker/transport in flight for the current geometry revision. */
  building?: boolean;
  /** Last session failure diagnostic for this map. */
  failed?: boolean;
  /** Last successful run measured an empty (zero-measure) domain. */
  noData?: boolean;
}

export const deriveAnalysisStatus = (
  _def: Pick<CadAnalysisMap, 'source'>,
  sourceStatuses: AnalysisSourceStatusState,
  hasCurrentResult: boolean,
  resultRevision: string | null,
  geometryRevision: string,
  session: AnalysisSessionState = {},
): CadAnalysisStatus => {
  if (session.building) return 'BUILDING';
  if (!sourceStatuses.found) return 'BROKEN_REFERENCE';
  if (sourceStatuses.status !== 'CURRENT') return 'SOURCE_NOT_CURRENT';
  if (!hasCurrentResult) return session.failed ? 'FAILED' : 'UNBUILT';
  if (resultRevision == null || resultRevision !== geometryRevision) return 'NEEDS_RECALC';
  if (session.noData) return 'NO_DATA';
  return 'CURRENT';
};
