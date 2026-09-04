import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS, EXAM_PREP_LEARN_UNITS } from '../../src/study/examPrep/examPrepRecallTasks';
import {
  isExamPrepUnitStudied,
  selectStudiedLearnUnitCount,
  selectUnitStudiedAt,
  selectUnitProgressForUnit,
  selectCurrentUnitProgress,
  selectCurrentRecallProgress,
  selectCurrentRecallProgressForTask,
  isExamPrepRecallIntroduced,
  isExamPrepRecallDue,
  selectDueRecallTaskCount,
  selectNewRecallTaskCount,
  selectIntroducedRecallTaskCount,
  buildExamPrepHomeMetrics,
  selectStudiedForUnit,
  selectRecommendedLearnUnit,
} from '../../src/study/examPrep/examPrepSelectors';
import { isCurrentExamPrepBinding, isSameCurriculumOtherHash } from '../../src/study/examPrep/examPrepManifest';
import type { ExamPrepRecallProgress } from '../../src/study/examPrep/examPrepTypes';
import {
  archivedBinding,
  currentBinding,
  makeRecallProgress,
  makeUnitProgress,
  otherCurriculumBinding,
  testCard,
} from './exam_prep_test_support';

const firstTask = EXAM_PREP_RECALL_TASKS[0];
if (!firstTask) throw new Error('expected recall tasks');

const firstUnit = EXAM_PREP_LEARN_UNITS[0];
if (!firstUnit) throw new Error('expected learn units');

describe('Exam Prep binding helpers', () => {
  it('current binding matches the frozen manifest', () => {
    expect(isCurrentExamPrepBinding(currentBinding)).toBe(true);
    expect(isCurrentExamPrepBinding(archivedBinding)).toBe(false);
    expect(isSameCurriculumOtherHash(archivedBinding)).toBe(true);
    expect(isSameCurriculumOtherHash(otherCurriculumBinding)).toBe(false);
    expect(isSameCurriculumOtherHash(currentBinding)).toBe(false);
  });
});

describe('Exam Prep current-binding selectors', () => {
  it('filters unit progress to the current curriculum content hash', () => {
    const archived = makeUnitProgress(firstUnit.id, '2026-09-01T00:00:00.000Z', archivedBinding);
    const current = makeUnitProgress(firstUnit.id, '2026-09-05T00:00:00.000Z', currentBinding);
    const other = makeUnitProgress(firstUnit.id, '2026-09-01T00:00:00.000Z', otherCurriculumBinding);
    const records = [archived, current, other];
    expect(selectCurrentUnitProgress(records)).toEqual([current]);
    expect(isExamPrepUnitStudied(records, firstUnit.id)).toBe(true);
    expect(selectUnitStudiedAt(records, firstUnit.id)).toBe('2026-09-05T00:00:00.000Z');
    expect(selectUnitProgressForUnit(records, firstUnit.id)).toEqual(current);
  });

  it('reports studied/not-studied independent of recall state', () => {
    expect(isExamPrepUnitStudied([], firstUnit.id)).toBe(false);
    expect(selectUnitStudiedAt([], firstUnit.id)).toBeNull();
    expect(selectStudiedForUnit([], firstUnit.id)).toEqual({ studied: false, studiedAt: null });
    const record = makeUnitProgress(firstUnit.id);
    expect(selectStudiedForUnit([record], firstUnit.id)).toEqual({
      studied: true,
      studiedAt: record.studiedAt,
    });
  });

  it('studied counts only current-hash records over the 133 learn units', () => {
    const unit = EXAM_PREP_LEARN_UNITS[0];
    const current = makeUnitProgress(unit.id);
    const archived = makeUnitProgress(EXAM_PREP_LEARN_UNITS[1].id, '2026-09-01T00:00:00.000Z', archivedBinding);
    expect(selectStudiedLearnUnitCount([current, archived])).toBe(1);
    expect(selectStudiedLearnUnitCount([])).toBe(0);
  });

  it('recall progress filtering ignores archived/other-curriculum records', () => {
    const current = makeRecallProgress({
      taskId: firstTask.id,
      unitId: firstTask.unitId,
      card: testCard(),
    });
    const archived = makeRecallProgress({
      taskId: EXAM_PREP_RECALL_TASKS[1].id,
      unitId: EXAM_PREP_RECALL_TASKS[1].unitId,
      card: testCard(),
      binding: archivedBinding,
    });
    const other = makeRecallProgress({
      taskId: EXAM_PREP_RECALL_TASKS[2].id,
      unitId: EXAM_PREP_RECALL_TASKS[2].unitId,
      card: testCard(),
      binding: otherCurriculumBinding,
    });
    const records = [archived, other, current];
    expect(selectCurrentRecallProgress(records)).toEqual([current]);
    expect(selectCurrentRecallProgressForTask(records, firstTask.id)).toEqual(current);
    expect(selectCurrentRecallProgressForTask(records, EXAM_PREP_RECALL_TASKS[1].id)).toBeNull();
  });

  it('treats uninitialized recall progress as not introduced and not due', () => {
    const uninitialized: ExamPrepRecallProgress = {
      ...makeRecallProgress({
        taskId: firstTask.id,
        unitId: firstTask.unitId,
        card: testCard(),
      }),
      scheduling: { schemaVersion: 1, algorithm: 'fsrs' as const, initialized: false, configVersion: 1 },
    };
    expect(isExamPrepRecallIntroduced(uninitialized)).toBe(false);
    expect(isExamPrepRecallDue(uninitialized, new Date('2026-09-10T00:00:00.000Z'))).toBe(false);
  });
});

