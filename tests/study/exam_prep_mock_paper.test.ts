// Exam Prep Mock — provisional profile + deterministic history-blind paper.

import { describe, expect, it } from 'vitest';
import {
  EXAM_PREP_DEFAULT_MOCK_PROFILE,
  EXAM_PREP_MOCK_PROFILES,
  EXAM_PREP_PROVISIONAL_MOCK_V1,
  examPrepMockProfilePointTotal,
  examPrepMockProfileQuestionTotal,
  selectExamPrepMockProfile,
} from '../../src/study/examPrep/mock/examPrepMockProfiles';
import {
  allocateMockBucketCounts,
  buildExamPrepMockPaper,
  resolveExamPrepMockBucketCounts,
} from '../../src/study/examPrep/mock/examPrepMockPaper';
import { resolveExamPrepMockQuestionContent } from '../../src/study/examPrep/mock/examPrepMockQuestionContent';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../../src/study/examPrep/examPrepRecognitionTasks';
import { EXAM_PREP_LOCATE_TASKS } from '../../src/study/examPrep/examPrepLocateTasks';
import { EXAM_PREP_DRILL_UNITS } from '../../src/study/examPrep/examPrepDrillFilters';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import type { ExamPrepMockQuestionRef } from '../../src/study/examPrep/mock/examPrepMockTypes';

describe('Exam Prep provisional mock profile V1', () => {
  it('describes the provisional 150-minute 30-question 42-point Statute Law profile', () => {
    const profile = EXAM_PREP_PROVISIONAL_MOCK_V1;
    expect(profile.id).toBe('nb-statute-provisional-v1');
    expect(profile.version).toBe(1);
    expect(profile.status).toBe('provisional');
    expect(profile.durationMinutes).toBe(150);
    expect(profile.questionCounts).toEqual({ recall: 6, recognition: 8, locate: 10, drill: 6 });
    expect(profile.pointsPerQuestion).toEqual({ recall: 1, recognition: 1, locate: 1, drill: 3 });
    expect(examPrepMockProfileQuestionTotal(profile)).toBe(30);
    expect(examPrepMockProfilePointTotal(profile)).toBe(42);
    expect(profile.passMarkPercent).toBeNull();
    expect(profile.timePolicy).toBe('hard_stop');
    expect(profile.resources).toEqual({ openBook: true, builtInStatuteLibrary: true });
  });

  it('registers as the active default profile and is selectable by id', () => {
    expect(EXAM_PREP_MOCK_PROFILES).toHaveLength(1);
    expect(EXAM_PREP_DEFAULT_MOCK_PROFILE.id).toBe('nb-statute-provisional-v1');
    expect(selectExamPrepMockProfile('nb-statute-provisional-v1')).toBe(
      EXAM_PREP_PROVISIONAL_MOCK_V1,
    );
    expect(selectExamPrepMockProfile('missing')).toBeNull();
  });

  it('is explicitly non-official and does not invent a pass mark', () => {
    expect(EXAM_PREP_PROVISIONAL_MOCK_V1.assumptions.join(' ')).toContain('awaiting');
    expect(EXAM_PREP_PROVISIONAL_MOCK_V1.assumptions.join(' ')).toContain('No official pass mark');
  });
});

const kindTierCounts = (
  paper: ExamPrepMockQuestionRef[],
  kind: 'recall' | 'recognition' | 'locate',
): Record<string, number> => {
  const taskTier = (ref: ExamPrepMockQuestionRef): string => {
    const task =
      kind === 'recall'
        ? EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === ref.sourceTaskId)
        : kind === 'recognition'
          ? EXAM_PREP_RECOGNITION_TASKS.find((entry) => entry.id === ref.sourceTaskId)
          : EXAM_PREP_LOCATE_TASKS.find((entry) => entry.id === ref.sourceTaskId);
    if (!task) throw new Error(`unresolved ${kind} task ${ref.sourceTaskId}`);
    return task.tier;
  };
  const counts: Record<string, number> = {};
  paper
    .filter((ref) => ref.kind === kind)
    .forEach((ref) => {
      const tier = taskTier(ref);
      const bucket = kind === 'recall' ? tier : tier === 'C' || tier === 'D' ? 'CD' : tier;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    });
  return counts;
};

