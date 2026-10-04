/**
 * Bounded review fixes (feat/phase20n1-multiple-collinear-transitions):
 * positional legs↔plans mesh gate + forged second-leg metadata, the
 * exact-offset/transition admission seam, canonical jointId SET rejects,
 * malformed service memberIds fail-closed, and the unconditional
 * GROUPBAKE/GROUPEXTRACT positional leg↔intent gate (order swaps refuse).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { setGroupTransition } from '../src/engine/cad/grading/gradingTransitionAuthoring';
import { sanitizeTransitions } from '../src/engine/cad/grading/gradingGroupPersistence';
import type { CadGradingGroup, CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GroupSolveInput } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  validateGroupTransitionLegsMesh,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import { planGroupTransitionRequest } from '../src/workers/surfaceGradingService';
import {
  resolveGroupTransitionMemberViews,
  toGroupSolveInput,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';

const DIST = (gradeRatio: number, distance: number): GradingCriterion => ({
  kind: 'distance', gradeRatio, distance,
});

/** Three collinear flat members (lengths 30/24/30): joints 0 and 1. */
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
    policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
    criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['A>B', 'B>C'],
    width: 8, side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1,
    jointZ: 10, endpointEvidence: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
    jointStation: 30, recordedRevision: 'ggrev1:fg',
  },
  {
    policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
    criterionFamily: 'distance', jointId: 'joint:1', memberIds: ['B>C', 'C>D'],
    width: 6, side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1,
    jointZ: 10, endpointEvidence: { vL: 7, vR: 9, gL: 0.5, gR: 0.5 },
    jointStation: 54, recordedRevision: 'ggrev1:fg',
  },
];

const meshArgsOf = (plans: GroupTransitionPlan[]) => {
  const request = request2T(plans);
  const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request));
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('genuine 2T solve failed');
  const views = resolveGroupTransitionMemberViews(request);
  if (!views) throw new Error('views did not resolve');
  return {
    plans,
    legs: [...outcome.result.transitions!],
    views,
    jointZs: [10, 10],
    liveRevision: 'ggrev1:fg',
    maxSearchDistance: 50,
    daylightPoints: outcome.result.daylightPoints,
    sourceBoundaryPoints: outcome.result.sourceBoundaryPoints!,
    side: 'left' as const,
  };
};

