/**
 * Component source-text analysis shared by Study AI job preparation.
 *
 * These functions are VERBATIM behavior mirrors of the same functions in
 * scripts/studyAiAuthoring.ts (cleanAiSourceText, sourceStatusFromComponent,
 * contentFlagsFromComponent and their repeal/citation classification
 * support). Keep both copies in lock-step; never change one without the
 * other. Pure logic — no provider calls, deterministic.
 */
import type { NbLawDocumentComponent } from '../content/nbLawTypes';
import type { AiSourceContentFlags } from './studyAiTypes';

export const cleanAiSourceText = (
  text: string,
): {
  operativeSourceText: string;
  sourceMetadata: {
    amendmentHistory?: string[];
    consolidationNotes?: string[];
    cleaningWarnings?: string[];
  };
} => {
  const lines = text.split(/\r?\n/);
  const operative: string[] = [];
  const amendmentHistory: string[] = [];
  const consolidationNotes: string[] = [];
  const cleaningWarnings: string[] = [];
  const amendmentPattern = /^\s*(?:\d{4},\s*c\.|R\.S\.|S\.N\.B\.|N\.B\.)/i;
  const consolidationPattern = /^\s*N\.B\.\s+This\s+(?:Act|Regulation)\s+is\s+consolidated\b/i;
  lines.forEach((line) => {
    if (consolidationPattern.test(line)) {
      consolidationNotes.push(line.trim());
      return;
    }
    if (amendmentPattern.test(line) && /,\s*s\.\s*\d+/i.test(line)) {
      amendmentHistory.push(line.trim());
      return;
    }
    operative.push(line);
  });
  while (operative.length > 1) {
    const last = operative.at(-1)?.trim() ?? '';
    const previous = operative.at(-2)?.trim() ?? '';
    if (
      last.length >= 4 &&
      last.length <= 80 &&
      previous === '' &&
      /^[A-Z][A-Z0-9 ,&'()-]+$/.test(last)
    ) {
      cleaningWarnings.push('TRAILING_STRUCTURAL_HEADING_REMOVED');
      operative.pop();
      continue;
    }
    break;
  }
  const operativeSourceText = operative.join('\n').trim() || text;
  if (!operativeSourceText.trim()) cleaningWarnings.push('OPERATIVE_SOURCE_EMPTY_FALLBACK_USED');
  return {
    operativeSourceText,
    sourceMetadata: { amendmentHistory, consolidationNotes, cleaningWarnings },
  };
};

// Whole-source repeal detection.
//
// A component is repeal-only ONLY when its entire body is a repeal stub plus
// citation/history metadata. A mixed provision whose FIRST subsection is
// repealed but which continues with live text (e.g.
// '2(1)Repealed: 2003, c.14, s.2\n2(2)This Act does not apply...') is NOT
// repeal-only and must remain scannable. The classification is line-based:
//   - the first non-blank line must be a repeal stub;
//   - every other line must be blank, a repeal stub, a citation/history
//     line, a structural heading, or a leaked structural label;
//   - any substantive law text (sentence-case words) makes the body 'mixed';
//   - short lines that are neither parseable metadata nor clearly structural
//     are 'ambiguous' and keep the body OUT of the repeal-only bucket
//     (fail closed).

/** Session/supplement qualifiers attached to a year or chapter: '(Supp.)', '(2nd Sess.)'. */
const CITE_SESSION_SRC = '(?:\\s*\\(\\s*(?:Supp\\.|\\d{1,2}(?:st|nd|rd|th)?\\s*Sess\\.)\\s*\\))?';

/** One citation unit: [year-range|RS][session] [, c.X|cc.X][session] [, s.|art. N...]. */
const CITE_UNIT_RE = new RegExp(
  `^(?:R\\.S\\.|(?:19|20)\\d{2}(?:\\s*[-\\u2013]\\s*(?:19|20)?\\d{2,3})?)${CITE_SESSION_SRC}(?:\\s*,\\s*CC?S?\\.[A-Za-z0-9][\\w./-]*${CITE_SESSION_SRC})*(?:\\s*,\\s*(?:s|art)\\.\\s*[0-9][0-9A-Z.,\\s]*)?\\.?$`,
  'i',
);
/** A line that is only a section-reference list, e.g. 's.5, 6'. */
const CITE_SECTIONS_ONLY_RE = /^s\.\s*[0-9][0-9A-Z.,\s]*$/i;

const isCitationUnit = (value: string): boolean =>
  CITE_UNIT_RE.test(value) || CITE_SECTIONS_ONLY_RE.test(value);

/** A citation/history line: 'O.'-optional units joined by ';' or 'and also'. */
const isCitationLine = (value: string): boolean => {
  const parts = value
    .replace(/^O\.{1,2}\s*/i, '')
    .split(';')
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((part) =>
      part
        .split(/\s+and\s+(?:also\s+)?/i)
        .map((unit) => unit.trim())
        .filter(Boolean)
        .every(isCitationUnit),
    )
  );
};

