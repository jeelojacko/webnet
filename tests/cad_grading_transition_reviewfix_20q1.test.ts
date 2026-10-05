/**
 * Phase 20Q.1 review-fix pins (BLOCKER + MAJOR).
 *
 * BLOCKER: transitioned groups hash source Z at full precision, so a
 * sub-nanometre flat-to-sloped edit moves `ggrev1:` (stale status +
 * recalculation, never a cached CURRENT). No-transition groups keep the
 * legacy 1nm quantizer byte-identical.
 *
 * MAJOR: the worker mesh gate compares result-owned cut + joint source
 * XYZ against authoritative member geometry. An altered
 * cut-source/daylight pair (re-anchored into both boundaries, so every
 * legacy law/native/anchor check passes) fails closed with
 * GRADING_AGREEMENT_TRANSITION_GEOMETRY.
 */
import { describe, expect, it } from 'vitest';

import { buildGroupRevision, type GroupRevisionInput } from '../src/engine/cad/grading/gradingGroupRevision';
import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  toGroupSolveInput,
  validateTransitionResultMeshAgainst,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import {
  validateTransitionResultMesh,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';

const GRADE = 0.5;
const Z0 = 10;
const W = 8;
const LEN = 30;
const MAX_SEARCH = 50;
const REV = 'ggrev1:20q1-reviewfix';
const SUB_NM = 4e-10;

const dist = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

const link = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): ResolvedGradingSource => ({
  startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});

const intent = (withTransition: boolean): CadGradingTransition[] | undefined =>
  withTransition
    ? [{
        policyVersion: TRANSITION_POLICY_VERSION, jointId: 'joint:0', memberIds: ['S0>S1', 'S1>S2'],
        width: W, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
        criterionFamily: 'distance', side: 'left',
      }]
    : undefined;

const revisionInput = (z01: number, z12: number, withTransition: boolean): GroupRevisionInput => ({
  sourceFeatureLineId: 'fl-reviewfix',
  courses: [
    { vertexAId: 'S0', vertexBId: 'S1', resolvedSource: link(-LEN, 0, Z0, 0, 0, z01) },
    { vertexAId: 'S1', vertexBId: 'S2', resolvedSource: link(0, 0, z01, LEN, 0, z12) },
  ],
  side: 'left',
  criterion: dist(5),
  maxSearchDistance: MAX_SEARCH,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  closed: false,
  ...(withTransition ? { transitions: intent(true) } : {}),
});

describe('20Q.1 review-fix BLOCKER: sub-nanometre source-Z revision identity', () => {
  it('transitioned group: sub-nm flat→sloped edit moves ggrev1 (no stale CURRENT)', () => {
    const flat = buildGroupRevision(revisionInput(Z0, Z0, true));
    const sloped = buildGroupRevision(revisionInput(Z0 + SUB_NM, Z0 + SUB_NM, true));
    expect(sloped).not.toBe(flat);
  });

  it('no-transition group: sub-nm edit keeps ggrev1 (legacy 1nm quantizer byte-identical)', () => {
    const flat = buildGroupRevision(revisionInput(Z0, Z0, false));
    const sloped = buildGroupRevision(revisionInput(Z0 + SUB_NM, Z0 + SUB_NM, false));
    expect(sloped).toBe(flat);
  });
});

describe('20Q.1 review-fix MAJOR: cut/joint source XYZ vs authoritative geometry', () => {
  const members = [link(-LEN, 0, Z0, 0, 0, Z0), link(0, 0, Z0, LEN, 0, Z0)];
  const keys = ['L', 'R'];

  const plan = (): GroupTransitionPlan => {
    const geom = (m: ResolvedGradingSource, id: string) => ({
      memberId: id, criterion: dist(5), length: m.length,
      dirX: m.endX - m.startX, dirY: m.endY - m.startY,
      startZ: m.startZ, endZ: m.endZ, isArc: false, maxSearchDistance: MAX_SEARCH,
    });
    const admitted = admitGradingTransition({
      policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: [...keys], width: W,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: Z0,
      members: [geom(members[0]!, keys[0]!), geom(members[1]!, keys[1]!)],
    });
    if (!admitted.ok) throw new Error('plan prerequisite failed');
    return {
      policyVersion: TRANSITION_POLICY_VERSION, jointId: 'joint:0', memberIds: [...keys], width: W,
      lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
      criterionFamily: 'distance', side: 'left',
      groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: Z0,
      endpointEvidence: { vL: admitted.vL, vR: admitted.vR, gL: GRADE, gR: GRADE },
      jointStation: LEN, recordedRevision: REV,
    };
  };

  const request = (): GradingGroupComputeRequest => ({
    groupId: 'g', revision: REV, memberSources: members, side: 'left',
    criterion: dist(5), memberCriteria: [dist(5), dist(5)],
    maxSearchDistance: MAX_SEARCH, curveChordTolerance: 0.01, closed: false,
    transition: plan(), transitionMemberKeys: [...keys],
  });

  it('untampered sloped+flat solves pass the mesh gate', () => {
    const req = request();
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(req));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(validateTransitionResultMeshAgainst(outcome.result, req)).toBeNull();
  });

  it('altered cut-source/daylight pair (re-anchored) fails closed', () => {
    const req = request();
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(req));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const leg = outcome.result.transition!;
    // Shift the cut-L source mate AND its daylight mate by +0.5 in Z, and
    // re-anchor both into the result-owned boundaries so every legacy
    // law/native/anchor check still passes — only the authoritative
    // geometry check can catch this.
    const tamperedSource = [...leg.sourceCheckpoints];
    const tamperedDaylight = [...leg.daylightCheckpoints];
    tamperedSource[2]! += 0.5;
    tamperedDaylight[2]! += 0.5;
    const patchedSourceBoundary = [...(outcome.result.sourceBoundaryPoints ?? []), ...tamperedSource.slice(0, 3)];
    const patchedDaylight = [...(outcome.result.daylightPoints ?? []), ...tamperedDaylight.slice(0, 3)];
    const tampered = {
      ...outcome.result,
      transition: { ...leg, sourceCheckpoints: tamperedSource, daylightCheckpoints: tamperedDaylight },
      sourceBoundaryPoints: patchedSourceBoundary,
      daylightPoints: patchedDaylight,
    };
    expect(validateTransitionResultMeshAgainst(tampered, req)).toBe(
      'GRADING_AGREEMENT_TRANSITION_GEOMETRY',
    );
    // The same re-anchored tamper passes the legacy checks (no member
    // geometry threaded): this is the hole the review fix closes.
    expect(
      validateTransitionResultMesh({
        family: 'distance',
        sL: leg.interval.sL, sR: leg.interval.sR,
        vL: leg.endpointScalars.vL, vR: leg.endpointScalars.vR,
        daylightCheckpoints: tamperedDaylight,
        sourceCheckpoints: tamperedSource,
        criterionL: dist(5), criterionR: dist(5),
        jointZ: Z0, maxSearchDistance: MAX_SEARCH,
        daylightPoints: patchedDaylight,
        sourceBoundaryPoints: patchedSourceBoundary,
        side: 'left',
      }),
    ).toBeNull();
  });
});
