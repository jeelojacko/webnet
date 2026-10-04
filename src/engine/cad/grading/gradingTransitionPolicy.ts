/**
 * Phase 20M.2 WAVE B/C/D foundation — collinear same-family transition admission.
 *
 * SINGLE typed admission authority for policyVersion `trp1`. Implements the
 * narrowed 20M.1 §9 predicate with EXACT checks only (no tolerances, no
 * widening, no defaults). Malformed/stale/inadmissible intent FAILS CLOSED.
 */
import { resolveAnalyticCriterionAt } from './gradingAnalyticCriterion';
import type { CadGradingTransition, GroupDiagnosticCode } from './gradingGroupTypes';
import type { GradingTopologyExpectation } from './gradingTopologyExpectation';
import { deriveTransitionExpectation } from './gradingTopologyExpectation';
import type { GradingCriterion, GradingSide } from './gradingTypes';

export type TransitionPolicyVersion = 'trp1';
export type TransitionLawKind = 'TRANSITION_LINEAR_V1';
export type TransitionLawVersion = 'v1';
export type TransitionFamily = 'distance' | 'relative-elevation' | 'elevation';

export const TRANSITION_POLICY_VERSION: TransitionPolicyVersion = 'trp1';
export const TRANSITION_LAW_KIND: TransitionLawKind = 'TRANSITION_LINEAR_V1';
export const TRANSITION_LAW_VERSION: TransitionLawVersion = 'v1';

export type TransitionRejectCode =
  | 'MALFORMED'
  | 'VERSION_UNKNOWN'
  | 'LAW_UNKNOWN'
  | 'CARDINALITY'
  | 'CLOSED'
  | 'NON_LINE'
  | 'NON_FLAT'
  | 'JOINT_Z_STEP'
  | 'SIDE_MISMATCH'
  | 'FAMILY_MISMATCH'
  | 'GRADE_MISMATCH'
  | 'NON_COLLINEAR'
  | 'WIDTH_INVALID'
  | 'WIDTH_INFEASIBLE'
  | 'MEMBER_REF_STALE'
  | 'NATIVE_CRITERION'
  | 'MAX_SEARCH';

export interface TransitionMemberGeometry {
  /** Stable identity, e.g. courseCriterionKey(vertexA, vertexB). */
  memberId: string;
  criterion: GradingCriterion;
  /** Source-line length in meters (> 0). */
  length: number;
  /** Plan direction (need not be unit; exact collinearity via cross/dot). */
  dirX: number;
  dirY: number;
  startZ: number;
  endZ: number;
  /** True for arc-bearing sources (excluded in trp1). */
  isArc: boolean;
  maxSearchDistance: number;
}

export interface AdmitTransitionInput {
  policyVersion: string;
  lawKind: string;
  lawVersion: string;
  criterionFamily: string;
  jointId: string;
  memberIds: readonly [string, string] | readonly string[];
  width: number;
  side: GradingSide;
  /** Group side the transition inherits (must match exactly). */
  groupSide: GradingSide;
  /** False for closed routes (excluded in trp1). */
  isOpen: boolean;
  /** Total transition objects on the group; trp1 allows exactly 1. */
  transitionCount: number;
  /** Authoritative joint Z (must equal both members' joint ends exactly). */
  jointZ: number;
  /** [prev, next] adjacent members at the joint. */
  members: readonly [TransitionMemberGeometry, TransitionMemberGeometry];
}

/** Legacy files carry no `transitions` key at all: behave exactly as today. */
export const hasTransitionIntent = (transitions: unknown): boolean =>
  Array.isArray(transitions) && transitions.length > 0;

/**
 * Phase 20N.1 Wave B — canonical joint index (`joint:<n>`, no leading
 * zeros, non-negative). Null for anything else; never coerces, never
 * sorts — out-of-order/duplicate/malformed intents fail closed upstream.
 */
export const parseCanonicalJointIndex = (jointId: unknown): number | null => {
  if (typeof jointId !== 'string') return null;
  const jointed = /^joint:(\d+)$/.exec(jointId);
  if (jointed === null || jointed[1] !== String(Number(jointed[1]))) return null;
  const index = Number(jointed[1]);
  return Number.isSafeInteger(index) ? index : null;
};

/**
 * Phase 20N.1 Wave B — strict shared-member separation:
 * `W_i/2 + W_{i+1}/2 < L_shared` with EXACT strict `<`, no epsilon.
 * Touching (`==`) and overlap both return false. Malformed inputs
 * (empty, length mismatch, non-finite/non-positive) return false.
 * A lone width (no shared member) is vacuously separated.
 */
