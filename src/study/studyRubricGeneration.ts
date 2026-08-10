import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyRubricCategory,
  StudyRubricItem,
  StudySourceReference,
  StudyUnitType,
} from './studyTypes';
import { prepareLegalText } from './studyLegalTextPreparation';

export type GeneratedRubricItem = Pick<
  StudyRubricItem,
  'category' | 'prompt' | 'referenceAnswer' | 'required' | 'origin' | 'order' | 'sourceReferences'
>;

export type StudyRubricTemplateItem = {
  category: StudyRubricCategory;
  prompt: string;
};

export type ExtractedLegalFact = {
  sourceKey: string;
  actor?: string;
  trigger?: string;
  modality?: 'may' | 'shall' | 'must' | 'shall-not' | 'commits-offence' | 'is-final' | 'is-conclusive';
  action?: string;
  object?: string;
  condition?: string;
  exceptionOrLimit?: string;
  noticeRule?: string;
  deadlineOrNumber?: string;
  filingEffect?: string;
  legalEffect?: string;
  offenceConduct?: string;
  penaltyCategory?: string;
  relatedProvision?: string;
  confidence: 'high' | 'medium' | 'low';
};

export type StudyRubricGenerationDiagnostic = {
  sectionTopic: string;
  extractedFacts: ExtractedLegalFact[];
  mergedItems: Array<{ prompt: string; factSourceKeys: string[]; template: string }>;
  rejectedDuplicatePrompts: string[];
  removedSourceText: string[];
  qualityWarnings: string[];
};

export const STUDY_RUBRIC_CATEGORY_LABELS: Record<StudyRubricCategory, string> = {
  purpose: 'Purpose',
  'scope-trigger': 'Scope or trigger',
  actor: 'Actor',
  'power-duty': 'Power or duty',
  'required-material': 'Required material',
  procedure: 'Procedure',
  notice: 'Notice',
  'deadline-number': 'Deadline or number',
  'limit-exception': 'Limit or exception',
  'legal-effect': 'Legal effect',
  'filing-record': 'Filing or record',
  'survey-relevance': 'Survey relevance',
  'related-provision': 'Related provision',
  custom: 'Custom',
};

const SECTION_TEMPLATE: StudyRubricTemplateItem[] = [
  { category: 'purpose', prompt: 'What is the purpose of this provision?' },
  { category: 'scope-trigger', prompt: 'When does this provision apply?' },
  { category: 'actor', prompt: 'Who is responsible or empowered under this provision?' },
  { category: 'power-duty', prompt: 'What power, duty or prohibition does this provision create?' },
  { category: 'required-material', prompt: 'What material, evidence or information is required?' },
  { category: 'procedure', prompt: 'What procedure must be followed?' },
  { category: 'notice', prompt: 'What notice is required or permitted?' },
  { category: 'deadline-number', prompt: 'What deadline or numerical rule matters?' },
  { category: 'limit-exception', prompt: 'What limits or exceptions apply?' },
  { category: 'legal-effect', prompt: 'What legal effect follows?' },
  { category: 'filing-record', prompt: 'What filing or record consequence follows?' },
  { category: 'survey-relevance', prompt: 'Why does this matter to survey work?' },
  { category: 'related-provision', prompt: 'What related provisions are referenced?' },
];

const WHOLE_ACT_TEMPLATE: StudyRubricTemplateItem[] = [
  { category: 'purpose', prompt: 'What is the Act mainly for?' },
  { category: 'scope-trigger', prompt: 'When does the Act apply?' },
  { category: 'actor', prompt: 'Who are the main actors and authorities?' },
  { category: 'power-duty', prompt: 'What are the main duties and powers?' },
  { category: 'procedure', prompt: 'What main procedure does the Act establish?' },
  { category: 'deadline-number', prompt: 'What important deadlines or numerical rules appear?' },
  { category: 'limit-exception', prompt: 'What important exceptions or limits apply?' },
  { category: 'legal-effect', prompt: 'What enforcement or legal effects matter?' },
  { category: 'survey-relevance', prompt: 'Why is the Act relevant to land surveying?' },
  { category: 'related-provision', prompt: 'What related regulations or legislation matter?' },
];

const CASE_TEMPLATE: StudyRubricTemplateItem[] = [
  { category: 'scope-trigger', prompt: 'What are the material facts?' },
  { category: 'custom', prompt: 'What boundary issue was before the court?' },
  { category: 'required-material', prompt: 'What competing evidence was considered?' },
  { category: 'legal-effect', prompt: 'What did the decision decide?' },
  { category: 'procedure', prompt: 'What legal rule or reasoning controlled the result?' },
  { category: 'survey-relevance', prompt: 'What practical surveying lesson follows?' },
  { category: 'related-provision', prompt: 'What related doctrine or case matters?' },
];

