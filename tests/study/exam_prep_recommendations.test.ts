// Exam Prep Phase 2.5 — Recommended Now / Recommended Drill tests.
//
// selectExamPrepRecommendedAction answers Home's "Recommended now" with the
// fixed advisory priority chain (due Recall → unstudied Learn → missed
// Recognition → missed Locate → Developing drill → Unattempted drill →
// Accurate drill → generic Recognition practice). selectRecommendedExamPrepDrill
// picks the top drill needing work (Developing → Unattempted → Accurate,
// never Exam-ready; then review weight high → medium → low; then canonical
// order). Both helpers are pure, deterministic, advisory, and current-hash
// only: archived/other-curriculum records never participate.

import { describe, expect, it } from 'vitest';
import {
  selectExamPrepRecommendedAction,
  selectRecommendedExamPrepDrill,
  type ExamPrepRecommendedAction,
} from '../../src/study/examPrep/examPrepRecommendations';
import { EXAM_PREP_LEARN_UNITS } from '../../src/study/examPrep/examPrepRecallTasks';
import {
  EXAM_PREP_DRILL_UNITS,
  examPrepDrillTaskId,
} from '../../src/study/examPrep/examPrepDrillFilters';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import type { ExamCurriculumUnit } from '../../src/study/examCurriculum/examCurriculumTypes';
import type { ExamPrepAttempt, ExamPrepDrillAttempt } from '../../src/study/examPrep/examPrepTypes';
import {
  archivedBinding,
  makeDrillAttempt,
  makeLocateAttempt,
  makeRecallProgress,
  makeRecognitionAttempt,
  makeUnitProgress,
  testCard,
} from './exam_prep_test_support';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const DUE_CARD = testCard({ state: 'Review', due: '2026-09-01T00:00:00.000Z' });
const FUTURE_CARD = testCard({ state: 'Review', due: '2099-01-01T00:00:00.000Z' });

const firstRecallTaskId = EXAM_PREP_RECALL_TASKS[0]?.id ?? 'recall:A-NBLS-01:1';

const allLearnStudied = (): ReturnType<typeof makeUnitProgress>[] =>
  EXAM_PREP_LEARN_UNITS.map((unit) => makeUnitProgress(unit.id, '2020-06-01T00:00:00.000Z'));

const recognitionMiss = (id: string, taskId: string): ExamPrepAttempt =>
  makeRecognitionAttempt({
    id,
    taskId,
    unitId: taskId.replace(/^recognition:/, '').split(':')[0] ?? 'A-NBLS-01',
    result: 'missed',
  });

const locateMiss = (id: string, taskId: string): ExamPrepAttempt =>
  makeLocateAttempt({
    id,
    taskId,
    unitId: taskId.replace(/^locate:/, '').split(':')[0] ?? 'A-NBLS-02',
    result: 'missed',
  });

/** A 3/3 within-target drill attempt on one practice date (accurate). */
const qualifyingDrillAttempt = (
  id: string,
  unitId: string,
  practiceDate: string,
  completedAt = `${practiceDate}T12:00:00.000Z`,
): ExamPrepDrillAttempt =>
  makeDrillAttempt({
    id,
    taskId: examPrepDrillTaskId(unitId),
    unitId,
    elapsedSeconds: 45,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: true,
    practiceDate,
    completedAt,
  });

/** A latest-score-2/3 drill attempt (developing). */
const developingDrillAttempt = (id: string, unitId: string): ExamPrepDrillAttempt =>
  makeDrillAttempt({
    id,
    taskId: examPrepDrillTaskId(unitId),
    unitId,
    elapsedSeconds: 90,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: false, // score 2
    practiceDate: '2026-09-03',
    completedAt: '2026-09-03T12:00:00.000Z',
  });

const drillUnit = (id: string): ExamCurriculumUnit => {
  const unit = EXAM_PREP_DRILL_UNITS.find((entry) => entry.id === id);
  if (!unit) throw new Error(`expected drill unit ${id}`);
  return unit;
};

const actionKind = (action: ExamPrepRecommendedAction): string => action.kind;

