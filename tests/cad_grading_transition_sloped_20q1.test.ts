/**
 * Phase 20Q.1 Wave A — singular sloped-source CURRENT contract (TESTS ONLY).
 *
 * RED now: production rejects ALL sloped transitions at NON_FLAT, so every
 * `CURRENT` case below FAILS until Waves B-E land. Green guards (flat
 * golden, 1-ULP, non-collinear, worker sloped-evidence mismatch) must hold
 * before AND after. Real production entry points only; no study oracle.
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  evaluateTransitionLinearV1,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  planTransitionJoint,
  transitionDaylightAt,
  type TransitionTileInput,
} from '../src/engine/cad/grading/gradingGroupTransitionTile';
import {
  checkGroupTransitionAgreement,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { stubSlopedFrame as stubFrame } from './cad_grading_transition_sloped_20q1.helpers';

const GRADE = 0.5;
const JOINT_Z = 10;
const LEN_L = 30;
const LEN_R = 50;
const REV = 'ggrev1:20q1-red';
const MAX_SEARCH = 50;

type Family = 'distance' | 'relative-elevation' | 'elevation';
type SlopeTag = 'EQ_UP' | 'EQ_DOWN' | 'FLAT_UP' | 'UP_FLAT' | 'STEEP_SHALLOW' | 'SHALLOW_STEEP' | 'CREST' | 'SAG';

const criterionOf = (family: Family, scalar: number): GradingCriterion => {
  if (family === 'distance') return { kind: 'distance', gradeRatio: GRADE, distance: scalar };
  if (family === 'relative-elevation') return { kind: 'relative-elevation', gradeRatio: GRADE, relativeElevation: scalar };
  return { kind: 'elevation', gradeRatio: GRADE, targetElevation: scalar };
};

const scalarOf = (family: Family): number => (family === 'distance' ? 5 : family === 'relative-elevation' ? 2.5 : 12.5);

/** Joint-continuous [startL, endL, startR, endR] at JOINT_Z. */
const SLOPES: Record<SlopeTag, readonly [number, number, number, number]> = {
  EQ_UP: [8, 10, 10, 12],
  EQ_DOWN: [12, 10, 10, 8],
  FLAT_UP: [10, 10, 10, 12],
  UP_FLAT: [8, 10, 10, 10],
  STEEP_SHALLOW: [8, 10, 10, 10.5],
  SHALLOW_STEEP: [9.5, 10, 10, 12],
  CREST: [8, 10, 10, 8],
  SAG: [12, 10, 10, 12],
};
const SLOPE_TAGS = Object.keys(SLOPES) as SlopeTag[];
const FAMILIES: Family[] = ['distance', 'relative-elevation', 'elevation'];
const SIDES: GradingSide[] = ['left', 'right'];

const geom = (id: string, criterion: GradingCriterion, len: number, startZ: number, endZ: number): TransitionMemberGeometry => ({
  memberId: id, criterion, length: len, dirX: len, dirY: 0, startZ, endZ, isArc: false, maxSearchDistance: MAX_SEARCH,
});

const admitInput = (family: Family, tag: SlopeTag, side: GradingSide, width: number, lenL: number, lenR: number): AdmitTransitionInput => {
  const [sL, eL, sR, eR] = SLOPES[tag]!;
  const c = criterionOf(family, scalarOf(family));
  return {
    policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: family, jointId: 'joint:0', memberIds: ['L', 'R'], width, side, groupSide: side,
    isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
    members: [geom('L', c, lenL, sL, eL), geom('R', c, lenR, sR, eR)],
  };
};

const resolvedChain = (tag: SlopeTag, lenL: number, lenR: number): ResolvedGradingSource[] => {
  const [sL, eL, sR, eR] = SLOPES[tag]!;
  return [
    { startX: 0, startY: 0, endX: lenL, endY: 0, startZ: sL, endZ: eL, length: lenL, reoriented: false, isArc: false },
    { startX: lenL, startY: 0, endX: lenL + lenR, endY: 0, startZ: sR, endZ: eR, length: lenR, reoriented: false, isArc: false },
  ];
};

const tileInput = (family: Family, side: GradingSide, width: number): TransitionTileInput => {
  const intent: CadGradingTransition = {
    policyVersion: TRANSITION_POLICY_VERSION, jointId: 'joint:0', memberIds: ['L', 'R'], width,
    lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: family, side,
  };
  return { side, revision: REV, maxSearchDistance: MAX_SEARCH, transition: intent, transitionMemberKeys: ['L', 'R'] };
};