const drillDifficultyCounts = (paper: ExamPrepMockQuestionRef[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  paper
    .filter((ref) => ref.kind === 'drill')
    .forEach((ref) => {
      const unit = EXAM_PREP_DRILL_UNITS.find((entry) => entry.id === ref.unitId);
      const difficulty = unit?.drill?.difficulty;
      if (difficulty) counts[difficulty] = (counts[difficulty] ?? 0) + 1;
    });
  return counts;
};

describe('allocations', () => {
  it('documents the provisional V1 tier/difficulty mix on the profile itself', () => {
    expect(resolveExamPrepMockBucketCounts(EXAM_PREP_PROVISIONAL_MOCK_V1, 'recall')).toEqual({
      A: 2,
      B: 2,
      NAV: 1,
      C: 1,
    });
    expect(
      resolveExamPrepMockBucketCounts(EXAM_PREP_PROVISIONAL_MOCK_V1, 'recognition'),
    ).toEqual({ A: 3, B: 2, NAV: 2, CD: 1 });
    expect(resolveExamPrepMockBucketCounts(EXAM_PREP_PROVISIONAL_MOCK_V1, 'locate')).toEqual({
      A: 4,
      B: 3,
      NAV: 2,
      CD: 1,
    });
    expect(resolveExamPrepMockBucketCounts(EXAM_PREP_PROVISIONAL_MOCK_V1, 'drill')).toEqual({
      direct: 2,
      routing: 2,
      cross_document: 2,
    });
  });

  it('falls back to deterministic cycling when a profile has no configured mix', () => {
    expect(allocateMockBucketCounts('recall', 6)).toEqual({ A: 2, B: 2, NAV: 1, C: 1 });
    expect(allocateMockBucketCounts('drill', 6)).toEqual({
      direct: 2,
      routing: 2,
      cross_document: 2,
    });
  });
});

describe('buildExamPrepMockPaper (provisional profile)', () => {
  const paper = buildExamPrepMockPaper({
    profile: EXAM_PREP_PROVISIONAL_MOCK_V1,
    seed: 'seed-a',
  });

  it('produces 30 mixed questions worth 42 possible points', () => {
    expect(paper).toHaveLength(30);
    expect(paper.reduce((sum, ref) => sum + ref.pointsPossible, 0)).toBe(42);
    expect(paper.map((ref) => ref.kind)).not.toEqual([
      ...Array(6).fill('recall'),
      ...Array(8).fill('recognition'),
      ...Array(10).fill('locate'),
      ...Array(6).fill('drill'),
    ]);
  });

  it('uses session-local question ids q01..q30 in final order', () => {
    expect(paper[0]?.questionId).toBe('q01');
    expect(paper[29]?.questionId).toBe('q30');
    expect(new Set(paper.map((ref) => ref.questionId)).size).toBe(30);
  });

  it('selects the profile count per kind with the documented tier mix', () => {
    expect(paper.filter((ref) => ref.kind === 'recall')).toHaveLength(6);
    expect(paper.filter((ref) => ref.kind === 'recognition')).toHaveLength(8);
    expect(paper.filter((ref) => ref.kind === 'locate')).toHaveLength(10);
    expect(paper.filter((ref) => ref.kind === 'drill')).toHaveLength(6);
    expect(kindTierCounts(paper, 'recall')).toEqual({ A: 2, B: 2, NAV: 1, C: 1 });
    expect(kindTierCounts(paper, 'recognition')).toEqual({ A: 3, B: 2, NAV: 2, CD: 1 });
    expect(kindTierCounts(paper, 'locate')).toEqual({ A: 4, B: 3, NAV: 2, CD: 1 });
    expect(drillDifficultyCounts(paper)).toEqual({ direct: 2, routing: 2, cross_document: 2 });
  });

  it('never repeats a source task id and keeps non-drill units broad', () => {
    expect(new Set(paper.map((ref) => ref.sourceTaskId)).size).toBe(30);
    const nonDrill = paper.filter((ref) => ref.kind !== 'drill');
    expect(new Set(nonDrill.map((ref) => ref.unitId)).size).toBe(nonDrill.length);
  });

  it('selects drills only from the frozen 24 DRILL units', () => {
    const drillIds = new Set(EXAM_PREP_DRILL_UNITS.map((unit) => unit.id));
    paper
      .filter((ref) => ref.kind === 'drill')
      .forEach((ref) => expect(drillIds.has(ref.unitId)).toBe(true));
  });

  it('is deterministic: same profile + same seed => byte-identical paper', () => {
    expect(
      buildExamPrepMockPaper({ profile: EXAM_PREP_PROVISIONAL_MOCK_V1, seed: 'seed-a' }),
    ).toEqual(paper);
  });

  it('is history-blind: rebuilding is pure and ignores learner state', () => {
    expect(buildExamPrepMockPaper({ profile: EXAM_PREP_PROVISIONAL_MOCK_V1, seed: 'seed-a' })).toEqual(
      paper,
    );
  });

  it('produces different (but valid) papers for different seeds', () => {
    const other = buildExamPrepMockPaper({ profile: EXAM_PREP_PROVISIONAL_MOCK_V1, seed: 'seed-b' });
    expect(other).toHaveLength(30);
    expect(other).not.toEqual(paper);
  });
});

describe('mock question content is frozen, never authored', () => {
  const paper = buildExamPrepMockPaper({
    profile: EXAM_PREP_PROVISIONAL_MOCK_V1,
    seed: 'content-seed',
  });

  it('every recall source maps exactly to one frozen recall task', () => {
    paper
      .filter((ref) => ref.kind === 'recall')
      .forEach((ref) => {
        const task = EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === ref.sourceTaskId);
        expect(task).toBeDefined();
        const content = resolveExamPrepMockQuestionContent(ref);
        if (content.kind !== 'recall') throw new Error('kind mismatch');
        expect(content.prompt).toBe(task?.prompt);
        expect(content.expectedAnswer).toBe(task?.expectedAnswer);
        expect(ref.unitId).toBe(task?.unitId);
      });
  });

  it('recognition cues are the exact frozen cue text', () => {
    paper
      .filter((ref) => ref.kind === 'recognition')
      .forEach((ref) => {
        const task = EXAM_PREP_RECOGNITION_TASKS.find((entry) => entry.id === ref.sourceTaskId);
        const content = resolveExamPrepMockQuestionContent(ref);
        if (content.kind !== 'recognition') throw new Error('kind mismatch');
        expect(content.cue).toBe(task?.cue);
        expect(content.unitTitle).toBe(task?.unitTitle);
        expect(content.expectedDocumentIds).toEqual(task?.expectedDocumentIds);
      });
  });

  it('locate prompts and pins match the frozen locate task', () => {
    paper
      .filter((ref) => ref.kind === 'locate')
      .forEach((ref) => {
        const task = EXAM_PREP_LOCATE_TASKS.find((entry) => entry.id === ref.sourceTaskId);
        const content = resolveExamPrepMockQuestionContent(ref);
        if (content.kind !== 'locate') throw new Error('kind mismatch');
        expect(content.prompt).toBe(task?.prompt);
        expect(content.expectedDocumentId).toBe(task?.expectedDocumentId);
        expect(content.expectedSourceKey).toBe(task?.expectedSourceKey);
      });
  });

  it('drill fact patterns/tasks/answer keys are the frozen DRILL content', () => {
    paper
      .filter((ref) => ref.kind === 'drill')
      .forEach((ref) => {
        const unit = EXAM_PREP_DRILL_UNITS.find((entry) => entry.id === ref.unitId);
        expect(unit?.drill).toBeDefined();
        const content = resolveExamPrepMockQuestionContent(ref);
        if (content.kind !== 'drill') throw new Error('kind mismatch');
        expect(content.factPattern).toBe(unit?.drill?.factPattern);
        expect(content.task).toBe(unit?.drill?.task);
        expect(content.requiredAnswerPoints).toEqual(unit?.drill?.answerKey.requiredAnswerPoints);
      });
  });
});

