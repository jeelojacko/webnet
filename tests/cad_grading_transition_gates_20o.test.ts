/**
 * Phase 20O — non-collinear transition forensics: gates + topology study
 * (STUDY ONLY, zero `src/` changes).
 *
 * Pins the live `trp1` fail-closed boundary (production admits strictly
 * collinear, exactly-flat, same-family, equal-grade, open same-side joints
 * only; every non-collinear deflection rejects at `NON_COLLINEAR`), the
 * adversarial reject table, and two topology negative controls proving the
 * production gtop2 certificate validates a DECLARED law but never chooses
 * one. Finally pins the worker-basis gap: the worker agreement/result
 * validators cannot express a non-collinear plan and fail closed.
 *
 * Every authority is imported read-only (admission, authoring mirror,
 * generation-2 topology certificate, worker agreement, the 20N study
 * bridge laws). No production predicate, tolerance, or law is re-derived.
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  transitionRejectGroupCode,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { transitionJointEligibility } from '../src/engine/cad/grading/gradingTransitionAuthoring';
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
  gradingTopologyCertificateExactError,
  gradingTopologyCertificateProductionError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import {
  checkGroupTransitionAgreement,
  validateTransitionResultMesh,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import {
  CANDIDATE_B_FAMILIES,
  candidateBPlanCurve,
  candidateBSegment,
} from '../scripts/phase20nTransitionExpansionStudy';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const deg = (d: number): number => (d * Math.PI) / 180;
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const L: TransitionMemberGeometry = {
  memberId: 'L',
  criterion: DIST(0.5, 5),
  length: 20,
  dirX: 1,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 50,
};
const R: TransitionMemberGeometry = {
  memberId: 'R',
  criterion: DIST(0.5, 7),
  length: 20,
  dirX: 1,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 50,
};

/** Canonical collinear distance joint; overrides express one adversarial delta. */
const joint = (o: Partial<AdmitTransitionInput> = {}): AdmitTransitionInput => ({
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
  members: [{ ...L }, { ...R }],
  ...o,
});

const rejectCode = (input: AdmitTransitionInput): string => {
  const r = admitGradingTransition(input);
  return r.ok ? 'ADMITTED' : r.code;
};

const deflect = (angleDeg: number): AdmitTransitionInput =>
  joint({
    members: [
      { ...L },
      { ...R, dirX: Math.cos(deg(angleDeg)), dirY: Math.sin(deg(angleDeg)) },
    ],
  });

const SIGNED_ANGLES: readonly number[] = [0.1, 1, 5, 15, 30, 45, 90, 135, 170, 179].flatMap(
  (a) => [a, -a] as const,
);

describe('20O.1 trp1 non-collinear gate: EXACT collinearity only', () => {
  it('rejects every signed deflection at NON_COLLINEAR with the exact reason', () => {
    for (const angle of SIGNED_ANGLES) {
      const r = admitGradingTransition(deflect(angle));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('NON_COLLINEAR');
      expect(r.detail).toBe('source deflection must be exactly 0');
    }
  });

  it('admits only the exact 0 deflection (both signed zero spellings)', () => {
    for (const a of [0, -0, 0.1, -0.1]) {
      const r = admitGradingTransition(deflect(a));
      // `=== 0` matches signed zero as well; -0 is admitted exactly like +0.
      if (a === 0) {
        expect(r.ok).toBe(true);
        if (r.ok) expect([r.vL, r.vR, r.sL, r.sR]).toEqual([5, 7, -4, 4]);
      } else {
        expect(r.ok).toBe(false);
      }
    }
  });

  it('authoring mirror reports the same bounded reason string', () => {
    const authoringReason = (angleDeg: number): string => {
      const group: CadGradingGroup = {
        id: 'gg',
        name: 'gg',
        sourceFeatureLineId: 'fl',
        sourceCourses: [
          { vertexAId: 'a', vertexBId: 'b' },
          { vertexAId: 'b', vertexBId: 'c' },
        ],
        side: 'left',
        criterion: DIST(0.5, 5),
        maxSearchDistance: 50,
        curveChordTolerance: 0.01,
        cornerMode: 'miter',
      };
      const prev: ResolvedGradingSource = {
        startX: 0, startY: 0, endX: 20, endY: 0, startZ: 10, endZ: 10,
        length: 20, reoriented: false, isArc: false,
      };
      const next: ResolvedGradingSource = {
        startX: 20, startY: 0,
        endX: 20 + 20 * Math.cos(deg(angleDeg)), endY: 20 * Math.sin(deg(angleDeg)),
        startZ: 10, endZ: 10, length: 20, reoriented: false, isArc: false,
      };
      const out = transitionJointEligibility({
        group,
        memberSources: [prev, next],
        memberCriteria: [DIST(0.5, 5), DIST(0.5, 5)],
        side: 'left',
        jointIndex: 0,
      });
      return out.ok ? 'ADMITTED' : out.reason;
    };
    expect(authoringReason(0)).toBe('ADMITTED');
    for (const angle of SIGNED_ANGLES) {
      expect(authoringReason(angle)).toBe('source deflection must be exactly 0 (collinear only)');
    }
  });

  it('policy reject maps to the bounded group diagnostic TRANSITION_REJECTED', () => {
    expect(transitionRejectGroupCode('NON_COLLINEAR')).toBe('TRANSITION_REJECTED');
  });
});