const CUSTOM_PRINCIPLE_TEMPLATE: StudyRubricTemplateItem[] = [
  { category: 'purpose', prompt: 'What is the principle for?' },
  { category: 'scope-trigger', prompt: 'What elements must be present?' },
  { category: 'required-material', prompt: 'What evidence is required?' },
  { category: 'limit-exception', prompt: 'What exceptions apply?' },
  { category: 'procedure', prompt: 'How is the principle applied?' },
  { category: 'custom', prompt: 'What example illustrates the principle?' },
  { category: 'related-provision', prompt: 'What related principles matter?' },
];

export const getStudyRubricTemplate = (unitType: StudyUnitType): StudyRubricTemplateItem[] => {
  if (unitType === 'whole-act') return WHOLE_ACT_TEMPLATE;
  if (unitType === 'survey-law-case') return CASE_TEMPLATE;
  if (unitType === 'custom-principle') return CUSTOM_PRINCIPLE_TEMPLATE;
  return SECTION_TEMPLATE;
};

const sourceReferenceFor = (source: ImportedLegalComponent): StudySourceReference => ({
  documentId: source.documentId,
  sourceKey: source.sourceKey,
  contentHashAtLinkTime: source.contentHash,
});

const normalizeSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

const stripLeadingLabel = (text: string, label: string): string => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalizeSpaces(text.replace(new RegExp(`^\\s*${escaped}\\s*`, 'i'), ''));
};

const stripSourceNoise = (text: string, diagnostic: StudyRubricGenerationDiagnostic): string => {
  const prepared = prepareLegalText(text);
  if (prepared.amendmentHistoryText) diagnostic.removedSourceText.push(normalizeSpaces(prepared.amendmentHistoryText));
  if (prepared.consolidationText) diagnostic.removedSourceText.push(normalizeSpaces(prepared.consolidationText));
  return normalizeSpaces(prepared.operativeText);
};

export const classifyStudyRubricSectionTopic = (source: ImportedLegalComponent): string => {
  const heading = normalizeSpaces(source.heading ?? '').toLowerCase();
  if (/\boffences? and penalt/.test(heading)) return 'offences-and-penalties';
  if (/\bcorrection\b/.test(heading)) return 'correction-procedure';
  if (/\bappeal\b/.test(heading)) return 'appeal';
  if (/\bdefinitions?|interpretation\b/.test(heading)) return 'definitions';
  if (/\blay-?out of streets and lots\b/.test(heading)) return 'subdivision-layout';
  if (/\bfiling of .*plan/.test(heading)) return 'filing';
  if (/\bauthority re private property\b/.test(heading)) return 'entry-authority';
  const body = source.text.toLowerCase().slice(0, 500);
  if (/\bcommits an offence\b|\bpunishable\b/.test(body)) return 'offences-and-penalties';
  if (/\bfiled?\b|\bregistered?\b/.test(body)) return 'filing';
  if (/\bnotice\b/.test(body)) return 'notice';
  if (/\bmay\b|\bshall\b|\bmust\b/.test(body)) return 'power-duty';
  return 'procedure';
};

const sourceUnits = (source: ImportedLegalComponent): Array<{ sourceKey: string; label: string; text: string }> => {
  if (source.subsections?.length) {
    return source.subsections.map((subsection) => ({
      sourceKey: subsection.sourceKey,
      label: subsection.label,
      text: stripLeadingLabel(prepareLegalText(subsection.text).operativeText, subsection.label),
    }));
  }
  return [{ sourceKey: source.sourceKey, label: source.label, text: stripLeadingLabel(prepareLegalText(source.text).operativeText, source.label) }];
};

