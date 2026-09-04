// Exam Prep Phase 2.5 — "Today's activity" derivation tests.
//
// buildExamPrepTodayActivity derives a per-day summary purely from the
// existing immutable current-binding records on the machine-local calendar
// date. These tests pin the current-hash-only rule and local calendar
// boundaries using local `Date` parts (never UTC slicing), per the phase
// plan: studied units come from `ExamPrepUnitProgress.studiedAt`, recall
// reviews from `ExamPrepRecallAttempt.reviewedAt`, recognition/locate from
// their `completedAt`, and drill attempts from the persisted browser-local
// `practiceDate`.

import { describe, expect, it } from 'vitest';
import { buildExamPrepTodayActivity } from '../../src/study/examPrep/examPrepToday';
import { formatExamPrepLocalDate } from '../../src/study/examPrep/examPrepLocalDate';
import {
  archivedBinding,
  otherCurriculumBinding,
  makeDrillAttempt,
  makeLocateAttempt,
  makeRecallAttempt,
  makeRecognitionAttempt,
  makeUnitProgress,
} from './exam_prep_test_support';

// Fixed local calendar day for the assertions. Using the local `Date`
// constructor keeps every fixture timezone independent.
const localNoon = (year: number, month: number, day: number): Date =>
  new Date(year, month - 1, day, 12, 0, 0);

const now = localNoon(2026, 9, 4);
const dayBefore = (): Date => localNoon(2026, 9, 3);
const dayAfter = (): Date => localNoon(2026, 9, 5);

