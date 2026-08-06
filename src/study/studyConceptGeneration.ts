import type { ImportedLegalComponent, ImportedLegalDocument } from './studyTypes';

export type ConceptGenerationReason =
  | 'defined-term'
  | 'heading'
  | 'subsection-topic'
  | 'actor-action'
  | 'deadline'
  | 'legal-effect'
  | 'fallback';

export type GeneratedConceptSuggestion = {
  label: string;
  sourceKey?: string;
  reason: ConceptGenerationReason;
  confidence: 'high' | 'medium' | 'low';
};

export type ConceptGenerationDiagnostic = GeneratedConceptSuggestion & {
  rejected?: boolean;
  rejectionReason?: string;
};

const GENERIC_HEADINGS = new Set([
  'administration',
  'general',
  'interpretation',
  'miscellaneous',
  'regulations',
]);

const STATUTORY_VERBS =
  'shall|must|may not|may|is required to|are required to|is entitled to|commits an offence|is final and binding|is conclusive proof';

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

const stripLabel = (text: string, label: string): string => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalizeSpaces(text.replace(new RegExp(`^\\s*${escaped}\\s*`, 'i'), ''));
};

const toTitleCase = (value: string): string =>
  normalizeSpaces(value)
    .split(' ')
    .map((word) => {
      if (/^\d/.test(word)) return word;
      if (word.length <= 3) return word.toLowerCase();
      return `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ')
    .replace(/\bNb\b/g, 'NB')
    .replace(/\bNew Brunswick\b/gi, 'New Brunswick');

export const normalizeConceptLabelKey = (label: string): string =>
  normalizeSpaces(label)
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(requirements|requirement)\b/g, 'require')
    .replace(/\b(periods|period)\b/g, 'period')
    .replace(/\b(rights|right)\b/g, 'right')
    .replace(/\b(powers|power)\b/g, 'power')
    .replace(/\b(s|es)\b/g, '')
    .trim();

const isRepealedOnly = (component: ImportedLegalComponent): boolean =>
  /^\s*(?:[0-9A-Za-z().\s-]+)?Repealed\.?\s*$/i.test(component.text);

const isNoiseText = (text: string): boolean =>
  /\b(?:O\.C\.|consolidated to|laws\.gnb\.ca|amended by)\b/i.test(text) && text.length < 180;

const addSuggestion = (
  suggestions: GeneratedConceptSuggestion[],
  suggestion: GeneratedConceptSuggestion,
): void => {
  const label = normalizeSpaces(suggestion.label.replace(/^[,;:.\s-]+|[,;:.\s-]+$/g, ''));
  const words = label.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 9) return;
  if (normalizeConceptLabelKey(label).length === 0) return;
  if (suggestions.some((entry) => normalizeConceptLabelKey(entry.label) === normalizeConceptLabelKey(label))) return;
  suggestions.push({ ...suggestion, label: toTitleCase(label) });
};

const extractDefinedTerms = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  const text = stripLabel(source.text, source.label);
  const matches = text.matchAll(/[“"]([^”"]{2,60})[”"]\s+means\b/gi);
  for (const match of matches) {
    addSuggestion(suggestions, {
      label: match[1],
      sourceKey: source.sourceKey,
      reason: 'defined-term',
      confidence: 'high',
    });
  }
};

const extractHeading = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  const heading = normalizeSpaces(source.heading ?? '');
  if (!heading || GENERIC_HEADINGS.has(heading.toLowerCase())) return;
  addSuggestion(suggestions, {
    label: heading,
    sourceKey: source.sourceKey,
    reason: 'heading',
    confidence: 'high',
  });
};

const extractSubsectionTopics = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  for (const subsection of source.subsections ?? []) {
    const text = stripLabel(subsection.text, subsection.label);
    const firstSentence = normalizeSpaces(text.split(/[.;:]/)[0] ?? '');
    const namedPhrase =
      firstSentence.match(/\b(?:District of New Brunswick|land titles offices?|instrument filing hours|office hours|office locations?)\b/i)?.[0] ??
      firstSentence.match(/\b(?:application|notice|hearing|appeal|filing|registration|certificate|plan of survey)[a-z ]{0,45}\b/i)?.[0];
    if (!namedPhrase) continue;
    addSuggestion(suggestions, {
      label: namedPhrase,
      sourceKey: subsection.sourceKey,
      reason: 'subsection-topic',
      confidence: 'medium',
    });
  }
};

const extractActorActions = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  const sentences = stripLabel(source.text, source.label).split(/(?<=[.;])\s+/);
  const matcher = new RegExp(`\\b([A-Z][A-Za-z ]{1,45}|[a-z][a-z ]{1,45})\\s+(${STATUTORY_VERBS})\\s+([^.;]{3,80})`, 'i');
  for (const sentence of sentences) {
    const match = normalizeSpaces(sentence).match(matcher);
    if (!match) continue;
    const actor = normalizeSpaces(match[1]).replace(/^(the|a|an)\s+/i, '');
    const verb = normalizeSpaces(match[2]);
    const object = normalizeSpaces(match[3]).replace(/\s+if\b.*$/i, '');
    const label = /may/i.test(verb)
      ? `${actor} power: ${object}`
      : `${object} requirement`;
    addSuggestion(suggestions, {
      label,
      sourceKey: source.sourceKey,
      reason: 'actor-action',
      confidence: 'medium',
    });
  }
};

const extractDeadlines = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  const text = stripLabel(source.text, source.label);
  const matches = text.matchAll(/\b(?:within|not later than|before|after)?\s*(\d+|one|two|three|six|twelve)\s+(day|days|month|months|year|years|hour|hours)\b[^.;]{0,45}/gi);
  for (const match of matches) {
    addSuggestion(suggestions, {
      label: normalizeSpaces(match[0]).replace(/^within\s+/i, '') + ' period',
      sourceKey: source.sourceKey,
      reason: 'deadline',
      confidence: 'medium',
    });
  }
};

const extractLegalEffects = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  const effects = [
    'conclusive proof',
    'final and binding',
    'does not constitute adjudication on title',
    'primary evidence',
    'right of appeal',
    'no right of action',
  ];
  const text = stripLabel(source.text, source.label);
  for (const effect of effects) {
    if (!new RegExp(`\\b${effect}\\b`, 'i').test(text)) continue;
    addSuggestion(suggestions, {
      label: effect,
      sourceKey: source.sourceKey,
      reason: 'legal-effect',
      confidence: 'high',
    });
  }
};

const extractFallback = (
  source: ImportedLegalComponent,
  suggestions: GeneratedConceptSuggestion[],
): void => {
  if (suggestions.some((entry) => entry.sourceKey === source.sourceKey && entry.confidence !== 'low')) return;
  const heading = normalizeSpaces(source.heading ?? '');
  if (heading && !GENERIC_HEADINGS.has(heading.toLowerCase())) {
    addSuggestion(suggestions, { label: heading, sourceKey: source.sourceKey, reason: 'fallback', confidence: 'low' });
    return;
  }
  const text = stripLabel(source.text, source.label);
  const quoted = text.match(/[“"]([^”"]{3,50})[”"]/);
  const firstSentence = normalizeSpaces(text.split(/[.;:]/)[0] ?? '');
  addSuggestion(suggestions, {
    label: quoted?.[1] ?? firstSentence,
    sourceKey: source.sourceKey,
    reason: 'fallback',
    confidence: 'low',
  });
};

export const generateRequiredConcepts = ({
  document: _document,
  selectedSources,
  limit = 12,
}: {
  document?: ImportedLegalDocument;
  selectedSources: ImportedLegalComponent[];
  limit?: number;
}): GeneratedConceptSuggestion[] => {
  const suggestions: GeneratedConceptSuggestion[] = [];
  for (const source of selectedSources) {
    if (source.extractionStatus === 'reference-only' || isRepealedOnly(source) || isNoiseText(source.text)) continue;
    extractDefinedTerms(source, suggestions);
    extractHeading(source, suggestions);
    extractSubsectionTopics(source, suggestions);
    extractActorActions(source, suggestions);
    extractDeadlines(source, suggestions);
    extractLegalEffects(source, suggestions);
    extractFallback(source, suggestions);
  }
  return suggestions.slice(0, limit);
};
