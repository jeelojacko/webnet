/**
 * Phase 20M.2 WAVE B/C/D — trp1 admission authority RED→green pins.
 *
 * Covers all admitted families + every WAVE A exclusion. Exact checks only.
 */
import { describe, expect, it } from 'vitest';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  hasTransitionIntent,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';

const member = (o: Partial<TransitionMemberGeometry> & { memberId: string }): TransitionMemberGeometry => ({
  criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
  length: 20,
  dirX: 1,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 10,
  ...o,
});

const base = (): AdmitTransitionInput => ({
  policyVersion: 'trp1',
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  jointId: 'joint:1',
  memberIds: ['A>B', 'B>C'],
  width: 8,
  side: 'left',
  groupSide: 'left',
  isOpen: true,
  transitionCount: 1,
  jointZ: 10,
  members: [member({ memberId: 'A>B' }), member({ memberId: 'B>C', criterion: { kind: 'distance', gradeRatio: 0.5, distance: 7 } , dirX: 2, dirY: 0 })],
});

const codeOf = (input: AdmitTransitionInput): string => {
  const r = admitGradingTransition(input);
  expect(r.ok).toBe(false);
  return (r as { ok: false; code: string }).code;
};

describe('20M.2 trp1 admission', () => {
  it('admits distance/relEl/flat-elevation with endpoint scalars + linear law', () => {
    const d = admitGradingTransition(base());
    expect(d).toMatchObject({ ok: true, vL: 5, vR: 7, sL: -4, sR: 4 });
    const rel: AdmitTransitionInput = {
      ...base(),
      criterionFamily: 'relative-elevation',
      members: [
        member({ memberId: 'A>B', criterion: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 } }),
        member({ memberId: 'B>C', criterion: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 4 }, dirX: 2, dirY: 0 }),
      ],
    };
    expect(admitGradingTransition(rel)).toMatchObject({ ok: true, vL: 2, vR: 4 });
    const elev: AdmitTransitionInput = {
      ...base(),
      criterionFamily: 'elevation',
      members: [
        member({ memberId: 'A>B', criterion: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 12 }, maxSearchDistance: 100 }),
        member({ memberId: 'B>C', criterion: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 14 }, dirX: 2, dirY: 0, maxSearchDistance: 100 }),
      ],
    };
    expect(admitGradingTransition(elev)).toMatchObject({ ok: true, vL: 12, vR: 14 });
    // Linear law: endpoints exact, midpoint interpolates.
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, -4)).toBe(5);
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, 4)).toBe(7);
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, 0)).toBe(6);
  });

  it('rejects grade mismatch', () => {
    const i = base();
    i.members = [i.members[0], { ...i.members[1], criterion: { kind: 'distance', gradeRatio: 0.75, distance: 7 } }];
    expect(codeOf(i)).toBe('GRADE_MISMATCH');
  });

  it('rejects non-collinear deflection', () => {
    const i = base();
    i.members = [i.members[0], { ...i.members[1], dirX: 0, dirY: 1 }];
    expect(codeOf(i)).toBe('NON_COLLINEAR');
  });

  it('rejects arc, closed, sloped, joint-step', () => {
    const arc = base();
    arc.members = [{ ...arc.members[0], isArc: true }, arc.members[1]];
    expect(codeOf(arc)).toBe('NON_LINE');
    expect(codeOf({ ...base(), isOpen: false })).toBe('CLOSED');
    const sloped = base();
    sloped.members = [{ ...sloped.members[0], startZ: 10, endZ: 11 }, sloped.members[1]];
    expect(codeOf(sloped)).toBe('NON_FLAT');
    const step = base();
    step.members = [step.members[0], { ...step.members[1], startZ: 11, endZ: 11 }];
    expect(codeOf(step)).toBe('JOINT_Z_STEP');
  });

  it('rejects surface/hybrid and mixed families', () => {
    const s = base();
    s.members = [{ ...s.members[0], criterion: { kind: 'fixed', gradeRatio: 0.5 } }, s.members[1]];
    expect(codeOf(s)).toBe('FAMILY_MISMATCH');
    const cut = base();
    cut.members = [{ ...cut.members[0], criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: 0.5 } }, cut.members[1]];
    expect(codeOf(cut)).toBe('FAMILY_MISMATCH');
    const mixed = base();
    mixed.members = [mixed.members[0], { ...mixed.members[1], criterion: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 3 } }];
    expect(codeOf(mixed)).toBe('FAMILY_MISMATCH');
  });

  it('rejects side mismatch', () => {
    expect(codeOf({ ...base(), groupSide: 'right' })).toBe('SIDE_MISMATCH');
  });

  it('width: invalid rejects, exact-max admits, over-max rejects', () => {
    for (const w of [0, -4, NaN, Infinity]) expect(codeOf({ ...base(), width: w })).toBe('WIDTH_INVALID');
    const max = base();
    max.members = [{ ...max.members[0], length: 20 }, { ...max.members[1], length: 12 }];
    expect(admitGradingTransition({ ...max, width: 24 }).ok).toBe(true);
    expect(codeOf({ ...max, width: 24.002 })).toBe('WIDTH_INFEASIBLE');
    const short = base();
    short.members = [{ ...short.members[0], length: 20 }, { ...short.members[1], length: 6 }];
    expect(codeOf({ ...short, width: 20 })).toBe('WIDTH_INFEASIBLE');
  });

  it('rejects second transition, unknown law/version, stale refs, malformed', () => {
    expect(codeOf({ ...base(), transitionCount: 2 })).toBe('CARDINALITY');
    expect(codeOf({ ...base(), lawKind: 'SMOOTH' })).toBe('LAW_UNKNOWN');
    expect(codeOf({ ...base(), lawVersion: 'v2' })).toBe('LAW_UNKNOWN');
    expect(codeOf({ ...base(), policyVersion: 'trp2' })).toBe('VERSION_UNKNOWN');
    expect(codeOf({ ...base(), memberIds: ['X>Y', 'B>C'] })).toBe('MEMBER_REF_STALE');
    expect(codeOf({ ...base(), jointId: '' })).toBe('MALFORMED');
  });

  it('rejects native resolver and maxSearch failures', () => {
    const beyond = base();
    beyond.members = [{ ...beyond.members[0], maxSearchDistance: 1 }, beyond.members[1]];
    expect(codeOf(beyond)).toBe('MAX_SEARCH');
    const wrong = base();
    wrong.criterionFamily = 'elevation';
    wrong.members = [
      { ...wrong.members[0], criterion: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 8 }, maxSearchDistance: 100 },
      { ...wrong.members[1], criterion: { kind: 'elevation', gradeRatio: 0.5, targetElevation: 14 }, maxSearchDistance: 100 },
    ];
    expect(codeOf(wrong)).toBe('NATIVE_CRITERION');
  });

  it('legacy files without transition key stay untouched (no admission)', () => {
    expect(hasTransitionIntent(undefined)).toBe(false);
    expect(hasTransitionIntent([])).toBe(false);
    expect(hasTransitionIntent([{ jointId: 'joint:1' }])).toBe(true);
  });
});