describe('Exam Prep Today activity', () => {
  it('counts current-hash activity on the local date only (mixed fixture)', () => {
    const today = formatExamPrepLocalDate(now);
    const todayIso = now.toISOString();
    const yesterdayIso = dayBefore().toISOString();
    const tomorrowIso = dayAfter().toISOString();

    const unitProgress = [
      // two studied today
      makeUnitProgress('A-NBLS-01', todayIso),
      makeUnitProgress('A-NBLS-02', todayIso),
      // older / future excluded
      makeUnitProgress('A-REG-01', yesterdayIso),
      makeUnitProgress('A-REG-02', tomorrowIso),
      // archived and other-curriculum records excluded even when dated today
      makeUnitProgress('A-BYL-01', todayIso, archivedBinding),
      makeUnitProgress('A-BYL-02', todayIso, otherCurriculumBinding),
    ];

    const attempts = [
      // three recall reviews today, one yesterday, one archived today
      makeRecallAttempt({ id: 'r1', taskId: 'recall:A-NBLS-01:1', unitId: 'A-NBLS-01', reviewedAt: todayIso }),
      makeRecallAttempt({ id: 'r2', taskId: 'recall:A-NBLS-02:1', unitId: 'A-NBLS-02', reviewedAt: todayIso }),
      makeRecallAttempt({ id: 'r3', taskId: 'recall:A-REG-01:1', unitId: 'A-REG-01', reviewedAt: todayIso }),
      makeRecallAttempt({ id: 'r-old', taskId: 'recall:A-REG-02:1', unitId: 'A-REG-02', reviewedAt: yesterdayIso }),
      makeRecallAttempt({
        id: 'r-archived',
        taskId: 'recall:A-REG-03:1',
        unitId: 'A-REG-03',
        reviewedAt: todayIso,
        binding: archivedBinding,
      }),
      // ten recognition attempts today + an archived one dated today
      ...Array.from({ length: 10 }, (_, index) =>
        makeRecognitionAttempt({
          id: `recog-${index}`,
          taskId: `recognition:A-NBLS-01:${index + 1}`,
          unitId: 'A-NBLS-01',
          result: index % 2 === 0 ? 'got_it' : 'missed',
          completedAt: todayIso,
        }),
      ),
      makeRecognitionAttempt({
        id: 'recog-archived',
        taskId: 'recognition:A-NBLS-01:20',
        unitId: 'A-NBLS-01',
        completedAt: todayIso,
        binding: archivedBinding,
      }),
      // ten locate attempts today + an archived one dated today
      ...Array.from({ length: 10 }, (_, index) =>
        makeLocateAttempt({
          id: `loc-${index}`,
          taskId: `locate:A-NBLS-02:${index + 1}`,
          unitId: 'A-NBLS-02',
          result: index % 2 === 0 ? 'found' : 'missed',
          completedAt: todayIso,
        }),
      ),
      makeLocateAttempt({
        id: 'loc-archived',
        taskId: 'locate:A-NBLS-02:30',
        unitId: 'A-NBLS-02',
        completedAt: todayIso,
        binding: archivedBinding,
      }),
      // one drill attempt on today's local practiceDate, one yesterday,
      // one archived with today's practiceDate
      makeDrillAttempt({
        id: 'd1',
        taskId: 'drill:DRILL-01',
        unitId: 'DRILL-01',
        practiceDate: today,
        completedAt: todayIso,
      }),
      makeDrillAttempt({
        id: 'd-old',
        taskId: 'drill:DRILL-02',
        unitId: 'DRILL-02',
        practiceDate: formatExamPrepLocalDate(dayBefore()),
        completedAt: yesterdayIso,
      }),
      makeDrillAttempt({
        id: 'd-archived',
        taskId: 'drill:DRILL-03',
        unitId: 'DRILL-03',
        practiceDate: today,
        completedAt: todayIso,
        binding: archivedBinding,
      }),
    ];

    expect(buildExamPrepTodayActivity(unitProgress, attempts, now)).toEqual({
      studiedUnits: 2,
      recallReviews: 3,
      recognitionAttempts: 10,
      locateAttempts: 10,
      drillAttempts: 1,
    });
  });

  it('counts drill attempts by the persisted local practiceDate, not the completedAt timestamp', () => {
    const today = formatExamPrepLocalDate(now);
    const attempts = [
      // completedAt is today but practiceDate is yesterday => excluded
      makeDrillAttempt({
        id: 'd-late',
        taskId: 'drill:DRILL-04',
        unitId: 'DRILL-04',
        practiceDate: formatExamPrepLocalDate(dayBefore()),
        completedAt: now.toISOString(),
      }),
      // completedAt is yesterday but practiceDate is today => included
      makeDrillAttempt({
        id: 'd-today',
        taskId: 'drill:DRILL-05',
        unitId: 'DRILL-05',
        practiceDate: today,
        completedAt: dayBefore().toISOString(),
      }),
    ];
    expect(buildExamPrepTodayActivity([], attempts, now).drillAttempts).toBe(1);
  });

  it('returns all zeros when nothing happened on the local date', () => {
    expect(buildExamPrepTodayActivity([], [], now)).toEqual({
      studiedUnits: 0,
      recallReviews: 0,
      recognitionAttempts: 0,
      locateAttempts: 0,
      drillAttempts: 0,
    });

    const farPast = localNoon(2026, 8, 1).toISOString();
    const unitProgress = [makeUnitProgress('A-NBLS-01', farPast)];
    const attempts = [
      makeRecallAttempt({ id: 'r', taskId: 'recall:A-NBLS-01:1', unitId: 'A-NBLS-01', reviewedAt: farPast }),
      makeRecognitionAttempt({ id: 'c', taskId: 'recognition:A-NBLS-01:1', unitId: 'A-NBLS-01', completedAt: farPast }),
      makeLocateAttempt({ id: 'l', taskId: 'locate:A-NBLS-02:1', unitId: 'A-NBLS-02', completedAt: farPast }),
      makeDrillAttempt({
        id: 'd',
        taskId: 'drill:DRILL-01',
        unitId: 'DRILL-01',
        practiceDate: formatExamPrepLocalDate(localNoon(2026, 8, 1)),
        completedAt: farPast,
      }),
    ];
    expect(buildExamPrepTodayActivity(unitProgress, attempts, now)).toEqual({
      studiedUnits: 0,
      recallReviews: 0,
      recognitionAttempts: 0,
      locateAttempts: 0,
      drillAttempts: 0,
    });
  });

  it('respects local calendar boundaries (start and end of the local day)', () => {
    const midnight = new Date(2026, 8, 4, 0, 0, 0, 0); // start of the local day
    const lateEvening = new Date(2026, 8, 4, 23, 59, 59, 999); // end of the local day
    const previousLate = new Date(2026, 8, 3, 23, 59, 59, 999); // previous local day
    const nextEarly = new Date(2026, 8, 5, 0, 0, 0, 0); // next local day

    const unitProgress = [
      makeUnitProgress('A-NBLS-01', lateEvening.toISOString()),
      makeUnitProgress('A-NBLS-02', previousLate.toISOString()),
    ];
    const attempts = [
      makeRecallAttempt({ id: 'a1', taskId: 'recall:A-NBLS-01:1', unitId: 'A-NBLS-01', reviewedAt: midnight.toISOString() }),
      makeRecallAttempt({ id: 'a2', taskId: 'recall:A-NBLS-01:2', unitId: 'A-NBLS-01', reviewedAt: lateEvening.toISOString() }),
      makeRecallAttempt({ id: 'a3', taskId: 'recall:A-NBLS-01:3', unitId: 'A-NBLS-01', reviewedAt: previousLate.toISOString() }),
      makeRecallAttempt({ id: 'a4', taskId: 'recall:A-NBLS-01:4', unitId: 'A-NBLS-01', reviewedAt: nextEarly.toISOString() }),
      makeDrillAttempt({
        id: 'd1',
        taskId: 'drill:DRILL-01',
        unitId: 'DRILL-01',
        practiceDate: formatExamPrepLocalDate(midnight),
        completedAt: midnight.toISOString(),
      }),
      makeDrillAttempt({
        id: 'd2',
        taskId: 'drill:DRILL-02',
        unitId: 'DRILL-02',
        practiceDate: formatExamPrepLocalDate(nextEarly),
        completedAt: nextEarly.toISOString(),
      }),
    ];

    expect(buildExamPrepTodayActivity(unitProgress, attempts, now)).toEqual({
      studiedUnits: 1, // late-evening today only; the previous-day marker is excluded
      recallReviews: 2, // midnight + late-evening today
      recognitionAttempts: 0,
      locateAttempts: 0,
      drillAttempts: 1, // today's drill (midnight); the next-day drill is excluded
    });
  });

  it('excludes archived and other-curriculum records even when dated today', () => {
    const todayIso = now.toISOString();
    const today = formatExamPrepLocalDate(now);
    const unitProgress = [
      makeUnitProgress('A-NBLS-01', todayIso, archivedBinding),
      makeUnitProgress('A-NBLS-02', todayIso, otherCurriculumBinding),
    ];
    const attempts = [
      makeDrillAttempt({
        id: 'dr',
        taskId: 'drill:DRILL-01',
        unitId: 'DRILL-01',
        practiceDate: today,
        completedAt: todayIso,
        binding: archivedBinding,
      }),
      makeRecognitionAttempt({
        id: 'rc',
        taskId: 'recognition:A-NBLS-01:1',
        unitId: 'A-NBLS-01',
        completedAt: todayIso,
        binding: otherCurriculumBinding,
      }),
    ];
    expect(buildExamPrepTodayActivity(unitProgress, attempts, now)).toEqual({
      studiedUnits: 0,
      recallReviews: 0,
      recognitionAttempts: 0,
      locateAttempts: 0,
      drillAttempts: 0,
    });
  });
});