const extractFacts = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): ExtractedLegalFact[] =>
  sourceUnits(source).map((unit) => {
    const text = stripSourceNoise(unit.text, diagnostic);
    const fact: ExtractedLegalFact = { sourceKey: unit.sourceKey, confidence: 'low' };
    fact.modality = /\bshall not\b/i.test(text)
      ? 'shall-not'
      : /\bcommits an offence\b/i.test(text)
        ? 'commits-offence'
        : /\bshall\b/i.test(text)
          ? 'shall'
          : /\bmust\b/i.test(text)
            ? 'must'
            : /\bmay\b/i.test(text)
              ? 'may'
              : undefined;
    fact.actor = text.match(/\b(?:the )?(Registrar General|Director of Surveys|development officer|surveyor|person|council|Minister)\b/i)?.[0];
    fact.trigger = text.match(/\b(?:if|when|on receiving|before|after|whose)[^,.;]{3,120}/i)?.[0];
    fact.noticeRule = text.match(/\b[^.]*notice[^.]*\./i)?.[0];
    fact.deadlineOrNumber = text.match(/\b(?:within|not later than)?\s*\d+\s+(?:days?|months?|years?)\b/i)?.[0];
    fact.penaltyCategory = text.match(/\bcategory\s+[A-Z]\b/i)?.[0];
    fact.relatedProvision = text.match(/\b(?:section|subsection|paragraph)\s+\d+(?:\([^)]+\))?/i)?.[0];
    fact.filingEffect = text.match(/\b[^.]*\b(?:filed|file|registered|notation|superseded)[^.]*\./i)?.[0];
    fact.legalEffect = text.match(/\b[^.]*\b(?:final and binding|conclusive proof|shall not affect|superseded)[^.]*\./i)?.[0];
    fact.offenceConduct = text.match(/\b(?:violates|fails to comply|obstructs)[^.]*?(?=\s+commits an offence|\.)/i)?.[0];
    fact.action = text.match(/\b(?:may|shall|must|shall not)\s+([^.;]+)/i)?.[1];
    fact.object = text.match(/\b(?:plan of survey|subdivision plan|legal survey monuments|streets, lots, blocks[^.]+|coordinate monuments|survey or tying to a coordinate monument)\b/i)?.[0];
    fact.condition = text.match(/\bsubject to [^,.;]+/i)?.[0];
    const signalCount = [
      fact.actor,
      fact.modality,
      fact.action,
      fact.object,
      fact.trigger,
      fact.noticeRule,
      fact.filingEffect,
      fact.legalEffect,
      fact.offenceConduct,
      fact.penaltyCategory,
    ].filter(Boolean).length;
    fact.confidence = signalCount >= 3 ? 'high' : signalCount >= 1 ? 'medium' : 'low';
    return fact;
  });

const makeItem = (
  source: ImportedLegalComponent,
  category: StudyRubricCategory,
  prompt: string,
  referenceAnswer: string,
  order: number,
  sourceKeys: string[],
): GeneratedRubricItem => ({
  category,
  prompt,
  referenceAnswer,
  required: true,
  origin: 'generated',
  order,
  sourceReferences: sourceKeys.length
    ? sourceKeys.map((sourceKey) => ({ ...sourceReferenceFor(source), sourceKey }))
    : [sourceReferenceFor(source)],
});

const sourceIdentity = (source: Pick<ImportedLegalComponent, 'documentId' | 'sourceKey'>): string =>
  `${source.documentId}::${source.sourceKey}`;

const assertSpecializedSource = (source: ImportedLegalComponent, expectedIdentity: string): void => {
  if (sourceIdentity(source) !== expectedIdentity) {
    throw new Error(`Study rubric specialized override scope violation: expected ${expectedIdentity}, got ${sourceIdentity(source)}`);
  }
};

const section14Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:14');
  diagnostic.mergedItems.push(
    { prompt: 'What offence and penalty apply to violating the regulations?', factSourceKeys: ['section:14/subsection:1'], template: 'offence-penalty' },
    { prompt: 'What offence and penalty apply to obstructing coordinate-monument work?', factSourceKeys: ['section:14/subsection:2'], template: 'offence-penalty' },
    { prompt: 'What offence and penalty apply to obstructing a survey or coordinate tie?', factSourceKeys: ['section:14/subsection:3'], template: 'offence-penalty' },
  );
  return [
    makeItem(source, 'legal-effect', 'What offence and penalty apply to violating the regulations?', 'A person who violates or fails to comply with any provision of the regulations commits an offence punishable as a category B offence.', 0, ['section:14/subsection:1']),
    makeItem(source, 'legal-effect', 'What offence and penalty apply to obstructing coordinate-monument work?', 'A person who obstructs the Director of Surveys or an appointed surveyor in establishing or maintaining coordinate monuments commits an offence punishable as a category E offence.', 1, ['section:14/subsection:2']),
    makeItem(source, 'legal-effect', 'What offence and penalty apply to obstructing a survey or coordinate tie?', 'A person who obstructs authorized survey work or tying to a coordinate monument under the Act commits an offence punishable as a category E offence.', 2, ['section:14/subsection:3']),
  ];
};

