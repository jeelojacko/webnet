// Exam Prep Phase 2.5 — Lookup Drill summary/filter tests.
//
// buildExamPrepDrillRows / buildExamPrepDrillStatusCounts / filter helpers
// derive readiness rows and the two local filter dimensions (status:
// All / Needs Work / one status — Needs Work is exactly Developing +
// Accurate; difficulty: All / Direct / Routing / Cross-document) over the 24
// frozen DRILL units. Current-hash attempts only; no task duplication; all 24
// stay reachable from All.

import { describe, expect, it } from 'vitest';
import {
  EXAM_PREP_DRILL_DIFFICULTY_LABELS,
  EXAM_PREP_DRILL_STATUS_LABELS,
  EXAM_PREP_DRILL_UNITS,
  buildExamPrepDrillRows,
  buildExamPrepDrillStatusCounts,
  examPrepDrillTaskId,
  filterExamPrepDrillRows,
  type ExamPrepDrillRow,
} from '../../src/study/examPrep/examPrepDrillFilters';
import { buildExamPrepDrillStats } from '../../src/study/examPrep/examPrepDrillStats';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import {
  archivedBinding,
  makeDrillAttempt,
} from './exam_prep_test_support';

const drillUnitIds = EXAM_PREP_DRILL_UNITS.map((unit) => unit.id);
if (drillUnitIds.length !== 24) throw new Error('expected 24 frozen drill units');

/** A 3/3 within-target attempt on one practice date. */
const qualifying = (
  id: string,
  unitId: string,
  practiceDate: string,
): ReturnType<typeof makeDrillAttempt> =>
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
    completedAt: `${practiceDate}T12:00:00.000Z`,
  });

const developing = (id: string, unitId: string): ReturnType<typeof makeDrillAttempt> =>
  makeDrillAttempt({
    id,
    taskId: examPrepDrillTaskId(unitId),
    unitId,
    elapsedSeconds: 90,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: false,
    practiceDate: '2026-09-03',
    completedAt: '2026-09-03T12:00:00.000Z',
  });

const difficultyOf = (unitId: string): string => {
  const unit = EXAM_PREP_DRILL_UNITS.find((entry) => entry.id === unitId);
  return unit?.drill?.difficulty ?? '';
};