describe('20O.2 adversarial reject table: every malformed/inadmissible joint fails closed', () => {
  const cases: ReadonlyArray<{ name: string; input: AdmitTransitionInput; code: string }> = [
    {
      name: '180 antiparallel',
      input: joint({ members: [{ ...L }, { ...R, dirX: -1, dirY: 0 }] }),
      code: 'NON_COLLINEAR',
    },
    { name: 'zero width', input: joint({ width: 0 }), code: 'WIDTH_INVALID' },
    { name: 'negative width', input: joint({ width: -8 }), code: 'WIDTH_INVALID' },
    { name: 'NaN width', input: joint({ width: Number.NaN }), code: 'WIDTH_INVALID' },
    { name: 'Infinity width', input: joint({ width: Number.POSITIVE_INFINITY }), code: 'WIDTH_INVALID' },
    { name: 'width beyond member', input: joint({ width: 41 }), code: 'WIDTH_INFEASIBLE' },
    {
      name: 'family mismatch',
      input: joint({
        members: [
          { ...L },
          { ...R, criterion: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 } },
        ],
      }),
      code: 'FAMILY_MISMATCH',
    },
    {
      name: 'criterionFamily mismatch',
      input: joint({ criterionFamily: 'relative-elevation' }),
      code: 'FAMILY_MISMATCH',
    },
    {
      name: 'grade mismatch',
      input: joint({ members: [{ ...L }, { ...R, criterion: DIST(0.4, 7) }] }),
      code: 'GRADE_MISMATCH',
    },
    { name: 'side mismatch', input: joint({ side: 'right', groupSide: 'left' }), code: 'SIDE_MISMATCH' },
    { name: 'sloped source', input: joint({ members: [{ ...L, endZ: 11 }, { ...R, startZ: 11 }] }), code: 'NON_FLAT' },
    { name: 'joint-Z step', input: joint({ members: [{ ...L }, { ...R, startZ: 11, endZ: 11 }] }), code: 'JOINT_Z_STEP' },
    { name: 'arc member', input: joint({ members: [{ ...L }, { ...R, isArc: true }] }), code: 'NON_LINE' },
    { name: 'closed group', input: joint({ isOpen: false }), code: 'CLOSED' },
    { name: 'second transition', input: joint({ transitionCount: 2 }), code: 'CARDINALITY' },
    { name: 'stale member ref', input: joint({ memberIds: ['L', 'X'] }), code: 'MEMBER_REF_STALE' },
  ];

  it.each(cases)('$name rejects at $code', ({ input, code }) => {
    expect(rejectCode(input)).toBe(code);
  });

  it('the collinear control admits cleanly (same builder, no overrides)', () => {
    const r = admitGradingTransition(joint());
    expect(r.ok).toBe(true);
  });
});

/* ── 20O.3 topology negative controls ──────────────────────────────────────
 * Two study bridge laws over the SAME source polyline and the SAME declared
 * expectation (one open strip, 1 component / 1 cycle) produce materially
 * different daylight geometry. Both certify and revalidate: gtop2 validates
 * the DECLARED topology of whichever geometry it is handed, it never chooses
 * the law. A deliberately wrong expectation does not certify. */

