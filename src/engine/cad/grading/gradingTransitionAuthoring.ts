/**
 * Phase 20M.2 WAVE H — transition authoring (pure, additive).
 *
 * Phase 20N.1 extends this to the authorized plural set: explicit user-owned
 * per-joint intents (policyVersion `trp1`), each with an explicit numeric
 * total width and the single registered TRANSITION_LINEAR_V1 law. Phase 20P.1
 * authorizes SPARSE sets: SET appends/replaces by jointId and always emits a
 * canonical STRICTLY INCREASING joint-index list (gaps allowed); an
 * out-of-order/duplicate/malformed set fails closed and is never silently
 * sorted. CLEAR drops only the named joint and the last removal drops the key,
 * restoring the legacy definition byte-identically. No auto-width, no implicit
 * creation, no per-joint defaults. Structural eligibility reuses the single
 * admission authority (`admitGradingTransition`); width + strict separation
 * are validated at commit only when real station geometry is supplied.
 *
 * Sanitation (persistence) always retains loaded intent order verbatim; the
 * policy gate rejects malformed/duplicate/out-of-order loads — nothing
 * is repaired to a default.
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
  checkSlopedPluralUnstudied,
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

/**
 * Wave C geometry context (optional). The commit path validates width
 * feasibility and strict separation BEFORE commit only when the caller can
 * supply real geometry: per-joint incident lengths for width, plus optional
 * full-chain `memberStations` for true cross-gap separation. Without
 * `memberStations` the authoring never invents a gap and the compute fails
 * closed instead.
 */
export interface TransitionAuthoringGeometry {
  /** Incident source-line lengths per joint id, as [previous, next]. */
  jointMemberLengths: Readonly<Record<string, readonly [number, number]>>;
  /**
   * Optional full-chain cumulative end-stations (same addition order as
   * `computeJointStations`): station[j] is the end station of member j, so
   * the joint-j station is `memberStations[j]`. When present, separation
   * across ANY joint pair uses the true station gap; when absent the
   * immediate-member check holds only for consecutive joints and gapped
   * pairs are left to the compute to fail closed (no invented gap).
   */
  memberStations?: readonly number[];
}

const fail = (error: string): GradingAuthoringResult<CadGradingGroup> => ({ ok: false, error });

/**
 * Parse a canonical `joint:<n>` id (no leading zeros, non-negative);
 * anything else is malformed (never coerced). Non-canonical spellings
 * such as `joint:01` reject HERE at SET so no intent is written that the
 * compute would reject downstream.
 */
const jointIndexOf = (jointId: string): number | null => {
  const m = /^joint:(\d+)$/.exec(jointId);
  if (!m || m[1] !== String(Number(m[1]))) return null;
  return Number(m[1]);
};

/**
 * Canonical-order gate: joint ids must be strictly increasing (gaps allowed
 * — sparse sets are authorized). Duplicates / out-of-order / malformed REJECT
 * (fail closed) — an out-of-order or duplicate list is never silently sorted.
 */
const canonicalJointOrderError = (transitions: readonly TransitionPersistedIntent[]): string | null => {
  const indices: number[] = [];
  for (const transition of transitions) {
    const index = jointIndexOf(transition.jointId);
    if (index === null) return `malformed transition jointId ${JSON.stringify(transition.jointId)}`;
    indices.push(index);
  }
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i]! <= indices[i - 1]!) {
      return 'transition joints must be canonical strictly increasing';
    }
  }
  return null;
};

/** True station gap between two parsed joints, or null when not resolvable. */
const stationGap = (
  stations: readonly number[] | undefined,
  left: number | null,
  right: number | null,
): number | null => {
  if (!stations || left === null || right === null) return null;
  const from = stations[left];
  const to = stations[right];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to! - from!;
};