export const checkGroupTransitionSeparation = (
  widths: readonly number[],
  sharedLengths: readonly number[],
): boolean => {
  if (widths.length === 0 || sharedLengths.length !== widths.length - 1) return false;
  for (const w of widths) if (!Number.isFinite(w) || !(w > 0)) return false;
  for (const l of sharedLengths) if (!Number.isFinite(l) || !(l > 0)) return false;
  for (let i = 0; i < sharedLengths.length; i += 1) {
    if (!(widths[i]! / 2 + widths[i + 1]! / 2 < sharedLengths[i]!)) return false;
  }
  return true;
};

export type AdmitTransitionResult =
  | {
      ok: true;
      vL: number;
      vR: number;
      sL: number;
      sR: number;
      width: number;
      family: TransitionFamily;
    }
  | { ok: false; code: TransitionRejectCode; detail: string };

const fail = (code: TransitionRejectCode, detail: string): AdmitTransitionResult => ({
  ok: false,
  code,
  detail,
});

const gradeOf = (c: GradingCriterion): number | null => {
  if (c.kind === 'distance' || c.kind === 'elevation' || c.kind === 'relative-elevation')
    return c.gradeRatio;
  return null;
};

const familyOf = (c: GradingCriterion): TransitionFamily | null => {
  if (c.kind === 'distance') return 'distance';
  if (c.kind === 'relative-elevation') return 'relative-elevation';
  if (c.kind === 'elevation') return 'elevation';
  return null;
};

/** Endpoint scalar per family: Distance d, RelEl Δ, flat Elevation E. */
const scalarOf = (c: GradingCriterion, resolvedHorizontal: number): number => {
  if (c.kind === 'distance') return resolvedHorizontal;
  if (c.kind === 'relative-elevation') return c.relativeElevation;
  return (c as Extract<GradingCriterion, { kind: 'elevation' }>).targetElevation;
};

export const admitGradingTransition = (input: AdmitTransitionInput): AdmitTransitionResult => {
  if (!input || !Array.isArray(input.memberIds) || input.memberIds.length !== 2 || !Array.isArray(input.members) || input.members.length !== 2)
    return fail('MALFORMED', 'transition intent requires jointId, 2 memberIds, 2 members');
  if (!input.jointId || typeof input.jointId !== 'string')
    return fail('MALFORMED', 'jointId required');
  if (typeof input.width !== 'number')
    return fail('MALFORMED', 'width must be a number');
  if (input.policyVersion !== TRANSITION_POLICY_VERSION)
    return fail('VERSION_UNKNOWN', `policyVersion ${String(input.policyVersion)} unsupported`);
  if (input.lawKind !== TRANSITION_LAW_KIND || input.lawVersion !== TRANSITION_LAW_VERSION)
    return fail('LAW_UNKNOWN', `law ${String(input.lawKind)}/${String(input.lawVersion)} unsupported`);
  if (input.transitionCount !== 1)
    return fail('CARDINALITY', 'trp1 admits exactly one transition per group');
  if (!input.isOpen) return fail('CLOSED', 'closed routes excluded');
  const [left, right] = input.members;
  if (input.memberIds[0] !== left.memberId || input.memberIds[1] !== right.memberId)
    return fail('MEMBER_REF_STALE', 'memberIds do not resolve to adjacent members');
  if (left.isArc || right.isArc) return fail('NON_LINE', 'arc-bearing member excluded');
  if (!Number.isFinite(left.length) || !(left.length > 0) || !Number.isFinite(right.length) || !(right.length > 0))
    return fail('MALFORMED', 'member lengths must be finite > 0');
  if (![left.dirX, left.dirY, right.dirX, right.dirY].every(Number.isFinite))
    return fail('MALFORMED', 'member directions must be finite');
  // Exact collinearity: cross == 0, dot > 0 (same plan direction of travel).
  const cross = left.dirX * right.dirY - left.dirY * right.dirX;
  const dot = left.dirX * right.dirX + left.dirY * right.dirY;
  if (!(cross === 0 && dot > 0)) return fail('NON_COLLINEAR', 'source deflection must be exactly 0');
  if (!(left.startZ === left.endZ && right.startZ === right.endZ))
    return fail('NON_FLAT', 'both adjacent members must be exactly flat');
  if (!(left.endZ === right.startZ && left.endZ === input.jointZ))
    return fail('JOINT_Z_STEP', 'joint Z must be exactly continuous');
  if (input.side !== input.groupSide) return fail('SIDE_MISMATCH', 'transition side must equal group side');
  const famL = familyOf(left.criterion);
  const famR = familyOf(right.criterion);
  if (famL === null || famR === null || famL !== famR || famL !== input.criterionFamily)
    return fail('FAMILY_MISMATCH', 'same target-free analytic family required on both sides');
  const gL = gradeOf(left.criterion);
  const gR = gradeOf(right.criterion);
  if (gL === null || gR === null || !(gL === gR))
    return fail('GRADE_MISMATCH', 'exact equal gradeRatio required');
  const w = input.width;
  if (!Number.isFinite(w) || !(w > 0)) return fail('WIDTH_INVALID', 'width must be finite > 0');
  if (!(w <= 2 * Math.min(left.length, right.length)))
    return fail('WIDTH_INFEASIBLE', 'width exceeds 2*min(member lengths)');
  const rL = resolveAnalyticCriterionAt(left.criterion, input.jointZ, left.maxSearchDistance);
  if (!rL.ok) return fail(rL.code === 'MAX_DISTANCE_REACHED' ? 'MAX_SEARCH' : 'NATIVE_CRITERION', `left native: ${rL.detail}`);
  const rR = resolveAnalyticCriterionAt(right.criterion, input.jointZ, right.maxSearchDistance);
  if (!rR.ok) return fail(rR.code === 'MAX_DISTANCE_REACHED' ? 'MAX_SEARCH' : 'NATIVE_CRITERION', `right native: ${rR.detail}`);
  const vL = scalarOf(left.criterion, rL.value.horizontalDistance);
  const vR = scalarOf(right.criterion, rR.value.horizontalDistance);
  if (!Number.isFinite(vL) || !Number.isFinite(vR))
    return fail('NATIVE_CRITERION', 'endpoint scalars must be finite');
  return { ok: true, vL, vR, sL: -w / 2, sR: w / 2, width: w, family: famL };
};

