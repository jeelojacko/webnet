/**
 * Canonical statutory definition recognition, shared by Study Map job
 * construction (sourceFocusOptions.definedTerms) and grounding validation
 * (DEFINED_TERM_NOT_IN_FOCUS_SOURCE).
 *
 * NB statutes introduce defined terms with either "means" or "includes"
 * (e.g. Highway Act s. 44.1: "highway" includes ...). Both consumer paths must
 * apply the same verbs, or includes-style terms could be offered to the model
 * yet rejected by validation.
 */

/** Definition verbs recognized by NB statutory drafting. */
export const DEFINITION_VERBS = 'means|includes';

/** A quoted term introduced by a definition verb (term length bound unchanged). */
export const DEFINITION_TERM_PATTERN = new RegExp(
  `["“]([^"”]{2,80})["”]\\s+(?:${DEFINITION_VERBS})\\b`,
  'gi',
);

/** Unique quoted terms introduced by a definition verb in `text`, in order. */
export const extractDefinedTerms = (text: string): string[] => {
  const terms = Array.from(text.matchAll(DEFINITION_TERM_PATTERN)).map(
    (match) => match[1].trim(),
  );
  return Array.from(new Set(terms));
};

/** Pattern confirming that `text` defines `term` via a definition verb. */
export const definedTermPattern = (term: string): RegExp => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `["“]?${escaped}["”]?\\s*(?:,\\s*)?(?:unless[^,.;]+,\\s*)?(?:${DEFINITION_VERBS})\\b`,
    'iu',
  );
};
