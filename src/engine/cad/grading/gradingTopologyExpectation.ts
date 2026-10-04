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

/**
 * Phase 20N.1: the authorized plural form — an ordered (canonical increasing
 * joint index) set of per-joint intents, each evaluated with the singular
 * `trp1` scalar contract. The merged-strip argument (surviving natives + C0
 * shared boundaries ⇒ one maximal non-tied run) is stated in
 * `docs/evidence/phase20n/decision.md` §3.5: an open strict-separated
 * all-positive chain declares the group-scoped open strip 1/1/1 PRE-MESH,
 * never from an observed count. Each entry carries `transitionCount: 1`
 * (per-joint admission, as in the study); the ARRAY LENGTH is the plural
 * set size, so the singular `transitionCount !== 1` rejection is untouched.
 */
export type TransitionExpectationSet = TransitionExpectationIntent[];

/** Parse a real `joint:<n>` id; anything else is malformed (never coerced). */
const transitionJointIndex = (jointId: string): number | null => {
  const m = /^joint:(\d+)$/.exec(jointId);
  return m ? Number(m[1]) : null;
};

/** Per-intent scalar validation shared by the singular and plural paths. */
const validateTransitionIntent = (
  intent: TransitionExpectationIntent,
): TransitionExpectationOutcome | null => {
  if (typeof intent.jointId !== 'string' || intent.jointId.length === 0) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'transition jointId required' };
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
  return null;
};

const declaredMergedStrip = (): TransitionExpectationOutcome => ({
  ok: true,
  expectation: deriveGradingTopologyExpectation({
    scope: 'group',
    closed: false,
    positiveWidthRegions: 1,
  }),
});

const deriveSingularTransitionExpectation = (
  intent: TransitionExpectationIntent,
): TransitionExpectationOutcome => {
  const invalid = validateTransitionIntent(intent);
  if (invalid) return invalid;
  if (intent.transitionCount !== 1) {
    return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'trp1 admits exactly one transition per group' };
  }
  return declaredMergedStrip();
};

/**
 * Plural pre-mesh expectation: every intent is admitted (trusted upstream),
 * joint ids are canonical strictly increasing (gaps allowed), and strict
 * separation `Wi/2 + Wj/2 < gap` holds. Legacy mode (no stationGaps)
 * additionally requires consecutive joints AND a bit-identical shared member
 * (never repaired). Station-gap mode (stationGaps provided) takes the gap
 * as the station difference and skips the shared-member check. Any failure
 * means NO expectation and NO certificate (fail closed; the measured mesh
 * count is never consulted).
 */
const deriveTransitionSetExpectation = (
  base: DeriveTopologyExpectationInput,
  intents: TransitionExpectationSet,
  stationGaps?: readonly number[],
): TransitionExpectationOutcome => {
  // Present-but-empty set is the legacy shape (absent intent).
  if (intents.length === 0) {
    return { ok: true, expectation: deriveGradingTopologyExpectation(base) };
  }
  const indices: number[] = [];
  for (const intent of intents) {
    if (intent === null || typeof intent !== 'object') {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'transition intent must be an object' };
    }
    const invalid = validateTransitionIntent(intent);
    if (invalid) return invalid;
    if (intent.transitionCount !== 1) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'each trp1 joint admits exactly one transition' };
    }
    const index = transitionJointIndex(intent.jointId);
    if (index === null) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: `malformed jointId ${JSON.stringify(intent.jointId)}` };
    }
    indices.push(index);
  }
  if (stationGaps !== undefined) {
    if (!Array.isArray(stationGaps) || stationGaps.length !== intents.length - 1) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'station gaps must match the transition set' };
    }
    for (let i = 1; i < indices.length; i += 1) {
      if (indices[i]! <= indices[i - 1]!) {
        return {
          ok: false,
          code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED',
          detail: 'transition joints must be canonical strictly increasing',
        };
      }
    }
    for (let i = 0; i + 1 < intents.length; i += 1) {
      const gap = stationGaps[i]!;
      if (!Number.isFinite(gap) || !(gap > 0)) {
        return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'station gaps must be finite > 0' };
      }
      const halfSpan = intents[i]!.width / 2 + intents[i + 1]!.width / 2;
      if (halfSpan === gap) {
        return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'touching transitions are not authorized (shared boundaries need a tie-break)' };
      }
      if (halfSpan > gap) {
        return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'overlapping transitions are not authorized' };
      }
    }
    return declaredMergedStrip();
  }
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] !== indices[i - 1]! + 1) {
      return {
        ok: false,
        code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED',
        detail: 'transition joints must be canonical increasing and consecutive',
      };
    }
  }
  for (let i = 0; i + 1 < intents.length; i += 1) {
    const left = intents[i]!;
    const right = intents[i + 1]!;
    // The shared member is joint i's right member and joint i+1's left
    // member; a mismatch is inconsistent input, never repaired to a default.
    const gap = left.memberLengths[1];
    if (gap !== right.memberLengths[0]) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_MALFORMED', detail: 'adjacent joints must share one member length exactly' };
    }
    const halfSpan = left.width / 2 + right.width / 2;
    if (halfSpan === gap) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'touching transitions are not authorized (shared boundaries need a tie-break)' };
    }
    if (halfSpan > gap) {
      return { ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP', detail: 'overlapping transitions are not authorized' };
    }
  }
  return declaredMergedStrip();
};

/**
 * Pre-mesh expectation from ONE intent (legacy, `transitionCount === 1`) or
 * the authorized plural set (ordered array). `null`/`undefined`/empty set
 * derives the legacy expectation byte-identically.
 */
export const deriveTransitionExpectation = (
  base: DeriveTopologyExpectationInput,
  intent: TransitionExpectationIntent | TransitionExpectationSet | null | undefined,
  stationGaps?: readonly number[],
): TransitionExpectationOutcome => {
  if (intent == null) {
    return { ok: true, expectation: deriveGradingTopologyExpectation(base) };
  }
  if (Array.isArray(intent)) {
    return deriveTransitionSetExpectation(base, intent, stationGaps);
  }
  return deriveSingularTransitionExpectation(intent);
};