type Pt = { x: number; y: number; z: number };

const studyStrips = (): { source: Pt[]; nlerp: Pt[]; heading: Pt[]; maxSep: number } => {
  const spec = CANDIDATE_B_FAMILIES[0]!;
  const seg = candidateBSegment(spec, 45, 'identity');
  const samples = 201;
  const source: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const s = -seg.width / 2 + (i / (samples - 1)) * seg.width;
    source.push(
      s <= 0
        ? { x: seg.V.x + seg.tL.x * s, y: seg.V.y + seg.tL.y * s, z: 0 }
        : { x: seg.V.x + seg.tR.x * s, y: seg.V.y + seg.tR.y * s, z: 0 },
    );
  }
  const nlerp = candidateBPlanCurve(seg, 'nlerp', samples).map((p) => ({ x: p.x, y: p.y, z: 0 }));
  const heading = candidateBPlanCurve(seg, 'heading', samples).map((p) => ({ x: p.x, y: p.y, z: 0 }));
  let maxSep = 0;
  for (let i = 0; i < samples; i += 1) {
    maxSep = Math.max(maxSep, Math.hypot(nlerp[i]!.x - heading[i]!.x, nlerp[i]!.y - heading[i]!.y));
  }
  return { source, nlerp, heading, maxSep };
};

const flat = (pts: readonly Pt[]): number[] => pts.flatMap((p) => [p.x, p.y, p.z]);

const certify = (source: Pt[], daylight: Pt[], regions: number) => {
  const built = buildGradingStripMesh(source, daylight);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error('unreachable');
  const expectation = deriveGradingTopologyExpectation({ scope: 'group', closed: false, positiveWidthRegions: regions });
  const cert = buildGradingTopologyCertificateExact({
    scope: 'group',
    points: built.points,
    triangles: built.triangles,
    expectation,
    sourceBoundaryPoints: flat(source),
    gradingBoundaryPoints: flat(daylight),
  });
  return { built, cert, boundaries: { sourceBoundaryPoints: flat(source), gradingBoundaryPoints: flat(daylight) } };
};

describe('20O.3 topology negative control: gtop2 validates a chosen law, never chooses it', () => {
  const { source, nlerp, heading, maxSep } = studyStrips();

  it('the two bridge laws diverge materially and dwarf the agreement band', () => {
    expect(maxSep).toBeGreaterThan(0);
    const band = coordinateAgreementTol(maxSep, 0, Math.max(1, maxSep));
    expect(maxSep).toBeGreaterThan(band * 1e3);
  });

  it.each([
    ['nlerp', nlerp],
    ['heading', heading],
  ] as const)('%s strip measures one positive-width region and certifies', (_name, daylight) => {
    expect(countPositiveWidthRegions(source, daylight)).toBe(1);
    const { built, cert, boundaries } = certify(source, daylight, 1);
    expect(cert).not.toBeNull();
    expect(cert).toMatchObject({ scope: 'group', expectedComponents: 1, expectedBoundaryCycles: 1, components: 1, boundaryCycles: 1 });
    expect(
      gradingTopologyCertificateExactError(cert ?? undefined, 'group', { points: built.points, triangles: built.triangles }, boundaries),
    ).toBeNull();
    expect(
      gradingTopologyCertificateProductionError(cert ?? undefined, 'group', { points: built.points, triangles: built.triangles }, boundaries),
    ).toBeNull();
  });

  it('both geometries certify against the same expectation while mesh digests differ', () => {
    const a = certify(source, nlerp, 1);
    const b = certify(source, heading, 1);
    expect(a.cert).not.toBeNull();
    expect(b.cert).not.toBeNull();
    expect(a.cert!.meshDigest).not.toBe(b.cert!.meshDigest);
    expect(a.cert!.sourceBoundaryDigest).toBe(b.cert!.sourceBoundaryDigest);
  });

  it('a deliberately wrong expectation (2 regions) does not certify a one-strip mesh', () => {
    const { cert } = certify(source, nlerp, 2);
    expect(cert).toBeNull();
  });
});

/* ── 20O.4 worker-basis gap ────────────────────────────────────────────────
 * The worker re-admits the persisted plan (NON_COLLINEAR → bounded reject)
 * and its result validator derives ONE side normal from the source chord,
 * so a law-correct non-collinear study bridge is OFF_LAW. The collinear
 * control passes, isolating the missing non-collinear plan/frame basis. */