/** Legislated interior law TRANSITION_LINEAR_V1: v(s) = vL + (vR-vL)*t. */
export const evaluateTransitionLinearV1 = (
  vL: number,
  vR: number,
  sL: number,
  sR: number,
  s: number,
): number => {
  const t = (s - sL) / (sR - sL);
  return vL + (vR - vL) * t;
};

/**
 * Transition selection over retained intents (moved from
 * gradingGroupCompute so service-side request assembly reuses the one
 * cardinality gate). Absent/empty = legacy path; exactly one object = the
 * candidate; more than one = CARDINALITY reject under trp1. Content
 * validity is decided at admission, not here.
 */
export type TransitionSelection =
  | { kind: 'absent' }
  | { kind: 'single'; transition: CadGradingTransition }
  | { kind: 'rejected'; code: GroupDiagnosticCode; detail: string };

/**
 * Phase 20N.1 Wave B — GROUP selection authority (decision.md §3).
 * Absent/empty = legacy path; exactly one = the single candidate;
 * N > 1 = the ordered group iff jointIds are canonical `joint:<n>`,
 * strictly increasing with NO gaps (j, j+1, ..., j+N-1) — sparse sets,
 * duplicates, out-of-order, and malformed ids reject fail-closed, NEVER
 * silently reordered/sorted. Content validity stays at per-joint
 * `admitGradingTransition` (transitionCount: 1), not here.
 */
export type GroupTransitionSelection =
  | { kind: 'absent' }
  | { kind: 'single'; transition: CadGradingTransition }
  | { kind: 'group'; transitions: CadGradingTransition[] }
  | { kind: 'rejected'; code: GroupDiagnosticCode; detail: string };

export const selectGroupTransitions = (transitions: unknown): GroupTransitionSelection => {
  if (transitions === undefined) return { kind: 'absent' };
  // Present-but-unreadable intent (non-array field) is retained as invalid
  // intent and fails closed — never the legacy path.
  if (!Array.isArray(transitions)) {
    return {
      kind: 'rejected',
      code: 'TRANSITION_MALFORMED',
      detail: 'GRADING_AGREEMENT_TRANSITION_MALFORMED',
    };
  }
  const intents = transitions.filter(
    (entry): entry is CadGradingTransition => entry !== null && typeof entry === 'object',
  );
  // Structurally non-object entries are present-but-unreadable intent:
  // fail closed, never scrubbed to absence.
  if (intents.length !== transitions.length) {
    return {
      kind: 'rejected',
      code: 'TRANSITION_MALFORMED',
      detail: 'GRADING_AGREEMENT_TRANSITION_MALFORMED',
    };
  }
  if (intents.length === 0) return { kind: 'absent' };
  if (intents.length === 1) return { kind: 'single', transition: intents[0]! };
  const groupReject = (): GroupTransitionSelection => ({
    kind: 'rejected',
    code: 'TRANSITION_REJECTED',
    detail: 'GRADING_AGREEMENT_TRANSITION_CARDINALITY',
  });
  let prev = -1;
  for (const intent of intents) {
    const index = parseCanonicalJointIndex(intent.jointId);
    if (index === null) return groupReject();
    if (prev >= 0 && index !== prev + 1) return groupReject();
    prev = index;
  }
  return { kind: 'group', transitions: intents };
};

