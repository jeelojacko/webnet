// Exam Prep — shared UI formatting helpers (no components).
//
// Kept out of component files so fast-refresh component modules export only
// components.

export const DRILL_DIFFICULTY_LABELS = {
  direct: 'direct',
  routing: 'routing',
  cross_document: 'cross-document',
} as const;

export const EXAM_PREP_MOCK_KIND_ORDER = ['recall', 'recognition', 'locate', 'drill'] as const;

export const EXAM_PREP_MOCK_KIND_LABELS = {
  recall: 'Recall',
  recognition: 'Recognition',
  locate: 'Locate',
  drill: 'Lookup drill',
} as const;

/** Formats elapsed seconds as M:SS (150 seconds renders "2:30"). */
export const formatExamDrillTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Formats seconds as H:MM:SS for mock timers (9056 seconds renders "2:30:56"). */
export const formatExamMockClock = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const remainingSeconds = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds,
  ).padStart(2, '0')}`;
};

export const EXAM_PREP_LEARNING_DEPTHS = ['recognize', 'understand', 'recall', 'retrieve'] as const;

export const examPrepTierLabel = (tier: 'A' | 'B' | 'C' | 'D' | 'NAV' | 'DRILL'): string =>
  tier === 'NAV' ? 'Navigation' : tier === 'DRILL' ? 'DRILL' : `Tier ${tier}`;

/**
 * Human-readable provision label for a locate reveal. Real frozen sourceKeys
 * are `section:…` (385), `schedule:…` (4) or `form:…` (1).
 */
export const examPrepProvisionLabel = (sourceKey: string): string => {
  const [type, ...rest] = sourceKey.split(':');
  const value = rest.join(':');
  if (type === 'section') return `s.${value}`;
  if (type === 'schedule') {
    return `SCHEDULE ${value.replace(/^schedule-?/i, '').toUpperCase()}`;
  }
  if (type === 'form') return `Form ${value.replace(/^form-?/i, '')}`;
  return sourceKey;
};