describe('20Q.1 RED: sloped singular admits as CURRENT (NON_FLAT today)', () => {
  it.each(
    FAMILIES.flatMap((family) => SIDES.flatMap((side) => SLOPE_TAGS.map((tag) => ({ family, side, tag })))),
  )('$family $side $tag admits CURRENT', ({ family, side, tag }) => {
    const out = admitGradingTransition(admitInput(family, tag, side, 8, LEN_L, LEN_L));
    expect(out.ok).toBe(true);
  });

  it.each(
    FAMILIES.flatMap((family) =>
      (['EQ_UP', 'CREST'] as SlopeTag[]).flatMap((tag) =>
        SIDES.flatMap((side) =>
          [
            { width: 2, lenL: LEN_L, lenR: LEN_L },
            { width: 8, lenL: LEN_L, lenR: LEN_L },
            { width: 2 * LEN_L, lenL: LEN_L, lenR: LEN_L },
            { width: 2, lenL: LEN_L, lenR: LEN_R },
            { width: 8, lenL: LEN_L, lenR: LEN_R },
            { width: 2 * LEN_L, lenL: LEN_L, lenR: LEN_R },
          ].map((w) => ({ family, side, tag, ...w })),
        ),
      ),
    ),
  )('$family $side $tag W=$width L=[$lenL,$lenR] admits CURRENT', ({ family, side, tag, width, lenL, lenR }) => {
    const out = admitGradingTransition(admitInput(family, tag, side, width, lenL, lenR));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.sL).toBe(-width / 2);
      expect(out.sR).toBe(width / 2);
      expect(out.family).toBe(family);
    }
  });
});

