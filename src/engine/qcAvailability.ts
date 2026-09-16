/**
 * Phase 14F §§16-17: shared QC availability taxonomy and restriction language.
 *
 * Display-boundary helpers only — no math. Centralizes the wording used by
 * report QC strips and settings notes so section-level reasons stay
 * consistent without touching the statistical-semantics registry or tooltips
 * (owned elsewhere).
 */

/** Closed vocabulary for why a QC result is not shown as a value. */
export type QcAvailabilityCategory =
  | 'unavailable'
  | 'unestimable'
  | 'insufficient-data'
  | 'not-analyzed'
  | 'not-applicable'
  | 'cancelled';

/**
 * Compact one-line section status: `<Section> <category> — <reason>.`
 * Compact tables keep showing "-" for these cells; the section-level line
 * (or row tooltip/detail) carries the reason — never a bare dash alone.
 */
export const formatQcAvailability = (
  section: string,
  category: QcAvailabilityCategory,
  reason: string,
): string => `${section} ${category} — ${reason}.`;

/**
 * Standard line for QC strips whose run summary is missing entirely
 * (e.g. runs solved before the summary existed). Categorized as
 * not-analyzed: the run simply did not produce this analysis.
 */
export const formatQcSummaryMissing = (section: string): string =>
  formatQcAvailability(section, 'not-analyzed', 'not reported for this run');