const section16Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-boundaries-confirmation-act::section:16');
  const prompts = [
    'What is the correction purpose of section 16?',
    'Who may order a corrected plan of survey, and on what evidence?',
    'What notice choice does the Registrar General have before ordering correction?',
    'What boundary-confirmation limit applies to a correction?',
    'How must the corrected plan of survey be filed?',
    'What happens to the original filed plan when the corrected plan is filed?',
    'What related subsection applies to the corrected plan?',
    'Why does section 16 matter to survey work?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:16'], template: 'correction' })));
  return [
    makeItem(source, 'purpose', prompts[0], 'To correct an inconsistency, error or omission in a previously filed plan of survey.', 0, ['section:16/subsection:1']),
    makeItem(source, 'actor', prompts[1], 'The Registrar General may order the correction on receiving satisfactory evidence.', 1, ['section:16/subsection:1']),
    makeItem(source, 'notice', prompts[2], 'The Registrar General may give notice considered appropriate or may make the order without giving notice.', 2, ['section:16/subsection:2']),
    makeItem(source, 'limit-exception', prompts[3], 'A correction shall not affect the location of a boundary that has been confirmed and certified under the Act.', 3, ['section:16/subsection:3']),
    makeItem(source, 'filing-record', prompts[4], 'The Registrar General shall cause the corrected plan to be filed in accordance with the regulations and with the Registry Act or the Land Titles Act, as the case may be.', 4, ['section:16/subsection:4']),
    makeItem(source, 'legal-effect', prompts[5], 'The original plan receives a notation that it is superseded by the corrected plan.', 5, ['section:16/subsection:6']),
    makeItem(source, 'related-provision', prompts[6], 'Subsection 15(2) applies with the necessary modifications to the corrected plan.', 6, ['section:16/subsection:5']),
    makeItem(source, 'survey-relevance', prompts[7], 'Study note: surveyors may prepare or rely on corrected plans, but the correction process cannot relocate an already confirmed boundary.', 7, ['section:16']),
  ];
};

const section83Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-community-planning-act::section:83');
  const prompts = [
    'When may a person proceed with laying out the subdivision?',
    'What may be laid out, and according to what instructions?',
    'What subdivision plan must be prepared?',
    'What legal survey monument requirement applies when acting under section 83?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:83'], template: 'subdivision-layout' })));
  return [
    makeItem(source, 'scope-trigger', prompts[0], 'A person may proceed when the tentative plan is approved by a development officer, or when the person is exempted under paragraph 77(1)(b) from submitting a tentative plan.', 0, ['section:83/subsection:1']),
    makeItem(source, 'power-duty', prompts[1], 'The person may lay out streets, lots, blocks, land for public purposes and other parcels of land in one or more stages, in accordance with the tentative plan or the development officer’s instructions.', 1, ['section:83/subsection:1']),
    makeItem(source, 'required-material', prompts[2], 'The person must prepare a subdivision plan in accordance with section 84.', 2, ['section:83/subsection:1']),
    makeItem(source, 'survey-relevance', prompts[3], 'A person acting under section 83 shall use legal survey monuments of a design and standard in accordance with the by-laws under the New Brunswick Land Surveyors Act, 1986.', 3, ['section:83/subsection:2']),
  ];
};

const wordLimitedSubject = (value: string, fallback: string): string => {
  const normalized = normalizeSpaces(value).replace(/[,:;]\s*$/, '');
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  let limited = words.slice(0, 16).join(' ').replace(/[,:;]\s*$/, '');
  if (/\bService New$/i.test(limited) && /\bService New Brunswick\b/i.test(normalized)) limited = `${limited} Brunswick`;
  if (/\(|\)/.test(limited)) return fallback;
  if (/\b(?:if|to|the|by|of|for|from|with|and|or|not|shall|may|must|it|this|that)$/i.test(limited)) return fallback;
  return limited;
};

const definitionRubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  const matches = [...prepareLegalText(source.text).operativeText.matchAll(/[“"]([^”"]{2,80})[”"]\s+means\s+([^.;]+(?:\.[^“"]*)?)/gi)];
  const definitionSourceKey = sourceUnits(source)[0]?.sourceKey ?? source.sourceKey;
  const items = matches.slice(0, 8).map((match, order) => {
    const term = normalizeSpaces(match[1]);
    const answer = normalizeSpaces(match[2]).replace(/\s+$/, '');
    const prompt = `What is a "${term}"?`;
    diagnostic.mergedItems.push({ prompt, factSourceKeys: [definitionSourceKey], template: 'definition' });
    return makeItem(source, 'purpose', prompt, answer.endsWith('.') ? answer : `${answer}.`, order, [definitionSourceKey]);
  });
  if (matches.length > 8) diagnostic.qualityWarnings.push('Definition section should be chunked into smaller study units.');
  return items.length ? items : [];
};