const REPEALED_DATE_TAIL_RE =
  /^(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,4}(?:,?\s+\d{2,4})?|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}|\d{4})\s*\.?$/i;

const REPEALED_PREFIX_RE = /^(?:[0-9().\s-]+)?Repealed\b/i;

/**
 * 'Repealed', 'Repealed: 2003, c.14, s.2', '2(1)Repealed: ...',
 * 'Repealed January 2006' — the tail must be empty, a citation/history
 * string, or a bare date; anything else is not a stub (fail closed).
 */
const isRepealStubLine = (line: string): boolean => {
  const t = line.trim();
  const prefix = REPEALED_PREFIX_RE.exec(t);
  if (!prefix) return false;
  const rest = t.slice(prefix[0].length).replace(/^[\s:.]+/, '').trim();
  return rest === '' || REPEALED_DATE_TAIL_RE.test(rest) || isCitationLine(rest);
};

/** Leaked next-structure labels left behind by normalization: '3', '21.2', 'IV', 'C'. */
const isStructuralLabelLine = (line: string): boolean => {
  const t = line.trim();
  return (
    /^[0-9]+(?:\.[0-9]+)*$/.test(t) || // leaked next number: '3', '21.2'
    /^[IVXLCDM]{2,7}$/.test(t) || // leaked part number: 'IV', 'IX'
    /^[A-Z]{1,2}\.?$/.test(t) // leaked part marker: 'C', 'B.'
  );
};

/** All-caps section/part heading line, e.g. 'GAS STORAGE', 'REAL PROPERTY ASSESSMENT NOTICE'. */
const isAllCapsHeadingLine = (line: string): boolean => {
  const t = line.trim();
  return t.length >= 4 && t.length <= 80 && /^[A-Z][A-Z0-9 ,&'()\-./]*$/.test(t);
};

/** Words that may stay lowercase in a title-case heading. */
const TITLE_CASE_SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from',
  'in', 'of', 'on', 'or', 'the', 'to', 'with',
]);

/** Title-case leaked heading, e.g. 'Fraction or Gore', 'Deferred Widening By-laws'. */
const isTitleCaseHeadingLine = (line: string): boolean => {
  const t = line.trim();
  if (t.length < 4 || t.length > 80) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  let capitalized = 0;
  for (const word of words) {
    const core = word.replace(/^[^A-Za-z]*/, '').replace(/[^A-Za-z-]+$/, '');
    if (!/[A-Za-z]/.test(word)) continue;
    if (TITLE_CASE_SMALL_WORDS.has(core.toLowerCase()) || core.length <= 2) continue;
    if (!/^[A-Z]/.test(core)) return false;
    capitalized += 1;
  }
  return capitalized >= 2;
};

/** Consolidation footnote, e.g. 'N.B. This Act is consolidated to June 16, 2023.' */
const isConsolidationNoteLine = (line: string): boolean => /^N\.B\.\s/i.test(line.trim());

type RepealLineKind =
  | 'blank'
  | 'stub'
  | 'citation'
  | 'heading'
  | 'label'
  | 'note'
  | 'substantive'
  | 'ambiguous';

const classifyRepealLine = (line: string): RepealLineKind => {
  const t = line.trim();
  if (t === '') return 'blank';
  if (isRepealStubLine(t)) return 'stub';
  if (isCitationLine(t)) return 'citation';
  if (isAllCapsHeadingLine(t)) return 'heading';
  if (isTitleCaseHeadingLine(t)) return 'heading';
  if (isStructuralLabelLine(t)) return 'label';
  if (isConsolidationNoteLine(t)) return 'note';
  const words = t.split(/\s+/).filter(Boolean);
  // Sentence-case law text is substantive; anything short and unparseable is
  // ambiguous and fails closed (never assumed to be metadata).
  return t.length >= 40 || words.length >= 3 ? 'substantive' : 'ambiguous';
};

