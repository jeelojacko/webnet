import type {
  StudyAttempt,
  StudyConcept,
  StudyPhase,
  StudyPhaseRules,
  StudyProgress,
  StudyPrompt,
  StudyRating,
  StudyRubricItem,
  StudySessionItem,
  StudyUnit,
} from './studyTypes';

export const DEFAULT_STUDY_PHASE_RULES: StudyPhaseRules = {
  guidedRecallSuccessDaysToFreeRecall: 2,
  freeRecallSuccessDaysToApplication: 2,
  applicationSuccessesToMaintenance: 1,
};

const RATING_INTERVAL_DAYS: Record<StudyRating, number> = {
  again: 0,
  hard: 1,
  good: 3,
  easy: 7,
};

export const toStudyDay = (iso: string): string => iso.slice(0, 10);

const addDaysIso = (iso: string, days: number): string => {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const uniqueDays = (days: string[]): string[] => Array.from(new Set(days)).sort();

const isSuccessfulRating = (rating: StudyRating): boolean => rating === 'good' || rating === 'easy';

const nextPhaseAfterAttempt = (
  progress: StudyProgress,
  rating: StudyRating,
  completedAt: string,
  rules: StudyPhaseRules,
): StudyPhase => {
  if (!isSuccessfulRating(rating)) return progress.phase;
  const completedDay = toStudyDay(completedAt);
  if (
    progress.phase === 'guided-recall' &&
    uniqueDays([...progress.successfulGuidedRecallDays, completedDay]).length >=
      rules.guidedRecallSuccessDaysToFreeRecall
  ) {
    return 'free-recall';
  }
  if (
    progress.phase === 'free-recall' &&
    uniqueDays([...progress.successfulFreeRecallDays, completedDay]).length >=
      rules.freeRecallSuccessDaysToApplication
  ) {
    return 'application';
  }
  if (
    progress.phase === 'application' &&
    progress.applicationSuccessCount + 1 >= rules.applicationSuccessesToMaintenance
  ) {
    return 'maintenance';
  }
  return progress.phase;
};

export const createInitialProgress = (unitId: string, nowIso: string): StudyProgress => ({
  unitId,
  phase: 'unread',
  scheduling: {
    schemaVersion: 1,
    algorithm: 'fsrs',
    initialized: false,
    configVersion: 1,
    legacyDueAt: nowIso,
  },
  dueAt: nowIso,
  lastStudiedAt: null,
  successfulGuidedRecallDays: [],
  successfulFreeRecallDays: [],
  applicationSuccessCount: 0,
  reviewCount: 0,
  createdAt: nowIso,
  updatedAt: nowIso,
});

export const markReadingComplete = (progress: StudyProgress, completedAt: string): StudyProgress => ({
  ...progress,
  phase: progress.phase === 'unread' ? 'guided-recall' : progress.phase,
  dueAt: completedAt,
  lastStudiedAt: completedAt,
  updatedAt: completedAt,
});

export const updateProgressAfterAttempt = ({
  progress,
  attempt,
  rules = DEFAULT_STUDY_PHASE_RULES,
}: {
  progress: StudyProgress;
  attempt: Pick<StudyAttempt, 'rating' | 'completedAt'>;
  rules?: StudyPhaseRules;
}): StudyProgress => {
  const completedDay = toStudyDay(attempt.completedAt);
  const successful = isSuccessfulRating(attempt.rating);
  const phase = nextPhaseAfterAttempt(progress, attempt.rating, attempt.completedAt, rules);
  const intervalDays = RATING_INTERVAL_DAYS[attempt.rating];
  return {
    ...progress,
    phase,
    dueAt: addDaysIso(attempt.completedAt, intervalDays),
    lastStudiedAt: attempt.completedAt,
    successfulGuidedRecallDays:
      successful && progress.phase === 'guided-recall'
        ? uniqueDays([...progress.successfulGuidedRecallDays, completedDay])
        : progress.successfulGuidedRecallDays.slice(),
    successfulFreeRecallDays:
      successful && progress.phase === 'free-recall'
        ? uniqueDays([...progress.successfulFreeRecallDays, completedDay])
        : progress.successfulFreeRecallDays.slice(),
    applicationSuccessCount:
      successful && progress.phase === 'application'
        ? progress.applicationSuccessCount + 1
        : progress.applicationSuccessCount,
    reviewCount: progress.reviewCount + 1,
    updatedAt: attempt.completedAt,
  };
};

const promptRank = (prompt: StudyPrompt, phase: StudyPhase): number => {
  if (prompt.kind === phase) return 0;
  if (phase === 'application' && prompt.kind === 'scenario') return 1;
  if (phase === 'maintenance') return 2;
  return 3;
};

export const buildSessionItems = ({
  units,
  prompts,
  concepts,
  rubrics = [],
  progress,
  nowIso,
  newPriorityLimit = 5,
  limit = 20,
}: {
  units: StudyUnit[];
  prompts: StudyPrompt[];
  concepts: StudyConcept[];
  rubrics?: StudyRubricItem[];
  progress: StudyProgress[];
  nowIso: string;
  newPriorityLimit?: number;
  limit?: number;
}): StudySessionItem[] => {
  const promptByUnit = new Map<string, StudyPrompt[]>();
  prompts.forEach((prompt) => {
    promptByUnit.set(prompt.unitId, [...(promptByUnit.get(prompt.unitId) ?? []), prompt]);
  });
  const conceptsByUnit = new Map<string, StudyConcept[]>();
  concepts.forEach((concept) => {
    conceptsByUnit.set(concept.unitId, [...(conceptsByUnit.get(concept.unitId) ?? []), concept]);
  });
  const rubricsByUnit = new Map<string, StudyRubricItem[]>();
  rubrics.forEach((rubric) => {
    rubricsByUnit.set(rubric.unitId, [...(rubricsByUnit.get(rubric.unitId) ?? []), rubric]);
  });
  const progressByUnit = new Map(progress.map((entry) => [entry.unitId, entry]));
  const candidates = units
    .filter((unit) => unit.priority <= newPriorityLimit)
    .map((unit) => {
      const entry = progressByUnit.get(unit.id) ?? createInitialProgress(unit.id, nowIso);
      const unitPrompts = (promptByUnit.get(unit.id) ?? []).sort(
        (a, b) =>
          promptRank(a, entry.phase) - promptRank(b, entry.phase) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
      const prompt = unitPrompts[0];
      if (!prompt) return null;
      return {
        unit,
        prompt,
        progress: entry,
        concepts: (conceptsByUnit.get(unit.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
        rubrics: (rubricsByUnit.get(unit.id) ?? []).sort(
          (a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt) || a.id.localeCompare(b.id),
        ),
        due: entry.phase !== 'unread' && entry.dueAt <= nowIso,
      } satisfies StudySessionItem;
    })
    .filter((item): item is StudySessionItem => item != null);

  return candidates
    .sort(
      (a, b) =>
        Number(b.due) - Number(a.due) ||
        a.progress.dueAt.localeCompare(b.progress.dueAt) ||
        a.unit.priority - b.unit.priority ||
        a.unit.title.localeCompare(b.unit.title) ||
        a.unit.id.localeCompare(b.unit.id),
    )
    .slice(0, limit);
};
