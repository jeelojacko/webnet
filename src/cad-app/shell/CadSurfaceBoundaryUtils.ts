import { dedupeRing } from '../../engine/cad/cadSurfaceRevision';
import { validateRingRelations } from '../../engine/cad/tin/tinBoundaries';

/**
 * Phase 18W — boundary UI helpers. Source detail resolves in the workspace
 * (describeBoundarySourceDetail); ring checks below reuse the exact engine
 * seams on live entity vertices. Parcel sources are reference-only and
 * polygon/polygon-vertex commits ride EDIT_ENTITY/GRIP (engine-guarded).
 */

export interface BoundarySourceDetail {
  entityType: string;
  label: string;
  isParcel: boolean;
  vertices: Array<{ x: number; y: number }>;
  sharedUses: number;
  sharedSurfaceIds: string[];
}

export type BoundaryRowStatus =
  | 'VALID'
  | 'BROKEN_REFERENCE'
  | 'SURFACE_BOUNDARY_INVALID'
  | 'SURFACE_VOID_INVALID';

/** Attributable per-row status + engine reason code (null when VALID). */
export const boundaryRowStatus = (
  detail: BoundarySourceDetail | null,
  kind: 'outer' | 'void',
): { status: BoundaryRowStatus; reason: string | null } => {
  if (!detail) return { status: 'BROKEN_REFERENCE', reason: 'SURFACE_REFERENCE_MISSING' };
  const ring = dedupeRing(detail.vertices);
  if (ring.length < 3) {
    return {
      status: kind === 'outer' ? 'SURFACE_BOUNDARY_INVALID' : 'SURFACE_VOID_INVALID',
      reason: kind === 'outer' ? 'SURFACE_BOUNDARY_INVALID' : 'SURFACE_VOID_INVALID',
    };
  }
  const problem = validateRingRelations(kind === 'outer' ? [ring] : [], kind === 'void' ? [ring] : [], []);
  if (problem === 'outer-invalid') return { status: 'SURFACE_BOUNDARY_INVALID', reason: 'SURFACE_BOUNDARY_INVALID' };
  if (problem === 'void-invalid') return { status: 'SURFACE_VOID_INVALID', reason: 'SURFACE_VOID_INVALID' };
  return { status: 'VALID', reason: null };
};

/** Midpoint insert default (documented naive midpoint; user adjusts numerically). */
export const midpointOf = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Indices whose coordinates differ between two rings (for red-edge marking). */
export const changedRingIndices = (
  oldRing: ReadonlyArray<{ x: number; y: number }>,
  candidate: ReadonlyArray<{ x: number; y: number }>,
): Set<number> => {
  const changed = new Set<number>();
  const shared = Math.min(oldRing.length, candidate.length);
  for (let index = 0; index < shared; index += 1) {
    const old = oldRing[index]!;
    const next = candidate[index]!;
    if (old.x !== next.x || old.y !== next.y) changed.add(index);
  }
  for (let index = shared; index < candidate.length; index += 1) changed.add(index);
  return changed;
};
