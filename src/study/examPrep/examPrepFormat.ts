// Exam Prep — shared UI formatting helpers (no components).
//
// Kept out of component files so fast-refresh component modules export only
// components.

export const DRILL_DIFFICULTY_LABELS = {
  direct: 'direct',
  routing: 'routing',
  cross_document: 'cross-document',
} as const;

/** Formats elapsed seconds as M:SS (150 seconds renders "2:30"). */
export const formatExamDrillTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

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