/** Width feasibility + strict separation, only when real geometry exists. */
const geometryError = (
  transitions: readonly TransitionPersistedIntent[],
  context: TransitionAuthoringGeometry,
): string | null => {
  const lengths = transitions.map((transition) => context.jointMemberLengths[transition.jointId]);
  for (let i = 0; i < transitions.length; i += 1) {
    const jointId = transitions[i]!.jointId;
    const pair = lengths[i];
    if (!pair || !pair.every((value) => Number.isFinite(value) && value > 0)) {
      return `member lengths unavailable for ${jointId}`;
    }
    if (!(transitions[i]!.width <= 2 * Math.min(pair[0], pair[1]))) {
      return `width exceeds 2×min(member lengths) at ${jointId}`;
    }
  }
  const stations = context.memberStations;
  for (let i = 0; i + 1 < transitions.length; i += 1) {
    const leftJoint = jointIndexOf(transitions[i]!.jointId);
    const rightJoint = jointIndexOf(transitions[i + 1]!.jointId);
    const halfSpan = transitions[i]!.width / 2 + transitions[i + 1]!.width / 2;
    // Full-chain context: the TRUE station gap spans every skipped joint.
    if (stations !== undefined) {
      const gap = stationGap(stations, leftJoint, rightJoint);
      if (gap === null) return `station positions unavailable for ${transitions[i + 1]!.jointId}`;
      if (halfSpan === gap) return 'touching transitions are not authorized';
      if (halfSpan > gap) return 'overlapping transitions are not authorized';
      continue;
    }
    // Incident-length context sees ONLY a shared member: check consecutive
    // pairs, and leave gapped pairs to the compute (never invent a gap).
    if (leftJoint === null || rightJoint === null || rightJoint !== leftJoint + 1) continue;
    const gap = lengths[i]![1];
    if (gap !== lengths[i + 1]![0]) return 'adjacent joints must share one member length exactly';
    if (halfSpan === gap) return 'touching transitions are not authorized';
    if (halfSpan > gap) return 'overlapping transitions are not authorized';
  }
  return null;
};

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
  const jointId = `joint:${jointIndex}`;
  const memberIds: [string, string] = [keyOf(group, pair.prev), keyOf(group, pair.next)];
  const prev = memberGeometry(memberSources, memberCriteria, memberIds[0], pair.prev, group.maxSearchDistance);
  const next = memberGeometry(memberSources, memberCriteria, memberIds[1], pair.next, group.maxSearchDistance);
  if (!prev || !next) return { ok: false, reason: 'member source/criterion unavailable at this joint' };
  // Phase 20Q.1 singular scope: this joint would form/extend a plural set
  // while ANY transitioned joint is non-flat — ineligible (the compute
  // whole-group rejects such sets; per-joint admission still owns content).
  const retained = groupTransitions(group).filter((entry) => entry.jointId !== jointId);
  if (retained.length > 0) {
    const joints: number[] = [];
    for (const entry of retained) {
      const index = jointIndexOf(entry.jointId);
      if (index === null) return { ok: false, reason: `malformed transition jointId ${JSON.stringify(entry.jointId)}` };
      joints.push(index);
    }
    joints.push(jointIndex);
    const flat: boolean[] = [];
    for (const index of joints) {
      const a = memberSources[index];
      const b = memberSources[index + 1];
      if (!a || !b) return { ok: false, reason: 'member source/criterion unavailable at this joint' };
      flat.push(a.startZ === a.endZ && b.startZ === b.endZ);
    }
    if (checkSlopedPluralUnstudied(joints.length, flat) !== null) {
      return { ok: false, reason: 'plural transition sets on non-flat joints are unstudied (singular sloped only)' };
    }
  }
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

/**
 * Commit ONE per-joint transition. Same-joint writes REPLACE in place; a new
 * joint APPENDS into canonical strictly increasing joint-index order (sparse
 * sets authorized). Any write that would leave a duplicate / out-of-order set
 * fails closed (never silently sorted). When geometry context is supplied,
 * width feasibility + strict separation are validated before commit;
 * otherwise the compute fails closed.
 */
export const setGroupTransition = (
  current: CadGradingGroup,
  intent: TransitionPersistedIntent,
  geometry?: TransitionAuthoringGeometry,
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
  const nextIndex = jointIndexOf(intent.jointId);
  const jointCount = Math.max(0, current.sourceCourses.length - 1);
  if (nextIndex === null || nextIndex < 0 || nextIndex >= jointCount) {
    return fail(`jointId ${intent.jointId} is not an open traversal joint`);
  }
  const expectedMemberIds: [string, string] = [keyOf(current, nextIndex), keyOf(current, nextIndex + 1)];
  if (intent.memberIds[0] !== expectedMemberIds[0] || intent.memberIds[1] !== expectedMemberIds[1]) {
    return fail('memberIds do not resolve to the adjacent courses at this joint');
  }
  const existing = groupTransitions(current);
  const existingError = canonicalJointOrderError(existing);
  if (existingError) return fail(existingError);
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
  // Replace-by-jointId, then re-append in canonical joint-index order.
  const merged = existing.filter((entry) => entry.jointId !== intent.jointId);
  merged.push(next);
  merged.sort((a, b) => (jointIndexOf(a.jointId) ?? 0) - (jointIndexOf(b.jointId) ?? 0));
  const mergedError = canonicalJointOrderError(merged);
  if (mergedError) return fail(mergedError);
  if (geometry) {
    const invalid = geometryError(merged, geometry);
    if (invalid) return fail(invalid);
  }
  return { ok: true, value: { ...current, transitions: merged } as CadGradingGroup };
};

/**
 * Removal drops only the named joint; the last removal drops the whole key
 * and restores the legacy definition byte-identically. Omitting `jointId`
 * clears every transition (legacy single-transition callers).
 */
export const clearGroupTransition = (
  current: CadGradingGroup,
  jointId?: string,
): GradingAuthoringResult<CadGradingGroup> => {
  const existing = groupTransitions(current);
  if (existing.length === 0) return fail('no transition to remove');
  const remaining = jointId === undefined ? [] : existing.filter((entry) => entry.jointId !== jointId);
  if (jointId !== undefined && remaining.length === existing.length) {
    return fail(`no transition at ${jointId}`);
  }
  if (remaining.length === 0) {
    const { transitions: _dropped, ...rest } = current as GroupTransitionDefinition;
    return { ok: true, value: rest };
  }
  return { ok: true, value: { ...current, transitions: remaining } as CadGradingGroup };
};