const genericRubric = (
  source: ImportedLegalComponent,
  topic: string,
  facts: ExtractedLegalFact[],
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  const categoryForTopic: StudyRubricCategory =
    topic === 'offences-and-penalties' ? 'legal-effect' : topic === 'filing' ? 'filing-record' : topic === 'notice' ? 'notice' : 'power-duty';
  return sourceUnits(source).map((unit, order) => {
    const subject = wordLimitedSubject(
      facts[order]?.object ?? facts[order]?.action ?? normalizeSpaces(source.heading ?? `section ${source.label}`),
      source.heading ? normalizeSpaces(source.heading) : `section ${source.label}`,
    );
    const prompt = categoryForTopic === 'filing-record'
      ? `What filing or record rule applies to ${subject}?`
      : categoryForTopic === 'notice'
        ? `What notice rule applies to ${subject}?`
        : `What specific rule applies to ${subject}?`;
    diagnostic.mergedItems.push({ prompt, factSourceKeys: [unit.sourceKey], template: `generic-${categoryForTopic}` });
    return makeItem(source, categoryForTopic, prompt, `${unit.label}: ${stripSourceNoise(unit.text, diagnostic)}`, order, [unit.sourceKey]);
  });
};

const dedupeItems = (
  items: GeneratedRubricItem[],
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.prompt.toLowerCase().replace(/\bsection\s+\d+(?:\([^)]+\))?\b/g, 'section #').replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) {
      diagnostic.rejectedDuplicatePrompts.push(item.prompt);
      return false;
    }
    seen.add(key);
    return true;
  }).map((item, order) => ({ ...item, order }));
};

export const generateStudyRubricWithDiagnostics = ({
  selectedSources = [],
  unitType,
}: {
  document?: ImportedLegalDocument;
  selectedSources?: ImportedLegalComponent[];
  unitType: StudyUnitType;
}): { items: GeneratedRubricItem[]; diagnostic: StudyRubricGenerationDiagnostic } => {
  const source = selectedSources[0];
  const topic = source ? classifyStudyRubricSectionTopic(source) : unitType;
  const diagnostic: StudyRubricGenerationDiagnostic = {
    sectionTopic: topic,
    extractedFacts: [],
    mergedItems: [],
    rejectedDuplicatePrompts: [],
    removedSourceText: [],
    qualityWarnings: [],
  };
  if (unitType !== 'section' || !source) {
    return {
      items: getStudyRubricTemplate(unitType).map((item, order) => ({
        ...item,
        referenceAnswer: '',
        required: true,
        origin: 'generated',
        order,
      })),
      diagnostic,
    };
  }
  diagnostic.extractedFacts = selectedSources.flatMap((entry) => extractFacts(entry, diagnostic));
  const items =
    sourceIdentity(source) === 'doc-surveys-act::section:14'
      ? section14Rubric(source, diagnostic)
      : sourceIdentity(source) === 'doc-boundaries-confirmation-act::section:16'
        ? section16Rubric(source, diagnostic)
        : sourceIdentity(source) === 'doc-community-planning-act::section:83'
          ? section83Rubric(source, diagnostic)
          : selectedSources.flatMap((entry) => {
              const definitionItems = topic === 'definitions' ? definitionRubric(entry, diagnostic) : [];
              return definitionItems.length ? definitionItems : genericRubric(entry, topic, diagnostic.extractedFacts, diagnostic);
            });
  const deduped = dedupeItems(items, diagnostic);
  if (deduped.length > 8) diagnostic.qualityWarnings.push('Generated more than 8 rubric items for a single section.');
  if (deduped.length > 1 && new Set(deduped.map((item) => item.prompt.split(' ').slice(0, 3).join(' '))).size === 1) {
    diagnostic.qualityWarnings.push('Generated prompts share the same opening stem.');
  }
  return { items: deduped, diagnostic };
};

export const generateStudyRubric = (options: {
  document?: ImportedLegalDocument;
  selectedSources?: ImportedLegalComponent[];
  unitType: StudyUnitType;
}): GeneratedRubricItem[] => generateStudyRubricWithDiagnostics(options).items;