export interface RepealOnlyClassification {
  /** 'whole': confirmed whole-source repeal; 'mixed': live text present;
   *  'ambiguous': unparseable/unknown lines, fail closed. */
  outcome: 'whole' | 'mixed' | 'ambiguous';
  lineKinds: Partial<Record<RepealLineKind, number>>;
}

export const classifyRepealOnly = (body: string): RepealOnlyClassification => {
  const kinds = body.split(/\r?\n/).map(classifyRepealLine);
  const lineKinds: Partial<Record<RepealLineKind, number>> = {};
  for (const kind of kinds) lineKinds[kind] = (lineKinds[kind] ?? 0) + 1;
  const firstContent = kinds.find((kind) => kind !== 'blank');
  const outcome: RepealOnlyClassification['outcome'] =
    lineKinds.substantive
      ? 'mixed'
      : lineKinds.ambiguous
        ? 'ambiguous'
        : firstContent === 'stub'
          ? 'whole'
          : 'ambiguous';
  return { outcome, lineKinds };
};

/** True only when the ENTIRE body is a repeal stub plus citation/history metadata. */
export const isRepealOnlyText = (text: string): boolean =>
  classifyRepealOnly(text).outcome === 'whole';

// Component text may embed the section heading as its first line (e.g.
// 'Right to dower or curtesy\n\n33Repealed: 2006, c.18, s.2'). For body
// classification, strip the leading heading (when `heading` is set and the
// trimmed text starts with it) so isRepealOnlyText only sees provision text.
const componentBodyText = (component: NbLawDocumentComponent): string => {
  const text = component.text.trim();
  const heading = component.heading?.trim();
  if (heading && text.startsWith(heading)) {
    return text.slice(heading.length).trim();
  }
  return text;
};

export const sourceStatusFromComponent = (
  component: NbLawDocumentComponent,
): 'current' | 'repealed' | 'historical' => {
  const normalized = component.text.toLowerCase();
  if (isRepealOnlyText(componentBodyText(component))) return 'repealed';
  if (/\bhistorical\b/.test(normalized)) return 'historical';
  return 'current';
};

// Explicit amendment-machinery phrasing: the provision itself amends, repeals,
// strikes out, or substitutes text (as opposed to merely granting power to do so).
const CONSEQUENTIAL_AMENDMENT_MACHINERY =
  /\b(?:is|are)\s+(?:amended|repealed|stricken|struck\s*out|deleted|substituted)\b|\bstruck\s*out\b|\bby\s+substituting\b/i;

// The amendment must target a distinct instrument/provision: a named Act, the
// parent "the Act", or a specific section. This keeps ordinary cross-references
// (which name sections but carry no amendment machinery) out of scope.
const CONSEQUENTIAL_AMENDMENT_TARGET =
  /\b(?:the\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+Act\b|\bof\s+the\s+Act\b|\bthe\s+Act\b|\bsection\s+\d+\b/i;

// A provision is a consequential amendment when its operative effect is to amend,
// repeal, or substitute text in another provision/instrument rather than to state
// its own independent legal rule. This is advisory content metadata: it signals the
// model to strongly prefer skip/reference-only, but it never by itself forbids
// mapping content that is independently operative.
export const isConsequentialAmendmentText = (text: string): boolean =>
  CONSEQUENTIAL_AMENDMENT_MACHINERY.test(text) && CONSEQUENTIAL_AMENDMENT_TARGET.test(text);

export const contentFlagsFromComponent = (
  component: NbLawDocumentComponent,
): AiSourceContentFlags => {
  const text = component.text;
  const normalized = text.toLowerCase();
  const repealBody = componentBodyText(component);
  const citationOnly = /\bmay be cited as\b/i.test(text) && text.length < 700;
  return {
    containsRepealedSubprovision: /\brepealed\b/i.test(text) && !isRepealOnlyText(repealBody),
    repealOnly: isRepealOnlyText(repealBody),
    commencementOnly:
      !citationOnly &&
      /\bcomes? into force\b|\bfixed by proclamation\b/i.test(text) &&
      text.length < 700,
    citationOnly,
    transitional: /\btransitional\b/i.test(normalized),
    consequentialAmendment: isConsequentialAmendmentText(text),
    staticGeographicBoundaryDescription: /\bbounded\s+as\s+follows\b/i.test(text),
  };
};