describe('review fix: positional legs↔plans mesh gate (second leg)', () => {
  it('genuine legs pass; reversed order refuses without re-matching', () => {
    const genuine = meshArgsOf(plan2T());
    expect(genuine.legs).toHaveLength(2);
    expect(validateGroupTransitionLegsMesh(genuine)).toBeNull();
    // Reversed legs carry intact checkpoints but cite the wrong plan.
    const reversed = { ...genuine, legs: [genuine.legs[1]!, genuine.legs[0]!] };
    expect(validateGroupTransitionLegsMesh(reversed)).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });

  it('forged second-leg citations (width/memberIds/station/scalars) refuse', () => {
    const forge = (index: 1, patch: object) => {
      const args = meshArgsOf(plan2T());
      const legs = [...args.legs];
      legs[index] = { ...legs[index]!, ...patch };
      return validateGroupTransitionLegsMesh({ ...args, legs });
    };
    expect(forge(1, { width: 10 })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    expect(forge(1, { memberIds: ['B>C', 'X>Y'] as [string, string] })).toBe(
      'GRADING_AGREEMENT_TRANSITION_STALE',
    );
    expect(forge(1, { jointStation: 30 })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    expect(forge(1, { recordedRevision: 'ggrev1:other' })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    expect(forge(1, { endpointScalars: { vL: 7, vR: 8, gL: 0.5, gR: 0.5 } })).toBe(
      'GRADING_AGREEMENT_TRANSITION_STALE',
    );
    expect(forge(1, { interval: { sL: -2, sR: 3 } })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });

  it('single legacy leg still passes positionally', () => {
    // Two-member chain: one joint, one plan, one leg (legacy shape).
    const plan: GroupTransitionPlan = {
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['A>B', 'B>C'],
      width: 8, side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1,
      jointZ: 10, endpointEvidence: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      jointStation: 30, recordedRevision: 'ggrev1:fg',
    };
    const request: GradingGroupComputeRequest = {
      ...request2T([plan]),
      memberSources: [
        { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
        { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
      ],
      memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      transitionMemberKeys: ['A>B', 'B>C'],
      transitions: undefined,
      transition: plan,
    };
    const outcome = computeGradingGroupFromSnapshots(toGroupSolveInput(request));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.transition).toBeDefined();
    const views = resolveGroupTransitionMemberViews(request);
    if (!views) throw new Error('views did not resolve');
    expect(validateGroupTransitionLegsMesh({
      plans: [plan],
      legs: [outcome.result.transition!],
      views: [views[0]!],
      jointZs: [10],
      liveRevision: 'ggrev1:fg',
      maxSearchDistance: 50,
      daylightPoints: outcome.result.daylightPoints,
      sourceBoundaryPoints: outcome.result.sourceBoundaryPoints!,
      side: 'left',
    })).toBeNull();
  });
});

describe('review fix: retained transition never bypasses via exact-offset', () => {
  // Study route B-DIST (line→arc→line): exact-feasible without intents.
  const arcSource = (
    p0: { x: number; y: number }, p1: { x: number; y: number }, cx: number, cy: number,
  ): ResolvedGradingSource => {
    const radius = Math.hypot(p0.x - cx, p0.y - cy);
    const a0 = Math.atan2(p0.y - cy, p0.x - cx);
    let a1 = Math.atan2(p1.y - cy, p1.x - cx);
    while (a1 >= a0) a1 -= 2 * Math.PI;
    return {
      startX: p0.x, startY: p0.y, endX: p1.x, endY: p1.y,
      startZ: 0, endZ: 0, length: radius * Math.abs(a1 - a0),
      reoriented: false, isArc: true,
      arc: { centerX: cx, centerY: cy, radius, startAngle: a0, endAngle: a1, sweepCCW: false },
    };
  };
  const lineSource = (x0: number, y0: number, x1: number, y1: number): ResolvedGradingSource => ({
    startX: x0, startY: y0, endX: x1, endY: y1, startZ: 0, endZ: 0,
    length: Math.hypot(x1 - x0, y1 - y0), reoriented: false, isArc: false,
  });
  const members: ResolvedGradingSource[] = [
    lineSource(-40, 0, 0, 0),
    arcSource({ x: 0, y: 0 }, { x: 50, y: 50 }, 50, 0),
    lineSource(50, 50, 50, 90),
  ];
  const keys = ['K0', 'K1', 'K2'];
  const base = {
    groupId: 'exact-seam', revision: 'ggrev1:seam', members, side: 'left' as const,
    criterion: DIST(1, 5), maxSearchDistance: 100, curveChordTolerance: 0.01,
    closed: false, transitionMemberKeys: keys,
  };

  it('bare curved group still solves; with a retained intent admission runs (no silent exact)', () => {
    const bare = computeGradingGroupFromSnapshots(base);
    expect(bare.ok).toBe(true);
    const withIntent = computeGradingGroupFromSnapshots({
      ...base,
      transitions: [{
        policyVersion: 'trp1', jointId: 'joint:0', memberIds: ['K0', 'K1'],
        width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
        criterionFamily: 'distance', side: 'left',
      }],
    });
    expect(withIntent.ok).toBe(false);
    if (withIntent.ok) return;
    expect(withIntent.code.startsWith('TRANSITION')).toBe(true);
  });

  it('present-but-non-array transitions fail closed (never silent exact)', () => {
    const malformed = computeGradingGroupFromSnapshots({
      ...base,
      transitions: { jointId: 'joint:0' } as unknown as [],
    });
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.code).toBe('TRANSITION_MALFORMED');
  });
});

describe('review fix: SET rejects non-canonical jointIds', () => {
  const group = (): CadGradingGroup => ({
    id: 'gg', name: 'gg', sourceFeatureLineId: 'fl',
    sourceCourses: [
      { vertexAId: 'v-a', vertexBId: 'v-b' },
      { vertexAId: 'v-b', vertexBId: 'v-c' },
      { vertexAId: 'v-c', vertexBId: 'v-d' },
    ],
    side: 'left', criterion: DIST(0.5, 5), maxSearchDistance: 50,
    curveChordTolerance: 0.01, cornerMode: 'miter',
  });
  const intentAt = (jointId: string, memberIds: [string, string]) => ({
    policyVersion: 'trp1', jointId, memberIds, width: 8,
    lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
    criterionFamily: 'distance', side: 'left' as const,
  });

  it('leading-zero spellings fail at SET; canonical spelling writes', () => {
    expect(setGroupTransition(group(), intentAt('joint:01', ['v-b>v-c', 'v-c>v-d'])).ok).toBe(false);
    expect(setGroupTransition(group(), intentAt('joint:00', ['v-a>v-b', 'v-b>v-c'])).ok).toBe(false);
    const written = setGroupTransition(group(), intentAt('joint:1', ['v-b>v-c', 'v-c>v-d']));
    expect(written.ok).toBe(true);
  });
});

describe('review fix: malformed retained memberIds fail closed in service planning', () => {
  const memberSources: ResolvedGradingSource[] = [
    { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
    { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
  ];
  const group = (): CadGradingGroup => ({
    id: 'gg', name: 'gg', sourceFeatureLineId: 'fl',
    sourceCourses: [
      { vertexAId: 'v-a', vertexBId: 'v-b' },
      { vertexAId: 'v-b', vertexBId: 'v-c' },
    ],
    side: 'left', criterion: DIST(0.5, 5), maxSearchDistance: 50,
    curveChordTolerance: 0.05, cornerMode: 'miter',
  });
  const inputsOf = (transitions: unknown) => ({
    group: group(),
    memberSources,
    memberCriteria: [DIST(0.5, 5), DIST(0.5, 5)],
    memberKeys: ['A>B', 'B>C'],
    transitions: transitions as CadGradingGroup['transitions'],
    revision: 'ggrev1:fg',
  });

  it.each([
    ['missing memberIds', { policyVersion: 'trp1', jointId: 'joint:0', width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' }],
    ['non-array memberIds', { policyVersion: 'trp1', jointId: 'joint:0', memberIds: 'A>B', width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' }],
    ['short memberIds', { policyVersion: 'trp1', jointId: 'joint:0', memberIds: ['A>B'], width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' }],
  ])('%s rejects bounded without throwing', (_label, intent) => {
    let planned: ReturnType<typeof planGroupTransitionRequest>;
    expect(() => {
      planned = planGroupTransitionRequest(inputsOf([intent]));
    }).not.toThrow();
    expect(planned!.kind).toBe('rejected');
  });
});

describe('review fix: product gates are positional and unconditional', () => {
  let seq = 0;
  const projectWithChain = (): { project: CadProject; chainId: string } => {
    const drawing = createBlankCadDrawingDocument({ name: 'ReviewFix', units: 'm' });
    seq += 1;
    const chainId = `fl-reviewfix-${seq}`;
    const chain: CadFeatureLineEntity = {
      id: chainId, type: 'feature-line', layerId: 'general', visible: true,
      locked: false, name: `FL ${chainId}`,
      vertices: [
        { id: `feature-vertex:${chainId}:a`, x: 0, y: 0, z: 10 },
        { id: `feature-vertex:${chainId}:b`, x: 30, y: 0, z: 10 },
        { id: `feature-vertex:${chainId}:c`, x: 54, y: 0, z: 10 },
        { id: `feature-vertex:${chainId}:d`, x: 84, y: 0, z: 10 },
      ],
    };
    return { project: { ...drawing.project, entities: [chain] }, chainId };
  };
  const setup = (withIntents: boolean) => {
    const { project, chainId } = projectWithChain();
    const fl = project.entities.find((entry) => entry.id === chainId) as CadFeatureLineEntity;
    const [a, b, c, d] = fl.vertices.map((v) => v.id);
    const created = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE', name: 'RF', sourceFeatureLineId: chainId,
      sourceCourses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: b!, vertexBId: c! },
        { vertexAId: c!, vertexBId: d! },
      ],
      side: 'left', criterion: DIST(0.5, 5), maxSearchDistance: 50, curveChordTolerance: 0.05,
    });
    const grouped = created.present.project;
    const groupId = grouped.gradingGroups![0]!.id;
    const inputs = resolveGroupInputs(grouped, groupId);
    if (!inputs) throw new Error('group inputs did not resolve');
    const [k0, k1, k2] = inputs.memberKeys;
    const projectWith = withIntents
      ? {
          ...grouped,
          gradingGroups: (grouped.gradingGroups ?? []).map((entry) =>
            entry.id !== groupId
              ? entry
              : {
                  ...entry,
                  transitions: [
                    { policyVersion: 'trp1', jointId: 'joint:0', memberIds: [k0, k1], width: 8, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' as const },
                    { policyVersion: 'trp1', jointId: 'joint:1', memberIds: [k1, k2], width: 6, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' as const },
                  ],
                },
          ),
        }
      : grouped;
    const live = resolveGroupInputs(projectWith, groupId);
    if (!live) throw new Error('live inputs did not resolve');
    const outcome = computeGradingGroupFromSnapshots({
      groupId, revision: live.revision, members: live.memberSources, side: live.group.side,
      criterion: live.group.criterion, memberCriteria: live.memberCriteria,
      maxSearchDistance: live.group.maxSearchDistance, curveChordTolerance: live.group.curveChordTolerance,
      closed: false, transitions: live.group.transitions, transitionMemberKeys: live.memberKeys,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('solve failed');
    return { project: projectWith, groupId, revision: live.revision, result: outcome.result };
  };

  it('out-of-order legs refuse bake and extract (never silently normalized)', () => {
    const { project, groupId, revision, result } = setup(true);
    expect(result.transitions).toHaveLength(2);
    const reordered = { ...result, transitions: [result.transitions![1]!, result.transitions![0]!] };
    for (const key of ['GROUPBAKE', 'GROUPEXTRACTDAYLIGHT'] as const) {
      const refused = runCadCommand(createCadHistoryState(project), {
        key, groupId, result: reordered, expectedRevision: revision, sessionCurrent: true,
      });
      expect(refused.undoStack).toHaveLength(0);
    }
  });

  it('intents with a leg-free result refuse bake; legacy leg-free still bakes', () => {
    const transitioned = setup(true);
    const stripped = { ...transitioned.result, transitions: undefined, transition: undefined };
    const refused = runCadCommand(createCadHistoryState(transitioned.project), {
      key: 'GROUPBAKE', groupId: transitioned.groupId, result: stripped,
      expectedRevision: transitioned.revision, sessionCurrent: true,
    });
    expect(refused.undoStack).toHaveLength(0);
    const legacy = setup(false);
    const baked = runCadCommand(createCadHistoryState(legacy.project), {
      key: 'GROUPBAKE', groupId: legacy.groupId, result: legacy.result,
      expectedRevision: legacy.revision, sessionCurrent: true,
    });
    expect(baked.undoStack).toHaveLength(1);
  });

  it('transitioned mesh with citation-less family refuses bake even when result and intent agree', () => {
    const genuine = setup(true);
    // Control: the genuine mesh+certificate commits on this path.
    const baked = runCadCommand(createCadHistoryState(genuine.project), {
      key: 'GROUPBAKE', groupId: genuine.groupId, result: genuine.result,
      expectedRevision: genuine.revision, sessionCurrent: true,
    });
    expect(baked.undoStack).toHaveLength(1);
    // Forged definition (family 'bogus' on both intents): recompute the
    // live revision and patch it into the result/legs so revision, mesh,
    // certificate, AND positional leg↔intent matching all pass — the only
    // remaining gate that can refuse is the citation check.
    const bogusProject = {
      ...genuine.project,
      gradingGroups: (genuine.project.gradingGroups ?? []).map((entry) =>
        entry.id !== genuine.groupId
          ? entry
          : { ...entry, transitions: entry.transitions!.map((t) => ({ ...t, criterionFamily: 'bogus' })) },
      ),
    };
    const live = resolveGroupInputs(bogusProject, genuine.groupId);
    if (!live) throw new Error('bogus inputs did not resolve');
    expect(live.revision).not.toBe(genuine.revision);
    const bogusLegs = genuine.result.transitions!.map((leg) => ({
      ...leg, criterionFamily: 'bogus', recordedRevision: live.revision,
    }));
    const refused = runCadCommand(createCadHistoryState(bogusProject), {
      key: 'GROUPBAKE', groupId: genuine.groupId,
      result: { ...genuine.result, revision: live.revision, transitions: bogusLegs },
      expectedRevision: live.revision, sessionCurrent: true,
    });
    expect(refused.undoStack).toHaveLength(0);
  });
});

describe('review fix: null transition intent fails closed without throwing', () => {
  const members = [
    { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
    { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
  ];
  const baseInput: GroupSolveInput = {
    groupId: 'null-guard', revision: 'ggrev1:ng', members, side: 'left',
    criterion: DIST(0.5, 5), maxSearchDistance: 50, curveChordTolerance: 0.05,
    closed: false, transitionMemberKeys: ['A>B', 'B>C'],
  };

  it.each([
    ['null singular', { transition: null }],
    ['null array element', { transitions: [null] }],
  ])('%s returns TRANSITION_MALFORMED, never throws', (_label, extra) => {
    let outcome: ReturnType<typeof computeGradingGroupFromSnapshots> | undefined;
    expect(() => {
      outcome = computeGradingGroupFromSnapshots({ ...baseInput, ...extra } as unknown as GroupSolveInput);
    }).not.toThrow();
    expect(outcome!.ok).toBe(false);
    if (!outcome!.ok) expect(outcome!.code).toBe('TRANSITION_MALFORMED');
  });
});

describe('review fix: sanitizer preserves evidence types, null evidence fails closed', () => {
  const intent = (overrides?: Record<string, unknown>): Record<string, unknown> => ({
    policyVersion: 'trp1', jointId: 'joint:0', memberIds: ['A>B', 'B>C'], width: 8,
    lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left',
    ...overrides,
  });

  it('string-typed endpoint values survive sanitation (no Number() repair)', () => {
    const kept = sanitizeTransitions([
      intent({ endpoints: { refs: ['A>B', 'B>C'], values: ['7', 9] } }),
    ]);
    expect(kept?.length).toBe(1);
    expect(typeof kept![0]!.endpoints!.values[0]).toBe('string');
    expect(kept![0]!.endpoints!.values).toEqual(['7', 9]);
  });

  it('loaded string-typed values fail the strict engine evidence compare', () => {
    const kept = sanitizeTransitions([
      intent({ endpoints: { refs: ['A>B', 'B>C'], values: ['5', 7] } }),
    ])!;
    const outcome = computeGradingGroupFromSnapshots({
      groupId: 'ev-types', revision: 'ggrev1:ev',
      members: [
        { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
        { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
      ],
      side: 'left', criterion: DIST(0.5, 5),
      memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      transitions: kept as unknown as CadGradingTransition[],
      transitionMemberKeys: ['A>B', 'B>C'],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('TRANSITION_STALE');
  });

  it.each([
    ['null endpoints', { endpoints: null }],
    ['null provenance', { provenance: null }],
    ['missing provenance members', { provenance: { jointId: 'joint:0' } }],
    ['array endpoints', { endpoints: [] }],
    ['array provenance', { provenance: [] }],
  ])('present-but-%s sanitizes to a malformed marker (never absent)', (_label, evidence) => {
    const kept = sanitizeTransitions([intent(evidence)]);
    expect(kept?.length).toBe(1);
    if ('provenance' in evidence && evidence.provenance && !Array.isArray(evidence.provenance)) {
      expect(kept![0]!.provenance?.memberIds).toEqual([]);
    } else {
      expect(kept![0]!.policyVersion).toBe('');
      expect(kept![0]!.endpoints).toBeUndefined();
    }
  });

  it.each([
    ['null', null],
    ['array', []],
    ['incomplete object', { jointId: 'joint:0' }],
    ['contradictory width', { jointId: 'joint:0', memberIds: ['A>B', 'B>C'], width: 9, lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance', side: 'left' }],
  ])('in-memory %s evidence fails closed at engine and service without throwing', (_label, malformed) => {
    const engineInput: GroupSolveInput = {
      groupId: 'ev-null', revision: 'ggrev1:ev',
      members: [
        { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ: 10, length: 30, reoriented: false, isArc: false },
        { startX: 30, startY: 0, endX: 54, endY: 0, startZ: 10, endZ: 10, length: 24, reoriented: false, isArc: false },
      ],
      side: 'left', criterion: DIST(0.5, 5),
      memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
      transition: intent({ provenance: malformed, ...(Array.isArray(malformed) || malformed === null ? { endpoints: malformed } : {}) }) as unknown as CadGradingTransition,
      transitionMemberKeys: ['A>B', 'B>C'],
    };
    let engineOut: ReturnType<typeof computeGradingGroupFromSnapshots> | undefined;
    expect(() => {
      engineOut = computeGradingGroupFromSnapshots(engineInput);
    }).not.toThrow();
    expect(engineOut!.ok).toBe(false);
    if (!engineOut!.ok) expect(engineOut!.code).toBe('TRANSITION_STALE');
  });
});