describe('synthetic alternate profile proves format flexibility', () => {
  it('builds and runs a 20-question profile with no drills and library disabled', () => {
    const synthetic = {
      ...EXAM_PREP_PROVISIONAL_MOCK_V1,
      id: 'test-short-profile',
      title: 'Short test profile',
      durationMinutes: 30,
      questionCounts: { recall: 2, recognition: 2, locate: 2, drill: 0 },
      pointsPerQuestion: { recall: 1, recognition: 1, locate: 1, drill: 3 },
      resources: { openBook: true, builtInStatuteLibrary: false },
      passMarkPercent: 70,
      questionMix: {
        recall: { A: 1, B: 1 },
        recognition: { A: 1, NAV: 1 },
        locate: { A: 1, B: 1 },
        drill: {},
      },
    };
    const paper = buildExamPrepMockPaper({ profile: synthetic, seed: 'short-seed' });
    expect(paper).toHaveLength(6);
    expect(paper.every((ref) => ref.kind !== 'drill')).toBe(true);
    expect(paper.reduce((sum, ref) => sum + ref.pointsPossible, 0)).toBe(6);
    expect(new Set(paper.map((ref) => ref.unitId)).size).toBe(6);
    expect(kindTierCounts(paper, 'recall')).toEqual({ A: 1, B: 1 });
  });
});

describe('frozen curriculum integrity used by the mock engine', () => {
  it('pools and manifest counts are unchanged', () => {
    expect(EXAM_PREP_MANIFEST.units).toHaveLength(157);
    expect(EXAM_PREP_RECALL_TASKS).toHaveLength(57);
    expect(EXAM_PREP_RECOGNITION_TASKS).toHaveLength(317);
    expect(EXAM_PREP_LOCATE_TASKS).toHaveLength(452);
    expect(EXAM_PREP_DRILL_UNITS).toHaveLength(24);
  });
});
