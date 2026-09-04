// Exam Prep Mock — deterministic history-blind paper generation.
//
// buildExamPrepMockPaper selects the profile's question quotas from the frozen
// pools (57 Recall tasks, 317 Recognition cues, 452 Locate targets, 24 DRILL
// units) using ONLY the profile + seed. It never reads learner attempts,
// miss history, Recall due state or drill readiness, so two learners with the
// same profile + seed receive the exact same paper. Selection is two-pass:
// PASS 1 prefers a curriculum unit only once across the non-drill portion;
// PASS 2 (only when required) allows repeated units. Expected answer content
// is never stored on the session — the frozen pools resolve it at render time
// after submission.

import type { ExamPrepLocateTask } from '../examPrepTypes';
import type { ExamPrepRecognitionTask } from '../examPrepTypes';
import type { ExamPrepRecallTask } from '../examPrepTypes';
import { EXAM_PREP_LOCATE_TASKS } from '../examPrepLocateTasks';
import { EXAM_PREP_RECALL_TASKS } from '../examPrepRecallTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../examPrepRecognitionTasks';
import { EXAM_PREP_DRILL_UNITS } from '../examPrepDrillFilters';
import type { ExamLookupDrillDifficulty } from '../../examCurriculum/examCurriculumTypes';
import { seededMockShuffle } from './examPrepMockRandom';
import {
  assertValidExamPrepMockProfile,
  examPrepMockProfilePointTotal,
  examPrepMockProfileQuestionTotal,
} from './examPrepMockProfiles';
import type { ExamPrepMockProfile } from './examPrepMockProfiles';
import type {
  ExamPrepMockQuestionKind,
  ExamPrepMockQuestionRef,
} from './examPrepMockTypes';

export type ExamPrepMockNonDrillBucket = 'A' | 'B' | 'NAV' | 'C' | 'D' | 'CD';
export type ExamPrepMockDrillBucket = ExamLookupDrillDifficulty;

export interface ExamPrepMockCandidate {
  kind: ExamPrepMockQuestionKind;
  sourceTaskId: string;
  unitId: string;
  /** Kind-scoped bucket key, e.g. `recall:A`, `locate:CD`, `drill:direct`. */
  bucket: string;
}

const KIND_ORDER: ExamPrepMockQuestionKind[] = ['recall', 'recognition', 'locate', 'drill'];

/** Canonical allocation order for each kind's tier/difficulty buckets. */
export const EXAM_PREP_MOCK_BUCKET_ORDER: Record<
  ExamPrepMockQuestionKind,
  readonly string[]
> = {
  recall: ['A', 'B', 'NAV', 'C'],
  recognition: ['A', 'B', 'NAV', 'CD'],
  locate: ['A', 'B', 'NAV', 'CD'],
  drill: ['direct', 'routing', 'cross_document'],
};

const recognitionLocateBucket = (tier: string): string =>
  tier === 'C' || tier === 'D' ? 'CD' : tier;

/** Deterministic cycling allocation: order buckets, hand out one seat each. */
export const allocateMockBucketCounts = (
  kind: ExamPrepMockQuestionKind,
  total: number,
): Record<string, number> => {
  const allocation: Record<string, number> = {};
  if (total <= 0) return allocation;
  const order = EXAM_PREP_MOCK_BUCKET_ORDER[kind];
  for (let seat = 0; seat < total; seat += 1) {
    const bucket = order[seat % order.length];
    allocation[bucket] = (allocation[bucket] ?? 0) + 1;
  }
  return allocation;
};

/**
 * Bucket quotas for a kind: the profile's configured `questionMix` when
 * present, otherwise the deterministic cycling fallback. Profile-level
 * configuration keeps tier mix changes out of the engine/components.
 */
export const resolveExamPrepMockBucketCounts = (
  profile: ExamPrepMockProfile,
  kind: ExamPrepMockQuestionKind,
): Record<string, number> => {
  const configured = profile.questionMix?.[kind];
  if (configured && Object.keys(configured).length > 0) {
    const result: Record<string, number> = {};
    Object.entries(configured).forEach(([bucket, count]) => {
      if (typeof count === 'number') result[bucket] = count;
    });
    return result;
  }
  return allocateMockBucketCounts(kind, profile.questionCounts[kind]);
};

