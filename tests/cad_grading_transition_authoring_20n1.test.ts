/**
 * Phase 20N.1 WAVE C/D — per-joint transition authoring, canonical order,
 * revision order-sensitivity, undo/redo round-trip, and the plural
 * (authorized set) pre-mesh expectation.
 *
 * SET appends/replaces by jointId; the emitted list is always canonical
 * increasing + consecutive; a non-consecutive N>1 set fails closed. CLEAR
 * drops only the named joint (last removal drops the key). Sanitation keeps
 * loaded order verbatim — nothing is silently repaired. ggrev1 hashes the
 * ordered array at full width precision, so add/remove/edit/order all move
 * it. The plural expectation declares the single merged open strip 1/1/1
 * from pre-mesh scalars only (never an observed count).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { sanitizeCadGradingGroups } from '../src/engine/cad/grading/gradingGroupPersistence';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import {
  clearGroupTransition,
  groupTransitions,
  setGroupTransition,
} from '../src/engine/cad/grading/gradingTransitionAuthoring';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import type { CadGradingGroup, CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const COURSES = [
  { vertexAId: 'v-a', vertexBId: 'v-b' },
  { vertexAId: 'v-b', vertexBId: 'v-c' },
  { vertexAId: 'v-c', vertexBId: 'v-d' },
  { vertexAId: 'v-d', vertexBId: 'v-e' },
];

const group = (courses = COURSES): CadGradingGroup => ({
  id: 'gg',
  name: 'gg',
  sourceFeatureLineId: 'fl',
  sourceCourses: courses.map((c) => ({ ...c })),
  side: 'left',
  criterion: DIST(0.5, 5),
  maxSearchDistance: 50,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
});

const intent = (o?: Partial<CadGradingTransition>): CadGradingTransition => ({
  policyVersion: 'trp1',
  jointId: 'joint:0',
  memberIds: ['v-a>v-b', 'v-b>v-c'],
  width: 8,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  side: 'left',
  ...o,
});

const joint1 = intent({ jointId: 'joint:1', memberIds: ['v-b>v-c', 'v-c>v-d'], width: 6 });

describe('20N.1 Wave C authoring: canonical per-joint set', () => {
  it('appends a second consecutive joint in canonical order and replaces per jointId', () => {
    const first = setGroupTransition(group(), intent());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const both = setGroupTransition(first.value, joint1);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(groupTransitions(both.value)).toMatchObject([
      { jointId: 'joint:0', width: 8 },
      { jointId: 'joint:1', width: 6 },
    ]);
    // Replace-by-jointId is one record, order preserved.
    const edited = setGroupTransition(both.value, intent({ width: 4 }));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(groupTransitions(edited.value)).toMatchObject([
      { jointId: 'joint:0', width: 4 },
      { jointId: 'joint:1', width: 6 },
    ]);
  });

  it('fails closed on non-consecutive, out-of-range, and member-ref-mismatch intents', () => {
    const first = setGroupTransition(group(), intent());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // joint:2 leaves a sparse set {0, 2}.
    expect(setGroupTransition(first.value, intent({ jointId: 'joint:2', memberIds: ['v-c>v-d', 'v-d>v-e'] })).ok).toBe(false);
    // 3-course group has no joint:2 at all.
    expect(setGroupTransition(group(COURSES.slice(0, 3)), intent({ jointId: 'joint:2', memberIds: ['v-c>v-d', 'v-d>v-e'] })).ok).toBe(false);
    // memberIds must resolve to the adjacent courses.
    expect(setGroupTransition(group(), intent({ memberIds: ['v-b>v-c', 'v-c>v-d'] })).ok).toBe(false);
  });

  it('clears only the named joint and drops the key on the last removal', () => {
    const first = setGroupTransition(group(), intent());
    if (!first.ok) throw new Error('setup');
    const both = setGroupTransition(first.value, joint1);
    if (!both.ok) throw new Error('setup');
    const one = clearGroupTransition(both.value, 'joint:0');
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(groupTransitions(one.value)).toMatchObject([{ jointId: 'joint:1' }]);
    const none = clearGroupTransition(one.value, 'joint:1');
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect('transitions' in none.value).toBe(false);
    expect(clearGroupTransition(none.value, 'joint:1').ok).toBe(false);
  });

  it('validates touching/overlap/width against supplied geometry, skips when absent', () => {
    const geometry = {
      jointMemberLengths: {
        'joint:0': [30, 24] as [number, number],
        'joint:1': [24, 30] as [number, number],
      },
    };
    const first = setGroupTransition(group(), intent(), geometry);
    if (!first.ok) throw new Error('setup');
    expect(setGroupTransition(first.value, joint1, geometry).ok).toBe(true);
    // Joint pair is required for separation: 4 + 20 == 24 touching, 4 + 21 > 24 overlap,
    // and 49 > 2*min(24, 30) is width-infeasible.
    expect(setGroupTransition(first.value, intent({ jointId: 'joint:1', memberIds: ['v-b>v-c', 'v-c>v-d'], width: 40 }), geometry).ok).toBe(false);
    expect(setGroupTransition(first.value, intent({ jointId: 'joint:1', memberIds: ['v-b>v-c', 'v-c>v-d'], width: 42 }), geometry).ok).toBe(false);
    expect(setGroupTransition(first.value, intent({ jointId: 'joint:1', memberIds: ['v-b>v-c', 'v-c>v-d'], width: 49 }), geometry).ok).toBe(false);
    // No context: structural commit succeeds; the compute fails closed later.
    expect(setGroupTransition(group(), intent({ width: 40 })).ok).toBe(true);
  });

  it('sanitation retains loaded order verbatim (never repaired or sorted)', () => {
    const raw = { ...group(COURSES.slice(0, 3)), transitions: [joint1, intent()] };
    const [sanitized] = sanitizeCadGradingGroups([raw]);
    expect(sanitized!.transitions!.map((t) => t.jointId)).toEqual(['joint:1', 'joint:0']);
  });
});

describe('20N.1 Wave C revision: ordered array, full width precision', () => {
  const straight = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource => ({
    startX: sx, startY: sy, endX: ex, endY: ey, startZ: 10, endZ: 10,
    length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
  });

  const revisionOf = (transitions: CadGradingTransition[]): string =>
    buildGroupRevision({
      sourceFeatureLineId: 'fl',
      courses: [
        { vertexAId: 'v-a', vertexBId: 'v-b', resolvedSource: straight(0, 0, 100, 0) },
        { vertexAId: 'v-b', vertexBId: 'v-c', resolvedSource: straight(100, 0, 200, 0) },
      ],
      side: 'left',
      criterion: DIST(0.5, 5),
      transitions,
      maxSearchDistance: 50,
      curveChordTolerance: 0.01,
      cornerMode: 'miter',
      closed: false,
    });

  it('is order-sensitive and moves on add/remove/edit at full width precision', () => {
    const base = revisionOf([intent()]);
    expect(revisionOf([joint1, intent()])).not.toBe(base);
    expect(revisionOf([intent(), joint1])).not.toBe(revisionOf([joint1, intent()]));
    expect(revisionOf([intent({ width: 4 })])).not.toBe(base);
    expect(revisionOf([intent({ width: 8 }), joint1])).not.toBe(base);
    expect(revisionOf([])).not.toBe(base);
    expect(revisionOf([intent({ width: 8.0000000001 })])).not.toBe(base);
  });
});

describe('20N.1 Wave C undo/redo: whole ordered array round-trips', () => {
  it('SET twice then undo/redo restores the exact ordered array', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'P', units: 'm' });
    const project: CadProject = { ...drawing.project, gradingGroups: [group()] };
    const history = createCadHistoryState(project);
    const one = runCadCommand(history, { key: 'GROUP_SET_TRANSITION', groupId: 'gg', intent: intent() });
    const two = runCadCommand(one, { key: 'GROUP_SET_TRANSITION', groupId: 'gg', intent: joint1 });
    expect(groupTransitions(two.present.project.gradingGroups![0]!).map((t) => t.jointId)).toEqual(['joint:0', 'joint:1']);
    const backOne = undoCadHistory(two);
    expect(groupTransitions(backOne.present.project.gradingGroups![0]!).map((t) => t.jointId)).toEqual(['joint:0']);
    const backTwo = undoCadHistory(backOne);
    expect(groupTransitions(backTwo.present.project.gradingGroups![0]!)).toEqual([]);
    const forwardTwo = redoCadHistory(redoCadHistory(backTwo));
    expect(groupTransitions(forwardTwo.present.project.gradingGroups![0]!).map((t) => t.jointId)).toEqual(['joint:0', 'joint:1']);
  });
});

describe('20N.1 Wave D plural expectation: pre-mesh merged strip 1/1/1', () => {
  const base = { scope: 'group' as const, closed: false, positiveWidthRegions: 0 };
  const pair = (widths: [number, number], gap: number) => [
    { jointId: 'joint:0', width: widths[0], memberLengths: [30, gap] as [number, number], transitionCount: 1, isOpen: true },
    { jointId: 'joint:1', width: widths[1], memberLengths: [gap, 30] as [number, number], transitionCount: 1, isOpen: true },
  ];

  it('declares 1/1/1 for a strictly-separated consecutive pair', () => {
    const out = deriveTransitionExpectation(base, pair([8, 6], 24));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.expectation).toMatchObject({
      scope: 'group', closed: false, expectedFaceComponents: 1, expectedBoundaryCycles: 1, positiveWidthRegionCount: 1,
    });
  });

  it('fails closed on touching/overlap/sparse/reorder/shared-length mismatch', () => {
    expect(deriveTransitionExpectation(base, pair([8, 6], 7)).ok).toBe(false);
    expect(deriveTransitionExpectation(base, pair([8, 6], 5)).ok).toBe(false);
    expect(deriveTransitionExpectation(base, [{ ...pair([8, 6], 24)[0]!, jointId: 'joint:2' }, pair([8, 6], 24)[1]!]).ok).toBe(false);
    expect(deriveTransitionExpectation(base, [pair([8, 6], 24)[1]!, pair([8, 6], 24)[0]!]).ok).toBe(false);
    expect(deriveTransitionExpectation(base, [pair([8, 6], 24)[0]!, { ...pair([8, 6], 24)[1]!, memberLengths: [25, 30] }]).ok).toBe(false);
  });

  it('leaves the singular count-1 contract byte-identical (count 2 still rejects)', () => {
    expect(deriveTransitionExpectation(base, {
      jointId: 'joint:0', width: 8, memberLengths: [20, 20], transitionCount: 1, isOpen: true,
    }).ok).toBe(true);
    const two = deriveTransitionExpectation(base, {
      jointId: 'joint:0', width: 8, memberLengths: [20, 20], transitionCount: 2, isOpen: true,
    });
    expect(two).toMatchObject({ ok: false, code: 'GRADING_AGREEMENT_TRANSITION_OVERLAP' });
  });
});
