/**
 * Phase 20Q.1 Wave A — sloped+plural whole-group reject + all-flat plural
 * CURRENT guards (TESTS ONLY, green before AND after Waves B-E).
 *
 * Sloped plural stays whole-group rejected (singular scope only in 20Q.1);
 * all-flat 2T/3T/sparse sets stay CURRENT to catch Wave B regressions.
 * Real production entry points only; no study oracle.
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  checkGroupTransitionSeparation,
  deriveGroupTransitionExpectation,
  selectGroupTransition,
  selectGroupTransitions,
  type AdmitTransitionInput,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  planTransitionGroup,
} from '../src/engine/cad/grading/gradingGroupTransitionPlural';
import type { TransitionTileInput } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { stubSlopedFrame } from './cad_grading_transition_sloped_20q1.helpers';
import {
  checkGroupTransitionPlansAgreement,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const GRADE = 0.5;
const JOINT_Z = 10;
const REV = 'ggrev1:20q1-red';
const MAX_SEARCH = 50;
const DIST: GradingCriterion = { kind: 'distance', gradeRatio: GRADE, distance: 5 };

const intent = (joint: number, left: string, right: string, width: number, side: GradingSide = 'left'): CadGradingTransition => ({
  policyVersion: TRANSITION_POLICY_VERSION, jointId: `joint:${joint}`, memberIds: [left, right], width,
  lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: 'distance', side,
});

const flatMembers = (lengths: readonly number[]): ResolvedGradingSource[] => {
  let x = 0;
  return lengths.map((len) => {
    const m: ResolvedGradingSource = {
      startX: x, startY: 0, endX: x + len, endY: 0,
      startZ: JOINT_Z, endZ: JOINT_Z, length: len, reoriented: false, isArc: false,
    };
    x += len;
    return m;
  });
};

const slopedMembers = (): ResolvedGradingSource[] => [
  { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 8, endZ: JOINT_Z, length: 30, reoriented: false, isArc: false },
  { startX: 30, startY: 0, endX: 80, endY: 0, startZ: JOINT_Z, endZ: JOINT_Z, length: 50, reoriented: false, isArc: false },
  { startX: 80, startY: 0, endX: 110, endY: 0, startZ: JOINT_Z, endZ: JOINT_Z, length: 30, reoriented: false, isArc: false },
];

const tileInput = (keys: string[]): TransitionTileInput => ({
  side: 'left', revision: REV, maxSearchDistance: MAX_SEARCH, transition: undefined, transitionMemberKeys: keys,
});

const viewsOf = (lengths: readonly number[], zOf: (_i: number) => readonly [number, number]): GroupTransitionMemberView[] =>
  lengths.map((len, _i) => {
    const [sZ, eZ] = zOf(_i);
    return {
      memberId: `M${_i}`, criterion: DIST, length: len, dirX: len, dirY: 0,
      startZ: sZ, endZ: eZ, isArc: false, maxSearchDistance: MAX_SEARCH,
    };
  });

const planOf = (joint: number, width: number, jointStation: number, evidence: { vL: number; vR: number }): GroupTransitionPlan => ({
  policyVersion: TRANSITION_POLICY_VERSION, jointId: `joint:${joint}`,
  memberIds: [`M${joint}`, `M${joint + 1}`], width,
  lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: 'distance', side: 'left',
  groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
  endpointEvidence: { ...evidence, gL: GRADE, gR: GRADE }, jointStation, recordedRevision: REV,
});

const flatEvidence = (width: number): { vL: number; vR: number } => {
  const member = (id: string): AdmitTransitionInput['members'][number] => ({
    memberId: id, criterion: DIST, length: 30, dirX: 30, dirY: 0,
    startZ: JOINT_Z, endZ: JOINT_Z, isArc: false, maxSearchDistance: MAX_SEARCH,
  });
  const out = admitGradingTransition({
    policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width,
    side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
    members: [member('L'), member('R')],
  });
  if (!out.ok) throw new Error('flat control must admit');
  return { vL: out.vL, vR: out.vR };
};

describe('20Q.1 guards: sloped+plural whole-group rejects', () => {
  it('narrow N<=1 wrapper rejects 2 intents at CARDINALITY (flat or sloped)', () => {
    for (const intents of [
      [intent(0, 'M0', 'M1', 8), intent(1, 'M1', 'M2', 8)],
      [intent(0, 'M0', 'M1', 8), intent(1, 'M1', 'M2', 8)],
    ]) {
      const sel = selectGroupTransition(intents);
      expect(sel.kind).toBe('rejected');
      if (sel.kind === 'rejected') {
        expect(sel.code).toBe('TRANSITION_REJECTED');
        expect(sel.detail).toBe('GRADING_AGREEMENT_TRANSITION_CARDINALITY');
      }
    }
    expect(selectGroupTransitions([intent(0, 'M0', 'M1', 8), intent(1, 'M1', 'M2', 8)]).kind).toBe('group');
  });

  it('group compute rejects any-sloped-joint whole-group at TRANSITION_REJECTED/NON_FLAT', () => {
    const intents = [intent(0, 'M0', 'M1', 8), intent(1, 'M1', 'M2', 8)];
    const members = slopedMembers();
    const out = planTransitionGroup(
      tileInput(['M0', 'M1', 'M2']), intents, members, () => DIST,
      members.map((m) => stubSlopedFrame(m.length, m.endZ, 5)), 2,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('TRANSITION_REJECTED');
      expect(out.detail).toContain('NON_FLAT');
    }
  });

  it('worker plans-agreement rejects the sloped joint inside a 2-plan group', () => {
    const ev = flatEvidence(8);
    const views: GroupTransitionMemberView[][] = [
      viewsOf([30, 50], (i) => (i === 0 ? [8, JOINT_Z] : [JOINT_Z, JOINT_Z])),
      viewsOf([50, 30], () => [JOINT_Z, JOINT_Z] as const).map((v, k) => ({ ...v, memberId: `M${k + 1}` })),
    ];
    const out = checkGroupTransitionPlansAgreement({
      plans: [planOf(0, 8, 30, ev), planOf(1, 8, 80, ev)],
      views, liveRevision: REV,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
  });
});

describe('20Q.1 guards: all-flat 2T/3T/sparse sets stay CURRENT', () => {
  it.each([
    { name: '2T consecutive', lengths: [30, 50, 30], joints: [0, 1], widths: [8, 8] },
    { name: '3T consecutive', lengths: [30, 50, 40, 30], joints: [0, 1, 2], widths: [8, 8, 8] },
    { name: '2T sparse gap', lengths: [30, 50, 40, 30], joints: [0, 2], widths: [8, 8] },
  ])('$name admits every joint + group expectation CURRENT', ({ lengths, joints, widths }) => {
    const members = flatMembers(lengths);
    const keys = lengths.map((_, i) => `M${i}`);
    const intents = joints.map((j, k) => intent(j, `M${j}`, `M${j + 1}`, widths[k]!));
    const stations: number[] = [];
    let acc = 0;
    for (const len of lengths) {
      acc += len;
      stations.push(acc);
    }
    const exp = deriveGroupTransitionExpectation(
      joints.map((j, k) => ({
        jointId: `joint:${j}`, width: widths[k]!, memberLengths: [lengths[j]!, lengths[j + 1]!] as const, isOpen: true,
      })),
      joints.slice(1).map((j, k) => stations[j]! - stations[joints[k]!]!),
    );
    expect(exp.ok).toBe(true);
    expect(checkGroupTransitionSeparation(
      widths, joints.slice(1).map((j, k) => stations[j]! - stations[joints[k]!]!),
    )).toBe(true);
    const out = planTransitionGroup(
      tileInput(keys), intents, members, () => DIST,
      members.map((m) => stubSlopedFrame(m.length, m.endZ, 5)), members.length - 1,
    );
    expect(out.ok).toBe(true);
  });

  it('worker plans-agreement CURRENT on all-flat 2T with live evidence', () => {
    const ev = flatEvidence(8);
    const views: GroupTransitionMemberView[][] = [
      viewsOf([30, 50], () => [JOINT_Z, JOINT_Z] as const),
      viewsOf([50, 30], () => [JOINT_Z, JOINT_Z] as const).map((v, k) => ({ ...v, memberId: `M${k + 1}` })),
    ];
    const out = checkGroupTransitionPlansAgreement({
      plans: [planOf(0, 8, 30, ev), planOf(1, 8, 80, ev)],
      views, liveRevision: REV,
    });
    expect(out.ok).toBe(true);
  });
});
