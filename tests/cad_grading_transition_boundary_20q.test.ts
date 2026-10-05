/**
 * Phase 20Q — boundary/invalid pins and no-overclaim guards (STUDY ONLY,
 * zero `src/` changes).
 *
 * Every malformed or inadmissible joint fails closed through the single
 * production authority (`admitGradingTransition`, never a re-derived
 * gate) with a bounded `TransitionRejectCode`. The no-overclaim guards
 * pin what the study does NOT establish: no C1 continuity (admission
 * carries no tangent authority), per-family behavior pinned separately
 * (never unified from single-family evidence), and no widening of
 * NON_COLLINEAR or of production admission.
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
  type TransitionRejectCode,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { planTransitionJoint, type TransitionTileInput } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const GRADE = 0.5;
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const RELEL = (g: number, v: number): GradingCriterion => ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: v });
const ELEV = (g: number, v: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: v });
const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });

const member = (id: string, o: Partial<TransitionMemberGeometry> = {}): TransitionMemberGeometry => ({
  memberId: id,
  criterion: DIST(GRADE, 5),
  length: 30,
  dirX: 30,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 50,
  ...o,
});

const base = (o: Partial<AdmitTransitionInput> = {}): AdmitTransitionInput => ({
  policyVersion: TRANSITION_POLICY_VERSION,
  lawKind: TRANSITION_LAW_KIND,
  lawVersion: TRANSITION_LAW_VERSION,
  criterionFamily: 'distance',
  jointId: 'joint:0',
  memberIds: ['L', 'R'],
  width: 8,
  side: 'left',
  groupSide: 'left',
  isOpen: true,
  transitionCount: 1,
  jointZ: 10,
  members: [member('L', { criterion: DIST(GRADE, 5) }), member('R', { criterion: DIST(GRADE, 7) })],
  ...o,
});

const BOUNDED: readonly TransitionRejectCode[] = [
  'MALFORMED', 'VERSION_UNKNOWN', 'LAW_UNKNOWN', 'CARDINALITY', 'CLOSED',
  'NON_LINE', 'NON_FLAT', 'JOINT_Z_STEP', 'SIDE_MISMATCH', 'FAMILY_MISMATCH',
  'GRADE_MISMATCH', 'NON_COLLINEAR', 'WIDTH_INVALID', 'WIDTH_INFEASIBLE',
  'MEMBER_REF_STALE', 'NATIVE_CRITERION', 'MAX_SEARCH',
];

const codeOf = (input: AdmitTransitionInput): TransitionRejectCode => {
  const r = admitGradingTransition(input);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('expected reject');
  expect(BOUNDED).toContain(r.code);
  return r.code;
};

describe('20Q.9 invalid numerics fail closed with bounded codes', () => {
  it.each([
    ['NaN jointZ', base({ jointZ: Number.NaN })],
    ['Inf jointZ', base({ jointZ: Number.POSITIVE_INFINITY })],
    ['NaN member endZ', base({ members: [member('L', { endZ: Number.NaN }), member('R')] })],
    ['NaN member startZ', base({ members: [member('L'), member('R', { startZ: Number.NaN })] })],
    ['Inf member endZ', base({ members: [member('L', { endZ: Number.POSITIVE_INFINITY }), member('R')] })],
    ['NaN gradeRatio', base({ members: [member('L', { criterion: DIST(Number.NaN, 5) }), member('R')] })],
    ['Inf gradeRatio', base({ members: [member('L', { criterion: DIST(Number.POSITIVE_INFINITY, 5) }), member('R')] })],
    ['NaN scalar', base({ members: [member('L', { criterion: DIST(GRADE, Number.NaN) }), member('R')] })],
    ['Inf scalar', base({ members: [member('L', { criterion: DIST(GRADE, Number.POSITIVE_INFINITY) }), member('R')] })],
  ])('%s rejects', (_name, input) => {
    codeOf(input);
  });
});

describe('20Q.10 invalid width and structural mismatch fail closed', () => {
  it.each([
    ['zero width', base({ width: 0 }), 'WIDTH_INVALID'],
    ['negative width', base({ width: -8 }), 'WIDTH_INVALID'],
    ['NaN width', base({ width: Number.NaN }), 'WIDTH_INVALID'],
    ['Inf width', base({ width: Number.POSITIVE_INFINITY }), 'WIDTH_INVALID'],
    ['infeasible width', base({ width: 61 }), 'WIDTH_INFEASIBLE'],
    ['grade mismatch', base({ members: [member('L'), member('R', { criterion: DIST(0.4, 7) })] }), 'GRADE_MISMATCH'],
    ['family mismatch', base({ members: [member('L'), member('R', { criterion: RELEL(GRADE, 2) })] }), 'FAMILY_MISMATCH'],
    ['criterionFamily mismatch', base({ criterionFamily: 'elevation' }), 'FAMILY_MISMATCH'],
    ['side mismatch', base({ side: 'right' }), 'SIDE_MISMATCH'],
    ['non-collinear 5deg', base({ members: [member('L'), member('R', { dirX: 29.885, dirY: 2.615 })] }), 'NON_COLLINEAR'],
    ['arc member', base({ members: [member('L'), member('R', { isArc: true })] }), 'NON_LINE'],
    ['closed route', base({ isOpen: false }), 'CLOSED'],
    ['surface criterion', base({ members: [member('L', { criterion: FIXED(GRADE) }), member('R', { criterion: FIXED(GRADE) })] }), 'FAMILY_MISMATCH'],
    ['hybrid surface+analytic', base({ members: [member('L'), member('R', { criterion: FIXED(GRADE) })] }), 'FAMILY_MISMATCH'],
    ['stale member ref', base({ memberIds: ['L', 'X'] }), 'MEMBER_REF_STALE'],
    ['second transition', base({ transitionCount: 2 }), 'CARDINALITY'],
    ['unknown policy version', base({ policyVersion: 'trpX' }), 'VERSION_UNKNOWN'],
    ['unknown law', base({ lawKind: 'NOPE' }), 'LAW_UNKNOWN'],
    ['malformed members', base({ memberIds: ['L'], members: [member('L')] as unknown as AdmitTransitionInput['members'] }), 'MALFORMED'],
  ] as const)('%s rejects at %s', (_name, input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it('relative-elevation and elevation controls admit (family evidence stays per family)', () => {
    const rel = base({
      criterionFamily: 'relative-elevation',
      members: [member('L', { criterion: RELEL(GRADE, 2.5) }), member('R', { criterion: RELEL(GRADE, 3.5) })],
    });
    expect(admitGradingTransition(rel).ok).toBe(true);
    const elev = base({
      criterionFamily: 'elevation',
      members: [member('L', { criterion: ELEV(GRADE, 12.5) }), member('R', { criterion: ELEV(GRADE, 13.5) })],
    });
    expect(admitGradingTransition(elev).ok).toBe(true);
  });
});

describe('20Q.10b stale refs fail closed on the joint-planning path', () => {
  it('mismatched member keys reject at TRANSITION_STALE', () => {
    const intent: CadGradingTransition = {
      policyVersion: TRANSITION_POLICY_VERSION,
      jointId: 'joint:0',
      memberIds: ['L', 'X'],
      width: 8,
      lawKind: TRANSITION_LAW_KIND,
      lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance',
      side: 'left',
    };
    const tile: TransitionTileInput = {
      side: 'left', revision: 'ggrev1:phase20q-study', maxSearchDistance: 50,
      transition: intent, transitionMemberKeys: ['L', 'R'],
    };
    const members: ResolvedGradingSource[] = [
      { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 0, endX: 80, endY: 0, startZ: 10, endZ: 10, length: 50, reoriented: false, isArc: false },
    ];
    const out = planTransitionJoint(tile, members, () => DIST(GRADE, 5), [], 1);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('TRANSITION_STALE');
      expect(out.detail).toContain('GRADING_AGREEMENT_TRANSITION_STALE');
    }
  });
});

describe('20Q.11 no overclaim: study pins boundaries, never new authority', () => {
  it('admission carries no tangent (C1) authority: admitted shape is exactly the trp1 record', () => {
    const r = admitGradingTransition(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r).sort()).toEqual(['family', 'ok', 'sL', 'sR', 'vL', 'vR', 'width']);
  });

  it('NON_COLLINEAR is not widened: 0.1deg still rejects, exact 0 still admits', () => {
    const tiny = base({ members: [member('L'), member('R', { dirX: 29.99995, dirY: 0.05236 })] });
    expect(codeOf(tiny)).toBe('NON_COLLINEAR');
    expect(admitGradingTransition(base()).ok).toBe(true);
  });
});