describe('selectExamPrepRecommendedAction priority chain', () => {
  it('due Recall beats an unstudied Learn unit', () => {
    const action = selectExamPrepRecommendedAction(
      [],
      [makeRecallProgress({ taskId: firstRecallTaskId, unitId: 'A-NBLS-01', card: DUE_CARD })],
      [],
      NOW,
    );
    expect(action).toEqual({ kind: 'recall', count: 1, path: '/study/review' });
  });

  it('unstudied Learn beats a missed Recognition task', () => {
    const action = selectExamPrepRecommendedAction(
      [],
      [],
      [recognitionMiss('miss-1', 'recognition:A-NBLS-01:1')],
      NOW,
    );
    expect(actionKind(action)).toBe('learn');
    if (action.kind !== 'learn') return;
    const unit = EXAM_PREP_LEARN_UNITS.find((entry) => entry.id === action.unitId);
    expect(unit).toBeTruthy();
    expect(unit?.title).toBe(action.title);
    expect(action.path).toBe('/study/learn');
  });

  it('missed Recognition beats missed Locate', () => {
    const attempts = [
      recognitionMiss('miss-r', 'recognition:A-NBLS-01:1'),
      locateMiss('miss-l', 'locate:A-NBLS-02:1'),
    ];
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], attempts, NOW);
    expect(action).toEqual({ kind: 'recognition', reason: 'missed', path: '/study/recognition' });
  });

  it('missed Locate beats a Developing drill', () => {
    const attempts = [
      locateMiss('miss-l', 'locate:A-NBLS-02:1'),
      developingDrillAttempt('dev-1', 'DRILL-01'),
    ];
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], attempts, NOW);
    expect(action).toEqual({ kind: 'locate', reason: 'missed', path: '/study/locate' });
  });

  it('a Developing drill beats an Unattempted drill', () => {
    const action = selectExamPrepRecommendedAction(
      allLearnStudied(),
      [],
      [developingDrillAttempt('dev-1', 'DRILL-01')],
      NOW,
    );
    expect(action).toEqual({
      kind: 'drill',
      drillId: 'DRILL-01',
      title: drillUnit('DRILL-01').title,
      status: 'developing',
      path: '/study/drills',
    });
  });

  it('an Unattempted drill beats an Accurate drill', () => {
    const attempts = [qualifyingDrillAttempt('acc-1', 'DRILL-01', '2026-09-01')];
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], attempts, NOW);
    expect(actionKind(action)).toBe('drill');
    if (action.kind !== 'drill') return;
    expect(action.status).toBe('unattempted');
    expect(action.drillId).not.toBe('DRILL-01');
    expect(action.drillId).toBe('DRILL-02'); // earliest canonical unattempted drill
  });

  it('an Accurate drill beats the generic Recognition-practice fallback', () => {
    const attempts = EXAM_PREP_DRILL_UNITS.map((unit) =>
      qualifyingDrillAttempt(`acc-${unit.id}`, unit.id, '2026-09-01'),
    );
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], attempts, NOW);
    expect(actionKind(action)).toBe('drill');
    if (action.kind !== 'drill') return;
    expect(action.status).toBe('accurate');
    expect(action.drillId).toBe('DRILL-01'); // high weight, earliest canonical
  });

  it('falls back to generic Recognition practice when no drill needs work', () => {
    const attempts = EXAM_PREP_DRILL_UNITS.flatMap((unit) => [
      qualifyingDrillAttempt(`ready-${unit.id}-a`, unit.id, '2026-09-01'),
      qualifyingDrillAttempt(`ready-${unit.id}-b`, unit.id, '2026-09-02'),
    ]);
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], attempts, NOW);
    expect(action).toEqual({ kind: 'recognition', reason: 'practice', path: '/study/recognition' });
  });

  it('ignores archived-hash misses and Developing drills entirely', () => {
    const archivedMiss = makeRecognitionAttempt({
      id: 'archived-miss',
      taskId: 'recognition:A-NBLS-01:1',
      unitId: 'A-NBLS-01',
      result: 'missed',
      binding: archivedBinding,
    });
    const action = selectExamPrepRecommendedAction(
      allLearnStudied(),
      [],
      [archivedMiss],
      NOW,
    );
    // with only archived misses the chain reaches the unattempted drill pool
    expect(actionKind(action)).toBe('drill');
    if (action.kind !== 'drill') return;
    expect(action.status).toBe('unattempted');

    // a genuinely current miss flips the answer back to Recognition
    const current = recognitionMiss('current-miss', 'recognition:A-NBLS-01:2');
    const flipped = selectExamPrepRecommendedAction(allLearnStudied(), [], [archivedMiss, current], NOW);
    expect(flipped).toEqual({ kind: 'recognition', reason: 'missed', path: '/study/recognition' });
  });

  it('uses the latest result per task (a recent got_it clears an older miss)', () => {
    const older = makeRecognitionAttempt({
      id: 'older',
      taskId: 'recognition:A-NBLS-01:1',
      unitId: 'A-NBLS-01',
      result: 'missed',
      completedAt: '2026-09-01T12:00:00.000Z',
    });
    const newer = makeRecognitionAttempt({
      id: 'newer',
      taskId: 'recognition:A-NBLS-01:1',
      unitId: 'A-NBLS-01',
      result: 'got_it',
      completedAt: '2026-09-02T12:00:00.000Z',
    });
    const action = selectExamPrepRecommendedAction(allLearnStudied(), [], [older, newer], NOW);
    expect(actionKind(action)).toBe('drill'); // no outstanding miss
  });

  it('is deterministic for a fixed snapshot and reports due counts from current progress only', () => {
    const unitProgress = [makeUnitProgress('A-NBLS-01', '2020-06-01T00:00:00.000Z')];
    const recallProgress = [
      makeRecallProgress({ taskId: firstRecallTaskId, unitId: 'A-NBLS-01', card: DUE_CARD }),
      // not-yet-due (future) current card must not add to the due count
      makeRecallProgress({ taskId: 'recall:A-NBLS-01:2', unitId: 'A-NBLS-01', card: FUTURE_CARD }),
      // archived due card must not count either
      makeRecallProgress({
        taskId: 'recall:A-NBLS-01:3',
        unitId: 'A-NBLS-01',
        card: DUE_CARD,
        binding: archivedBinding,
      }),
    ];
    const attempts = [recognitionMiss('miss-1', 'recognition:A-NBLS-01:1')];
    const first = selectExamPrepRecommendedAction(unitProgress, recallProgress, attempts, NOW);
    const second = selectExamPrepRecommendedAction(unitProgress, recallProgress, attempts, NOW);
    expect(first).toEqual({ kind: 'recall', count: 1, path: '/study/review' });
    expect(second).toEqual(first);
  });
});

