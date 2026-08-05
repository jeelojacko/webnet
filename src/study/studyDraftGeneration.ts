import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyReferenceAnswerFormat,
  StudySourceCitationSummary,
} from './studyTypes';

export type SelectedLegalSource = ImportedLegalComponent;

export type GeneratedQuestion = {
  question: string;
  template: string;
};

export type ReferenceAnswerOptions = {
  format: StudyReferenceAnswerFormat;
  includeAmendmentHistory: boolean;
  includeConsolidationNotes: boolean;
  includeRepealedProvisions: boolean;
  includeSectionHeadings: boolean;
  includeSourceCitationAfterEachSection: boolean;
};

export type GeneratedReferenceAnswer = {
  text: string;
  warnings: string[];
};

export const DEFAULT_REFERENCE_ANSWER_OPTIONS: ReferenceAnswerOptions = {
  format: 'structured-exact',
  includeAmendmentHistory: false,
  includeConsolidationNotes: false,
  includeRepealedProvisions: true,
  includeSectionHeadings: true,
  includeSourceCitationAfterEachSection: false,
};

const DASH = ' - ';

const sentenceCase = (value: string): string => value.trim().replace(/\s+/g, ' ');

const stripLeadingLabel = (text: string, label: string): string => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*${escaped}\\s*`, 'i'), '').trim();
};

const stripSourceNoise = (text: string, options: ReferenceAnswerOptions): string => {
  let next = text;
  if (!options.includeConsolidationNotes) {
    next = next.replace(/N\.B\.\s*This Regulation is consolidated to [A-Za-z]+\s+\d{1,2},\s+\d{4}\.?\s*/gi, '');
  }
  if (!options.includeAmendmentHistory) {
    next = next
      .replace(/\s*\d{4},\s*c\.[^.\n]*(?:\.|\n|$)/gi, '\n')
      .replace(/\s*O\.C\.\s*\d{4}-\d+[^.\n]*(?:\.|\n|$)/gi, '\n');
  }
  return next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

const isRepealedText = (text: string): boolean => /^\s*(?:[0-9A-Za-z().\s-]+)?Repealed\.?\s*$/i.test(text);

const sectionWord = (component: ImportedLegalComponent): string => {
  if (component.componentType === 'section') return 'Section';
  if (component.componentType === 'schedule') return 'Schedule';
  if (component.componentType === 'form') return 'Form';
  return component.componentType.replace(/-/g, ' ');
};

const pluralSectionWord = (component: ImportedLegalComponent): string => {
  const word = sectionWord(component);
  return word === 'Section' ? 'Sections' : `${word}s`;
};

const selectedLabelText = (components: ImportedLegalComponent[]): string => {
  if (components.length === 0) return '';
  if (components.length === 1) return `${sectionWord(components[0])} ${components[0].label}`;
  const first = components[0];
  const last = components[components.length - 1];
  if (components.every((component) => component.componentType === first.componentType)) {
    return `${pluralSectionWord(first)} ${first.label}-${last.label}`;
  }
  return components.map((component) => `${sectionWord(component)} ${component.label}`).join(', ');
};

const combinedHeading = (components: ImportedLegalComponent[]): string => {
  const headings = components
    .map((component) => sentenceCase(component.heading ?? ''))
    .filter(Boolean)
    .filter((heading, index, all) => all.indexOf(heading) === index);
  if (headings.length === 0) return '';
  if (headings.length === 1) return headings[0];
  if (headings.length === 2) return `${headings[0]} and ${headings[1]}`;
  return `${headings[0]}, ${headings[1]} and related provisions`;
};

export const generateStudyTitle = ({
  documentTitle,
  selectedSources,
}: {
  documentTitle: string;
  selectedSources: SelectedLegalSource[];
}): string => {
  const label = selectedLabelText(selectedSources);
  const heading = combinedHeading(selectedSources);
  return [documentTitle, label + (heading ? `: ${heading}` : '')].filter(Boolean).join(DASH);
};

type QuestionCategory =
  | 'definitions'
  | 'duties'
  | 'powers'
  | 'application'
  | 'requirements'
  | 'notice'
  | 'objection'
  | 'hearing'
  | 'order'
  | 'appeal'
  | 'certification'
  | 'filing'
  | 'offences'
  | 'regulations'
  | 'fallback';

const categoryMatchers: Array<[QuestionCategory, RegExp]> = [
  ['definitions', /\bdefinition|interpretation\b/i],
  ['duties', /\bdut(?:y|ies)\b|\bshall\b.*\bsurveyor\b/i],
  ['powers', /\bpower|authority|authorize|director\b/i],
  ['application', /\bapplication|apply\b/i],
  ['requirements', /\brequirement|required|must\b/i],
  ['notice', /\bnotice|notify|service\b/i],
  ['objection', /\bobjection|object\b/i],
  ['hearing', /\bhearing\b/i],
  ['order', /\border\b/i],
  ['appeal', /\bappeal\b/i],
  ['certification', /\bcertif/i],
  ['filing', /\bfil(?:e|ing)|register|registration|record\b/i],
  ['offences', /\boffence|offense|penalt|fine\b/i],
  ['regulations', /\bregulation\b/i],
];

const classifyQuestionCategory = (sources: SelectedLegalSource[]): QuestionCategory => {
  const haystack = sources.map((source) => `${source.heading ?? ''}\n${source.text.slice(0, 500)}`).join('\n');
  return categoryMatchers.find(([, matcher]) => matcher.test(haystack))?.[0] ?? 'fallback';
};

export const generateStudyQuestion = ({
  documentTitle,
  selectedSources,
}: {
  documentTitle: string;
  officialCitation?: string;
  selectedSources: SelectedLegalSource[];
}): GeneratedQuestion => {
  const label = selectedLabelText(selectedSources).toLowerCase();
  const heading = combinedHeading(selectedSources).toLowerCase();
  const category = classifyQuestionCategory(selectedSources);
  const multi = selectedSources.length > 1;
  if (multi) {
    return {
      template: category,
      question: `What do ${label} of ${documentTitle} establish${heading ? ` about ${heading}` : ''}?`,
    };
  }
  const source = selectedSources[0];
  if (!source) return { template: 'fallback', question: `What should be recalled from ${documentTitle}?` };
  const singleLabel = `${sectionWord(source).toLowerCase()} ${source.label}`;
  const questions: Record<QuestionCategory, string> = {
    definitions: `What definitions are provided in ${singleLabel} of ${documentTitle}?`,
    duties: `What duties does ${singleLabel} of ${documentTitle} impose${heading ? ` about ${heading}` : ''}?`,
    powers: `What powers or authority are established by ${singleLabel} of ${documentTitle}?`,
    application: `What are the application requirements under ${singleLabel} of ${documentTitle}?`,
    requirements: `What requirements are established by ${singleLabel} of ${documentTitle}?`,
    notice: `What notice requirements are established by ${singleLabel} of ${documentTitle}?`,
    objection: `What objection process is established by ${singleLabel} of ${documentTitle}?`,
    hearing: `What hearing process is established by ${singleLabel} of ${documentTitle}?`,
    order: `What order-making rules are established by ${singleLabel} of ${documentTitle}?`,
    appeal: `What appeal rights, restrictions and deadlines are established by ${singleLabel} of ${documentTitle}?`,
    certification: `What certification requirements are established by ${singleLabel} of ${documentTitle}?`,
    filing: `What filing or registration requirements are established by ${singleLabel} of ${documentTitle}?`,
    offences: `What offences or penalties are established by ${singleLabel} of ${documentTitle}?`,
    regulations: `What regulation-making authority is established by ${singleLabel} of ${documentTitle}?`,
    fallback: `What does ${singleLabel} of ${documentTitle} provide?`,
  };
  return { template: category, question: questions[category] };
};

const formatStructuredComponent = (
  document: ImportedLegalDocument,
  component: ImportedLegalComponent,
  options: ReferenceAnswerOptions,
): string => {
  const citation = options.includeSourceCitationAfterEachSection
    ? `\nSource: ${document.officialTitle}${document.officialCitationDisplay ? `, ${document.officialCitationDisplay}` : ''}`
    : '';
  const heading = options.includeSectionHeadings && component.heading ? ` - ${component.heading}` : '';
  if (component.extractionStatus === 'reference-only') {
    return `${sectionWord(component)} ${component.label}${heading}\n\nReference-only form warning: the normalized source did not include a complete body.${citation}`;
  }
  if (component.subsections?.length) {
    const bullets = component.subsections
      .map((subsection) => {
        const cleaned = stripSourceNoise(stripLeadingLabel(subsection.text, subsection.label), options);
        if (isRepealedText(cleaned)) return options.includeRepealedProvisions ? `* ${subsection.label}: Repealed.` : '';
        return `* ${subsection.label}: ${cleaned}`;
      })
      .filter(Boolean)
      .join('\n\n');
    return `${sectionWord(component)} ${component.label}${heading}\n\n${bullets}${citation}`;
  }
  const cleaned = stripSourceNoise(stripLeadingLabel(component.text, component.label), options);
  if (isRepealedText(cleaned)) {
    return options.includeRepealedProvisions ? `${sectionWord(component)} ${component.label}${heading}\n\nRepealed.${citation}` : '';
  }
  return `${sectionWord(component)} ${component.label}${heading}\n\n${cleaned}${citation}`;
};

export const generateReferenceAnswer = ({
  document,
  selectedSources,
  options,
}: {
  document: ImportedLegalDocument;
  selectedSources: SelectedLegalSource[];
  options: ReferenceAnswerOptions;
}): GeneratedReferenceAnswer => {
  if (options.format === 'empty') return { text: '', warnings: [] };
  const warnings = selectedSources
    .filter((source) => source.extractionStatus === 'reference-only')
    .map((source) => `${source.label} is reference-only; the normalized source did not include a complete body.`);
  if (options.format === 'complete-exact-text') {
    return {
      text: selectedSources.map((source) => source.text).join('\n\n'),
      warnings,
    };
  }
  return {
    text: selectedSources
      .map((source) => formatStructuredComponent(document, source, options))
      .filter(Boolean)
      .join('\n\n'),
    warnings,
  };
};

export const generateSourceCitationSummary = ({
  document,
  selectedSources,
}: {
  document: ImportedLegalDocument;
  selectedSources: SelectedLegalSource[];
}): StudySourceCitationSummary => {
  const labels = selectedLabelText(selectedSources).toLowerCase();
  const parts = [
    `${document.officialTitle}${labels ? `, ${labels}` : ''}`,
    document.officialCitationDisplay,
    document.consolidatedTo ? `Consolidated to ${document.consolidatedTo}` : '',
    'Official source: laws.gnb.ca',
  ].filter(Boolean);
  return {
    text: parts.join('\n'),
    officialSource: 'laws.gnb.ca',
    consolidatedTo: document.consolidatedTo,
  };
};

const stopWords = new Set([
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'by',
  'with',
  'under',
  'this',
  'that',
  'shall',
  'may',
  'be',
  'is',
  'are',
  'a',
  'an',
]);

const titleCaseConcept = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(' ');

export const suggestRequiredConcepts = (selectedSources: SelectedLegalSource[], limit = 6): string[] => {
  const candidates: string[] = [];
  for (const source of selectedSources) {
    if (source.heading && source.heading.length <= 80) candidates.push(source.heading);
    for (const subsection of source.subsections ?? []) {
      const text = stripLeadingLabel(subsection.text, subsection.label);
      const phrase = text.match(/\b(?:land titles offices?|instrument-filing hours|office hours|District of New Brunswick)\b/i)?.[0];
      if (phrase) candidates.push(phrase);
    }
  }
  const cleaned = candidates
    .map((candidate) => candidate.replace(/[^A-Za-z0-9 .'-]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((candidate) => {
      const words = candidate.split(/\s+/);
      return words.length >= 2 && words.length <= 7 && words.some((word) => !stopWords.has(word.toLowerCase()));
    })
    .map(titleCaseConcept);
  return cleaned.filter((concept, index) => cleaned.indexOf(concept) === index).slice(0, limit);
};
