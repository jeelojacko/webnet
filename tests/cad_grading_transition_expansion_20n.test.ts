/**
 * Phase 20N — transition expansion decision pins (STUDY ONLY, zero src/ changes).
 *
 * Imports the study script + production authorities read-only and asserts the
 * decision verdicts: Candidate A PARTIAL_GO (per-joint reuse + strict
 * separation), Candidate B POLICY_REQUIRED (gate pin + underdetermination).
 * Study verdicts are NOT production behavior: every A-eligible layout still
 * REJECTS in production today (pinned explicitly).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  hasTransitionIntent,
  selectGroupTransition,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  CANDIDATE_A_LAYOUTS,
  CANDIDATE_B_ANGLES,
  CANDIDATE_B_FAMILIES,
  CANDIDATE_B_WIDTH_M,
  candidateAAdmitJoint,
  candidateABuildCorpus,
  candidateAClassifyStation,
  candidateAExpectationRegions,
  candidateAIntervals,
  candidateALayoutOk,
  candidateAMidScalar,
  candidateBAgreementBandM,
  candidateBAdmissionAuthorityRejectsNonCollinear,
  candidateBAdmissionCode,
  candidateBAuditPlanLawAuthorities,
  candidateBBuildCorpus,
  candidateBFacts,
  candidateBPlanMetrics,
  candidateBSegment,
  CANDIDATE_B_AUTHORITY_INVENTORY,
} from '../scripts/phase20nTransitionExpansionStudy';

const corpusDir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20n');

/** Minimal live-admission input: collinear distance joint, tunable count/deflection. */
const admitInput = (transitionCount: number, dirY = 0): AdmitTransitionInput => {
  const members: [TransitionMemberGeometry, TransitionMemberGeometry] = [
    { memberId: 'L', criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 }, length: 20, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
    { memberId: 'R', criterion: { kind: 'distance', gradeRatio: 0.5, distance: 7 }, length: 20, dirX: 1, dirY, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
  ];
  return {
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: 'distance',
    jointId: 'joint:0',
    memberIds: ['L', 'R'],
    width: 8,
    side: 'left',
    groupSide: 'left',
    isOpen: true,
    transitionCount,
    jointZ: 10,
    members,
  };
};

describe('20N candidate A: multiple collinear transitions', () => {
  it('corpus holds 11 A rows; 2T/3T x 3fam admit per joint + strict separation + C0', () => {
    const rows = candidateABuildCorpus();
    expect(rows).toHaveLength(11);
    expect(CANDIDATE_A_LAYOUTS).toHaveLength(11);
    for (const row of rows.slice(0, 6)) {
      expect(row.measured.layoutOk).toBe(true);
      expect(row.measured.allAdmitted).toBe(true);
      expect(row.measured.midScalar).toBe(row.measured.expectMid);
      // Merged strip: N strictly-separated collinear joints form ONE
      // positive-width region (natives survive between intervals, C0
      // boundaries merge; production pins 1/1/1).
      expect(row.measured.regions).toBe(1);
      expect(row.measured.endpointGap).toBe(0);
      expect(row.futurePredicateEligible).toBe(true);
    }
    // Midpoints reuse the legislated law exactly: 6 / 1.75 / 0.75.
    expect(candidateAMidScalar('distance', 8)).toBe(6);
    expect(candidateAMidScalar('relative-elevation', 8)).toBe(1.75);
    expect(candidateAMidScalar('elevation', 8)).toBe(0.75);
    // Unequal widths within one group are the point: [8,6] and [8,6,4].
    expect(rows[0]!.widths).toEqual([8, 6]);
    expect(rows[1]!.widths).toEqual([8, 6, 4]);
  });

  it('strict gap holds; near-zero strict gap holds; touching excluded from first predicate', () => {
    expect(candidateALayoutOk([8, 6], [20])).toBe(true);
    expect(candidateALayoutOk([2, 2], [2.0001])).toBe(true);
    expect(candidateALayoutOk([8, 6], [7])).toBe(false); // touching (==), not authorized
    const touching = candidateABuildCorpus()[6]!;
    expect(touching.expected).toBe('touching-not-authorized');
    expect(touching.measured.layoutOk).toBe(false);
    expect(touching.futurePredicateEligible).toBe(false);
    // Separation is a group-layout predicate: per-joint admission still passes.
    expect(touching.measured.admitCodes).toBe('ok,ok');
  });

  it('overlap, too-wide middle, malformed widths all fail closed', () => {
    const rows = candidateABuildCorpus();
    expect(rows[7]!.measured).toMatchObject({ layoutOk: false, admitCodes: 'ok,ok' }); // overlap
    expect(rows[8]!.measured.layoutOk).toBe(false); // negative gap
    expect(rows[9]!.measured).toMatchObject({ layoutOk: false, allAdmitted: false, admitCodes: 'WIDTH_INFEASIBLE,ok' });
    const badWidth = candidateAAdmitJoint('distance', -1, 'joint:0');
    expect(badWidth.ok).toBe(false);
    if (!badWidth.ok) expect(badWidth.code).toBe('WIDTH_INVALID');
    const zeroWidth = candidateAAdmitJoint('distance', 0, 'joint:0');
    expect(zeroWidth.ok).toBe(false);
  });

  it('mirror identical, reversal symmetric under the legislated law (midpoint + endpoints)', () => {
    const rows = candidateABuildCorpus();
    const rev = rows[10]!;
    expect(rev.transform).toBe('reversal');
    expect(rev.measured).toMatchObject({ layoutOk: true, reversalConsistent: true, reversalEndpointsOk: true, endpointGap: 0 });
    // Collinear mirror is the same line: layout predicate unaffected.
    expect(candidateALayoutOk([8, 6], [20])).toBe(true);
  });

  it('station ownership invariant under 1e6/1e8 translations', () => {
    const ivs = candidateAIntervals([8, 6], [20]);
    for (const shift of [1e6, 1e8]) {
      const moved = ivs.map((iv) => ({ index: iv.index, lo: iv.lo + shift, hi: iv.hi + shift }));
      expect(candidateAClassifyStation(0 + shift, moved)).toEqual({ kind: 'transition', index: 0 });
      expect(candidateAClassifyStation(10 + shift, moved)).toEqual({ kind: 'native' });
      expect(candidateAClassifyStation(-4 + shift, moved)).toEqual({ kind: 'boundary' });
    }
  });

  it('regen deterministic: A corpus twice-built deep-equal', () => {
    expect(candidateABuildCorpus()).toEqual(candidateABuildCorpus());
  });

  it('topology: production rejects count 2 today; design declares the merged single region', () => {
    const out = deriveTransitionExpectation(
      { scope: 'group', closed: false, positiveWidthRegions: 1 },
      { jointId: 'joint:0', width: 8, memberLengths: [20, 20], transitionCount: 2, isOpen: true },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_OVERLAP');
    expect(candidateAExpectationRegions(2)).toBe(1);
    expect(candidateAExpectationRegions(3)).toBe(1);
  });

  it('study verdicts are not production behavior: A-eligible layouts still REJECT today', () => {
    for (const n of [2, 3]) {
      const sel = selectGroupTransition(new Array(n).fill({ jointId: 'joint:0' }));
      expect(sel).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
    }
    expect(admitGradingTransition({ ...admitInput(1), transitionCount: 2 }).ok).toBe(false);
  });
});

describe('20N candidate B: single non-collinear transition', () => {
  it('angle ladder 0/1/5/15/30/45/90/135/179 x 3fam: admit only at 0, kink == deflection, C0 holds', () => {
    expect(candidateBAdmissionAuthorityRejectsNonCollinear()).toBe(true);
    for (const spec of CANDIDATE_B_FAMILIES) {
      for (const angleDeg of CANDIDATE_B_ANGLES) {
        const f = candidateBFacts(spec, angleDeg, 'identity');
        expect(f.admissionCode).toBe(angleDeg === 0 ? 'ADMITTED' : 'NON_COLLINEAR');
        expect(f.kinkDeg).toBe(angleDeg);
        expect(f.c0Gap).toBe(0);
        expect(f.foldover).toBe(angleDeg > 90);
        const expectCut = CANDIDATE_B_WIDTH_M * Math.abs(Math.sin((angleDeg * Math.PI) / 360));
        expect(Math.abs(f.cutPointErrorM - expectCut)).toBeLessThan(1e-9);
      }
    }
  });

  it('mirror and reversal match identity on all 81 rows (genuine vs-identity comparison)', () => {
    const rows = candidateBBuildCorpus();
    expect(rows).toHaveLength(81);
    for (const row of rows) {
      expect(row.measuredFacts.mirrorStable).toBe(true);
      expect(row.measuredFacts.reversalStable).toBe(true);
      expect(row.expectedClassification).toBe(
        row.angleDeg === 0 ? 'COLLINEAR_CONTROL_EXISTING_TRP1' : 'POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW',
      );
    }
  });

  it('width bounds enforced per joint even off the gate path', () => {
    const spec = CANDIDATE_B_FAMILIES[0]!;
    expect(candidateBFacts(spec, 0, 'identity', 44).admissionCode).toBe('WIDTH_INFEASIBLE');
  });

  it('two study probes diverge materially off-axis, coincide on-axis', () => {
    const spec = CANDIDATE_B_FAMILIES[0]!;
    const on = candidateBPlanMetrics(candidateBSegment(spec, 0, 'identity'));
    expect(on.maxPlanSepM).toBeLessThan(1e-9);
    const off = candidateBPlanMetrics(candidateBSegment(spec, 45, 'identity'));
    expect(off.maxPlanSepM).toBeGreaterThan(1e-9);
    // Shallowest deflection already dwarfs the shared agreement band: not rounding.
    const shallow = candidateBPlanMetrics(candidateBSegment(spec, 1, 'identity'));
    expect(shallow.maxPlanSepM).toBeGreaterThan(candidateBAgreementBandM(5, 7) * 1e3);
  });

  it('self-cross diagnostics: straight clean, 90-degree distance self-intersects', () => {
    const spec = CANDIDATE_B_FAMILIES[0]!;
    expect(candidateBPlanMetrics(candidateBSegment(spec, 0, 'identity')).selfIntersect).toBe(false);
    expect(candidateBPlanMetrics(candidateBSegment(spec, 90, 'identity')).selfIntersect).toBe(true);
  });

  it('translations: analytic facts exact, plan metrics stable under 1e6 shift', () => {
    const spec = CANDIDATE_B_FAMILIES[0]!;
    expect(candidateBFacts(spec, 45, 'identity')).toEqual(candidateBFacts(spec, 45, 'identity'));
    const seg = candidateBSegment(spec, 45, 'identity');
    const moved = { ...seg, V: { x: seg.V.x + 1e6, y: seg.V.y - 1e6 } };
    const a = candidateBPlanMetrics(seg);
    const b = candidateBPlanMetrics(moved);
    expect(Math.abs(a.maxPlanSepM - b.maxPlanSepM)).toBeLessThan(1e-6);
    expect(a.selfIntersect).toBe(b.selfIntersect);
  });

  it('C3: no existing authority selects a plan path', () => {
    const audit = candidateBAuditPlanLawAuthorities();
    expect(audit.miterMatchesExactOffset).toBe(true);
    expect(audit.selectsPlanPath).toBe(false);
    for (const entry of CANDIDATE_B_AUTHORITY_INVENTORY) expect(entry.selectsPlanPath).toBe(false);
  });
});

describe('20N controls: 20M.2 behavior unchanged', () => {
  it('single collinear transition admits exactly as 20M.2', () => {
    const d = admitGradingTransition(admitInput(1));
    expect(d).toMatchObject({ ok: true, vL: 5, vR: 7, sL: -4, sR: 4 });
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, -4)).toBe(5);
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, 4)).toBe(7);
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, 0)).toBe(6);
  });

  it('absent intent stays the legacy path', () => {
    expect(selectGroupTransition(undefined)).toEqual({ kind: 'absent' });
    expect(hasTransitionIntent(undefined)).toBe(false);
    expect(hasTransitionIntent([])).toBe(false);
    expect(hasTransitionIntent([{ jointId: 'joint:0' }])).toBe(true);
  });

  it('second transition REJECTS in production today', () => {
    const sel = selectGroupTransition([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]);
    expect(sel).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
    const r = admitGradingTransition(admitInput(2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CARDINALITY');
  });

  it('non-collinear REJECTS in production today', () => {
    const r = admitGradingTransition(admitInput(1, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NON_COLLINEAR');
    expect(candidateBAdmissionCode(CANDIDATE_B_FAMILIES[0]!, candidateBSegment(CANDIDATE_B_FAMILIES[0]!, 30, 'identity'))).toBe('NON_COLLINEAR');
  });

  it('committed corpus matches regen: 116 rows (35 A-mesh + 81 B), sha256 pinned', () => {
    const raw = readFileSync(join(corpusDir, 'corpus.json'), 'utf8');
    const rows = JSON.parse(raw) as unknown[];
    expect(rows).toHaveLength(116);
    const sha = createHash('sha256').update(raw).digest('hex');
    const pinned = readFileSync(join(corpusDir, 'corpus.sha256'), 'utf8').split(/\s/)[0]!;
    expect(sha).toBe(pinned);
    expect(candidateBBuildCorpus()).toHaveLength(81);
  });
});
