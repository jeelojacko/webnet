import {
  BREAKLINE_CHAIN_DUPLICATE_REF,
  BREAKLINE_CHAIN_SELF_INTERSECT,
  breaklineChainSelfIntersects,
  validateBreaklineChainRefs,
} from '../../engine/cad/cadBreaklineChainValidation';

/**
 * Phase 18W — breakline UI helpers. The shell never sees CadProject:
 * membership comes from describeBreaklineChain, coordinates from
 * describeSurveyPointCoords (both live, read-only, Z never invented).
 * Status reuses engine reason codes; the cross-chain gate stays in the
 * commit path (fail-closed notice on reject).
 */

export interface BreaklineCoord {
  ref: string;
  entityId: string | null;
  stationId: string;
  x: number;
  y: number;
  z: number | null;
}

export interface BreaklineChainDetail {
  sourceKind: 'point-chain' | 'entity';
  memberIds: string[];
  sourceEntityId: string | null;
  sourceLabel: string | null;
}

export type BreaklineRowStatus =
  | 'VALID'
  | 'BROKEN_REFERENCE'
  | 'MISSING_Z'
  | 'INTERSECTION';

/** Derived per-row status + the engine reason code behind it (null when VALID). */
export const breaklineRowStatus = (
  detail: BreaklineChainDetail,
  coords: BreaklineCoord[],
): { status: BreaklineRowStatus; reason: string | null; resolvedCount: number } => {
  const byRef = new Map(coords.map((coord) => [coord.ref, coord]));
  const refProblem = validateBreaklineChainRefs(detail.memberIds);
  if (refProblem != null) {
    // Duplicate refs read as an intersection; anything else cannot form a chain.
    return {
      status: refProblem === BREAKLINE_CHAIN_DUPLICATE_REF ? 'INTERSECTION' : 'BROKEN_REFERENCE',
      reason: refProblem,
      resolvedCount: 0,
    };
  }
  let resolved = 0;
  for (const ref of detail.memberIds) {
    const coord = byRef.get(ref);
    if (!coord || coord.entityId == null) {
      return { status: 'BROKEN_REFERENCE', reason: 'SURFACE_REFERENCE_MISSING', resolvedCount: 0 };
    }
    if (coord.z == null || !Number.isFinite(coord.z)) {
      return { status: 'MISSING_Z', reason: 'SURFACE_BREAKLINE_MISSING_Z', resolvedCount: detail.memberIds.length };
    }
    resolved += 1;
  }
  const xy = detail.memberIds.map((ref) => {
    const coord = byRef.get(ref)!;
    return { x: coord.x, y: coord.y };
  });
  if (breaklineChainSelfIntersects(xy)) {
    return { status: 'INTERSECTION', reason: BREAKLINE_CHAIN_SELF_INTERSECT, resolvedCount: resolved };
  }
  return { status: 'VALID', reason: null, resolvedCount: resolved };
};

/** Membership preflight for insert/reorder/replace/create (null = clean). */
export const preflightChainRefs = (
  memberIds: readonly string[],
  coords: BreaklineCoord[],
): string | null => {
  const refProblem = validateBreaklineChainRefs(memberIds);
  if (refProblem != null) return refProblem;
  const byRef = new Map(coords.map((coord) => [coord.ref, coord]));
  const xy: Array<{ x: number; y: number }> = [];
  for (const ref of memberIds) {
    const coord = byRef.get(ref);
    if (!coord || coord.entityId == null) return 'SURFACE_REFERENCE_MISSING';
    if (coord.z == null || !Number.isFinite(coord.z)) return 'SURFACE_BREAKLINE_MISSING_Z';
    xy.push({ x: coord.x, y: coord.y });
  }
  if (breaklineChainSelfIntersects(xy)) return BREAKLINE_CHAIN_SELF_INTERSECT;
  return null;
};

/** Label for one member ref (station when resolved, raw ref otherwise). */
export const memberLabel = (coord: BreaklineCoord | undefined, ref: string): string =>
  coord && coord.entityId != null ? coord.stationId : ref;