describe('Exam Prep recommended next Learn unit', () => {
  const progressFor = (units: typeof EXAM_PREP_LEARN_UNITS) =>
    units.map((unit) => makeUnitProgress(unit.id));

  it('returns the highest-priority unstudied unit for a fresh learner', () => {
    expect(selectRecommendedLearnUnit([])).toBe(EXAM_PREP_LEARN_UNITS[0]);
  });

  it('ignores archived and other-curriculum studied records', () => {
    const archived = makeUnitProgress(
      EXAM_PREP_LEARN_UNITS[0].id,
      '2026-09-01T00:00:00.000Z',
      archivedBinding,
    );
    const other = makeUnitProgress(
      EXAM_PREP_LEARN_UNITS[1].id,
      '2026-09-01T00:00:00.000Z',
      otherCurriculumBinding,
    );
    expect(selectRecommendedLearnUnit([archived, other])).toBe(EXAM_PREP_LEARN_UNITS[0]);
  });

  it('prefers an unstudied high-B unit over remaining other-A units', () => {
    const studiedAHigh = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'A' && unit.reviewWeight === 'high',
    );
    const expected = EXAM_PREP_LEARN_UNITS.find(
      (unit) => unit.tier === 'B' && unit.reviewWeight === 'high',
    );
    const recommended = selectRecommendedLearnUnit(progressFor(studiedAHigh));
    expect(recommended).toBe(expected);
  });

  it('walks the full rank ladder: high B, high NAV, other A, other B, other NAV, C, D', () => {
    const highA = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'A' && unit.reviewWeight === 'high',
    );
    const highB = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'B' && unit.reviewWeight === 'high',
    );
    const highNav = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'NAV' && unit.reviewWeight === 'high',
    );
    const otherA = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'A' && unit.reviewWeight !== 'high',
    );
    const otherB = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'B' && unit.reviewWeight !== 'high',
    );
    const otherNav = EXAM_PREP_LEARN_UNITS.filter(
      (unit) => unit.tier === 'NAV' && unit.reviewWeight !== 'high',
    );
    const tierC = EXAM_PREP_LEARN_UNITS.filter((unit) => unit.tier === 'C');
    const tierD = EXAM_PREP_LEARN_UNITS.filter((unit) => unit.tier === 'D');

    expect(selectRecommendedLearnUnit(progressFor(highA))).toBe(highB[0]);
    expect(selectRecommendedLearnUnit(progressFor([...highA, ...highB]))).toBe(highNav[0]);
    expect(
      selectRecommendedLearnUnit(progressFor([...highA, ...highB, ...highNav])),
    ).toBe(otherA[0]);
    expect(
      selectRecommendedLearnUnit(progressFor([...highA, ...highB, ...highNav, ...otherA])),
    ).toBe(otherB[0]);
    expect(
      selectRecommendedLearnUnit(
        progressFor([...highA, ...highB, ...highNav, ...otherA, ...otherB]),
      ),
    ).toBe(otherNav[0]);
    expect(
      selectRecommendedLearnUnit(
        progressFor([...highA, ...highB, ...highNav, ...otherA, ...otherB, ...otherNav]),
      ),
    ).toBe(tierC[0]);
    expect(
      selectRecommendedLearnUnit(
        progressFor([
          ...highA,
          ...highB,
          ...highNav,
          ...otherA,
          ...otherB,
          ...otherNav,
          ...tierC,
        ]),
      ),
    ).toBe(tierD[0]);
    expect(
      selectRecommendedLearnUnit(
        progressFor([
          ...highA,
          ...highB,
          ...highNav,
          ...otherA,
          ...otherB,
          ...otherNav,
          ...tierC,
          ...tierD,
        ]),
      ),
    ).toBeNull();
  });
});

