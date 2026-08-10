import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyReferenceAnswerFormat,
  StudyRubricCategory,
  StudySourceCitationSummary,
} from './studyTypes';
import { generateRequiredConcepts } from './studyConceptGeneration';
import { prepareLegalText } from './studyLegalTextPreparation';
import {
  hasPositiveTopicEvidence,
  headingSubject,
  hasTierASurfaceQualityFailure,
  classifyStrongHeadingTopic,
  normalizeHeadingSubject,
  questionHasUnsupportedTopic,
  sourceEvidenceText,
  strongHeadingTopicMismatch,
  type StudyQuestionTier,
} from './studyQuestionSupport';

export { generateRequiredConcepts } from './studyConceptGeneration';
export type { GeneratedConceptSuggestion } from './studyConceptGeneration';

export type SelectedLegalSource = ImportedLegalComponent;

export type GeneratedQuestion = {
  question: string;
  template: string;
  questionTier: StudyQuestionTier;
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
  const prepared = prepareLegalText(text);
  const parts = [prepared.operativeText];
  if (options.includeAmendmentHistory && prepared.amendmentHistoryText) parts.push(prepared.amendmentHistoryText);
  if (options.includeConsolidationNotes && prepared.consolidationText) parts.unshift(prepared.consolidationText);
  return parts.filter(Boolean).join('\n').trim();
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
  const heading = combinedHeading(sources);
  if (/\bdefinition|interpretation\b/i.test(heading)) return 'definitions';
  if (/\boffences? and penalt/i.test(heading) && hasPositiveTopicEvidence(sources, 'offences')) return 'offences';
  if (/\bcorrection\b/i.test(heading)) return 'fallback';
  if (/\bobjection\b/i.test(heading)) return 'objection';
  if (/\bhearing\b/i.test(heading)) return 'hearing';
  if (/\bsubdivision plan\b/i.test(heading)) return 'requirements';
  if (/\bapproval of subdivision plan\b/i.test(heading)) return 'requirements';
  if (/\binitiation of proceeding by registrar general\b/i.test(heading)) return 'application';
  if (/\blay-?out of streets and lots\b/i.test(heading)) return 'powers';
  if (/\bfil(?:e|ing)|register|registration|record\b/i.test(heading)) return 'filing';
  if (/\bnotice|notify|service\b/i.test(heading) && hasPositiveTopicEvidence(sources, 'notice')) return 'notice';
  if (/\bappeal\b/i.test(heading) && hasPositiveTopicEvidence(sources, 'appeal')) return 'appeal';
  if (/\border\b/i.test(heading)) return 'order';
  if (/\bregulations?\b/i.test(heading) && hasPositiveTopicEvidence(sources, 'regulations')) return 'regulations';
  if (/\bestablishment of coordinate survey system\b/i.test(heading)) return 'powers';
  const haystack = sources.map((source) => `${source.heading ?? ''}\n${source.text.slice(0, 500)}`).join('\n');
  const matched = categoryMatchers.find(([, matcher]) => matcher.test(haystack))?.[0] ?? 'fallback';
  if (matched === 'offences' && !hasPositiveTopicEvidence(sources, 'offences')) return 'fallback';
  if (matched === 'notice' && !hasPositiveTopicEvidence(sources, 'notice')) return 'fallback';
  if (matched === 'filing' && !hasPositiveTopicEvidence(sources, 'filing')) return 'fallback';
  if (matched === 'appeal' && !hasPositiveTopicEvidence(sources, 'appeal')) return 'fallback';
  if (matched === 'certification' && !hasPositiveTopicEvidence(sources, 'certification')) return 'fallback';
  if (matched === 'application' && !hasPositiveTopicEvidence(sources, 'application')) return 'fallback';
  if (matched === 'regulations' && !hasPositiveTopicEvidence(sources, 'regulations')) return 'fallback';
  return matched;
};

const sourceIdentity = (source: Pick<ImportedLegalComponent, 'documentId' | 'sourceKey'>): string =>
  `${source.documentId}::${source.sourceKey}`;

const withIndefiniteArticle = (value: string): string => {
  const normalized = sentenceCase(value).toLowerCase();
  if (!normalized) return '';
  if (/^(?:the|a|an|service new brunswick|minister|registrar general|lieutenant-governor)/i.test(normalized)) return normalized;
  return `${/^[aeiou]/i.test(normalized) ? 'an' : 'a'} ${normalized}`;
};

const headingAfter = (heading: string, prefix: RegExp): string =>
  normalizeHeadingSubject(sentenceCase(heading).replace(prefix, ''));

const dutyActorFromHeading = (heading: string): string =>
  sentenceCase(heading).match(/^duties\s+of\s+(.+?)(?:\s+(?:re|regarding|about)\s+.+)?$/i)?.[1] ?? '';

