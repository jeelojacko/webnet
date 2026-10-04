/**
 * Phase 20O — non-collinear plan/frame law decision pins (STUDY ONLY, zero src/ changes).
 *
 * Pins the live trp1 NON_COLLINEAR gate at every study angle, scalar C0 via
 * the production law, per-law endpoint continuity, material divergence of the
 * three candidate laws (separation >> coordinateAgreementTol at realistic
 * angles), exact-0 routing to trp1, antiparallel rejection, byte-identical
 * determinism (double-build + SHA pin), mirror/reversal/translation
 * stability, and a no-src-change guard on the live policy file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  buildAdversarialRows,
  buildFullCorpus,
  buildGridCorpus,
  evalLaw,
  PLAN_LAW_ANGLES_DEG,
  PLAN_LAW_KINDS,
  STUDY_FAMILIES,
  studyJoint,
  type PlanLawKind,
  type StudyFamilySpec,
} from '../scripts/phase20oNoncollinearPlanLawStudy';
import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';

const corpusDir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20o');
const D2R = Math.PI / 180;

const members = (spec: StudyFamilySpec, deltaDeg: number): [TransitionMemberGeometry, TransitionMemberGeometry] => [
  {
    memberId: 'L',
    criterion: spec.criterionL,
    length: 20,
    dirX: 1,
    dirY: 0,
    startZ: spec.jointZ,
    endZ: spec.jointZ,
    isArc: false,
    maxSearchDistance: spec.maxSearchDistance,
  },
  {
    memberId: 'R',
    criterion: spec.criterionR,
    length: 20,
    dirX: Math.cos(deltaDeg * D2R),
    dirY: Math.sin(deltaDeg * D2R),
    startZ: spec.jointZ,
    endZ: spec.jointZ,
    isArc: false,
    maxSearchDistance: spec.maxSearchDistance,
  },
];

const admitCode = (spec: StudyFamilySpec, deltaDeg: number, side: GradingSide): string => {
  const input: AdmitTransitionInput = {
    policyVersion: TRANSITION_POLICY_VERSION,
    lawKind: TRANSITION_LAW_KIND,
    lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: spec.family,
    jointId: 'joint:1',
    memberIds: ['L', 'R'],
    width: 8,
    side,
    groupSide: side,
    isOpen: true,
    transitionCount: 1,
    jointZ: spec.jointZ,
    members: members(spec, deltaDeg),
  };
  const r = admitGradingTransition(input);
  return r.ok ? 'ADMITTED' : r.code;
};

describe('phase20o plan/frame law study', () => {
  it('live trp1 rejects every nonzero study angle at NON_COLLINEAR, admits exact 0', () => {
    for (const spec of STUDY_FAMILIES)
      for (const angle of PLAN_LAW_ANGLES_DEG)
        for (const sign of [1, -1]) {
          expect(admitCode(spec, sign * angle, 'left')).toBe('NON_COLLINEAR');
          expect(admitCode(spec, sign * angle, 'right')).toBe('NON_COLLINEAR');
        }
    for (const spec of STUDY_FAMILIES) expect(admitCode(spec, 0, 'left')).toBe('ADMITTED');
  });

  it('legislated scalar is C0 via the production law on every grid row', () => {
    for (const row of buildGridCorpus()) {
      if (row.laws === null) continue;
      for (const kind of PLAN_LAW_KINDS) {
        const L = row.laws[kind];
        if (!L.ok) continue;
        expect(L.v[0]).toBe(evaluateTransitionLinearV1(row.laws[kind].v[0]!, row.laws[kind].v[L.v.length - 1]!, -row.W / 2, row.W / 2, -row.W / 2));
        expect(L.v[L.v.length - 1]).toBe(
          evaluateTransitionLinearV1(L.v[0]!, L.v[L.v.length - 1]!, -row.W / 2, row.W / 2, row.W / 2),
        );
        // Midpoint station (s=0) carries the exact legislated mid scalar, not just endpoints.
        const mid = (L.v.length - 1) / 2;
        expect(L.v[mid]).toBe(
          evaluateTransitionLinearV1(L.v[0]!, L.v[L.v.length - 1]!, -row.W / 2, row.W / 2, 0),
        );
      }
    }
  });

  it('every admitted law curve is endpoint-continuous (C0) by construction', () => {
    let checked = 0;
    for (const row of buildGridCorpus()) {
      if (row.laws === null || !row.widthFeasible) continue;
      for (const kind of PLAN_LAW_KINDS) {
        const L = row.laws[kind];
        if (!L.ok) continue;
        expect(L.c0).toBe(true);
        const tol = coordinateAgreementTol(L.p[0]!.x, L.p[0]!.x, 20);
        expect(L.endPosResidL).toBeLessThanOrEqual(tol);
        expect(L.endPosResidR).toBeLessThanOrEqual(tol);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('candidate laws diverge materially at realistic angles (separation >> agreement tol)', () => {
    const scale = 20;
    const tol = coordinateAgreementTol(10, 12, scale);
    expect(tol).toBeGreaterThan(0);
    for (const angle of [1, 5, 45, 179]) {
      const rows = buildGridCorpus().filter(
        (r) => r.angleDeg === angle && r.widthClass === 'comfortable-equal' && r.widthFeasible,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const d = row.divergence!;
        // Hermite-vs-frame laws differ by decimetres even at 1deg: no unique path.
        expect(d.headingHermite! / tol).toBeGreaterThan(1000);
        expect(d.nlerpHermite! / tol).toBeGreaterThan(1000);
        // Heading-vs-nlerp differ materially from 5deg up (and measurably at 1deg).
        expect(d.headingNlerp! / tol).toBeGreaterThan(angle >= 5 ? 1000 : 1);
        // The Hermite magnitude choice alone moves the path by decimetres.
        expect(d.hermiteMagnitudeSensitivity! / tol).toBeGreaterThan(1000);
      }
    }
  });

  it('mid-interval kink tracks deflection on frame laws, stays small on Hermite (all feasible rows, δ≤45°)', () => {
    let checked = 0;
    for (const row of buildGridCorpus()) {
      if (row.laws === null || !row.widthFeasible || row.angleDeg > 45) continue;
      const h = row.laws.LAW_HEADING.midKinkDeg;
      const n = row.laws.LAW_NLERP.midKinkDeg;
      const x = row.laws.LAW_HERMITE_EXPLICIT.midKinkDeg;
      // Frame laws inherit the anchor corner at the middle station: kink within [0.5δ, 2δ].
      expect(h).toBeGreaterThanOrEqual(0.5 * row.angleDeg);
      expect(h).toBeLessThanOrEqual(2 * row.angleDeg);
      expect(n).toBeGreaterThanOrEqual(0.5 * row.angleDeg);
      expect(n).toBeLessThanOrEqual(2 * row.angleDeg);
      // Hermite smooths the corner by construction: kink below 0.2δ (measured worst 0.09δ).
      expect(x).toBeLessThan(0.2 * row.angleDeg);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('interior daylight inversion only fires where a law inverts unnecessarily (δ≤90° discriminates)', () => {
    for (const row of buildGridCorpus()) {
      if (row.laws === null || !row.widthFeasible) continue;
      if (row.angleDeg <= 45) {
        for (const kind of PLAN_LAW_KINDS) expect(row.laws[kind].normalFlip).toBe(false);
      }
      if (row.angleDeg === 90) {
        // Frame blends never oppose an endpoint frame at 90°; Hermite does on some rows.
        expect(row.laws.LAW_HEADING.normalFlip).toBe(false);
        expect(row.laws.LAW_NLERP.normalFlip).toBe(false);
      }
    }
    const at90 = buildGridCorpus().filter((r) => r.angleDeg === 90 && r.widthFeasible);
    expect(at90.length).toBe(48);
    expect(at90.filter((r) => r.laws!.LAW_HERMITE_EXPLICIT.normalFlip).length).toBe(18);
  });

  it('frame-law endpoint tangents differ from member tangents (offset-blend slope + deflection term)', () => {
    // Even at δ=0.1° the residual is ~14°: the legislated offset blend (offL=5 vs
    // offR=7 over W=8, atan(2/8)≈14.04°) slopes the path off the member tangent
    // before any deflection contributes. Endpoint residuals must NOT be read as
    // pure C1 jumps; the deflection-specific C1 break is the mid-interval kink.
    const spec = STUDY_FAMILIES[0]!;
    const flat = studyJoint(spec, 0.1, 'left', 8);
    for (const kind of ['LAW_HEADING', 'LAW_NLERP'] as const) {
      const base = evalLaw(kind, flat);
      expect(base.ok).toBe(true);
      expect(base.endTanResidDegL).toBeGreaterThan(10);
      expect(base.endTanResidDegL).toBeLessThan(20);
    }
    const j = studyJoint(spec, 45, 'left', 8);
    for (const kind of ['LAW_HEADING', 'LAW_NLERP'] as const) {
      const L = evalLaw(kind, j);
      expect(L.ok).toBe(true);
      expect(L.endTanResidDegL).toBeGreaterThan(0.5);
      expect(L.endTanResidDegR).toBeGreaterThan(0.5);
    }
  });

  it('exact 0 routes to trp1, never to a new law', () => {
    const adv = buildAdversarialRows().filter((r) => r.id.includes('angle0'));
    expect(adv.length).toBe(3);
    for (const row of adv) {
      expect(row.route).toBe('trp1');
      expect(row.liveAdmit).toBe('ADMITTED');
      expect(row.laws).toBeNull();
    }
  });

  it('antiparallel rejects fail closed on all three laws with an exact boundary', () => {
    const spec = STUDY_FAMILIES[0]!;
    for (const kind of PLAN_LAW_KINDS) {
      const at180 = evalLaw(kind, studyJoint(spec, 180, 'left', 8));
      expect(at180.ok).toBe(false);
      expect(at180.rejectCode).toBe('ANTIPARALLEL');
      const justInside = evalLaw(kind, studyJoint(spec, 180 - 5e-10, 'left', 8));
      expect(justInside.ok).toBe(false);
      const at179 = evalLaw(kind as PlanLawKind, studyJoint(spec, 179, 'left', 8));
      expect(at179.ok).toBe(true);
    }
  });

  it('adversarial width/family/grade/side/slope/step/arc/closed rows reject with exact reasons', () => {
    const adv = buildAdversarialRows();
    const byId = new Map(adv.map((r) => [r.id, r]));
    expect(byId.get('o20-adv-width-zero')!.liveAdmit).toBe('WIDTH_INVALID');
    expect(byId.get('o20-adv-width-negative')!.liveAdmit).toBe('WIDTH_INVALID');
    expect(byId.get('o20-adv-width-nan')!.liveAdmit).toBe('WIDTH_INVALID');
    expect(byId.get('o20-adv-width-inf')!.liveAdmit).toBe('WIDTH_INVALID');
    expect(byId.get('o20-adv-width-beyond-member')!.liveAdmit).toBe('WIDTH_INFEASIBLE');
    expect(byId.get('o20-adv-family-mismatch')!.liveAdmit).toBe('FAMILY_MISMATCH');
    expect(byId.get('o20-adv-grade-mismatch')!.liveAdmit).toBe('GRADE_MISMATCH');
    expect(byId.get('o20-adv-side-mismatch')!.liveAdmit).toBe('SIDE_MISMATCH');
    expect(byId.get('o20-adv-sloped-source')!.liveAdmit).toBe('NON_FLAT');
    expect(byId.get('o20-adv-joint-z-step')!.liveAdmit).toBe('JOINT_Z_STEP');
    expect(byId.get('o20-adv-arc-member')!.liveAdmit).toBe('NON_LINE');
    expect(byId.get('o20-adv-closed-group')!.liveAdmit).toBe('CLOSED');
  });

  it('over-bound widths are infeasible, near-bound widths feasible (exact 2*min bound)', () => {
    for (const row of buildGridCorpus()) {
      if (row.widthClass.startsWith('over-bound')) {
        expect(row.widthFeasible).toBe(false);
        expect(row.reject).toBe('WIDTH_INFEASIBLE');
      }
      if (row.widthClass.startsWith('near-bound')) expect(row.widthFeasible).toBe(true);
    }
  });

  it('corpus is deterministic: double build byte-identical and SHA matches', () => {
    const a = JSON.stringify(buildFullCorpus(), null, 2);
    const b = JSON.stringify(buildFullCorpus(), null, 2);
    expect(a).toBe(b);
    expect(buildFullCorpus().length).toBe(736);
    const file = readFileSync(join(corpusDir, 'corpus.json'), 'utf8');
    expect(file).toBe(`${a}\n`);
    const sha = createHash('sha256').update(file).digest('hex');
    expect(readFileSync(join(corpusDir, 'corpus.sha256'), 'utf8')).toBe(`${sha}  corpus.json\n`);
  });

  it('mirror/reversal/translation identities hold (raw, unrounded)', () => {
    let mirror = 0;
    let reversal = 0;
    let t6 = 0;
    let t8 = 0;
    for (const row of buildGridCorpus()) {
      if (!row.widthFeasible || row.stability === null) continue;
      mirror = Math.max(mirror, row.stability.mirror);
      reversal = Math.max(reversal, row.stability.reversal);
      t6 = Math.max(t6, row.stability.translate1e6);
      t8 = Math.max(t8, row.stability.translate1e8);
    }
    expect(mirror).toBeLessThan(1e-9);
    expect(reversal).toBeLessThan(1e-9);
    expect(t6).toBeLessThan(1e-8);
    expect(t8).toBeLessThan(1e-6);
  });

  it('no-src-change guard: live policy still owns the NON_COLLINEAR gate', () => {
    const policy = readFileSync(
      join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'engine', 'cad', 'grading', 'gradingTransitionPolicy.ts'),
      'utf8',
    );
    expect(policy).toContain('NON_COLLINEAR');
  });
});