const buildRecallCandidates = (): ExamPrepMockCandidate[] =>
  EXAM_PREP_RECALL_TASKS.map((task: ExamPrepRecallTask) => ({
    kind: 'recall' as const,
    sourceTaskId: task.id,
    unitId: task.unitId,
    bucket: task.tier,
  }));

const buildRecognitionCandidates = (): ExamPrepMockCandidate[] =>
  EXAM_PREP_RECOGNITION_TASKS.map((task: ExamPrepRecognitionTask) => ({
    kind: 'recognition' as const,
    sourceTaskId: task.id,
    unitId: task.unitId,
    bucket: recognitionLocateBucket(task.tier),
  }));

const buildLocateCandidates = (): ExamPrepMockCandidate[] =>
  EXAM_PREP_LOCATE_TASKS.map((task: ExamPrepLocateTask) => ({
    kind: 'locate' as const,
    sourceTaskId: task.id,
    unitId: task.unitId,
    bucket: recognitionLocateBucket(task.tier),
  }));

const buildDrillCandidates = (): ExamPrepMockCandidate[] =>
  EXAM_PREP_DRILL_UNITS.flatMap((unit) => {
    const difficulty = unit.drill?.difficulty;
    if (!difficulty) return [];
    return [
      {
        kind: 'drill' as const,
        sourceTaskId: `drill:${unit.id}`,
        unitId: unit.id,
        bucket: difficulty,
      },
    ];
  });

const buildCandidatesByKind = (): Record<ExamPrepMockQuestionKind, ExamPrepMockCandidate[]> => ({
  recall: buildRecallCandidates(),
  recognition: buildRecognitionCandidates(),
  locate: buildLocateCandidates(),
  drill: buildDrillCandidates(),
});

const padQuestionId = (index: number, width: number): string =>
  `q${String(index).padStart(width, '0')}`;

/**
 * Fail-closed paper postconditions. The builder derives every field itself,
 * so any violation here means a malformed profile or an allocation bug must
 * surface loudly instead of silently handing learners a wrong-size paper.
 */
export const assertExamPrepMockPaperPostconditions = ({
  paper,
  profile,
  allocations,
}: {
  paper: ExamPrepMockQuestionRef[];
  profile: ExamPrepMockProfile;
  allocations: Array<{ kind: ExamPrepMockQuestionKind; counts: Record<string, number> }>;
}): void => {
  const fail = (detail: string): never => {
    throw new Error(
      `Exam Prep mock paper postcondition failed for profile ${profile.id}: ${detail}.`,
    );
  };
  if (paper.length !== examPrepMockProfileQuestionTotal(profile)) {
    fail(
      `expected ${examPrepMockProfileQuestionTotal(profile)} questions but built ${paper.length}`,
    );
  }
  const pointTotal = paper.reduce((sum, ref) => sum + ref.pointsPossible, 0);
  if (pointTotal !== examPrepMockProfilePointTotal(profile)) {
    fail(`expected ${examPrepMockProfilePointTotal(profile)} points but built ${pointTotal}`);
  }
  allocations.forEach(({ kind, counts }) => {
    const quota = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const selected = paper.filter((ref) => ref.kind === kind).length;
    if (selected !== quota) {
      fail(`kind ${kind}: expected ${quota} questions but selected ${selected}`);
    }
  });
  const seenQuestionIds = new Set<string>();
  const seenSourceTaskIds = new Set<string>();
  paper.forEach((ref, index) => {
    if (ref.pointsPossible !== profile.pointsPerQuestion[ref.kind]) {
      fail(
        `${ref.questionId}: pointsPossible ${ref.pointsPossible} does not match profile ${ref.kind} points ${profile.pointsPerQuestion[ref.kind]}`,
      );
    }
    if (seenQuestionIds.has(ref.questionId)) {
      fail(`duplicate question id ${ref.questionId}`);
    }
    seenQuestionIds.add(ref.questionId);
    if (ref.questionId !== padQuestionId(index + 1, String(paper.length).length)) {
      fail(`question ids must be sequential q01..; found ${ref.questionId} at index ${index}`);
    }
    if (seenSourceTaskIds.has(ref.sourceTaskId)) {
      fail(`duplicate source task id ${ref.sourceTaskId}`);
    }
    seenSourceTaskIds.add(ref.sourceTaskId);
  });
};

