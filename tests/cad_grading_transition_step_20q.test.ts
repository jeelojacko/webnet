/**
 * Phase 20Q — joint-Z-step study pins (STUDY ONLY, zero `src/` changes).
 *
 * Pins the production freeze (joint-Z steps fail closed at JOINT_Z_STEP
 * through admission and joint planning, and at the corner-mismatch
 * detail on the compute path), exact 1-ULP step classification (never
 * epsilon-tied), zero-step J-law reduction, and J-law properties via
 * the study oracles. J1/J3/J4 nonzero-step rows refuse gtop2: the code
 * is recorded, 1/1/1 is never asserted. J4 reversal asymmetry is pinned
 * per family (exact only outside elevation; elevation is record-only).
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { planTransitionJoint, type MemberSolve, type TransitionTileInput } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import { buildGradingTopologyCertificateExact } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { toGroupSolveInput, type GradingGroupComputeRequest } from '../src/workers/surfaceWorkerHandler';
import {
  buildPhase20qCases,
  classifyPhase20qStep,
  PHASE20Q_ULP_STEP,
  type Phase20qCase,
} from '../scripts/phase20qFixtures';
import {
  checkFlatReductionExact,
  evaluatePhase20qLaw,
  phase20qHybridPoints,
  phase20qStations,
  PHASE20Q_S3_TAU,
  type Phase20qLawId,
} from '../scripts/phase20qLaws';
import { phase20qWorkerFacts } from '../scripts/phase20qEvidence';
import {
  persistPhase20qInputs,
  phase20qIndependentRecompute,
  phase20qPerCheckpointSourceZExtension,
  phase20qSourceZAwareCheck,
  phase20qWidthTamperViaValidator,
} from '../scripts/phase20qRecheck';
import { phase20qTransformDeviations } from '../scripts/phase20qTransforms';

const GRADE = 0.5;
const Z = 10;
const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

const member = (id: string, startZ: number, endZ: number): TransitionMemberGeometry => ({
  memberId: id,
  criterion: DIST(5),
  length: 30,
  dirX: 30,
  dirY: 0,
  startZ,
  endZ,
  isArc: false,
  maxSearchDistance: 50,
});

const input = (step: number): AdmitTransitionInput => ({
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
  jointZ: Z,
  members: [member('L', Z, Z), member('R', Z + step, Z + step)],
});

const stepCases = (): Phase20qCase[] => buildPhase20qCases().filter((c) => c.matrix === 'step');
const stepped = (): Phase20qCase[] => stepCases().filter((c) => c.step !== 0);
const zeroStep = (): Phase20qCase[] => stepCases().filter((c) => c.step === 0);

describe('20Q.5 production freeze: joint-Z steps fail closed', () => {
  it('admission rejects every step incl. 1 ULP at JOINT_Z_STEP (zero-step admits)', () => {
    for (const step of [PHASE20Q_ULP_STEP, -PHASE20Q_ULP_STEP, 0.001, 1, 10]) {
      const r = admitGradingTransition(input(step));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('JOINT_Z_STEP');
        expect(r.detail).toBe('joint Z must be exactly continuous');
      }
    }
    expect(admitGradingTransition(input(0)).ok).toBe(true);
  });

  it('joint planning maps the step reject to bounded TRANSITION codes', () => {
    const intent: CadGradingTransition = {
      policyVersion: TRANSITION_POLICY_VERSION,
      jointId: 'joint:0',
      memberIds: ['L', 'R'],
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
      { startX: 0, startY: 0, endX: 30, endY: 0, startZ: Z, endZ: Z, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 0, endX: 80, endY: 0, startZ: Z + 1, endZ: Z + 1, length: 50, reoriented: false, isArc: false },
    ];
    const out = planTransitionJoint(tile, members, () => DIST(5), [] as unknown as MemberSolve[], 1);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('TRANSITION_REJECTED');
      expect(out.detail).toContain('GRADING_AGREEMENT_TRANSITION_JOINT_Z_STEP');
    }
  });

  it('compute rejects stepped members at the corner-mismatch gate', () => {
    const sources: ResolvedGradingSource[] = [
      { startX: 0, startY: 0, endX: 30, endY: 0, startZ: Z, endZ: Z, length: 30, reoriented: false, isArc: false },
      { startX: 30, startY: 0, endX: 80, endY: 0, startZ: Z + 1, endZ: Z + 1, length: 50, reoriented: false, isArc: false },
    ];
    const request: GradingGroupComputeRequest = {
      groupId: 'g',
      revision: 'ggrev1:phase20q-study',
      memberSources: sources,
      side: 'left',
      criterion: DIST(5),
      memberCriteria: [DIST(5), DIST(7)],
      maxSearchDistance: 50,
      curveChordTolerance: 0.01,
      closed: false,
    };
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('CORNER_INVERTED');
      expect(outcome.detail).toBe('GRADING_GROUP_CORNER_MISMATCH');
    }
  });
});

describe('20Q.6 exact steps: 1 ULP is a step, never silently tied', () => {
  it('ULP pos/neg classify as step; zero classifies continuous (exact ===)', () => {
    expect(PHASE20Q_ULP_STEP === 0).toBe(false);
    for (const c of stepCases().filter((c) => c.slopePattern === 'STEP' && Math.abs(c.step) === PHASE20Q_ULP_STEP)) {
      expect(c.step === 0).toBe(false);
      expect(classifyPhase20qStep(c)).toBe('step');
    }
    for (const c of zeroStep()) {
      expect(c.step === 0).toBe(true);
      expect(classifyPhase20qStep(c)).toBe('continuous');
    }
  });

  it('every nonzero-step row in the matrix classifies as step', () => {
    for (const c of stepped()) {
      expect(c.step === 0).toBe(false);
      expect(classifyPhase20qStep(c)).toBe('step');
    }
  });
});

describe('20Q.7 zero-reduction: zero-step J laws reduce exactly', () => {
  it('step-m0 reduces bitwise-exact on J1-J4; every stepped row is out of scope', () => {
    for (const c of zeroStep()) {
      for (const law of ['J1', 'J2', 'J3', 'J4'] as const) {
        const r = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
        expect(checkFlatReductionExact(c, r)).toBe(true);
      }
    }
    for (const c of stepped()) {
      const r = evaluatePhase20qLaw('J1', c, phase20qStations(c), PHASE20Q_S3_TAU);
      expect(checkFlatReductionExact(c, r)).toBeNull();
    }
  });
});

describe('20Q.8 J-law properties (study oracles, production checks)', () => {
  const certOf = (c: Phase20qCase, law: Phase20qLawId): string | null => {
    const points = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU);
    const source = points.map((p) => ({ x: p.srcX, y: p.srcY, z: p.srcZ }));
    const daylight = points.map((p) => ({ x: p.dayX, y: p.dayY, z: p.dayZ }));
    const built = buildGradingStripMesh(source, daylight);
    if (!built.ok) return `mesh:${built.code}`;
    const expectation = deriveTransitionExpectation(
      { scope: 'group', closed: false, positiveWidthRegions: 0 },
      { jointId: 'joint:0', width: c.W, memberLengths: [c.LL, c.LR] as readonly [number, number], transitionCount: 1, isOpen: true },
    );
    if (!expectation.ok) return `expectation:${expectation.code}`;
    const flat = (pts: readonly { x: number; y: number; z: number }[]): number[] => pts.flatMap((p) => [p.x, p.y, p.z]);
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group', points: built.points, triangles: built.triangles,
      expectation: expectation.expectation, sourceBoundaryPoints: flat(source), gradingBoundaryPoints: flat(daylight),
    });
    return cert === null ? 'gtop2-refused' : `certified:${cert.components}/${cert.boundaryCycles}`;
  };

  it('J1/J3/J4 nonzero-step refuse gtop2 (code recorded, 1/1/1 never asserted)', () => {
    for (const law of ['J1', 'J3', 'J4'] as const) {
      for (const c of stepped()) {
        expect(certOf(c, law)).toBe('gtop2-refused');
      }
    }
  });

  it('J2 is flagged authority-violating with altered source geometry', () => {
    for (const c of stepped()) {
      const r = evaluatePhase20qLaw('J2', c, phase20qStations(c), PHASE20Q_S3_TAU);
      expect(r.rejectReason).toBe('SOURCE_Z_BRIDGED_INVENTED');
      const mid = r.points.find((p) => p.tag === 'jointL')!;
      expect(mid.srcZ).toBe(c.jointZL + (c.jointZR - c.jointZL) * 0.5);
      if (Math.abs(c.step) >= 1e-6) expect(mid.srcZ).not.toBe(c.jointZL);
    }
  });

  it('J4 reversal asymmetry equals |step| exactly outside elevation (record-only in elevation)', () => {
    for (const c of stepped().filter((c) => c.family !== 'elevation')) {
      expect(phase20qTransformDeviations(c, 'J4').reversal).toBe(Math.abs(c.step));
    }
    for (const c of stepped().filter((c) => c.family === 'elevation')) {
      const reversal = phase20qTransformDeviations(c, 'J4').reversal;
      expect(typeof reversal).toBe('number');
      expect(Number.isFinite(reversal as number)).toBe(true);
    }
  });

  it('worker agreement fails closed on every nonzero-step J row', () => {
    for (const law of ['J1', 'J2', 'J3', 'J4'] as const) {
      for (const c of stepped().filter((c) => c.W === 10 && c.side === 'left')) {
        expect(phase20qWorkerFacts(c, law).agreement).toBe('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
      }
    }
  });
});

describe('20Q.16 B2/B3 on step laws: per-family PASS/FAIL + persisted recompute', () => {
  it('J1 passes the source-Z-aware check on every step row (physical law)', () => {
    for (const c of stepCases()) {
      expect(phase20qSourceZAwareCheck(c, 'J1')).toBe('PASS');
    }
  });

  it('stepped J2/J4 fail with bounded codes (bridged source / fixed-Z daylight)', () => {
    for (const c of stepped()) {
      expect(phase20qSourceZAwareCheck(c, 'J2')).toBe('study-sourceZ-divergent');
      expect(phase20qSourceZAwareCheck(c, 'J4')).toBe('study-daylight-divergent');
    }
    for (const c of zeroStep()) {
      expect(phase20qSourceZAwareCheck(c, 'J2')).toBe('PASS');
      expect(phase20qSourceZAwareCheck(c, 'J4')).toBe('PASS');
    }
  });

  it('persisted independent recompute matches on step rows; width tamper caught flat', () => {
    for (const c of stepCases().filter((c) => c.W === 10 && c.side === 'left')) {
      const w = phase20qWorkerFacts(c, 'J1');
      const ind = phase20qIndependentRecompute(persistPhase20qInputs(c, 'J1'), w.recomputeVL, w.recomputeVR);
      expect(ind.error).toBeNull();
      expect(ind.matchVsRow).toBe(true);
    }
    for (const c of zeroStep()) {
      const t = phase20qWidthTamperViaValidator(c, 'J1');
      expect(t.untampered).toBeNull();
      expect(t.caught).toBe(true);
    }
  });
});

describe('20Q.17b M1/M2 on step laws: extension proof + width accounting', () => {
  it('per-checkpoint-source-Z extension passes every step J1 row (physical law)', () => {
    for (const c of stepCases()) {
      expect(phase20qPerCheckpointSourceZExtension(c, 'J1')).toBe('PASS');
    }
  });

  it('M2 step-J1 width accounting: 76 applicable caught, 80 inapplicable, 0 missed', () => {
    let caught = 0;
    let inapplicable = 0;
    let missed = 0;
    for (const c of stepCases()) {
      const t = phase20qWidthTamperViaValidator(c, 'J1');
      if (t.caught) caught += 1;
      else if (!t.applicable) {
        inapplicable += 1;
        expect(t.untampered).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
      } else missed += 1;
    }
    expect([caught, inapplicable, missed]).toEqual([76, 80, 0]);
  });
});