describe('Exam Prep drill summary and filters', () => {
  it('builds one row per canonical drill unit with Unattempted defaults', () => {
    expect(EXAM_PREP_DRILL_UNITS).toHaveLength(24);
    const rows = buildExamPrepDrillRows();
    expect(rows).toHaveLength(24);
    expect(rows[0]?.unit.id).toBe('DRILL-01');
    expect(rows[23]?.unit.id).toBe('DRILL-24');
    for (const row of rows) {
      expect(row.stats.status).toBe('unattempted');
      expect(row.stats.attemptCount).toBe(0);
    }
    expect(EXAM_PREP_MANIFEST.units.filter((unit) => unit.tier === 'DRILL')).toHaveLength(24);
  });

  it('computes summary counts across the four readiness statuses with Needs Work = Developing + Accurate', () => {
    const attempts = [
      // DRILL-01 exam-ready (two qualifying dates)
      qualifying('d1-a', 'DRILL-01', '2026-09-01'),
      qualifying('d1-b', 'DRILL-01', '2026-09-02'),
      // DRILL-02 accurate (one qualifying date)
      qualifying('d2-a', 'DRILL-02', '2026-09-01'),
      // DRILL-03 developing (latest score 2)
      developing('d3-a', 'DRILL-03'),
      // DRILL-04 accurate (score 3 but never within target time)
      makeDrillAttempt({
        id: 'd4-a',
        taskId: examPrepDrillTaskId('DRILL-04'),
        unitId: 'DRILL-04',
        elapsedSeconds: 999,
        targetSeconds: 90,
        lawIdentified: true,
        provisionLocated: true,
        substantiveAnswerComplete: true,
        practiceDate: '2026-09-01',
        completedAt: '2026-09-01T12:00:00.000Z',
      }),
    ];
    const counts = buildExamPrepDrillStatusCounts(buildExamPrepDrillRows(EXAM_PREP_DRILL_UNITS, attempts));
    expect(counts).toMatchObject({
      total: 24,
      attempted: 4,
      examReady: 1,
      accurate: 2,
      developing: 1,
      unattempted: 20,
      needsWork: 3,
    });
    expect(counts.needsWork).toBe(counts.developing + counts.accurate);
  });

  it('keeps the exact Exam-ready semantics: two distinct local dates with 3/3 within target', () => {
    // same date twice is not enough
    const sameDay = [
      qualifying('a', 'DRILL-01', '2026-09-01'),
      qualifying('b', 'DRILL-01', '2026-09-01'),
    ];
    expect(buildExamPrepDrillStats(sameDay, examPrepDrillTaskId('DRILL-01')).status).toBe('accurate');
    // two distinct dates qualify even when later attempts slip
    const twoDays = [
      ...sameDay,
      qualifying('c', 'DRILL-01', '2026-09-02'),
    ];
    expect(buildExamPrepDrillStats(twoDays, examPrepDrillTaskId('DRILL-01')).status).toBe('exam_ready');
  });

  it('status filters: All, Needs Work, each status — with no duplication and All reachable', () => {
    const attempts = [
      qualifying('d1-a', 'DRILL-01', '2026-09-01'),
      qualifying('d1-b', 'DRILL-01', '2026-09-02'),
      qualifying('d2-a', 'DRILL-02', '2026-09-01'),
      developing('d3-a', 'DRILL-03'),
    ];
    const rows = buildExamPrepDrillRows(EXAM_PREP_DRILL_UNITS, attempts);

    const all = filterExamPrepDrillRows(rows, 'all', 'all');
    expect(all).toHaveLength(24);
    expect(new Set(all.map((row) => row.unit.id)).size).toBe(24);

    const needsWork = filterExamPrepDrillRows(rows, 'needs_work', 'all');
    expect(needsWork.map((row) => row.unit.id).sort()).toEqual(['DRILL-02', 'DRILL-03']);

    const examReady = filterExamPrepDrillRows(rows, 'exam_ready', 'all');
    expect(examReady.map((row) => row.unit.id)).toEqual(['DRILL-01']);

    const unattempted = filterExamPrepDrillRows(rows, 'unattempted', 'all');
    expect(unattempted).toHaveLength(21);

    const accurate = filterExamPrepDrillRows(rows, 'accurate', 'all');
    expect(accurate.map((row) => row.unit.id)).toEqual(['DRILL-02']);

    const developingOnly = filterExamPrepDrillRows(rows, 'developing', 'all');
    expect(developingOnly.map((row) => row.unit.id)).toEqual(['DRILL-03']);

    // Needs Work excludes Exam-ready by construction
    expect(needsWork.some((row) => row.stats.status === 'exam_ready')).toBe(false);
  });

  it('difficulty filters use the frozen Direct/Routing/Cross-document split (8/8/8)', () => {
    const rows = buildExamPrepDrillRows();
    const byDifficulty = (difficulty: string): ExamPrepDrillRow[] =>
      filterExamPrepDrillRows(rows, 'all', difficulty as never);

    expect(byDifficulty('direct')).toHaveLength(8);
    expect(byDifficulty('routing')).toHaveLength(8);
    expect(byDifficulty('cross_document')).toHaveLength(8);
    expect(byDifficulty('direct').every((row) => difficultyOf(row.unit.id) === 'direct')).toBe(true);
    expect(
      byDifficulty('cross_document').every((row) => difficultyOf(row.unit.id) === 'cross_document'),
    ).toBe(true);
    expect(EXAM_PREP_DRILL_DIFFICULTY_LABELS).toEqual({
      direct: 'Direct',
      routing: 'Routing',
      cross_document: 'Cross-document',
    });
    expect(EXAM_PREP_DRILL_STATUS_LABELS).toEqual({
      unattempted: 'Unattempted',
      developing: 'Developing',
      accurate: 'Accurate',
      exam_ready: 'Exam-ready',
    });
  });

  it('combines status and difficulty filters', () => {
    // DRILL-01..08 are Direct; DRILL-02 accurate via one qualifying day.
    const attempts = [qualifying('d2-a', 'DRILL-02', '2026-09-01')];
    const rows = buildExamPrepDrillRows(EXAM_PREP_DRILL_UNITS, attempts);

    const accurateDirect = filterExamPrepDrillRows(rows, 'accurate', 'direct');
    expect(accurateDirect.map((row) => row.unit.id)).toEqual(['DRILL-02']);

    const accurateRouting = filterExamPrepDrillRows(rows, 'accurate', 'routing');
    expect(accurateRouting).toHaveLength(0);

    const examReadyCross = filterExamPrepDrillRows(rows, 'exam_ready', 'cross_document');
    expect(examReadyCross).toHaveLength(0);

    const needsWorkCross = filterExamPrepDrillRows(rows, 'needs_work', 'cross_document');
    expect(needsWorkCross).toHaveLength(0);

    const needsWorkDirect = filterExamPrepDrillRows(rows, 'needs_work', 'direct');
    expect(needsWorkDirect.map((row) => row.unit.id)).toEqual(['DRILL-02']);
  });

  it('ignores archived-hash attempts in rows, counts, and filters', () => {
    const archived = [
      qualifying('a1', 'DRILL-01', '2026-09-01'),
      qualifying('a2', 'DRILL-01', '2026-09-02'),
    ].map((attempt) => ({
      ...attempt,
      id: `archived-${attempt.id}`,
      curriculumId: archivedBinding.curriculumId,
      curriculumContentHash: archivedBinding.curriculumContentHash,
    }));

    const rows = buildExamPrepDrillRows(EXAM_PREP_DRILL_UNITS, archived);
    expect(rows.find((row) => row.unit.id === 'DRILL-01')?.stats.status).toBe('unattempted');
    const counts = buildExamPrepDrillStatusCounts(rows);
    expect(counts.attempted).toBe(0);
    expect(counts.examReady).toBe(0);
    expect(counts.unattempted).toBe(24);
  });
});
