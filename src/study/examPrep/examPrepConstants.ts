// Exam Prep — shared constants.
//
// Task prompts, session-limit defaults/bounds, and the frozen tier sets are
// centralized here so derivation, selectors, storage defaults, and UI all
// agree. Prompt text and card totals are part of the deterministic Exam Prep
// contract; do not change them without a spec change.

import type { ExamPrepCurriculumTier } from './examPrepTypes';

export const EXAM_PREP_RECALL_PROMPT =
  'State the key rule you should remember for this curriculum unit.';

/**
 * Recognition ask for ordinary document-focused A/B/C/D units. Acknowledges
 * that several laws can matter while still asking for the primary routing
 * target.
 */
export const EXAM_PREP_RECOGNITION_ASK_NORMAL =
  'Which statute, regulation, bylaw, or legal topic should you check first?';

/**
 * Recognition ask for tier-NAV cross-document navigation units, whose cues
 * (e.g. `deed`) are routing problems rather than one-Act facts.
 */
export const EXAM_PREP_RECOGNITION_ASK_NAV =
  'What routing issue should this cue make you resolve first?';

/**
 * Task-aware Recognition question shared by the Recognition sprint, the
 * provisional Mock exam (pre-submission prompt) and Mock grading/review
 * (post-submission echo) so normal / NAV copy cannot drift. Frozen cues are
 * untouched; only the question wording is selected per task tier.
 */
export const examPrepRecognitionAskForTier = (tier: ExamPrepCurriculumTier | string): string =>
  tier === 'NAV' ? EXAM_PREP_RECOGNITION_ASK_NAV : EXAM_PREP_RECOGNITION_ASK_NORMAL;

/**
 * Reveal/expected-block label: NAV recognition tasks expose a routing issue,
 * ordinary tasks expose the expected topic. Presentation only.
 */
export const examPrepRecognitionExpectedLabelForTier = (tier: ExamPrepCurriculumTier | string): string =>
  tier === 'NAV' ? 'Expected routing issue' : 'Expected topic';

/**
 * One-line description of Recognition practice used by the Home Suggested
 * study flow and the Recognition sprint start card.
 */
export const EXAM_PREP_RECOGNITION_PRACTICE_COPY =
  'Practice identifying which law or legal topic applies.';

/** Curriculum tiers rendered by Learn (exactly 133 A-D/NAV units). */
export const EXAM_PREP_LEARN_TIERS = ['A', 'B', 'C', 'D', 'NAV'] as const;

/** Total FSRS recall cards derived from the frozen manifest (57). */
export const EXAM_PREP_TOTAL_RECALL_CARDS = 57;

/** Total Recognition tasks derived from frozen A-D/NAV recognitionCues (317). */
export const EXAM_PREP_TOTAL_RECOGNITION_TASKS = 317;

/** Total Locate tasks derived from every frozen A-D/NAV mustLocate (452). */
export const EXAM_PREP_TOTAL_LOCATE_TASKS = 452;

/** Frozen lookup-drill count (24 DRILL units). */
export const EXAM_PREP_TOTAL_LOOKUP_DRILLS = 24;

/** Total A-D/NAV curriculum units tracked for studied progress (133). */
export const EXAM_PREP_TOTAL_LEARN_UNITS = 133;

export const EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION = 8;
export const EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION = 20;

export const EXAM_PREP_NEW_CARDS_MIN = 0;
export const EXAM_PREP_NEW_CARDS_MAX = EXAM_PREP_TOTAL_RECALL_CARDS;
export const EXAM_PREP_MAX_CARDS_MIN = 1;
export const EXAM_PREP_MAX_CARDS_MAX = EXAM_PREP_TOTAL_RECALL_CARDS;

export const EXAM_PREP_SESSION_LIMIT_DEFAULT = 25;
