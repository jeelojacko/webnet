/**
 * Phase 20N.1 Waves F+G — plural worker/service/handler wiring + product.
 *
 * Two strictly-separated collinear joints end to end: the service planner
 * emits per-joint plans in canonical order (one bad intent rejects the
 * whole group), the worker pre-solve re-admits EVERY plan and the
 * post-solve mesh gate validates EVERY leg against its OWN checkpoints
 * (never first-only), and GROUPBAKE cites one provenance entry per leg
 * while GROUPEXTRACTDAYLIGHT refuses any leg↔intent mismatch.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  checkGroupTransitionPlansAgreement,
  validateGroupTransitionLegsMesh,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import { planGroupTransitionRequest } from '../src/workers/surfaceGradingService';
import {
  canonicalTransitionsFromPlans,
  createSurfaceWorkerHandler,
  resolveGroupTransitionMemberViews,
  toGroupSolveInput,
  transitionPlansOf,
  type GradingGroupComputeRequest,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

let seq = 0;
const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

/** Three collinear flat members (lengths 30/24/30): joints 0 and 1. */
const projectWithChain = (): { project: CadProject; chainId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Plural FG', units: 'm' });
  seq += 1;
  const chainId = `fl-20n1-fg-${seq}`;
  const chain: CadFeatureLineEntity = {
    id: chainId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${chainId}`,
    vertices: [
      vertex(`feature-vertex:${chainId}:a`, 0, 0, 10),
      vertex(`feature-vertex:${chainId}:b`, 30, 0, 10),
      vertex(`feature-vertex:${chainId}:c`, 54, 0, 10),
      vertex(`feature-vertex:${chainId}:d`, 84, 0, 10),
    ],
  };
  return { project: { ...drawing.project, entities: [chain] }, chainId };
};

const DIST = (gradeRatio: number, distance: number) =>
  ({ kind: 'distance', gradeRatio, distance }) as const;

const createGroup = (project: CadProject, chainId: string): CadProject => {
  const fl = project.entities.find((entry) => entry.id === chainId) as CadFeatureLineEntity;
  const [a, b, c, d] = fl.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'FG',
    sourceFeatureLineId: chainId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
      { vertexAId: c!, vertexBId: d! },
    ],
    side: 'left',
    criterion: DIST(0.5, 5),
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
  });
  const withOverrides = runCadCommand(state, {
    key: 'GROUP_SET_COURSE_CRITERIA',
    groupId: state.present.project.gradingGroups![0]!.id,
    courses: [state.present.project.gradingGroups![0]!.sourceCourses[1]!],
    criterion: DIST(0.5, 7),
  });
  const groupId = withOverrides.present.project.gradingGroups![0]!.id;
  const withThird = runCadCommand(withOverrides, {
    key: 'GROUP_SET_COURSE_CRITERIA',
    groupId,
    courses: [withOverrides.present.project.gradingGroups![0]!.sourceCourses[2]!],
    criterion: DIST(0.5, 9),
  });
  return withThird.present.project;
};

const withTwoIntents = (project: CadProject, groupId: string): CadProject => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const [k0, k1, k2] = inputs.memberKeys;
  return {
    ...project,
    gradingGroups: (project.gradingGroups ?? []).map((entry) =>
      entry.id !== groupId
        ? entry
        : {
            ...entry,
            transitions: [
              {
                policyVersion: 'trp1',
                jointId: 'joint:0',
                memberIds: [k0, k1],
                width: 8,
                lawKind: 'TRANSITION_LINEAR_V1',
                lawVersion: 'v1',
                criterionFamily: 'distance',
                side: 'left',
              },
              {
                policyVersion: 'trp1',
                jointId: 'joint:1',
                memberIds: [k1, k2],
                width: 6,
                lawKind: 'TRANSITION_LINEAR_V1',
                lawVersion: 'v1',
                criterionFamily: 'distance',
                side: 'left',
              },
            ],
          },
    ),
  };
};

/** Worker request for the same 3-member chain (widths 8/6, gap 24). */
const request2T = (plans: GroupTransitionPlan[]): GradingGroupComputeRequest => ({
  groupId: 'fg-group',
  revision: 'ggrev1:fg',
  memberSources: [
    { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
    { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
    { startX: 54, startY: 0, endX: 84, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
  ],
  side: 'left',
  criterion: DIST(0.5, 5),
  memberCriteria: [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)],
  transitionMemberKeys: ['A>B', 'B>C', 'C>D'],
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  closed: false,
  transitions: plans,
});

const plan2T = (): GroupTransitionPlan[] => [
  {
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
    jointStation: 30,
    recordedRevision: 'ggrev1:fg',
  },
  {
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: 'distance',
    jointId: 'joint:1',
    memberIds: ['B>C', 'C>D'],
    width: 6,
    side: 'left',
    groupSide: 'left',
    isOpen: true,
    transitionCount: 1,
    jointZ: 10,
    endpointEvidence: { vL: 7, vR: 9, gL: 0.5, gR: 0.5 },
    jointStation: 54,
    recordedRevision: 'ggrev1:fg',
  },
];

describe('20N.1 Wave F: plural service planner', () => {
  it('emits per-joint plans in canonical order; one bad intent rejects the group', () => {
    const { project, chainId } = projectWithChain();
    const grouped = createGroup(project, chainId);
    const groupId = grouped.gradingGroups![0]!.id;
    const transitioned = withTwoIntents(grouped, groupId);
    const inputs = resolveGroupInputs(transitioned, groupId);
    if (!inputs) throw new Error('group inputs did not resolve');
    const planned = planGroupTransitionRequest(inputs);
    expect(planned.kind).toBe('plan');
    if (planned.kind !== 'plan') return;
    expect(planned.transitions.map((p) => p.jointId)).toEqual(['joint:0', 'joint:1']);
    expect(planned.transitions.map((p) => p.jointStation)).toEqual([30, 54]);
    expect(planned.transitions.map((p) => p.endpointEvidence)).toEqual([
      { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      { vL: 7, vR: 9, gL: 0.5, gR: 0.5 },
    ]);
    // One tampered intent (width exceeds 2*min) rejects the whole group.
    const bad = {
      ...transitioned,
      gradingGroups: (transitioned.gradingGroups ?? []).map((entry) =>
        entry.id !== groupId
          ? entry
          : { ...entry, transitions: [...entry.transitions!, { ...entry.transitions![1]!, width: 100 }] },
      ),
    };
    const badInputs = resolveGroupInputs(bad, groupId);
    if (!badInputs) throw new Error('bad group inputs did not resolve');
    expect(planGroupTransitionRequest(badInputs)).toMatchObject({ kind: 'rejected' });
  });
});

describe('20N.1 Wave F: plural worker gates', () => {
  it('pre-solve admits both joints; tampering EITHER plan never reaches the engine', async () => {
    const views = resolveGroupTransitionMemberViews(request2T(plan2T()));
    expect(views?.length).toBe(2);
    const agreed = checkGroupTransitionPlansAgreement({
      plans: plan2T(),
      views: views!,
      liveRevision: 'ggrev1:fg',
    });
    expect(agreed.ok).toBe(true);
    // Over-wide first plan (21+3=24 !< 24) fails the whole group at pre-solve.
    const touching = plan2T();
    touching[0] = { ...touching[0]!, width: 42 };
    const touchingViews = resolveGroupTransitionMemberViews(request2T(touching));
    const touched = checkGroupTransitionPlansAgreement({
      plans: touching,
      views: touchingViews!,
      liveRevision: 'ggrev1:fg',
    });
    expect(touched.ok).toBe(false);

    // Handler path: a tampered SECOND plan never dispatches to the engine.
    const calls: string[] = [];
    const sent: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadGroupGradingFn: () => Promise.resolve(() => {
        calls.push('engine');
        return Promise.resolve({ ok: false as const, code: 'MEMBER_NO_SOLUTION' as const, detail: 'fake' });
      }),
      postMessage: (message) => sent.push(message),
      defer: (callback) => callback(),
    });
    const tampered = plan2T();
    tampered[1] = { ...tampered[1]!, width: 100 };
    handler.handleMessage({ type: 'group-grading', requestId: 't-second', request: request2T(tampered) });
    await flush();
    expect(calls).toEqual([]);
    const failure = sent.find((m) => m.type === 'group-failure');
    expect(failure?.type).toBe('group-failure');
  });

  it('post-solve validates EVERY leg: tampered second checkpoints and missing legs fail closed', async () => {
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request2T(plan2T())));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.transitions?.length).toBe(2);
    const legs = outcome.result.transitions!;
    // Direct plural mesh gate agrees on the genuine legs.
    const views = resolveGroupTransitionMemberViews(request2T(plan2T()))!;
    expect(validateGroupTransitionLegsMesh({
      plans: plan2T(),
      legs,
      views,
      jointZs: [10, 10],
      liveRevision: 'ggrev1:fg',
      maxSearchDistance: 50,
      daylightPoints: outcome.result.daylightPoints,
      sourceBoundaryPoints: outcome.result.sourceBoundaryPoints!,
      side: 'left',
    })).toBeNull();
    // Tampered SECOND leg checkpoints (0.5 m off law) fail closed.
    const tamperedLegs = [...legs];
    tamperedLegs[1] = { ...tamperedLegs[1]!, daylightCheckpoints: [...tamperedLegs[1]!.daylightCheckpoints] };
    tamperedLegs[1]!.daylightCheckpoints[4]! += 0.5;
    expect(validateGroupTransitionLegsMesh({
      plans: plan2T(),
      legs: tamperedLegs,
      views,
      jointZs: [10, 10],
      liveRevision: 'ggrev1:fg',
      maxSearchDistance: 50,
      daylightPoints: outcome.result.daylightPoints,
      sourceBoundaryPoints: outcome.result.sourceBoundaryPoints!,
      side: 'left',
    })).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
    // A result carrying only the FIRST leg never passes a two-plan request.
    expect(validateGroupTransitionLegsMesh({
      plans: plan2T(),
      legs: [legs[0]!],
      views,
      jointZs: [10, 10],
      liveRevision: 'ggrev1:fg',
      maxSearchDistance: 50,
      daylightPoints: outcome.result.daylightPoints,
      sourceBoundaryPoints: outcome.result.sourceBoundaryPoints!,
      side: 'left',
    })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });

  it('serializes canonical order: singular legacy still maps, plural maps in order', () => {
    expect(transitionPlansOf(request2T(plan2T()))?.map((p) => p.jointId)).toEqual(['joint:0', 'joint:1']);
    const legacy = { ...request2T(plan2T()), transitions: undefined, transition: plan2T()[0]! };
    expect(transitionPlansOf(legacy)?.map((p) => p.jointId)).toEqual(['joint:0']);
    expect(transitionPlansOf({ ...legacy, transition: undefined })?.length).toBe(0);
    // Dual-field requests are malformed, never merged.
    expect(transitionPlansOf({ ...legacy, transitions: plan2T() })).toBeNull();
    const input = toGroupSolveInput(request2T(plan2T()));
    expect(input.transitions?.map((t) => t.jointId)).toEqual(['joint:0', 'joint:1']);
    expect(input.transition).toBeUndefined();
    expect(canonicalTransitionsFromPlans(plan2T()).map((t) => t.jointId)).toEqual(['joint:0', 'joint:1']);
    const legacyInput = toGroupSolveInput(legacy);
    expect(legacyInput.transition?.jointId).toBe('joint:0');
    expect(legacyInput.transitions).toBeUndefined();
  });
});

describe('20N.1 Wave G: plural product gates', () => {
  it('GROUPBAKE cites one provenance entry per leg; one forged leg refuses; extract refuses too', () => {
    const { project, chainId } = projectWithChain();
    const grouped = createGroup(project, chainId);
    const groupId = grouped.gradingGroups![0]!.id;
    const transitioned = withTwoIntents(grouped, groupId);
    const inputs = resolveGroupInputs(transitioned, groupId);
    if (!inputs) throw new Error('group inputs did not resolve');
    const outcome = computeGradingGroupFromSnapshots({
      groupId,
      revision: inputs.revision,
      members: inputs.memberSources,
      side: inputs.group.side,
      criterion: inputs.group.criterion,
      memberCriteria: inputs.memberCriteria,
      maxSearchDistance: inputs.group.maxSearchDistance,
      curveChordTolerance: inputs.group.curveChordTolerance,
      closed: false,
      transitions: inputs.group.transitions,
      transitionMemberKeys: inputs.memberKeys,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = outcome.result;
    expect(result.transitions?.length).toBe(2);
    const baked = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(baked.undoStack).toHaveLength(1);
    const surface = baked.present.project.surfaces!.find((entry) => entry.name === 'FG - Baked')!;
    const payload = surface.definition.sourceKind === 'explicit-tin' ? surface.definition.importedTin : null;
    const provenance = payload?.provenance as unknown as { transitions?: unknown[] };
    expect(provenance?.transitions).toHaveLength(2);
    expect(provenance?.transitions).toMatchObject([
      { policyVersion: 'trp1', jointId: 'joint:0', joint: 0, side: 'left', widthMeters: 8, jointStation: 30 },
      { policyVersion: 'trp1', jointId: 'joint:1', joint: 1, side: 'left', widthMeters: 6, jointStation: 54 },
    ]);
    // Forged second leg (edited width): bake refuses AND extract refuses.
    const forged = {
      ...result,
      transitions: [...result.transitions!, { ...result.transitions![1]!, width: 10 }],
    };
    const refusedBake = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPBAKE',
      groupId,
      result: forged,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(refusedBake.undoStack).toHaveLength(0);
    const refusedExtract = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result: forged,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(refusedExtract.undoStack).toHaveLength(0);
    // Genuine legs extract the full boundary.
    const extracted = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    expect(extracted.undoStack).toHaveLength(1);
  });
});
