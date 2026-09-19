import type { CadSectionStatus, CadSurfaceStatus } from './cadTypes';

/**
 * Phase 18K derived section status (pure; never a persisted flag).
 *
 * Per sample-line x source. Priority:
 * BUILDING > BROKEN_REFERENCE (missing group/line/alignment/surface) >
 * OUT_OF_RANGE (line raw station outside the alignment) >
 * SOURCE_NOT_CURRENT (source TIN not CURRENT) > UNBUILT/FAILED (no result) >
 * NEEDS_REBUILD (source rebuilt since this result) > NO_COVERAGE >
 * CURRENT.
 */

export interface CadSectionStatusState {
  groupExists: boolean;
  lineExists: boolean;
  alignmentExists: boolean;
  surfaceExists: boolean;
  /** Current derived status of the source surface (deriveSurfaceStatus). */
  surfaceStatus: CadSurfaceStatus | 'MISSING';
  /** Source surface srev1 the cached result was built against (null = never built). */
  surfaceRevisionAtBuild: string | null;
  /** Current source surface srev1. */
  currentSurfaceRevision: string | null;
  hasResult: boolean;
  building: boolean;
  /** Line raw station falls outside the alignment raw extents. */
  outOfRange: boolean;
  /** Last session failure diagnostic for this line x source. */
  diagnostic?: string;
  /** False when the cached result covers zero width (gap-only/void-only). */
  hasCoverage?: boolean;
}

export const deriveCadSectionStatus = (state: CadSectionStatusState): CadSectionStatus => {
  if (state.building) return 'BUILDING';
  if (!state.groupExists || !state.lineExists || !state.alignmentExists || !state.surfaceExists) {
    return 'BROKEN_REFERENCE';
  }
  if (state.surfaceStatus === 'MISSING' || state.surfaceStatus === 'BROKEN_REFERENCE') {
    return 'BROKEN_REFERENCE';
  }
  if (state.outOfRange) return 'OUT_OF_RANGE';
  if (state.surfaceStatus !== 'CURRENT') return 'SOURCE_NOT_CURRENT';
  if (!state.hasResult) return state.diagnostic ? 'FAILED' : 'UNBUILT';
  if (state.surfaceRevisionAtBuild !== state.currentSurfaceRevision) return 'NEEDS_REBUILD';
  if (state.hasCoverage === false) return 'NO_COVERAGE';
  return 'CURRENT';
};