const dutySubject = (source: ImportedLegalComponent): string => {
  const heading = source.heading ?? '';
  const headingSubjectText = headingAfter(heading, /^duties\s+of\s+.+?\s+(?:re|regarding|about)\s+/i);
  const text = sourceEvidenceText([source]);
  if (/integrated survey area/i.test(heading) && /\blegal monuments?\b/i.test(text)) {
    return 'legal monuments in an integrated survey area';
  }
  if (/coordinate survey system/i.test(heading) && /\bbearings?\b/i.test(text) && /\bdistances?\b/i.test(text)) {
    return 'boundary bearings, distances and parcel descriptions under the coordinate survey system';
  }
  return headingSubjectText;
};

const failureActorFromText = (source: ImportedLegalComponent): string => {
  const text = sourceEvidenceText([source]);
  return text.match(/\bif\s+(.+?)\s+fails?\s+to\s+(?:make\s+a\s+by-law\s+adopting|adopt)\b/i)?.[1] ?? '';
};

const strongHeadingQuestion = (
  documentTitle: string,
  source: ImportedLegalComponent,
): GeneratedQuestion | undefined => {
  const topic = classifyStrongHeadingTopic(source.heading);
  if (!topic) return undefined;
  const heading = source.heading ?? '';
  const subject = normalizeHeadingSubject(heading);
  const actor = dutyActorFromHeading(heading);
  if (topic === 'purpose') {
    const plural = /^purposes\b/i.test(heading);
    return {
      template: 'strong-heading-purpose',
      questionTier: 'B',
      question: `What ${plural ? 'are the purposes' : 'is the purpose'} of the ${documentTitle}?`,
    };
  }
  if (topic === 'duties' && actor) {
    const dutyTarget = dutySubject(source);
    return {
      template: 'strong-heading-duties',
      questionTier: 'B',
      question: `What duties does ${withIndefiniteArticle(actor)} have${dutyTarget ? ` regarding ${dutyTarget}` : ''}?`,
    };
  }
  if (topic === 'administration') {
    return {
      template: 'strong-heading-administration',
      questionTier: 'B',
      question: 'Who is responsible for administering the Act, and what authority or limitations apply?',
    };
  }
  if (topic === 'compensation') {
    return {
      template: 'strong-heading-compensation',
      questionTier: 'B',
      question: 'What compensation rules and limits apply?',
    };
  }
  if (topic === 'validity-commencement' && subject) {
    return {
      template: 'strong-heading-validity-commencement',
      questionTier: 'B',
      question: `What conditions determine the validity and coming into force of ${subject}?`,
    };
  }
  if (topic === 'failure-to-adopt' && subject) {
    const actorText = failureActorFromText(source);
    return {
      template: 'strong-heading-failure-to-adopt',
      questionTier: 'B',
      question: `What happens if ${actorText ? withIndefiniteArticle(actorText) : 'a body'} fails to adopt ${subject}?`,
    };
  }
  if (topic === 'preparation-content' && subject) {
    return {
      template: 'strong-heading-preparation-content',
      questionTier: 'B',
      question: `What requirements govern the preparation and content of ${subject}?`,
    };
  }
  if (topic === 'records-copies') {
    return {
      template: 'strong-heading-records-copies',
      questionTier: 'B',
      question: 'What rules govern access to, copies of, and evidentiary use of records?',
    };
  }
  return undefined;
};

const fallbackQuestion = (documentTitle: string, source: ImportedLegalComponent): GeneratedQuestion => {
  const singleLabel = `${sectionWord(source).toLowerCase()} ${source.label}`;
  const subject = headingSubject(source);
  return {
    template: 'fallback-heading',
    questionTier: 'C',
    question: subject
      ? `What does ${singleLabel} of the ${documentTitle} provide regarding ${subject}?`
      : `What does ${singleLabel} of the ${documentTitle} provide?`,
  };
};

