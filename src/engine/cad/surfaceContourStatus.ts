/**
 * Phase 18H — derived contour status (separate from TIN status).
 *
 * TIN CURRENT + contours FAILED must leave TIN inquiries working: this
 * status derives ONLY from contour state (pending set, cached geometry
 * revision, contour diagnostic) and never touches deriveSurfaceStatus.
 * Stale-TIN policy: a contour set is CURRENT only if the parent TIN is
 * CURRENT for the same surface revision; otherwise an older set may show
 * stale-marked only and new derivation is blocked (never CURRENT).
 */

export type SurfaceContourStatus = 'NOT_REQUESTED' | 'BUILDING' | 'CURRENT' | 'FAILED';

export interface ContourStatusInput {
  /** Parent TIN CURRENT for this exact surface revision. */
  tinCurrent: boolean;
  /** In-flight contour request for this surface. */
  building: boolean;
  /** Cached set matches (surfaceRevision, geometryRevision) exactly. */
  cacheHit: boolean;
  /** Last contour failure diagnostic for this surface. */
  diagnostic?: string;
  /** An older set exists but revisions differ (stale-marked display only). */
  hasStale: boolean;
}

export const deriveSurfaceContourStatus = (
  input: ContourStatusInput,
): { status: SurfaceContourStatus; stale: boolean } => {
  if (!input.tinCurrent) {
    // Stale-TIN: nothing new can be CURRENT; old sets show stale-marked.
    if (input.building) return { status: 'BUILDING', stale: input.hasStale };
    if (input.cacheHit) return { status: 'CURRENT', stale: true };
    return { status: input.diagnostic ? 'FAILED' : 'NOT_REQUESTED', stale: input.hasStale };
  }
  if (input.building) return { status: 'BUILDING', stale: false };
  if (input.cacheHit) return { status: 'CURRENT', stale: false };
  if (input.diagnostic) return { status: 'FAILED', stale: input.hasStale };
  return { status: 'NOT_REQUESTED', stale: input.hasStale };
};
