import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyRubricCategory,
  StudyRubricItem,
  StudySourceReference,
  StudyUnitType,
} from './studyTypes';
import { prepareLegalText } from './studyLegalTextPreparation';
import { hasTierASurfaceQualityFailure } from './studyQuestionSupport';
import type { StudyQuestionTier } from './studyQuestionSupport';

export type GeneratedRubricItem = Pick<
  StudyRubricItem,
  'category' | 'prompt' | 'referenceAnswer' | 'required' | 'origin' | 'order' | 'questionTier' | 'sourceReferences'
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
  tierAQualityDowngrades: string[];
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

const ACTOR_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/^person$/i, 'a person'],
  [/^surveyor$/i, 'a surveyor'],
  [/^applicant$/i, 'the applicant'],
  [/^council$/i, 'the council'],
  [/^Minister$/i, 'the Minister'],
  [/^Registrar General$/i, 'the Registrar General'],
  [/^Director of Surveys$/i, 'the Director of Surveys'],
  [/^development officer$/i, 'the development officer'],
  [/^registrar$/i, 'the registrar'],
  [/^Lieutenant-Governor in Council$/i, 'the Lieutenant-Governor in Council'],
  [/^Chief Registrar of Deeds$/i, 'the Chief Registrar of Deeds'],
];

const normalizeLegalActor = (actor: string): string => {
  const cleaned = normalizeSpaces(actor).replace(/^(?:the|a|an)\s+/i, '');
  return ACTOR_NORMALIZATIONS.find(([pattern]) => pattern.test(cleaned))?.[1] ?? cleaned.replace(/^The\b/, 'the');
};

const bareVerbObject = (action: string): string => {
  const cleaned = normalizeSpaces(action)
    .replace(/\s+thereof\b/gi, '')
    .replace(/\s+in accordance\b.*$/i, '')
    .replace(/\s+subject to\b.*$/i, '')
    .replace(/[.;:,]\s*$/, '');
  return cleaned;
};

const actionVerb = (action: string): string =>
  bareVerbObject(action).match(/^(file|provide|establish|prepare|submit|approve|certify|register|record|appoint|adopt|make|give|serve|order|refuse|reject)\b/i)?.[1].toLowerCase() ?? '';

const safeTriggerClause = (trigger: string | undefined): string => {
  const cleaned = normalizeSpaces(trigger ?? '')
    .replace(/^(?:if|when|on receiving|before|after|whose)\s+/i, '')
    .replace(/[.;:,]\s*$/, '');
  if (!cleaned || cleaned.length > 90) return '';
  if (/\b(?:and|or|to|of|the|not|by|for|with)\s*$/i.test(cleaned)) return '';
  if ((cleaned.match(/\(/g)?.length ?? 0) !== (cleaned.match(/\)/g)?.length ?? 0)) return '';
  return cleaned;
};

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
  if (/\bcertification\b|\bcertif(?:y|ies|ied|icate)\b/.test(heading)) return 'certification';
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
    fact.actor = text.match(/\b(?:the )?(Lieutenant-Governor in Council|Registrar General|Director of Surveys|development officer|surveyor|person|council|Minister)\b/i)?.[0];
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
  questionTier: StudyQuestionTier = 'B',
): GeneratedRubricItem => ({
  category,
  prompt,
  referenceAnswer,
  required: true,
  origin: 'generated',
  order,
  questionTier,
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

const surveysSection2Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:2');
  const prompt = 'Who must establish and maintain the coordinate survey system, and what is it for?';
  diagnostic.mergedItems.push({ prompt, factSourceKeys: ['section:2'], template: 'semantic-duty-purpose' });
  return [
    makeItem(source, 'power-duty', prompt, 'Service New Brunswick shall establish and maintain a system of plane rectangular coordinates for locating points on the earth’s surface.', 0, ['section:2'], 'A'),
  ];
};

const surveysSection3Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:3');
  const prompts = [
    'Who must Service New Brunswick designate as Director of Surveys?',
    'What other surveyor designations may Service New Brunswick make?',
    'Who is eligible to be designated under subsection 3(1.1)?',
    'What coordinate-monument duty does the Director of Surveys have?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:3'], template: 'semantic-director' })));
  return [
    makeItem(source, 'actor', prompts[0], 'Service New Brunswick shall designate a surveyor as Director of Surveys.', 0, ['section:3/subsection:1'], 'A'),
    makeItem(source, 'power-duty', prompts[1], 'Service New Brunswick may designate one or more surveyors to perform specified duties or exercise specified powers of the Director of Surveys.', 1, ['section:3/subsection:1.1'], 'A'),
    makeItem(source, 'scope-trigger', prompts[2], 'Only a surveyor who is an employee of Service New Brunswick or an employee under the Civil Service Act is eligible.', 2, ['section:3/subsection:1.2'], 'A'),
    makeItem(source, 'power-duty', prompts[3], 'For the purposes of the coordinate survey system, the Director of Surveys shall establish and maintain coordinate monuments.', 3, ['section:3/subsection:2'], 'A'),
  ];
};

