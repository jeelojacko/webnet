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

/** Kind-scoped bucket keys the mock engine can allocate (pool buckets). */
export const EXAM_PREP_MOCK_MIX_BUCKETS: Record<
  'recall' | 'recognition' | 'locate' | 'drill',
  readonly string[]
> = {
  recall: ['A', 'B', 'C', 'D', 'NAV'],
  recognition: ['A', 'B', 'NAV', 'CD'],
  locate: ['A', 'B', 'NAV', 'CD'],
  drill: ['direct', 'routing', 'cross_document'],
};

const isNonNegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const kindBucketCount = (
  profile: ExamPrepMockProfile,
  kind: keyof typeof EXAM_PREP_MOCK_MIX_BUCKETS,
): number => {
  const mix = profile.questionMix?.[kind];
  if (!mix) return 0;
  let total = 0;
  Object.values(mix).forEach((count) => {
    if (typeof count === 'number') total += count;
  });
  return total;
};

/**
 * Structural profile validation: fails closed (returns every problem found)
 * so malformed profiles/questionMix cannot silently produce a wrong paper.
 * Called before paper generation and pinned by tests.
 */
export const validateExamPrepMockProfile = (
  profile: ExamPrepMockProfile,
): string[] => {
  const errors: string[] = [];
  const add = (message: string): void => {
    errors.push(message);
  };

  if (typeof profile.id !== 'string' || profile.id.trim() === '') {
    add('id must be a non-empty string');
  }
  if (!isNonNegativeInteger(profile.version) || profile.version < 1) {
    add('version must be a positive integer');
  }
  if (typeof profile.title !== 'string' || profile.title.trim() === '') {
    add('title must be a non-empty string');
  }
  if (profile.status !== 'provisional' && profile.status !== 'official') {
    add("status must be 'provisional' or 'official'");
  }
  if (!isNonNegativeInteger(profile.durationMinutes) || profile.durationMinutes < 1) {
    add('durationMinutes must be a positive integer');
  }
  if (profile.timePolicy !== 'hard_stop') {
    add("timePolicy must be 'hard_stop'");
  }
  if (
    profile.passMarkPercent !== null &&
    (!isNonNegativeInteger(profile.passMarkPercent) ||
      profile.passMarkPercent < 1 ||
      profile.passMarkPercent > 100)
  ) {
    add('passMarkPercent must be null or an integer between 1 and 100');
  }
  if (typeof profile.resources?.openBook !== 'boolean') {
    add('resources.openBook must be a boolean');
  }
  if (typeof profile.resources?.builtInStatuteLibrary !== 'boolean') {
    add('resources.builtInStatuteLibrary must be a boolean');
  }
  if (profile.resources?.builtInStatuteLibrary && !profile.resources?.openBook) {
    add('resources.builtInStatuteLibrary requires resources.openBook');
  }
  if (examPrepMockProfileQuestionTotal(profile) < 1) {
    add('questionCounts must total at least one question');
  }

  const kinds: Array<keyof typeof EXAM_PREP_MOCK_MIX_BUCKETS> = [
    'recall',
    'recognition',
    'locate',
    'drill',
  ];
  kinds.forEach((kind) => {
    const count = profile.questionCounts[kind];
    if (!isNonNegativeInteger(count)) {
      add(`questionCounts.${kind} must be a non-negative integer`);
    }
    const points = profile.pointsPerQuestion[kind];
    if (!isNonNegativeInteger(points) || points < 1) {
      add(`pointsPerQuestion.${kind} must be a positive integer`);
    }
  });

  if (profile.questionMix !== undefined) {
    if (typeof profile.questionMix !== 'object' || profile.questionMix === null) {
      add('questionMix must be an object');
    } else {
      Object.keys(profile.questionMix).forEach((kindKey) => {
        if (!kinds.includes(kindKey as keyof typeof EXAM_PREP_MOCK_MIX_BUCKETS)) {
          add(`questionMix has an unknown question kind: ${kindKey}`);
          return;
        }
        const kind = kindKey as keyof typeof EXAM_PREP_MOCK_MIX_BUCKETS;
        const mix = profile.questionMix?.[kind];
        const expected = profile.questionCounts[kind];
        if (typeof mix !== 'object' || mix === null) {
          add(`questionMix.${kind} must be an object`);
          return;
        }
        const entries = Object.entries(mix);
        entries.forEach(([bucket, bucketCount]) => {
          if (!EXAM_PREP_MOCK_MIX_BUCKETS[kind].includes(bucket)) {
            add(`questionMix.${kind} has an unknown bucket: ${bucket}`);
          } else if (!isNonNegativeInteger(bucketCount)) {
            add(`questionMix.${kind}.${bucket} must be a non-negative integer`);
          }
        });
        // A kind with an empty mix object falls back to cycling; only a
        // non-empty mix must agree with the kind's configured question count.
        if (entries.length > 0 && kindBucketCount(profile, kind) !== expected) {
          add(
            `questionMix.${kind} bucket counts (${kindBucketCount(profile, kind)}) must sum to questionCounts.${kind} (${expected})`,
          );
        }
      });
    }
  }

  return errors;
};

/** Throws when a profile fails structural validation. */
export const assertValidExamPrepMockProfile = (
  profile: ExamPrepMockProfile,
): void => {
  const errors = validateExamPrepMockProfile(profile);
  if (errors.length > 0) {
    throw new Error(
      `Exam Prep mock profile ${profile.id ?? '(missing id)'} is invalid: ${errors.join('; ')}.`,
    );
  }
};
