import type {
  SerializedStudyFsrsCard,
  StudyConcept,
  StudyFsrsSchedule,
  StudyPhase,
  StudyProgress,
  StudyPrompt,
  StudyQueueReason,
  StudyRubricItem,
  StudySessionItem,
  StudyUnit,
} from './studyTypes';
import { createInitialProgress } from './studyScheduler';

export type StudyQueueItem = StudySessionItem & {
  reason: StudyQueueReason;
  dueAt: string | null;
};

export type BuildStudyQueueOptions = {
  units: StudyUnit[];
  prompts: StudyPrompt[];
  concepts: StudyConcept[];
  rubrics?: StudyRubricItem[];
  progress: StudyProgress[];
  now: Date;
  newUnitsPerSession: number;
  limit?: number;
  includeSurprisePractice?: boolean;
  surpriseUnitIds?: string[];
  unitFilter?: (_unit: StudyUnit) => boolean;
};

const promptRank = (prompt: StudyPrompt, phase: StudyPhase): number => {
  if (prompt.kind === phase) return 0;
  if (phase === 'application' && prompt.kind === 'scenario') return 1;
  if (phase === 'maintenance') return 2;
  return 3;
};

const groupBy = <T>(items: T[], keyFor: (_item: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
};

const scheduleDueAt = (schedule: StudyFsrsSchedule | undefined): string | null => {
  if (!schedule) return null;
  if (schedule.initialized && schedule.card) return schedule.card.due;
  return schedule.legacyDueAt ?? null;
};

const isDue = (dueAt: string | null, nowIso: string): boolean => Boolean(dueAt && dueAt <= nowIso);

const initializedState = (
  schedule: StudyFsrsSchedule | undefined,
): SerializedStudyFsrsCard['state'] | null => {
  if (!schedule?.initialized || !schedule.card) return null;
  return schedule.card.state;
};

const reasonFor = (
  unit: StudyUnit,
  progress: StudyProgress,
  nowIso: string,
): StudyQueueReason | null => {
  if (unit.sourceReviewRequired || unit.sourceReferenceMissing) return 'source-review-required';
  const state = initializedState(progress.scheduling);
  const dueAt = scheduleDueAt(progress.scheduling);
  if (state === 'Learning') return isDue(dueAt, nowIso) ? 'learning-due' : null;
  if (state === 'Relearning') return isDue(dueAt, nowIso) ? 'relearning-due' : null;
  if (state === 'Review') return isDue(dueAt, nowIso) ? 'review-due' : null;
  if (!progress.scheduling?.initialized && progress.scheduling?.legacyDueAt) {
    if (progress.phase === 'unread') return 'new';
    return isDue(progress.scheduling.legacyDueAt, nowIso) ? 'review-due' : null;
  }
  return !progress.scheduling?.initialized ? 'new' : null;
};

const queueGroupRank: Record<StudyQueueReason, number> = {
  'source-review-required': 0,
  'learning-due': 1,
  'relearning-due': 1,
  'review-due': 2,
  new: 3,
  'surprise-practice': 4,
};

const compareDueItems = (a: StudyQueueItem, b: StudyQueueItem): number =>
  (a.dueAt ?? '').localeCompare(b.dueAt ?? '') ||
  a.unit.priority - b.unit.priority ||
  a.unit.title.localeCompare(b.unit.title) ||
  a.unit.id.localeCompare(b.unit.id);

const compareNewItems = (a: StudyQueueItem, b: StudyQueueItem): number =>
  a.unit.priority - b.unit.priority ||
  a.unit.title.localeCompare(b.unit.title) ||
  a.unit.id.localeCompare(b.unit.id);

const compareQueueItems = (a: StudyQueueItem, b: StudyQueueItem): number => {
  const group = queueGroupRank[a.reason] - queueGroupRank[b.reason];
  if (group !== 0) return group;
  if (a.reason === 'new' || a.reason === 'surprise-practice') return compareNewItems(a, b);
  return compareDueItems(a, b);
};

const buildCandidate = ({
  unit,
  progress,
  reason,
  dueAt,
  promptsByUnit,
  conceptsByUnit,
  rubricsByUnit,
}: {
  unit: StudyUnit;
  progress: StudyProgress;
  reason: StudyQueueReason;
  dueAt: string | null;
  promptsByUnit: Map<string, StudyPrompt[]>;
  conceptsByUnit: Map<string, StudyConcept[]>;
  rubricsByUnit: Map<string, StudyRubricItem[]>;
}): StudyQueueItem | null => {
  const prompt = (promptsByUnit.get(unit.id) ?? [])
    .slice()
    .sort(
      (a, b) =>
        promptRank(a, progress.phase) - promptRank(b, progress.phase) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )[0];
  if (!prompt) return null;
  return {
    unit,
    prompt,
    progress,
    concepts: (conceptsByUnit.get(unit.id) ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label)),
    rubrics: (rubricsByUnit.get(unit.id) ?? [])
      .slice()
      .sort(
        (a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt) || a.id.localeCompare(b.id),
      ),
    due: reason !== 'new' && reason !== 'surprise-practice',
    reason,
    dueAt,
  };
};

export const buildStudyQueue = ({
  units,
  prompts,
  concepts,
  rubrics = [],
  progress,
  now,
  newUnitsPerSession,
  limit = 25,
  includeSurprisePractice = false,
  surpriseUnitIds = [],
  unitFilter = () => true,
}: BuildStudyQueueOptions): StudyQueueItem[] => {
  const nowIso = now.toISOString();
  const promptsByUnit = groupBy(prompts, (prompt) => prompt.unitId);
  const conceptsByUnit = groupBy(concepts, (concept) => concept.unitId);
  const rubricsByUnit = groupBy(rubrics, (rubric) => rubric.unitId);
  const progressByUnit = new Map(progress.map((entry) => [entry.unitId, entry]));
  const surpriseIds = new Set(surpriseUnitIds);
  const dueItems: StudyQueueItem[] = [];
  const newItems: StudyQueueItem[] = [];
  const surpriseItems: StudyQueueItem[] = [];

  for (const unit of units.filter(unitFilter)) {
    const entry = progressByUnit.get(unit.id) ?? createInitialProgress(unit.id, nowIso);
    const reason = reasonFor(unit, entry, nowIso);
    const dueAt = scheduleDueAt(entry.scheduling);
    const queueReason =
      includeSurprisePractice && surpriseIds.has(unit.id) && reason === null
        ? 'surprise-practice'
        : reason;
    if (!queueReason) continue;
    const candidate = buildCandidate({
      unit,
      progress: entry,
      reason: queueReason,
      dueAt,
      promptsByUnit,
      conceptsByUnit,
      rubricsByUnit,
    });
    if (!candidate) continue;
    if (candidate.reason === 'new') newItems.push(candidate);
    else if (candidate.reason === 'surprise-practice') surpriseItems.push(candidate);
    else dueItems.push(candidate);
  }

  return [
    ...dueItems.sort(compareQueueItems),
    ...newItems.sort(compareQueueItems).slice(0, Math.max(0, newUnitsPerSession)),
    ...surpriseItems.sort(compareQueueItems),
  ].slice(0, limit);
};