const surveysSection4Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:4');
  const prompts = [
    'How must a surveyor express boundary bearings and distances under the coordinate survey system?',
    'How must a surveyor describe a parcel of land under the coordinate survey system?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:4'], template: 'semantic-coordinate-duties' })));
  return [
    makeItem(source, 'power-duty', prompts[0], 'A surveyor shall set out bearings of boundary lines in terms of grid azimuth and distances in metres.', 0, ['section:4/subsection:1'], 'A'),
    makeItem(source, 'required-material', prompts[1], 'Subject to any requirement respecting further particulars, a surveyor shall describe a parcel by the legal monuments at the corners with their respective coordinates, or by the corners in terms of coordinates.', 1, ['section:4/subsection:2'], 'A'),
  ];
};

const surveysSection5Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:5');
  const prompt = 'What changes may the Lieutenant-Governor in Council make to an integrated survey area?';
  diagnostic.mergedItems.push({ prompt, factSourceKeys: ['section:5'], template: 'semantic-paragraph-list' });
  return [
    makeItem(source, 'power-duty', prompt, 'The Lieutenant-Governor in Council may constitute and define an integrated survey area, and may extend, reduce, subdivide, annul or merge an existing integrated survey area in whole or in part with any other.', 0, ['section:5'], 'A'),
  ];
};

const surveysSection6Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-surveys-act::section:6');
  const prompts = [
    'What must the Director of Surveys file when an integrated survey area is constituted?',
    'What must the Director of Surveys file when an integrated survey area plan is amended?',
    'What legal effect follows when the amended plan and values are filed?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:6'], template: 'semantic-filing-effect' })));
  return [
    makeItem(source, 'filing-record', prompts[0], 'The Director of Surveys shall file in the registry office a plan of the area setting out the coordinate monuments and authentication, and a schedule setting out the values of the coordinate monuments.', 0, ['section:6/subsection:1'], 'A'),
    makeItem(source, 'filing-record', prompts[1], 'The Director of Surveys shall file in the same registry office an amended plan showing unaffected, destroyed and additional coordinate monuments with authentication, and a certificate showing new or amended coordinate-monument values.', 1, ['section:6/subsection:2'], 'A'),
    makeItem(source, 'legal-effect', prompts[2], 'When filed, the amended plan becomes the official plan of the coordinate monuments and the amended values become the official values for the affected coordinate monuments.', 2, ['section:6/subsection:3'], 'A'),
  ];
};

const certificationSection14Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-boundaries-confirmation-act::section:14');
  const prompts = [
    'When must the Registrar General certify a confirmed boundary?',
    'What plan shows the certified boundary?',
    'What conclusive legal effect does certification have?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:14'], template: 'semantic-certification' })));
  return [
    makeItem(source, 'scope-trigger', prompts[0], 'The Registrar General shall certify after confirming the boundary under section 12 and after appeal periods have expired with no notice of appeal filed, or after an appeal is finally disposed of and the court confirms the order or boundary location.', 0, ['section:14/subsection:1'], 'A'),
    makeItem(source, 'required-material', prompts[1], 'The certified confirmation is shown on a plan of survey as confirmed by the Registrar General or the court, as the case may be.', 1, ['section:14/subsection:1'], 'A'),
    makeItem(source, 'legal-effect', prompts[2], 'Certification is conclusive proof that the application and every notice, proceeding or act that ought to have been made, given or done has been made, given or done in accordance with the Act.', 2, ['section:14/subsection:2'], 'A'),
  ];
};

const communityPlanningSection16Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-community-planning-act::section:16');
  const prompts = [
    'What direction may the Minister give to enforce a statement of public interest?',
    'Who must comply with the Minister’s direction?',
    'What is the 24-month deadline under section 16?',
    'When must the Minister revoke the direction?',
  ];
  diagnostic.mergedItems.push(...prompts.map((prompt) => ({ prompt, factSourceKeys: ['section:16'], template: 'semantic-public-interest-enforcement' })));
  return [
    makeItem(source, 'power-duty', prompts[0], 'After consulting with the council or regional service commission, the Minister may direct it to prepare and make an amendment to a regional land use plan, municipal plan, rural plan or by-law to achieve consistency with a statement of public interest.', 0, ['section:16/subsection:1'], 'A'),
    makeItem(source, 'actor', prompts[1], 'The council or regional service commission, as the case may be, shall comply with the direction.', 1, ['section:16/subsection:2'], 'A'),
    makeItem(source, 'deadline-number', prompts[2], 'Compliance must occur within 24 months after the date the direction was given under subsection (1).', 2, ['section:16/subsection:2'], 'A'),
    makeItem(source, 'legal-effect', prompts[3], 'The Minister shall revoke the direction if the council makes the amendment in a manner that complies with and, in the Minister’s opinion, is consistent with the statement of public interest.', 3, ['section:16/subsection:3'], 'A'),
  ];
};