describe('selectRecommendedExamPrepDrill ordering', () => {
  it('ranks Developing above Unattempted above Accurate regardless of list order', () => {
    const attempts = [
      qualifyingDrillAttempt('acc-1', 'DRILL-01', '2026-09-01'), // accurate
      developingDrillAttempt('dev-8', 'DRILL-08'), // developing
    ];
    const units = [drillUnit('DRILL-01'), drillUnit('DRILL-08')];
    const recommended = selectRecommendedExamPrepDrill(attempts, units);
    expect(recommended?.unit.id).toBe('DRILL-08');
    expect(recommended?.stats.status).toBe('developing');
  });

  it('orders Developing drills by review weight high before medium before low', () => {
    const mediumLow = drillUnit('DRILL-08'); // the only medium-weight drill
    const lowClone = { ...mediumLow, id: 'DRILL-99', reviewWeight: 'low' as const };

    // high (DRILL-01) beats medium (DRILL-08)
    const highAttempts = [
      developingDrillAttempt('dev-a', 'DRILL-01'),
      developingDrillAttempt('dev-b', 'DRILL-08'),
    ];
    expect(selectRecommendedExamPrepDrill(highAttempts, [drillUnit('DRILL-08'), drillUnit('DRILL-01')])?.unit.id).toBe(
      'DRILL-01',
    );

    // medium (DRILL-08) beats low (synthetic DRILL-99)
    const mediumAttempts = [
      developingDrillAttempt('dev-c', 'DRILL-08'),
      developingDrillAttempt('dev-d', 'DRILL-99'),
    ];
    expect(
      selectRecommendedExamPrepDrill(mediumAttempts, [lowClone, drillUnit('DRILL-08')])?.unit.id,
    ).toBe('DRILL-08');
  });

  it('breaks ties by canonical order for equal weight and status', () => {
    const attempts = [
      developingDrillAttempt('dev-1', 'DRILL-01'),
      developingDrillAttempt('dev-2', 'DRILL-02'),
    ];
    expect(
      selectRecommendedExamPrepDrill(attempts, [drillUnit('DRILL-01'), drillUnit('DRILL-02')])
        ?.unit.id,
    ).toBe('DRILL-01');
  });

  it('never recommends an Exam-ready drill and is deterministic', () => {
    const attempts = [
      qualifyingDrillAttempt('e1', 'DRILL-01', '2026-09-01'),
      qualifyingDrillAttempt('e2', 'DRILL-01', '2026-09-02'),
    ];
    const units = [drillUnit('DRILL-01')];
    expect(selectRecommendedExamPrepDrill(attempts, units)).toBeNull();
    // with no attempts the same unit is simply Unattempted and recommended
    expect(selectRecommendedExamPrepDrill([], units)?.stats.status).toBe('unattempted');
    // two calls over a stable snapshot agree
    expect(selectRecommendedExamPrepDrill([], units)).toEqual(
      selectRecommendedExamPrepDrill([], units),
    );
  });

  it('ignores archived-hash drill attempts when picking the recommended drill', () => {
    const archivedDeveloping = {
      ...developingDrillAttempt('archived-dev', 'DRILL-01'),
      curriculumId: archivedBinding.curriculumId,
      curriculumContentHash: archivedBinding.curriculumContentHash,
      id: 'archived-dev-2',
    };
    const recommended = selectRecommendedExamPrepDrill(
      [archivedDeveloping],
      EXAM_PREP_DRILL_UNITS,
    );
    expect(recommended?.unit.id).toBe('DRILL-01');
    expect(recommended?.stats.status).toBe('unattempted');
  });
});