/**
 * Builds the session question list for a profile + seed. Deterministic and
 * history-blind. Throws when a profile quota cannot be met by the frozen pool
 * (a configuration error surfaced at paper build time).
 */
export const buildExamPrepMockPaper = ({
  profile,
  seed,
}: {
  profile: ExamPrepMockProfile;
  seed: string;
}): ExamPrepMockQuestionRef[] => {
  assertValidExamPrepMockProfile(profile);
  const candidatesByKind = buildCandidatesByKind();
  const allocations = KIND_ORDER.map((kind) => ({
    kind,
    counts: resolveExamPrepMockBucketCounts(profile, kind),
  }));

  // Seed-shuffled per-bucket candidate pools (streams derive from the seed so
  // same seed => same pools regardless of pool sizes).
  const pools = new Map<string, ExamPrepMockCandidate[]>();
  allocations.forEach(({ kind, counts }) => {
    const kindCandidates = candidatesByKind[kind];
    Object.keys(counts).forEach((bucket) => {
      const pool = kindCandidates.filter((candidate) => candidate.bucket === bucket);
      pools.set(`${kind}:${bucket}`, seededMockShuffle(pool, `${seed}:${kind}:${bucket}`));
    });
  });

  const bucketKeys: string[] = [];
  allocations.forEach(({ kind, counts }) => {
    Object.keys(counts).forEach((bucket) => bucketKeys.push(`${kind}:${bucket}`));
  });

  const cursors = new Map(bucketKeys.map((key) => [key, 0]));
  const chosen = new Map(bucketKeys.map((key) => [key, [] as ExamPrepMockCandidate[]]));
  const quotaOf = (key: string): number => {
    const [kind, bucket] = key.split(':') as [ExamPrepMockQuestionKind, string];
    return allocations.find((entry) => entry.kind === kind)?.counts[bucket] ?? 0;
  };
  const selectedTaskIds = new Set<string>();
  const selectedUnitIds = new Set<string>();
  const poolOf = (key: string): ExamPrepMockCandidate[] => pools.get(key) ?? [];

  const takeFromBucket = (key: string, breadthOnly: boolean): boolean => {
    const selected = chosen.get(key) ?? [];
    if (selected.length >= quotaOf(key)) return false;
    const pool = poolOf(key);
    let cursor = cursors.get(key) ?? 0;
    while (cursor < pool.length) {
      const candidate = pool[cursor];
      cursor += 1;
      if (selectedTaskIds.has(candidate.sourceTaskId)) continue;
      if (breadthOnly && selectedUnitIds.has(candidate.unitId)) continue;
      selected.push(candidate);
      selectedTaskIds.add(candidate.sourceTaskId);
      selectedUnitIds.add(candidate.unitId);
      cursors.set(key, cursor);
      chosen.set(key, selected);
      return true;
    }
    cursors.set(key, cursor);
    chosen.set(key, selected);
    return false;
  };

  // PASS 1 — breadth: a curriculum unit appears only once on the paper.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const key of bucketKeys) {
      const selected = chosen.get(key) ?? [];
      if (selected.length >= quotaOf(key)) continue;
      if (takeFromBucket(key, true)) progressed = true;
    }
  }
  // PASS 2 — only fill any quota the breadth pass could not satisfy.
  for (const key of bucketKeys) {
    const selected = chosen.get(key) ?? [];
    while (selected.length < quotaOf(key)) {
      if (!takeFromBucket(key, false)) {
        throw new Error(
          `Exam Prep mock profile ${profile.id} exceeds the frozen question pool for ${key}.`,
        );
      }
    }
  }

  const selectedCandidates = bucketKeys.flatMap((key) => chosen.get(key) ?? []);
  const mixed = seededMockShuffle(selectedCandidates, `${seed}:mix`);
  const width = String(mixed.length).length;
  const paper = mixed.map((candidate, index) => ({
    questionId: padQuestionId(index + 1, width),
    kind: candidate.kind,
    sourceTaskId: candidate.sourceTaskId,
    unitId: candidate.unitId,
    pointsPossible: profile.pointsPerQuestion[candidate.kind],
  }));
  assertExamPrepMockPaperPostconditions({ paper, profile, allocations });
  return paper;
};
