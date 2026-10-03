/**
 * Phase 20M.2 WAVE H — transition authoring (pure, additive).
 *
 * Explicit user-owned transition intent only: ONE transition at a valid
 * joint, explicit numeric total width, law selector fixed to the single
 * registered TRANSITION_LINEAR_V1 (version persisted). No auto-width, no
 * implicit creation, no per-joint defaults. Structural eligibility reuses
 * the single admission authority (`admitGradingTransition`); width is
 * validated separately at commit. Removal drops the key and restores the
 * legacy definition byte-identically.
 *
 * TODO(20M.2 sibling): `ggrev1:` participation + persistence round-trip
 * belong to the sibling persistence/revision wave — a transition edit goes
 * through history and must be recalculated, but the revision string cannot
 * move until the canonical writer lands. The panel says so truthfully.
 */
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from './gradingTypes';
import type { CadGradingGroup } from './gradingGroupTypes';
import type { GradingAuthoringResult } from './gradingAuthoring';
import { courseCriterionKey } from './gradingGroupCourseCriteria';
import {
  admitGradingTransition,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  type TransitionMemberGeometry,
} from './gradingTransitionPolicy';
import type { TransitionPersistedIntent } from './gradingTransitionProvenance';

export type GroupTransitionDefinition = CadGradingGroup & {
  transitions?: TransitionPersistedIntent[];
};

/** Transitions carried on a definition (absent key = legacy, untouched). */
export const groupTransitions = (group: CadGradingGroup): TransitionPersistedIntent[] =>
  (group as GroupTransitionDefinition).transitions ?? [];

const fail = (error: string): GradingAuthoringResult<CadGradingGroup> => ({ ok: false, error });

/** Adjacent traversal course pair at joint j: courses j and j+1. */
const adjacentPair = (
  group: CadGradingGroup,
  jointIndex: number,
): { prev: number; next: number } | null => {
  if (!Number.isInteger(jointIndex) || jointIndex < 0) return null;
  if (jointIndex + 1 >= group.sourceCourses.length) return null;
  return { prev: jointIndex, next: jointIndex + 1 };
};

const keyOf = (group: CadGradingGroup, courseIndex: number): string => {
  const course = group.sourceCourses[courseIndex]!;
  return courseCriterionKey(course.vertexAId, course.vertexBId);
};

const memberGeometry = (
  sources: readonly ResolvedGradingSource[],
  criteria: readonly GradingCriterion[],
  memberId: string,
  courseIndex: number,
  maxSearchDistance: number,
): TransitionMemberGeometry | null => {
  const source = sources[courseIndex];
  const criterion = criteria[courseIndex];
  if (!source || !criterion) return null;
  return {
    memberId,
    criterion,
    length: source.length,
    dirX: source.endX - source.startX,
    dirY: source.endY - source.startY,
    startZ: source.startZ,
    endZ: source.endZ,
    isArc: source.isArc,
    maxSearchDistance,
  };
};

export type TransitionEligibility =
  | { ok: true; jointId: string; memberIds: [string, string] }
  | { ok: false; reason: string };

const reasonOf = (code: string): string => {
  switch (code) {
    case 'CLOSED':
      return 'closed routes cannot carry a transition';
    case 'NON_LINE':
      return 'arc-bearing member excluded';
    case 'NON_COLLINEAR':
      return 'source deflection must be exactly 0 (collinear only)';
    case 'NON_FLAT':
      return 'both adjacent members must be exactly flat';
    case 'JOINT_Z_STEP':
      return 'joint Z must be exactly continuous';
    case 'SIDE_MISMATCH':
      return 'transition side must equal the group side';
    case 'FAMILY_MISMATCH':
      return 'both members must share one target-free analytic family';
    case 'GRADE_MISMATCH':
      return 'both members must carry exactly equal gradeRatio';
    case 'MEMBER_REF_STALE':
      return 'member refs no longer resolve to adjacent courses';
    case 'NATIVE_CRITERION':
    case 'MAX_SEARCH':
      return 'native endpoint criterion does not resolve here';
    default:
      return `joint not transition-admissible (${code})`;
  }
};

/**
 * Structural eligibility of joint j (width-independent: width is user input
 * validated at commit). A width probe at the feasibility ceiling isolates
 * structural rejection from width rejection.
 */
