/**
 * Phase 20K.3 Wave B — grading topology expectation (pure, pre-mesh).
 *
 * The expectation is derived from the definition (standalone strip vs
 * group, open vs closed, positive-width regions, tied stations) BEFORE
 * mesh topology runs. The validator and the gtop2 certificate then check
 * the observed mesh against this declaration — never against the mesh's
 * own observation.
 *
 * Policies (policyVersion 20k3.1):
 * - empty tied course/group: shape empty-tied, 0 components / 0 cycles /
 *   0 regions (ALREADY_TIED, exempt from certification).
 * - standalone open strip: 1 component / 1 cycle.
 * - standalone tied splits: N regions -> N components / N cycles.
 * - open group: 1/1, or N/N when tied splits separate regions.
 * - closed group: 1 component / 2 cycles (source + grading ring).
 * - a figure-eight (self-touching walk) is never accepted as an annulus:
 *   derivation never declares it; the topology trace rejects it as PINCH.
 */
import { isZeroWidthPair } from './gradingMesh';

export const GRADING_TOPOLOGY_POLICY_VERSION = '20k3.1';

/**
 * Topological components of a standalone strip: maximal runs of stations
 * whose source/daylight pair is not zero-width. A single tied station is a
 * vertex pinch that also separates two edge-components (a CUT→TIED→FILL
 * hinge), so unlike a cell-run count it breaks the run here. This is the
 * pre-mesh authority for `positiveWidthRegionCount` / expected components.
 */
export const countPositiveWidthStationRuns = (
  sourcePts: ReadonlyArray<{ x: number; y: number; z: number }>,
  daylightPts: ReadonlyArray<{ x: number; y: number; z: number }>,
): number => {
  const count = Math.min(sourcePts.length, daylightPts.length);
  let regions = 0;
  let inRegion = false;
  for (let i = 0; i < count; i += 1) {
    if (isZeroWidthPair(sourcePts[i]!, daylightPts[i]!)) inRegion = false;
    else if (!inRegion) {
      regions += 1;
      inRegion = true;
    }
  }
  return regions;
};

export type GradingTopologyScope = 'standalone' | 'group';
export type GradingTopologyShape =
  | 'open-strip'
  | 'closed-annulus'
  | 'split-open-strips'
  | 'empty-tied';

export interface GradingTopologyExpectation {
  policyVersion: typeof GRADING_TOPOLOGY_POLICY_VERSION;
  scope: GradingTopologyScope;
  shape: GradingTopologyShape;
  expectedFaceComponents: number;
  expectedBoundaryCycles: number;
  positiveWidthRegionCount: number;
  tiedSplitCoords: number[];
  closed: boolean;
  sourceBoundaryKind: 'open-path' | 'closed-ring' | 'empty';
  gradingBoundaryKind: 'open-path' | 'closed-ring' | 'empty';
}

export interface DeriveTopologyExpectationInput {
  scope: GradingTopologyScope;
  closed: boolean;
  /** Maximal non-tied station runs (standalone) or region count (group). */
  positiveWidthRegions: number;
  tiedSplitCoords?: readonly number[];
  /** No mesh: fully-tied course, nothing to certify. */
  empty?: boolean;
}

export const deriveGradingTopologyExpectation = (
  input: DeriveTopologyExpectationInput,
): GradingTopologyExpectation => {
  const tiedSplitCoords = [...(input.tiedSplitCoords ?? [])];
  const regions = Math.max(0, Math.floor(input.positiveWidthRegions));
  if (input.empty === true || regions === 0) {
    return {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION,
      scope: input.scope,
      shape: 'empty-tied',
      expectedFaceComponents: 0,
      expectedBoundaryCycles: 0,
      positiveWidthRegionCount: 0,
      tiedSplitCoords,
      closed: input.closed,
      sourceBoundaryKind: 'empty',
      gradingBoundaryKind: 'empty',
    };
  }
  if (input.scope === 'standalone') {
    const split = regions > 1;
    return {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION,
      scope: 'standalone',
      shape: split ? 'split-open-strips' : 'open-strip',
      expectedFaceComponents: regions,
      expectedBoundaryCycles: regions,
      positiveWidthRegionCount: regions,
      tiedSplitCoords,
      closed: false,
      sourceBoundaryKind: 'open-path',
      gradingBoundaryKind: 'open-path',
    };
  }
  if (input.closed) {
    return {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION,
      scope: 'group',
      shape: 'closed-annulus',
      expectedFaceComponents: 1,
      expectedBoundaryCycles: 2,
      positiveWidthRegionCount: 1,
      tiedSplitCoords,
      closed: true,
      sourceBoundaryKind: 'closed-ring',
      gradingBoundaryKind: 'closed-ring',
    };
  }
  const split = regions > 1;
  return {
    policyVersion: GRADING_TOPOLOGY_POLICY_VERSION,
    scope: 'group',
    shape: split ? 'split-open-strips' : 'open-strip',
    expectedFaceComponents: regions,
    expectedBoundaryCycles: regions,
    positiveWidthRegionCount: regions,
    tiedSplitCoords,
    closed: false,
    sourceBoundaryKind: 'open-path',
    gradingBoundaryKind: 'open-path',
  };
};

/**
 * Phase 20M.2 WAVE E — transition-aware PRE-MESH group expectation.
 *
 * Additive helper over `deriveGradingTopologyExpectation` (untouched).
 * A group with NO transition intent (`null`/`undefined`/empty) derives the
 * legacy expectation byte-identically. An admitted open transition declares
 * the group-scoped open-strip shape: 1 component / 1 boundary cycle / 1
 * positive-width run. Anything else fails pre-mesh (never observed-count
 * fallback, never a separate standalone-strip certificate).
 *
 * The intent carries pre-mesh scalars only (width + member lengths +
 * joint/count/open flags); persisted identity refs stay canonical in
 * `CadGradingTransition` — never a second canonical type.
 */
export interface TransitionExpectationIntent {
  jointId: string;
  /** Explicit total symmetric width W, source-line meters. */
  width: number;
  /** Source-line lengths of the two incident members. */
  memberLengths: readonly [number, number];
  /** Total transition objects on the group; trp1 admits exactly 1. */
  transitionCount: number;
  /** False for closed routes (excluded in trp1). */
  isOpen: boolean;
}

export type TransitionExpectationOutcome =
  | { ok: true; expectation: GradingTopologyExpectation }
  | { ok: false; code: string; detail: string };

export const deriveTransitionExpectation = (
  base: DeriveTopologyExpectationInput,
  intent: TransitionExpectationIntent | null | undefined,
): TransitionExpectationOutcome => {
  if (intent == null) {
    return { ok: true, expectation: deriveGradingTopologyExpectation(base) };
  }
  if (typeof intent.jointId !== 'string' || intent.jointId.length === 0) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'transition jointId required' };
  }
  if (intent.transitionCount !== 1) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'trp1 admits exactly one transition per group' };
  }
  if (!intent.isOpen) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'closed-route transitions excluded' };
  }
  const w = intent.width;
  if (!Number.isFinite(w) || !(w > 0)) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'transition width must be finite > 0' };
  }
  const [a, b] = intent.memberLengths;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a > 0) || !(b > 0)) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'member lengths must be finite > 0' };
  }
  if (!(w <= 2 * Math.min(a, b))) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_WIDE', detail: 'transition width exceeds 2*min(member lengths)' };
  }
  return {
    ok: true,
    expectation: deriveGradingTopologyExpectation({
      scope: 'group',
      closed: false,
      positiveWidthRegions: 1,
    }),
  };
};
