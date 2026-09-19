import type { CadSurfaceStatus, SurfaceProfileStatus } from './cadTypes';

/**
 * Phase 18J derived profile status (pure; never a persisted flag).
 *
 * BUILDING > BROKEN_REFERENCE (missing profile/alignment/surface refs) >
 * SOURCE_NOT_CURRENT (source TIN not CURRENT) > UNBUILT/FAILED (no result) >
 * NEEDS_REBUILD (surface rebuilt since this profile) > NO_OVERLAP (no
 * covered length) > CURRENT.
 */

export interface SurfaceProfileStatusState {
  profileExists: boolean;
  alignmentExists: boolean;
  /** Current derived status of the source surface (deriveSurfaceStatus). */
  surfaceStatus: CadSurfaceStatus | 'MISSING';
  /** Source surface srev1 the cached result was built against (null = never built). */
  surfaceRevisionAtBuild: string | null;
  /** Current source surface srev1. */
  currentSurfaceRevision: string | null;
  /** Whether a cached extraction result exists for the built revision. */
  hasResult: boolean;
  building: boolean;
  /** Last session failure diagnostic for this profile. */
  diagnostic?: string;
  /** False when the cached result covers zero length (gap-only/void-only). */
  hasOverlap?: boolean;
}

export const deriveSurfaceProfileStatus = (state: SurfaceProfileStatusState): SurfaceProfileStatus => {
  if (state.building) return 'BUILDING';
  if (!state.profileExists || !state.alignmentExists) return 'BROKEN_REFERENCE';
  if (state.surfaceStatus === 'MISSING' || state.surfaceStatus === 'BROKEN_REFERENCE') {
    return 'BROKEN_REFERENCE';
  }
  if (state.surfaceStatus !== 'CURRENT') return 'SOURCE_NOT_CURRENT';
  if (!state.hasResult) return state.diagnostic ? 'FAILED' : 'UNBUILT';
  if (state.surfaceRevisionAtBuild !== state.currentSurfaceRevision) return 'NEEDS_REBUILD';
  if (state.hasOverlap === false) return 'NO_OVERLAP';
  return 'CURRENT';
};
