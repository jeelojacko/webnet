/**
 * Phase 20M.2 WAVE H — minimal transition editor.
 *
 * Explicit user action adds/removes ONE transition at a valid joint with an
 * explicit numeric total width and the single TRANSITION_LINEAR_V1 law
 * (version persisted). No auto-width, no implicit creation; unsupported
 * joints carry the truthful admission reason; removal restores legacy;
 * commits are single undo steps and the operator recalculates after commit.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';
import {
  clearGroupTransition,
  groupTransitions,
  setGroupTransition,
  transitionJointEligibility,
  validateTransitionWidth,
} from '../src/engine/cad/grading/gradingTransitionAuthoring';
import type { TransitionPersistedIntent } from '../src/engine/cad/grading/gradingTransitionProvenance';

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const src = (sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10, isArc = false): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc,
});

const group = (o?: Partial<CadGradingGroup>): CadGradingGroup => ({
  id: 'gg-h',
  name: 'H',
  sourceFeatureLineId: 'fl',
  sourceCourses: [
    { vertexAId: 'a', vertexBId: 'b' },
    { vertexAId: 'b', vertexBId: 'c' },
  ],
  side: 'left',
  criterion: DIST(0.5, 5),
  maxSearchDistance: 10,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  ...o,
});

const criteria = (c0: GradingCriterion, c1: GradingCriterion): GradingCriterion[] => [c0, c1];

const intent = (o?: Partial<TransitionPersistedIntent>): TransitionPersistedIntent => ({
  policyVersion: 'trp1',
  jointId: 'joint:0',
  memberIds: ['a>b', 'b>c'],
  width: 8,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  side: 'left',
  ...o,
});

describe('20M.2 WAVE H transition editor', () => {
  it('admits a valid joint and reports truthful reasons for unsupported joints', () => {
    const g = group();
    const good = [src(-20, 0, 0, 0), src(0, 0, 20, 0)];
    const ok = transitionJointEligibility({
      group: g, memberSources: good, memberCriteria: criteria(DIST(0.5, 5), DIST(0.5, 7)), side: 'left', jointIndex: 0,
    });
    expect(ok).toEqual({ ok: true, jointId: 'joint:0', memberIds: ['a>b', 'b>c'] });
    const bad = (
      sources: ResolvedGradingSource[],
      memberCriteria: GradingCriterion[],
      grp: CadGradingGroup = g,
    ): string => {
      const out = transitionJointEligibility({ group: grp, memberSources: sources, memberCriteria, side: 'left', jointIndex: 0 });
      expect(out.ok).toBe(false);
      return (out as { ok: false; reason: string }).reason;
    };
    expect(bad([src(-20, 0, 0, 0, 10, 10, true), src(0, 0, 20, 0)], criteria(DIST(0.5, 5), DIST(0.5, 7)))).toContain('arc');
    expect(bad([src(-20, 0, 0, 0), src(0, 0, 0, 20)], criteria(DIST(0.5, 5), DIST(0.5, 7)))).toContain('exactly 0');
    expect(bad([src(-20, 0, 0, 0, 10, 12), src(0, 0, 20, 0)], criteria(DIST(0.5, 5), DIST(0.5, 7)))).toContain('flat');
    expect(bad([src(-20, 0, 0, 0, 10, 10), src(0, 0, 20, 0, 11, 11)], criteria(DIST(0.5, 5), DIST(0.5, 7)))).toContain('continuous');
    expect(bad(good, criteria(DIST(0.5, 5), DIST(0.75, 7)))).toContain('gradeRatio');
    expect(bad(good, criteria(DIST(0.5, 5), { kind: 'elevation', gradeRatio: 0.5, targetElevation: 10 }))).toContain('family');
    expect(bad(good, criteria(DIST(0.5, 5), DIST(0.5, 7)), group({ closed: true }))).toContain('closed');
    expect(transitionJointEligibility({ group: g, memberSources: good, memberCriteria: criteria(DIST(0.5, 5), DIST(0.5, 7)), side: 'left', jointIndex: 3 }))
      .toMatchObject({ ok: false });
  });

  it('validates explicit width (no implicit default, no auto-fit)', () => {
    expect(validateTransitionWidth(8, [20, 20])).toBeNull();
    expect(validateTransitionWidth(0, [20, 20])).toContain('> 0');
    expect(validateTransitionWidth(NaN, [20, 20])).toContain('finite');
    expect(validateTransitionWidth(41, [20, 20])).toContain('2×min');
  });

  it('commits one transition, replaces same-joint edits, rejects the rest, and restores legacy on removal', () => {
    const g = group();
    expect(groupTransitions(g)).toEqual([]);
    const set = setGroupTransition(g, intent());
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(groupTransitions(set.value)).toHaveLength(1);
    // Same-joint edit replaces (width change is one record, never two).
    const edit = setGroupTransition(set.value, intent({ width: 4 }));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(groupTransitions(edit.value)).toMatchObject([{ jointId: 'joint:0', width: 4 }]);
    // A second joint is not authorized under trp1.
    expect(setGroupTransition(set.value, intent({ jointId: 'joint:1', memberIds: ['b>c', 'c>d'] })).ok).toBe(false);
    expect(setGroupTransition(g, intent({ lawKind: 'NOPE' })).ok).toBe(false);
    expect(setGroupTransition(g, intent({ width: -1 })).ok).toBe(false);
    expect(setGroupTransition(group({ closed: true }), intent()).ok).toBe(false);
    // Removal drops the key: byte-identical legacy shape.
    const cleared = clearGroupTransition(edit.value);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect('transitions' in cleared.value).toBe(false);
    expect(clearGroupTransition(g).ok).toBe(false);
  });

  it('runs set/clear as single undo steps through the REAL command path', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Transition Editor', units: 'm' });
    const project: CadProject = { ...drawing.project, gradingGroups: [group()] };
    const history = createCadHistoryState(project);
    const done = runCadCommand(history, { key: 'GROUP_SET_TRANSITION', groupId: 'gg-h', intent: intent() });
    expect(done.undoStack).toHaveLength(1);
    const committed = done.present.project.gradingGroups![0]! as CadGradingGroup;
    expect(groupTransitions(committed)).toMatchObject([{ jointId: 'joint:0', width: 8 }]);
    // A rejected intent mutates nothing (no new undo entry).
    const rejected = runCadCommand(done, {
      key: 'GROUP_SET_TRANSITION',
      groupId: 'gg-h',
      intent: intent({ jointId: 'joint:1', memberIds: ['b>c', 'c>d'] }),
    });
    expect(rejected.undoStack).toHaveLength(1);
    const undone = undoCadHistory(done);
    expect(groupTransitions(undone.present.project.gradingGroups![0]!)).toEqual([]);
    expect(redoCadHistory(undone).present.project.gradingGroups).toHaveLength(1);
    const cleared = runCadCommand(done, { key: 'GROUP_CLEAR_TRANSITION', groupId: 'gg-h' });
    expect(cleared.undoStack).toHaveLength(2);
    expect('transitions' in cleared.present.project.gradingGroups![0]!).toBe(false);
    expect(undoCadHistory(cleared).present.project.gradingGroups).toHaveLength(1);
  });
});