describe('Exam Prep due/introduced/new metrics', () => {
  const now = new Date('2026-09-10T00:00:00.000Z');
  it('counts due, introduced, and new cards over 57 current tasks', () => {
    const due = makeRecallProgress({
      taskId: EXAM_PREP_RECALL_TASKS[0].id,
      unitId: EXAM_PREP_RECALL_TASKS[0].unitId,
      card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
    });
    const future = makeRecallProgress({
      taskId: EXAM_PREP_RECALL_TASKS[1].id,
      unitId: EXAM_PREP_RECALL_TASKS[1].unitId,
      card: testCard({ state: 'Review', due: '2026-10-01T00:00:00.000Z' }),
    });
    const archived = makeRecallProgress({
      taskId: EXAM_PREP_RECALL_TASKS[2].id,
      unitId: EXAM_PREP_RECALL_TASKS[2].unitId,
      card: testCard({ state: 'Review', due: '2026-09-01T00:00:00.000Z' }),
      binding: archivedBinding,
    });
    const records = [due, future, archived];
    expect(isExamPrepRecallDue(due, now)).toBe(true);
    expect(isExamPrepRecallDue(future, now)).toBe(false);
    expect(isExamPrepRecallDue(archived, now)).toBe(false);
    expect(selectIntroducedRecallTaskCount(records)).toBe(2); // archived ignored
    expect(selectDueRecallTaskCount(records, now)).toBe(1);
    expect(selectNewRecallTaskCount(records)).toBe(57 - 2); // two introduced current-hash
  });

  it('builds Home metrics studied X/133, due X, introduced X/57, cards 57', () => {
    const metrics = buildExamPrepHomeMetrics(
      [makeUnitProgress(EXAM_PREP_LEARN_UNITS[0].id)],
      [makeRecallProgress({
        taskId: EXAM_PREP_RECALL_TASKS[0].id,
        unitId: EXAM_PREP_RECALL_TASKS[0].unitId,
        card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
      })],
      now,
    );
    expect(metrics).toEqual({
      studiedLearnUnits: 1,
      totalLearnUnits: 133,
      dueRecallCards: 1,
      introducedRecallCards: 1,
      newRecallCards: 56,
      totalRecallCards: 57,
      recognition: { attemptedTasks: 0, correctLatestTasks: 0, accuracy: null },
      locate: { attemptedTasks: 0, foundLatestTasks: 0, accuracy: null },
      drill: { attemptedDrills: 0, examReadyDrills: 0, totalDrills: 24 },
    });
  });
});