const goldenQuestion = (documentTitle: string, source: ImportedLegalComponent): GeneratedQuestion | undefined => {
  const singleLabel = `${sectionWord(source).toLowerCase()} ${source.label}`;
  const identity = sourceIdentity(source);
  if (identity === 'doc-surveys-act::section:2') {
    return {
      template: 'semantic-coordinate-system',
      questionTier: 'A',
      question: 'Who must establish and maintain the coordinate survey system, and what is the system used for?',
    };
  }
  if (identity === 'doc-surveys-act::section:3') {
    return {
      template: 'semantic-director-designation',
      questionTier: 'A',
      question: 'What Director of Surveys designations and coordinate-monument duties are established by section 3 of Surveys Act?',
    };
  }
  if (identity === 'doc-surveys-act::section:4') {
    return {
      template: 'semantic-coordinate-duties',
      questionTier: 'A',
      question: 'How must surveyors express boundary bearings, distances and parcel descriptions under the coordinate survey system?',
    };
  }
  if (identity === 'doc-surveys-act::section:5') {
    return {
      template: 'semantic-integrated-survey-area',
      questionTier: 'A',
      question: 'What authority does the Lieutenant-Governor in Council have to create or change integrated survey areas?',
    };
  }
  if (identity === 'doc-boundaries-confirmation-act::section:8') {
    return {
      template: 'registrar-general-initiation',
      questionTier: 'B',
      question: `How may the Registrar General initiate a boundary-confirmation proceeding under ${singleLabel} of ${documentTitle}?`,
    };
  }
  if (identity === 'doc-boundaries-confirmation-act::section:10') {
    return {
      template: 'objection-hearing-process',
      questionTier: 'B',
      question: `What objection and hearing process is established by ${singleLabel} of ${documentTitle}?`,
    };
  }
  if (identity === 'doc-community-planning-act::section:79') {
    return {
      template: 'subdivision-plan-requirements',
      questionTier: 'B',
      question: `What subdivision-plan requirements are established by ${singleLabel} of ${documentTitle}?`,
    };
  }
  if (identity === 'doc-community-planning-act::section:85') {
    return {
      template: 'subdivision-plan-approval',
      questionTier: 'B',
      question: `What approval rules apply to a subdivision plan under ${singleLabel} of ${documentTitle}?`,
    };
  }
  if (identity === 'doc-surveys-act::section:6') {
    return {
      template: 'semantic-integrated-survey-plan',
      questionTier: 'A',
      question: 'What filing, amendment and legal-effect rules apply to an integrated survey area plan?',
    };
  }
  if (identity === 'doc-boundaries-confirmation-act::section:14') {
    return {
      template: 'semantic-certification-effect',
      questionTier: 'A',
      question: 'When must the Registrar General certify a confirmed boundary, and what conclusive effect does certification have?',
    };
  }
  if (identity === 'doc-community-planning-act::section:16') {
    return {
      template: 'semantic-public-interest-enforcement',
      questionTier: 'A',
      question: 'How may the Minister enforce statements of public interest under section 16 of Community Planning Act?',
    };
  }
  if (identity === 'doc-registry-act::section:16') {
    return {
      template: 'semantic-registry-control',
      questionTier: 'A',
      question: 'What happens to control of the registry office when the registrar dies, resigns or is removed?',
    };
  }
  if (identity === 'doc-surveys-act::section:14' && hasPositiveTopicEvidence([source], 'offences')) {
    return {
      template: 'offences',
      questionTier: 'B',
      question: `What offences and penalties are established by ${singleLabel} of ${documentTitle}?`,
    };
  }
  if (identity === 'doc-boundaries-confirmation-act::section:16') {
    return {
      template: 'correction-procedure',
      questionTier: 'B',
      question: `How may a filed plan of survey be corrected under ${singleLabel} of ${documentTitle}, and what limits and filing consequences apply?`,
    };
  }
  if (identity === 'doc-community-planning-act::section:83') {
    return {
      template: 'subdivision-layout',
      questionTier: 'B',
      question: `What authority and survey-monument requirements does ${singleLabel} of ${documentTitle} establish for laying out streets and lots?`,
    };
  }
  return undefined;
};

export const generateStudyQuestion = ({
  documentTitle,
  selectedSources,
  rubricCategories,
}: {
  documentTitle: string;
  officialCitation?: string;
  selectedSources: SelectedLegalSource[];
  rubricCategories?: StudyRubricCategory[];
}): GeneratedQuestion => {
  const label = selectedLabelText(selectedSources).toLowerCase();
  const heading = combinedHeading(selectedSources).toLowerCase();
  const category = classifyQuestionCategory(selectedSources);
  const multi = selectedSources.length > 1;
  if (multi) {
    return {
      template: category,
      questionTier: category === 'fallback' ? 'C' : 'B',
      question: `What do ${label} of ${documentTitle} establish${heading ? ` about ${heading}` : ''}?`,
    };
  }
  const source = selectedSources[0];
  if (!source) return { template: 'fallback', questionTier: 'C', question: `What should be recalled from ${documentTitle}?` };
  const singleLabel = `${sectionWord(source).toLowerCase()} ${source.label}`;
  const golden = rubricCategories?.length ? goldenQuestion(documentTitle, source) : undefined;
  if (golden) return hasTierASurfaceQualityFailure(golden.question) && golden.questionTier === 'A'
    ? { ...golden, questionTier: 'B', template: `${golden.template}-quality-downgraded` }
    : golden;
  const strongHeading = strongHeadingQuestion(documentTitle, source);
  if (strongHeading) return strongHeading;
  const dutyHeadingSubject = headingSubject(source);
  const dutySuffix = dutyHeadingSubject && !/^dut(?:y|ies)$/.test(dutyHeadingSubject) && heading ? ` about ${heading}` : '';
  const questions: Record<QuestionCategory, string> = {
    definitions: `What definitions are provided in ${singleLabel} of ${documentTitle}?`,
    duties: `What duties does ${singleLabel} of ${documentTitle} impose${dutySuffix}?`,
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
  const generated = { template: category, questionTier: category === 'fallback' ? 'C' as const : 'B' as const, question: questions[category] };
  if (questionHasUnsupportedTopic([source], generated.question)) return fallbackQuestion(documentTitle, source);
  if (strongHeadingTopicMismatch(source.heading, generated.question)) return fallbackQuestion(documentTitle, source);
  if (category === 'fallback' && sourceEvidenceText([source]).length > 0) return fallbackQuestion(documentTitle, source);
  return generated;
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

export const suggestRequiredConcepts = (selectedSources: SelectedLegalSource[], limit = 6): string[] => {
  return generateRequiredConcepts({ selectedSources, limit }).map((suggestion) => suggestion.label);
};
