// Exam Prep Mock — versioned exam profiles.
//
// Every uncertain exam-format assumption lives inside a versioned profile
// registry so the mock engine, session persistence, question pools and
// results architecture never hard-wire format details. Sessions snapshot the
// profile that started them, so later registrar-driven changes (a new
// `nb-statute-official-v1`, a `provisional-v2`, a different duration) never
// reinterpret historical sessions.

export interface ExamPrepMockProfileResources {
  openBook: boolean;
  builtInStatuteLibrary: boolean;
}

export interface ExamPrepMockProfileQuestionCounts {
  recall: number;
  recognition: number;
  locate: number;
  drill: number;
}

export interface ExamPrepMockProfilePointsPerQuestion {
  recall: number;
  recognition: number;
  locate: number;
  drill: number;
}

export interface ExamPrepMockProfile {
  id: string;
  version: number;

  title: string;
  description: string;

  status: 'provisional' | 'official';

  durationMinutes: number;

  questionCounts: ExamPrepMockProfileQuestionCounts;
  pointsPerQuestion: ExamPrepMockProfilePointsPerQuestion;

  resources: ExamPrepMockProfileResources;

  timePolicy: 'hard_stop';

  passMarkPercent: number | null;

  assumptions: string[];

  /**
   * Optional per-kind tier/difficulty quotas. Bucket keys are tier letters
   * (A/B/C/D/NAV or the combined `CD`) for recall/recognition/locate and
   * drill difficulty names for drills; each kind's values must sum to its
   * questionCounts entry. Omitted kinds fall back to the deterministic
   * cycling allocation (allocateMockBucketCounts).
   */
  questionMix?: Partial<
    Record<
      ExamPrepMockQuestionKindLike,
      Partial<Record<string, number>>
    >
  >;
}

type ExamPrepMockQuestionKindLike = 'recall' | 'recognition' | 'locate' | 'drill';

/** Total questions configured by a profile (30 for the provisional V1). */
export const examPrepMockProfileQuestionTotal = (
  profile: ExamPrepMockProfile,
): number =>
  profile.questionCounts.recall +
  profile.questionCounts.recognition +
  profile.questionCounts.locate +
  profile.questionCounts.drill;

/** Total possible points configured by a profile (42 for the provisional V1). */
export const examPrepMockProfilePointTotal = (profile: ExamPrepMockProfile): number =>
  profile.questionCounts.recall * profile.pointsPerQuestion.recall +
  profile.questionCounts.recognition * profile.pointsPerQuestion.recognition +
  profile.questionCounts.locate * profile.pointsPerQuestion.locate +
  profile.questionCounts.drill * profile.pointsPerQuestion.drill;

/**
 * Provisional Statute Law mock profile V1. Question format, resource rules and
 * pass mark are NOT confirmed by the registrar; `passMarkPercent` is null on
 * purpose and every UI that uses this profile labels it provisional.
 */
export const EXAM_PREP_PROVISIONAL_MOCK_V1: ExamPrepMockProfile = {
  id: 'nb-statute-provisional-v1',
  version: 1,
  title: 'Provisional Mock Exam',
  description:
    'A timed, open-book Statute Law practice simulation over the frozen exam curriculum.',
  status: 'provisional',
  durationMinutes: 150,
  questionCounts: { recall: 6, recognition: 8, locate: 10, drill: 6 },
  pointsPerQuestion: { recall: 1, recognition: 1, locate: 1, drill: 3 },
  resources: { openBook: true, builtInStatuteLibrary: true },
  timePolicy: 'hard_stop',
  passMarkPercent: null,
  questionMix: {
    recall: { A: 2, B: 2, NAV: 1, C: 1 },
    recognition: { A: 3, B: 2, NAV: 2, CD: 1 },
    locate: { A: 4, B: 3, NAV: 2, CD: 1 },
    drill: { direct: 2, routing: 2, cross_document: 2 },
  },
  assumptions: [
    'Exam-format details are awaiting confirmation from the registrar.',
    'Open-book format is assumed for this practice profile.',
    'A built-in browser statute library is assumed available.',
    'No official pass mark is configured.',
  ],
};

/** Registry of known profiles; the active default is the provisional V1. */
export const EXAM_PREP_MOCK_PROFILES: ExamPrepMockProfile[] = [EXAM_PREP_PROVISIONAL_MOCK_V1];

export const EXAM_PREP_DEFAULT_MOCK_PROFILE: ExamPrepMockProfile = EXAM_PREP_PROVISIONAL_MOCK_V1;

export const selectExamPrepMockProfile = (
  profileId: string,
): ExamPrepMockProfile | null =>
  EXAM_PREP_MOCK_PROFILES.find((profile) => profile.id === profileId) ?? null;