describe('20Q.1 RED: sloped joint plan is CURRENT with per-station-Z daylight', () => {
  it.each(
    FAMILIES.flatMap((family) => SIDES.flatMap((side) => (['EQ_UP', 'CREST'] as SlopeTag[]).map((tag) => ({ family, side, tag })))),
  )('$family $side $tag plans CURRENT, joint-Z continuous', ({ family, side, tag }) => {
    const c = criterionOf(family, scalarOf(family));
    const out = planTransitionJoint(
      tileInput(family, side, 8), resolvedChain(tag, LEN_L, LEN_L),
      () => c, [stubFrame(LEN_L, JOINT_Z, 5), stubFrame(LEN_L, JOINT_Z, 5)], 1,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Source joint stays exactly on the original geometry (V.z = jointZ).
    expect(out.plan.srcFlat[5]).toBe(JOINT_Z);
    expect(out.plan.jointStation).toBe(LEN_L);
    expect(out.plan.law.family).toBe(family);
    const v0 = evaluateTransitionLinearV1(out.plan.law.vL, out.plan.law.vR, out.plan.law.sL, out.plan.law.sR, 0);
    // S1 joint daylight: V1 scalar at the JOINT plan station (LEN_L, 0)
    // with the joint source Z. The tie is daylight-side (Z + g·v), never
    // the source V — joint-Z continuity lives in srcFlat, not in tie z.
    const q = transitionDaylightAt(family, v0, GRADE, JOINT_Z, LEN_L, 0, 0, 1);
    expect([q.x, q.y, q.z]).toEqual([out.plan.tieXyz[0], out.plan.tieXyz[1], out.plan.tieXyz[2]]);
  });

  it('daylight formulas use per-station source Z, never a frozen jointZ', () => {
    for (const z of [JOINT_Z, JOINT_Z + 2]) {
      const dist = transitionDaylightAt('distance', 5, GRADE, z, 0, 0, 0, 1);
      expect([dist.d, dist.z]).toEqual([5, z + GRADE * 5]);
      const rel = transitionDaylightAt('relative-elevation', 2.5, GRADE, z, 0, 0, 0, 1);
      expect([rel.d, rel.z]).toEqual([2.5 / GRADE, z + 2.5]);
      const elev = transitionDaylightAt('elevation', 12.5, GRADE, z, 0, 0, 0, 1);
      expect([elev.d, elev.z]).toEqual([(12.5 - z) / GRADE, 12.5]);
    }
  });
});

describe('20Q.1 guards: flat golden + rejections hold before AND after', () => {
  it.each(FAMILIES)('%s flat pair pins byte-identical golden admission', (family) => {
    const c = criterionOf(family, scalarOf(family));
    const input: AdmitTransitionInput = {
      policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: family, jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
      members: [geom('L', c, LEN_L, JOINT_Z, JOINT_Z), geom('R', c, LEN_L, JOINT_Z, JOINT_Z)],
    };
    const out = admitGradingTransition(input);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out).sort()).toEqual(['family', 'ok', 'sL', 'sR', 'vL', 'vR', 'width']);
    expect([out.sL, out.sR, out.width, out.family]).toEqual([-4, 4, 8, family]);
    expect(out.vL).toBe(out.vR);
    expect(out.vL).toBe(scalarOf(family));
  });

  it('1-ULP joint-Z step rejects; 1-ULP joint-continuous slope admits exact (no epsilon)', () => {
    const step = JOINT_Z + Number.EPSILON * 8;
    expect(step).not.toBe(JOINT_Z);
    expect(step - JOINT_Z).toBe(Number.EPSILON * 8);
    const c = criterionOf('distance', 5);
    const stepped: AdmitTransitionInput = {
      policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
      members: [geom('L', c, LEN_L, JOINT_Z, JOINT_Z), geom('R', c, LEN_L, step, step)],
    };
    const rStep = admitGradingTransition(stepped);
    expect(rStep.ok).toBe(false);
    if (!rStep.ok) expect(rStep.code).toBe('JOINT_Z_STEP');
    // 20Q.1 S1: joint-continuous sloped admits at ANY nonzero slope —
    // exact `===` throughout, so even 1 ULP of slope is sloped, not flat.
    const sloped: AdmitTransitionInput = {
      ...stepped,
      members: [geom('L', c, LEN_L, JOINT_Z, JOINT_Z), geom('R', c, LEN_L, JOINT_Z, step)],
    };
    const rSlope = admitGradingTransition(sloped);
    expect(rSlope.ok).toBe(true);
    if (rSlope.ok) {
      expect(rSlope.family).toBe('distance');
      expect([rSlope.sL, rSlope.sR]).toEqual([-4, 4]);
    }
  });

  it('non-collinear rejects (deflection + reversal)', () => {
    const c = criterionOf('distance', 5);
    const flat = (): AdmitTransitionInput => ({
      policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
      members: [geom('L', c, LEN_L, JOINT_Z, JOINT_Z), geom('R', c, LEN_L, JOINT_Z, JOINT_Z)],
    });
    const bent = flat();
    bent.members[1]!.dirY = 0.001;
    const rBent = admitGradingTransition(bent);
    expect(rBent.ok).toBe(false);
    if (!rBent.ok) expect(rBent.code).toBe('NON_COLLINEAR');
    const rev = flat();
    rev.members[1]!.dirX = -LEN_L;
    const rRev = admitGradingTransition(rev);
    expect(rRev.ok).toBe(false);
    if (!rRev.ok) expect(rRev.code).toBe('NON_COLLINEAR');
  });

  it('worker agreement holds on sloped members when evidence matches; tampered evidence rejects', () => {
    const c = criterionOf('distance', 5);
    const flatAdmit = admitGradingTransition({
      policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
      members: [geom('L', c, LEN_L, JOINT_Z, JOINT_Z), geom('R', c, LEN_L, JOINT_Z, JOINT_Z)],
    });
    expect(flatAdmit.ok).toBe(true);
    if (!flatAdmit.ok) return;
    const [sL, eL, sR, eR] = SLOPES.CREST!;
    const members: GroupTransitionMemberView[] = [
      { ...geom('L', c, LEN_L, sL, eL) }, { ...geom('R', c, LEN_L, sR, eR) },
    ];
    const plan: GroupTransitionPlan = {
      policyVersion: TRANSITION_POLICY_VERSION, jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: 'distance', side: 'left',
      groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
      endpointEvidence: { vL: flatAdmit.vL, vR: flatAdmit.vR, gL: GRADE, gR: GRADE },
      jointStation: LEN_L, recordedRevision: REV,
    };
    // 20Q.1 S1: singular sloped admits, and distance scalars are
    // slope-independent — flat-pinned evidence matches the sloped
    // re-resolution exactly, so agreement holds.
    const out = checkGroupTransitionAgreement(plan, members, REV);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([out.vL, out.vR]).toEqual([flatAdmit.vL, flatAdmit.vR]);
    const tampered: GroupTransitionPlan = {
      ...plan,
      endpointEvidence: { ...plan.endpointEvidence, vL: plan.endpointEvidence.vL + 1 },
    };
    expect(checkGroupTransitionAgreement(tampered, members, REV).ok).toBe(false);
  });
});