const workerPlan = (): GroupTransitionPlan => ({
  policyVersion: TRANSITION_POLICY_VERSION,
  jointId: 'joint:0',
  memberIds: ['L', 'R'],
  width: 8,
  lawKind: TRANSITION_LAW_KIND,
  lawVersion: TRANSITION_LAW_VERSION,
  criterionFamily: 'distance',
  side: 'left',
  groupSide: 'left',
  isOpen: true,
  transitionCount: 1,
  jointZ: 10,
  endpointEvidence: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
  jointStation: 0,
  recordedRevision: 'ggrev1:plan',
});

const workerViews = (angleDeg: number): GroupTransitionMemberView[] => [
  { memberId: 'L', criterion: DIST(0.5, 5), length: 20, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
  {
    memberId: 'R',
    criterion: DIST(0.5, 7),
    length: 20,
    dirX: Math.cos(deg(angleDeg)),
    dirY: Math.sin(deg(angleDeg)),
    startZ: 10,
    endZ: 10,
    isArc: false,
    maxSearchDistance: 50,
  },
];

/** 3-checkpoint (sL/0/sR) study bridge built through the study laws. */
const bridgeCheckpoints = (angleDeg: number, probe: 'nlerp' | 'heading') => {
  const spec = CANDIDATE_B_FAMILIES[0]!;
  const seg = candidateBSegment(spec, angleDeg, 'identity');
  const g = (spec.criterionL as { gradeRatio: number }).gradeRatio;
  // Distance family: daylight Z is jointZ + g*d(s) (production result law).
  const zAt = (t: number): number => spec.jointZ + g * (5 + (7 - 5) * t);
  const daylight = candidateBPlanCurve(seg, probe, 3).map((p, i) => ({ x: p.x, y: p.y, z: zAt(i / 2) }));
  const src = (s: number): Pt =>
    s <= 0
      ? { x: seg.V.x + seg.tL.x * s, y: seg.V.y + seg.tL.y * s, z: spec.jointZ }
      : { x: seg.V.x + seg.tR.x * s, y: seg.V.y + seg.tR.y * s, z: spec.jointZ };
  const source = [src(-seg.width / 2), src(0), src(seg.width / 2)];
  return { spec, daylight, source, sL: -seg.width / 2, sR: seg.width / 2 };
};

describe('20O.4 worker-basis gap: no non-collinear plan/frame authority', () => {
  it('checkGroupTransitionAgreement rejects a non-collinear plan fail-closed', () => {
    const out = checkGroupTransitionAgreement(workerPlan(), workerViews(45), 'ggrev1:plan');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
  });

  it('validateTransitionResultMesh accepts the collinear control bridge', () => {
    const { spec, daylight, source, sL, sR } = bridgeCheckpoints(0, 'nlerp');
    expect(
      validateTransitionResultMesh({
        family: 'distance',
        sL,
        sR,
        vL: 5,
        vR: 7,
        daylightCheckpoints: flat(daylight),
        sourceCheckpoints: flat(source),
        criterionL: spec.criterionL,
        criterionR: spec.criterionR,
        jointZ: spec.jointZ,
        maxSearchDistance: spec.maxSearchDistance,
        daylightPoints: flat(daylight),
        sourceBoundaryPoints: flat(source),
        side: 'left',
      }),
    ).toBeNull();
  });

  it('validateTransitionResultMesh rejects the law-correct non-collinear bridge (single-frame basis)', () => {
    for (const probe of ['nlerp', 'heading'] as const) {
      const { spec, daylight, source, sL, sR } = bridgeCheckpoints(45, probe);
      const out = validateTransitionResultMesh({
        family: 'distance',
        sL,
        sR,
        vL: 5,
        vR: 7,
        daylightCheckpoints: flat(daylight),
        sourceCheckpoints: flat(source),
        criterionL: spec.criterionL,
        criterionR: spec.criterionR,
        jointZ: spec.jointZ,
        maxSearchDistance: spec.maxSearchDistance,
        daylightPoints: flat(daylight),
        sourceBoundaryPoints: flat(source),
        side: 'left',
      });
      expect(out).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
    }
  });
});
