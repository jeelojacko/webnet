// Exam Prep — Lookup Drill summary/filter helpers (pure).
//
// Phase 2.5 derives per-drill readiness rows from immutable current-hash
// attempts (statuses unattempted → developing → accurate → exam_ready) and
// exposes the two local filter dimensions used by the Lookup Drills view:
// status (`all` / `needs_work` / one status) and difficulty (`all` /
// `direct` / `routing` / `cross_document`). "Needs Work" is exactly the union
// Developing + Accurate: Accurate means a correct answer exists but the
// two-date within-target readiness criterion is not yet demonstrated.
// Nothing here persists; the canonical 24 DRILL units come from the frozen
// manifest.

import type {
  ExamCurriculumUnit,
  ExamLookupDrillDifficulty,
} from '../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import {
  buildExamPrepDrillStats,
  type ExamPrepDrillStats,
  type ExamPrepDrillStatus,
} from './examPrepDrillStats';
import type { ExamPrepAttempt } from './examPrepTypes';

/** Canonical frozen lookup-drill units (DRILL-01..DRILL-24) in manifest order. */
export const EXAM_PREP_DRILL_UNITS: ExamCurriculumUnit[] = EXAM_PREP_MANIFEST.units.filter(
  (unit) => unit.tier === 'DRILL',
);

export const EXAM_PREP_DRILL_STATUS_LABELS: Record<ExamPrepDrillStatus, string> = {
  unattempted: 'Unattempted',
  developing: 'Developing',
  accurate: 'Accurate',
  exam_ready: 'Exam-ready',
};

export const EXAM_PREP_DRILL_DIFFICULTY_LABELS: Record<ExamLookupDrillDifficulty, string> = {
  direct: 'Direct',
  routing: 'Routing',
  cross_document: 'Cross-document',
};

export type ExamPrepDrillStatusFilter = 'all' | 'needs_work' | ExamPrepDrillStatus;
export type ExamPrepDrillDifficultyFilter = 'all' | ExamLookupDrillDifficulty;

export type ExamPrepDrillRow = {
  unit: ExamCurriculumUnit;
  stats: ExamPrepDrillStats;
};

export const examPrepDrillTaskId = (unitId: string): string => `drill:${unitId}`;

/** One row per canonical drill with its current-hash readiness stats. */
export const buildExamPrepDrillRows = (
  units: ExamCurriculumUnit[] = EXAM_PREP_DRILL_UNITS,
  attempts: ExamPrepAttempt[] = [],
): ExamPrepDrillRow[] =>
  units.map((unit) => ({
    unit,
    stats: buildExamPrepDrillStats(attempts, examPrepDrillTaskId(unit.id)),
  }));

export const matchesExamPrepDrillStatusFilter = (
  stats: ExamPrepDrillStats,
  filter: ExamPrepDrillStatusFilter,
): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_work':
      return stats.status === 'developing' || stats.status === 'accurate';
    default:
      return stats.status === filter;
  }
};

export const matchesExamPrepDrillFilters = (
  row: ExamPrepDrillRow,
  statusFilter: ExamPrepDrillStatusFilter,
  difficultyFilter: ExamPrepDrillDifficultyFilter,
): boolean =>
  matchesExamPrepDrillStatusFilter(row.stats, statusFilter) &&
  (difficultyFilter === 'all' || row.unit.drill?.difficulty === difficultyFilter);

export const filterExamPrepDrillRows = (
  rows: ExamPrepDrillRow[],
  statusFilter: ExamPrepDrillStatusFilter,
  difficultyFilter: ExamPrepDrillDifficultyFilter,
): ExamPrepDrillRow[] => rows.filter((row) => matchesExamPrepDrillFilters(row, statusFilter, difficultyFilter));

export type ExamPrepDrillStatusCounts = {
  total: number;
  attempted: number;
  examReady: number;
  accurate: number;
  developing: number;
  unattempted: number;
  needsWork: number;
};

export const buildExamPrepDrillStatusCounts = (
  rows: ExamPrepDrillRow[],
): ExamPrepDrillStatusCounts => {
  const counts: ExamPrepDrillStatusCounts = {
    total: rows.length,
    attempted: 0,
    examReady: 0,
    accurate: 0,
    developing: 0,
    unattempted: 0,
    needsWork: 0,
  };
  for (const row of rows) {
    if (row.stats.attemptCount > 0) counts.attempted += 1;
    switch (row.stats.status) {
      case 'exam_ready':
        counts.examReady += 1;
        break;
      case 'accurate':
        counts.accurate += 1;
        break;
      case 'developing':
        counts.developing += 1;
        break;
      default:
        counts.unattempted += 1;
        break;
    }
  }
  counts.needsWork = counts.developing + counts.accurate;
  return counts;
};

/**
 * Concise readiness reason for the status ladder, used by the drills summary
 * and the recommended-drill block. `developing` and `accurate` get concrete
 * explanations; `exam_ready` restates the two-date rule; `unattempted` has
 * no note.
 */
export const examPrepDrillReadinessReason = (stats: ExamPrepDrillStats): string | null => {
  switch (stats.status) {
    case 'developing':
      return `Latest attempt: ${stats.latestScore ?? 0} / 3`;
    case 'accurate':
      return stats.qualifyingPracticeDates.length === 1
        ? '1 qualifying practice day · needs another successful day for Exam-ready.'
        : 'Correct, but not yet within the target time.';
    case 'exam_ready':
      return '3/3 within the target time on two different practice dates.';
    default:
      return null;
  }
};