/**
 * Narrow compatibility wrapper for N <= 1 (production tiling/services
 * admit at most one transition until Wave E wires the group path).
 * Output is byte-identical to the 20M.2 gate for every input: a valid
 * multi-joint group still rejects here — use `selectGroupTransitions`.
 */
export const selectGroupTransition = (transitions: unknown): TransitionSelection => {
  const selection = selectGroupTransitions(transitions);
  if (selection.kind === 'group') {
    return {
      kind: 'rejected',
      code: 'TRANSITION_REJECTED',
      detail: 'GRADING_AGREEMENT_TRANSITION_CARDINALITY',
    };
  }
  return selection;
};

/**
 * Policy reject → bounded group diagnostic (single mapping shared by the
 * engine solve and service-side request assembly; fail closed, never
 * fallback).
 */
export const transitionRejectGroupCode = (code: TransitionRejectCode): GroupDiagnosticCode => {
  if (code === 'MALFORMED') return 'TRANSITION_MALFORMED';
  if (code === 'VERSION_UNKNOWN' || code === 'LAW_UNKNOWN') return 'TRANSITION_LAW_UNKNOWN';
  if (code === 'MEMBER_REF_STALE' || code === 'NATIVE_CRITERION' || code === 'MAX_SEARCH') {
    return 'TRANSITION_STALE';
  }
  return 'TRANSITION_REJECTED';
};

/**
 * Phase 20N.1 Wave B — GROUP pre-mesh gate (decision.md §3.5), reconciled
 * in Wave F: the scalar/order/separation expectation delegates to the ONE
 * plural authority (`deriveTransitionExpectation` in
 * gradingTopologyExpectation.ts). This helper keeps the bounded policy
 * vocabulary (no new codes) plus the strict canonical `joint:<n>` parse
 * (leading-zero ids never admit); everything else — per-joint width
 * bounds, consecutive order, shared-member exactness, strict separation,
 * and the merged-strip 1/1/1 declaration — comes from the delegate.
 * Whole-group fail-closed; absent intent is handled by
 * `selectGroupTransitions`, not here — this takes a non-empty list.
 */
export interface GroupTransitionExpectationJoint {
  jointId: string;
  /** Explicit total symmetric width W, source-line meters. */
  width: number;
  /** Source-line lengths of the two incident members. */
  memberLengths: readonly [number, number];
  /** False for closed routes (excluded, as in trp1). */
  isOpen: boolean;
}

export type GroupTransitionExpectationOutcome =
  | { ok: true; expectation: GradingTopologyExpectation }
  | { ok: false; code: GroupDiagnosticCode; detail: string };

export const deriveGroupTransitionExpectation = (
  joints: readonly GroupTransitionExpectationJoint[],
): GroupTransitionExpectationOutcome => {
  const malformed = (detail: string): GroupTransitionExpectationOutcome => ({
    ok: false,
    code: 'TRANSITION_MALFORMED',
    detail,
  });
  if (!Array.isArray(joints) || joints.length === 0) {
    return malformed('transition joint list required');
  }
  for (const joint of joints) {
    if (joint === null || typeof joint !== 'object') return malformed('transition joint must be an object');
    if (parseCanonicalJointIndex(joint.jointId) === null) {
      return malformed('canonical joint:<n> order required, never re-sorted');
    }
  }
  const outcome = deriveTransitionExpectation(
    { scope: 'group', closed: false, positiveWidthRegions: 1 },
    joints.map((joint) => ({
      jointId: joint.jointId,
      width: joint.width,
      memberLengths: joint.memberLengths,
      transitionCount: 1,
      isOpen: joint.isOpen,
    })),
  );
  if (outcome.ok) return { ok: true, expectation: outcome.expectation };
  const code: GroupDiagnosticCode =
    outcome.code === 'GRADING_AGREEMENT_TRANSITION_OVERLAP' ||
    outcome.code === 'GRADING_AGREEMENT_TRANSITION_WIDE'
      ? 'TRANSITION_REJECTED'
      : 'TRANSITION_MALFORMED';
  return { ok: false, code, detail: `${outcome.code}: ${outcome.detail}` };
};
