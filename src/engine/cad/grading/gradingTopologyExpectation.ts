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