const registrySection16Rubric = (
  source: ImportedLegalComponent,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem[] => {
  assertSpecializedSource(source, 'doc-registry-act::section:16');
  const prompt = 'What happens to control of the registry office when the registrar dies, resigns or is removed?';
  diagnostic.mergedItems.push({ prompt, factSourceKeys: ['section:16'], template: 'semantic-registry-control' });
  return [
    makeItem(source, 'legal-effect', prompt, 'The deputy registrar shall continue in control of the office and of the books and records in it.', 0, ['section:16'], 'A'),
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
    const fact = facts.find((entry) => entry.sourceKey === unit.sourceKey) ?? facts[order];
    const prompt = naturalPromptForFact(fact, categoryForTopic, subject, unit.label);
    diagnostic.mergedItems.push({ prompt, factSourceKeys: [unit.sourceKey], template: `generic-${categoryForTopic}` });
    return makeItem(source, categoryForTopic, prompt, `${unit.label}: ${stripSourceNoise(unit.text, diagnostic)}`, order, [unit.sourceKey], fact?.confidence === 'high' ? 'A' : 'C');
  });
};

const naturalPromptForFact = (
  fact: ExtractedLegalFact | undefined,
  category: StudyRubricCategory,
  subject: string,
  label: string,
): string => {
  const actor = fact?.actor ? normalizeLegalActor(fact.actor) : '';
  const action = bareVerbObject(fact?.action ?? '');
  const verb = actionVerb(action);
  const trigger = safeTriggerClause(fact?.trigger);
  if (trigger && fact?.modality && actor) return `What must ${actor} do when ${trigger}?`;
  if (fact?.modality === 'shall-not') return actor ? `What is ${actor} prohibited from doing?` : `What prohibition applies under ${label}?`;
  if (fact?.modality === 'may' && actor) {
    if (verb && action) return `What authority does ${actor} have to ${action}?`;
    return `What may ${actor} do?`;
  }
  if ((fact?.modality === 'shall' || fact?.modality === 'must') && actor) {
    if (verb && ['file', 'provide', 'establish', 'prepare', 'submit', 'approve', 'certify', 'register', 'record'].includes(verb)) {
      return `What must ${actor} ${verb}?`;
    }
    if (action) return `What must ${actor} do?`;
  }
  if (fact?.legalEffect) return `What legal effect does ${subject} have?`;
  if (fact?.filingEffect) return `What filing or record rule applies to ${subject}?`;
  if (fact?.noticeRule) return `What notice rule applies to ${subject}?`;
  if (category === 'filing-record') return `What filing or record rule applies to ${subject}?`;
  if (category === 'notice') return `What notice rule applies to ${subject}?`;
  return `What does ${label} provide regarding ${subject}?`;
};

const applyTierAQualityGate = (
  item: GeneratedRubricItem,
  diagnostic: StudyRubricGenerationDiagnostic,
): GeneratedRubricItem => {
  if (item.questionTier !== 'A' || !hasTierASurfaceQualityFailure(item.prompt)) return item;
  diagnostic.tierAQualityDowngrades.push(item.prompt);
  return { ...item, questionTier: 'B' };
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
    tierAQualityDowngrades: [],
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
    sourceIdentity(source) === 'doc-surveys-act::section:2'
      ? surveysSection2Rubric(source, diagnostic)
      : sourceIdentity(source) === 'doc-surveys-act::section:3'
        ? surveysSection3Rubric(source, diagnostic)
        : sourceIdentity(source) === 'doc-surveys-act::section:4'
          ? surveysSection4Rubric(source, diagnostic)
          : sourceIdentity(source) === 'doc-surveys-act::section:5'
            ? surveysSection5Rubric(source, diagnostic)
            : sourceIdentity(source) === 'doc-surveys-act::section:6'
              ? surveysSection6Rubric(source, diagnostic)
              : sourceIdentity(source) === 'doc-boundaries-confirmation-act::section:14'
                ? certificationSection14Rubric(source, diagnostic)
                : sourceIdentity(source) === 'doc-community-planning-act::section:16'
                  ? communityPlanningSection16Rubric(source, diagnostic)
                  : sourceIdentity(source) === 'doc-registry-act::section:16'
                    ? registrySection16Rubric(source, diagnostic)
                    : sourceIdentity(source) === 'doc-surveys-act::section:14'
      ? section14Rubric(source, diagnostic)
      : sourceIdentity(source) === 'doc-boundaries-confirmation-act::section:16'
        ? section16Rubric(source, diagnostic)
        : sourceIdentity(source) === 'doc-community-planning-act::section:83'
          ? section83Rubric(source, diagnostic)
          : selectedSources.flatMap((entry) => {
              const definitionItems = topic === 'definitions' ? definitionRubric(entry, diagnostic) : [];
              return definitionItems.length ? definitionItems : genericRubric(entry, topic, diagnostic.extractedFacts, diagnostic);
            });
  const deduped = dedupeItems(items, diagnostic).map((item) => applyTierAQualityGate(item, diagnostic));
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
