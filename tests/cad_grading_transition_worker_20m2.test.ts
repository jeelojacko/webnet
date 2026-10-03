/**
 * Phase 20M.2 WAVE F — worker transition agreement.
 *
 * The request/snapshot carries law/ref/station data (`transition` +
 * `transitionMembers`); the worker independently re-resolves native endpoint
 * criteria, rechecks family/grade/admission, reconstructs v(s), and
 * validates transition-owned vertices at their own source station under the
 * CURRENT coordinate/elevation authorities. Source boundary check unchanged.
 * Tampered plan/Z/station/width/ref/revision/law all fail closed with
 * bounded GRADING_AGREEMENT_TRANSITION_* codes through the REAL handler
 * path (`toGroupSolveInput` + `handleMessage`).
 */
import { describe, expect, it } from 'vitest';

import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import {
  checkGroupTransitionAgreement,
  validateTransitionInteriorVertices,
  validateTransitionResultMesh,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import {
  canonicalTransitionFromPlan,
  computeGroupGradingResultFromRequest,
  createSurfaceWorkerHandler,
  toGroupSolveInput,
  type GradingGroupComputeRequest,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

const member = (memberId: string, criterion: GradingCriterion): GroupTransitionMemberView => ({
  memberId,
  criterion,
  length: 20,
  dirX: 1,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 10,
});

const members = (): GroupTransitionMemberView[] => [
  member('A>B', { kind: 'distance', gradeRatio: 0.5, distance: 5 }),
  member('B>C', { kind: 'distance', gradeRatio: 0.5, distance: 7 }),
];

const plan = (o?: Partial<GroupTransitionPlan>): GroupTransitionPlan => ({
  policyVersion: 'trp1',
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  jointId: 'joint:0',
  memberIds: ['A>B', 'B>C'],
  width: 8,
  side: 'left',
  groupSide: 'left',
  isOpen: true,
  transitionCount: 1,
  jointZ: 10,
  endpointEvidence: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
  jointStation: 20,
  recordedRevision: 'ggrev1:plan',
  ...o,
});

const codeOf = (p: GroupTransitionPlan, ms: GroupTransitionMemberView[], rev: string): string => {
  const out = checkGroupTransitionAgreement(p, ms, rev);
  expect(out.ok).toBe(false);
  return (out as { ok: false; code: string }).code;
};

// Real-path request: the true transition shape (collinear flat members,
// differing offsets) with member keys matching the plan refs end to end.
const request = (p?: GroupTransitionPlan): GradingGroupComputeRequest => ({
  groupId: 'transition-group',
  revision: 'ggrev1:plan',
  memberSources: [
    { startX: -20, startY: 0, endX: 0, endY: 0, startZ: 10, endZ: 10, length: 20, reoriented: false, isArc: false },
    { startX: 0, startY: 0, endX: 20, endY: 0, startZ: 10, endZ: 10, length: 20, reoriented: false, isArc: false },
  ],
  side: 'left',
  criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
  memberCriteria: [
    { kind: 'distance', gradeRatio: 0.5, distance: 5 },
    { kind: 'distance', gradeRatio: 0.5, distance: 7 },
  ],
  transitionMemberKeys: ['A>B', 'B>C'],
  maxSearchDistance: 10,
  curveChordTolerance: 0.01,
  closed: false,
  ...(p !== undefined ? { transition: p, transitionMembers: members() } : {}),
});

describe('20M.2 WAVE F transition agreement', () => {
  it('agrees on a valid plan and reconstructs v(s) at interior stations', () => {
    const out = checkGroupTransitionAgreement(plan(), members(), 'ggrev1:plan');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out).toMatchObject({ vL: 5, vR: 7, sL: -4, sR: 4, family: 'distance' });
    // Interior vertex exactly on the law at its own station passes.
    expect(validateTransitionInteriorVertices(out, [
      { s: 0, x: 0, y: 6, z: 10, srcX: 0, srcY: 0, srcZ: 10 },
      { s: -4, x: -4, y: 5, z: 10, srcX: -4, srcY: 0, srcZ: 10 },
    ])).toBeNull();
  });

  it('fails tampered law/version/width/ref/revision closed', () => {
    const ms = members();
    expect(codeOf(plan({ lawKind: 'NOPE' }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN');
    expect(codeOf(plan({ policyVersion: 'trp0' }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_VERSION_UNKNOWN');
    expect(codeOf(plan({ width: 0 }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_MALFORMED');
    expect(codeOf(plan({ width: 41 }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_WIDE');
    expect(codeOf(plan({ memberIds: ['A>B', 'X>Y'] }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    expect(codeOf(plan(), ms, 'ggrev1:moved')).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    expect(codeOf(plan({ transitionCount: 2 }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_OVERLAP');
    // Tampered pinned evidence (plan Z/scalars drifted from the natives).
    expect(codeOf(plan({ endpointEvidence: { vL: 5, vR: 8, gL: 0.5, gR: 0.5 } }), ms, 'ggrev1:plan'))
      .toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    // Tampered family/grade no longer admits.
    expect(codeOf(plan({ criterionFamily: 'elevation' }), ms, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH');
    const grade = members();
    grade[1] = member('B>C', { kind: 'distance', gradeRatio: 0.75, distance: 7 });
    expect(codeOf(plan(), grade, 'ggrev1:plan')).toBe('GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH');
  });

  it('fails off-law and mis-assigned interior vertices closed', () => {
    const out = checkGroupTransitionAgreement(plan(), members(), 'ggrev1:plan');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Tampered plan position (0.5 m off the legislated 6 m offset).
    expect(validateTransitionInteriorVertices(out, [
      { s: 0, x: 0, y: 6.5, z: 10, srcX: 0, srcY: 0, srcZ: 10 },
    ])).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
    // Station outside the owned interval is a geometry mis-assignment.
    expect(validateTransitionInteriorVertices(out, [
      { s: 9, x: 9, y: 7, z: 10, srcX: 9, srcY: 0, srcZ: 10 },
    ])).toBe('GRADING_AGREEMENT_TRANSITION_GEOMETRY');
    // Non-finite node is malformed.
    expect(validateTransitionInteriorVertices(out, [
      { s: 0, x: NaN, y: 6, z: 10, srcX: 0, srcY: 0, srcZ: 10 },
    ])).toBe('GRADING_AGREEMENT_TRANSITION_MALFORMED');
  });

  it('carries transition data through toGroupSolveInput and the real compute path', async () => {
    const req = request(plan());
    const input = toGroupSolveInput(req);
    // The solve input carries the canonical intent (evidence stays worker-side).
    expect(input.transition).toEqual(canonicalTransitionFromPlan(plan()));
    // Legacy requests carry nothing: byte-identical shape to before.
    expect('transition' in toGroupSolveInput(request())).toBe(false);
    // The real kernel solves the transitioned group end to end.
    const outcome = await computeGroupGradingResultFromRequest(JSON.parse(JSON.stringify(req)) as GradingGroupComputeRequest);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.daylightPoints.length).toBeGreaterThan(0);
    expect(outcome.result.topologyCertificate?.version).toBe('gtop2');
  });

  it('gates the handler path: valid plans reach the engine, tampered plans never do', async () => {    const mkHandler = (calls: string[], code: object) => {
      const sent: SurfaceWorkerResponseMessage[] = [];
      const handler = createSurfaceWorkerHandler({
        loadBuilder: () => Promise.reject(new Error('unused')),
        loadGroupGradingFn: () => Promise.resolve(() => {
          calls.push('engine');
          return Promise.resolve(code as never);
        }),
        postMessage: (message) => sent.push(message),
        defer: (callback) => callback(),
      });
      return { handler, sent };
    };
    const failing = { ok: false as const, code: 'MEMBER_NO_SOLUTION' as const, detail: 'fake-engine' };
    const goodCalls: string[] = [];
    const good = mkHandler(goodCalls, failing);
    good.handler.handleMessage({ type: 'group-grading', requestId: 't-good', request: request(plan()) });
    await flush();
    expect(goodCalls).toEqual(['engine']);
    expect(good.sent.find((m) => m.type === 'group-failure')).toBeDefined();

    const badCalls: string[] = [];
    const bad = mkHandler(badCalls, failing);
    bad.handler.handleMessage({
      type: 'group-grading',
      requestId: 't-bad',
      request: request(plan({ width: 41 })),
    });
    await flush();
    expect(badCalls).toEqual([]);
    const failure = bad.sent.find((m) => m.type === 'group-failure');
    expect(failure?.type).toBe('group-failure');
    if (failure?.type !== 'group-failure') return;
    expect(failure.error).toBe('GRADING_AGREEMENT_TRANSITION_WIDE');
  });

  it('re-resolves members from memberSources: service views never decide', async () => {
    // Corrupted service-supplied views are ignored: the live memberSources
    // still admit, so the request reaches the engine.
    const calls: string[] = [];
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadGroupGradingFn: () => Promise.resolve(() => {
        calls.push('engine');
        return Promise.resolve({ ok: false as const, code: 'MEMBER_NO_SOLUTION' as const, detail: 'fake-engine' });
      }),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    const req = request(plan());
    req.transitionMembers = [
      member('A>B', { kind: 'distance', gradeRatio: 0.75, distance: 5 }),
      member('B>C', { kind: 'distance', gradeRatio: 0.75, distance: 7 }),
    ];
    handler.handleMessage({ type: 'group-grading', requestId: 't-views', request: req });
    await flush();
    expect(calls).toEqual(['engine']);
    // Corrupted live sources fail even with pristine service views.
    const badCalls: string[] = [];
    const badSent: SurfaceWorkerResponseMessage[] = [];
    const badHandler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadGroupGradingFn: () => Promise.resolve(() => {
        badCalls.push('engine');
        return Promise.resolve({ ok: false as const, code: 'MEMBER_NO_SOLUTION' as const, detail: 'fake-engine' });
      }),
      postMessage: (message) => badSent.push(message),
      defer: (callback) => callback(),
    });
    const badReq = request(plan());
    badReq.memberCriteria = [
      { kind: 'distance', gradeRatio: 0.5, distance: 5 },
      { kind: 'distance', gradeRatio: 0.75, distance: 7 },
    ];
    badHandler.handleMessage({ type: 'group-grading', requestId: 't-sources', request: badReq });
    await flush();
    expect(badCalls).toEqual([]);
    const failure = badSent.find((m) => m.type === 'group-failure');
    expect(failure?.type).toBe('group-failure');
    if (failure?.type !== 'group-failure') return;
    expect(failure.error).toBe('GRADING_AGREEMENT_TRANSITION_FAMILY_MISMATCH');
  });

  it('post-solve mesh gate runs on the production path (real engine + handler)', async () => {
    // Full production path with the real kernel: agreement pre-solve, mesh
    // recheck post-solve, group-success delivery.
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadGroupGradingFn: () => Promise.resolve(computeGroupGradingResultFromRequest),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'group-grading', requestId: 't-e2e', request: request(plan()) });
    await flush(10);
    const success = sent.find((m) => m.type === 'group-success');
    expect(success?.type).toBe('group-success');
    if (success?.type !== 'group-success') return;
    expect(success.result.transition).toMatchObject({ joint: 0, agreementCode: null });
    // The result-owned checkpoints independently satisfy law + natives.
    const leg = success.result.transition!;
    expect(validateTransitionResultMesh({
      family: 'distance',
      sL: leg.interval.sL,
      sR: leg.interval.sR,
      vL: leg.endpointScalars.vL,
      vR: leg.endpointScalars.vR,
      daylightCheckpoints: leg.daylightCheckpoints,
      sourceCheckpoints: leg.sourceCheckpoints,
      criterionL: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
      criterionR: { kind: 'distance', gradeRatio: 0.5, distance: 7 },
      jointZ: 10,
      maxSearchDistance: 10,
    })).toBeNull();
  });

  it('post-solve mesh gate fails tampered checkpoints and missing legs closed', async () => {
    const real = await computeGroupGradingResultFromRequest(JSON.parse(JSON.stringify(request(plan()))) as GradingGroupComputeRequest);
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    const mkHandler = (sent: SurfaceWorkerResponseMessage[], result: typeof real.result) => createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadGroupGradingFn: () => Promise.resolve(() => Promise.resolve({ ok: true as const, result })),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    // Off-law checkpoint (0.5 m off the legislated offset).
    const tampered = {
      ...real.result,
      transition: { ...real.result.transition!, daylightCheckpoints: [...real.result.transition!.daylightCheckpoints] },
    };
    tampered.transition.daylightCheckpoints[4]! += 0.5;
    const tamperedSent: SurfaceWorkerResponseMessage[] = [];
    mkHandler(tamperedSent, tampered).handleMessage({ type: 'group-grading', requestId: 't-tampered', request: request(plan()) });
    await flush();
    const tamperedFailure = tamperedSent.find((m) => m.type === 'group-failure');
    expect(tamperedFailure?.type).toBe('group-failure');
    if (tamperedFailure?.type !== 'group-failure') return;
    expect(tamperedFailure.error).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
    // Missing leg on a transitioned request never passes.
    const noLeg = { ...real.result };
    delete noLeg.transition;
    const noLegSent: SurfaceWorkerResponseMessage[] = [];
    mkHandler(noLegSent, noLeg).handleMessage({ type: 'group-grading', requestId: 't-noleg', request: request(plan()) });
    await flush();
    const noLegFailure = noLegSent.find((m) => m.type === 'group-failure');
    expect(noLegFailure?.type).toBe('group-failure');
    if (noLegFailure?.type !== 'group-failure') return;
    expect(noLegFailure.error).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });
});