export const transitionJointEligibility = (input: {
  group: CadGradingGroup;
  memberSources: readonly ResolvedGradingSource[];
  memberCriteria: readonly GradingCriterion[];
  side: GradingSide;
  jointIndex: number;
}): TransitionEligibility => {
  const { group, memberSources, memberCriteria, side, jointIndex } = input;
  const isOpen = group.closed !== true;
  if (!isOpen) return { ok: false, reason: 'closed routes cannot carry a transition' };
  const pair = adjacentPair(group, jointIndex);
  if (!pair) return { ok: false, reason: 'joint index out of range' };
  const existing = groupTransitions(group);
  if (existing.length > 1) return { ok: false, reason: 'only one transition per group (trp1)' };
  const jointId = `joint:${jointIndex}`;
  const memberIds: [string, string] = [keyOf(group, pair.prev), keyOf(group, pair.next)];
  if (existing.length === 1 && existing[0]!.jointId !== jointId) {
    return { ok: false, reason: 'only one transition per group (trp1)' };
  }
  const prev = memberGeometry(memberSources, memberCriteria, memberIds[0], pair.prev, group.maxSearchDistance);
  const next = memberGeometry(memberSources, memberCriteria, memberIds[1], pair.next, group.maxSearchDistance);
  if (!prev || !next) return { ok: false, reason: 'member source/criterion unavailable at this joint' };
  // Width probe at the feasibility ceiling: WIDTH_* failures are the width
  // input's verdict, not the joint's — everything else rejects the joint.
  const probe = 2 * Math.min(prev.length, next.length);
  const jointZ = memberSources[pair.prev]!.endZ;
  const admitted = admitGradingTransition({
    policyVersion: TRANSITION_POLICY_VERSION,
    lawKind: TRANSITION_LAW_KIND,
    lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: '',
    jointId,
    memberIds,
    width: probe,
    side,
    groupSide: group.side,
    isOpen,
    transitionCount: 1,
    jointZ,
    members: [prev, next],
  });
  if (admitted.ok) return { ok: true, jointId, memberIds };
  // criterionFamily probe is intentionally blank: FAMILY_MISMATCH against a
  // blank probe is inconclusive, so re-probe with the members' own family.
  if (admitted.code === 'FAMILY_MISMATCH') {
    const kinds = new Set([prev.criterion.kind, next.criterion.kind]);
    if (kinds.size !== 1 || !['distance', 'relative-elevation', 'elevation'].includes([...kinds][0]!)) {
      return { ok: false, reason: reasonOf('FAMILY_MISMATCH') };
    }
    const retry = admitGradingTransition({
      policyVersion: TRANSITION_POLICY_VERSION,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: [...kinds][0]!,
      jointId,
      memberIds,
      width: probe,
      side,
      groupSide: group.side,
      isOpen,
      transitionCount: 1,
      jointZ,
      members: [prev, next],
    });
    if (retry.ok) return { ok: true, jointId, memberIds };
    if (retry.code === 'WIDTH_INVALID' || retry.code === 'WIDTH_INFEASIBLE') {
      return { ok: true, jointId, memberIds };
    }
    return { ok: false, reason: reasonOf(retry.code) };
  }
  if (admitted.code === 'WIDTH_INVALID' || admitted.code === 'WIDTH_INFEASIBLE') {
    return { ok: true, jointId, memberIds };
  }
  return { ok: false, reason: reasonOf(admitted.code) };
};

/** Explicit width verdict (finite, > 0, feasible against both members). */
export const validateTransitionWidth = (
  width: number,
  memberLengths: readonly [number, number],
): string | null => {
  if (!Number.isFinite(width) || !(width > 0)) return 'width must be a finite number > 0 (source-line meters)';
  const [a, b] = memberLengths;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a > 0) || !(b > 0)) {
    return 'member lengths unavailable';
  }
  if (!(width <= 2 * Math.min(a, b))) return 'width exceeds 2×min(member lengths)';
  return null;
};

/** Commit ONE explicit transition (same-joint write replaces; other joints reject). */
export const setGroupTransition = (
  current: CadGradingGroup,
  intent: TransitionPersistedIntent,
): GradingAuthoringResult<CadGradingGroup> => {
  if (intent.policyVersion !== TRANSITION_POLICY_VERSION) return fail(`policyVersion ${intent.policyVersion} unsupported`);
  if (intent.lawKind !== TRANSITION_LAW_KIND || intent.lawVersion !== TRANSITION_LAW_VERSION) {
    return fail(`law ${intent.lawKind}/${intent.lawVersion} unsupported`);
  }
  if (typeof intent.jointId !== 'string' || intent.jointId.length === 0) return fail('jointId required');
  if (!Array.isArray(intent.memberIds) || intent.memberIds.length !== 2) return fail('two memberIds required');
  if (!Number.isFinite(intent.width) || !(intent.width > 0)) return fail('width must be finite > 0');
  if (intent.side !== current.side) return fail('transition side must equal the group side');
  if (current.closed === true) return fail('closed routes cannot carry a transition');
  const existing = groupTransitions(current);
  if (existing.length > 0 && existing[0]!.jointId !== intent.jointId) {
    return fail('only one transition per group (trp1)');
  }
  const next: TransitionPersistedIntent = {
    policyVersion: intent.policyVersion,
    jointId: intent.jointId,
    memberIds: [intent.memberIds[0]!, intent.memberIds[1]!],
    width: intent.width,
    lawKind: intent.lawKind,
    lawVersion: intent.lawVersion,
    criterionFamily: intent.criterionFamily,
    side: intent.side,
  };
  return { ok: true, value: { ...current, transitions: [next] } as CadGradingGroup };
};

/** Removal drops the key: the definition is legacy again. */
export const clearGroupTransition = (
  current: CadGradingGroup,
): GradingAuthoringResult<CadGradingGroup> => {
  if (groupTransitions(current).length === 0) return fail('no transition to remove');
  const { transitions: _dropped, ...rest } = current as GroupTransitionDefinition;
  return { ok: true, value: rest };
};
