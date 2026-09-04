// Exam Prep — shared constants.
//
// Task prompts, session-limit defaults/bounds, and the frozen tier sets are
// centralized here so derivation, selectors, storage defaults, and UI all
// agree. Prompt text and card totals are part of the deterministic Exam Prep
// contract; do not change them without a spec change.

export const EXAM_PREP_RECALL_PROMPT =
  'State the key rule you should remember for this curriculum unit.';

/** Curriculum tiers rendered by Learn (exactly 133 A-D/NAV units). */
export const EXAM_PREP_LEARN_TIERS = ['A', 'B', 'C', 'D', 'NAV'] as const;

/** Total FSRS recall cards derived from the frozen manifest (57). */
export const EXAM_PREP_TOTAL_RECALL_CARDS = 57;

/** Total A-D/NAV curriculum units tracked for studied progress (133). */
export const EXAM_PREP_TOTAL_LEARN_UNITS = 133;

export const EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION = 8;
export const EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION = 20;

export const EXAM_PREP_NEW_CARDS_MIN = 0;
export const EXAM_PREP_NEW_CARDS_MAX = EXAM_PREP_TOTAL_RECALL_CARDS;
export const EXAM_PREP_MAX_CARDS_MIN = 1;
export const EXAM_PREP_MAX_CARDS_MAX = EXAM_PREP_TOTAL_RECALL_CARDS;

export const EXAM_PREP_SESSION_LIMIT_DEFAULT = 25;
