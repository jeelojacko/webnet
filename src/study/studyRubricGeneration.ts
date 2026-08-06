import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyRubricCategory,
  StudyRubricItem,
  StudySourceReference,
  StudyUnitType,
} from './studyTypes';

export type GeneratedRubricItem = Pick<
  StudyRubricItem,
  'category' | 'prompt' | 'referenceAnswer' | 'required' | 'origin' | 'order' | 'sourceReferences'
>;

export type StudyRubricTemplateItem = {
  category: StudyRubricCategory;
  prompt: string;
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

const cleanText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^\d+(?:\([^)]+\))?/, '')
    .trim();

const sourceUnits = (source: ImportedLegalComponent): Array<{ label: string; text: string }> => {
  if (source.subsections?.length) {
    return source.subsections.map((subsection) => ({
      label: subsection.label,
      text: cleanText(subsection.text),
    }));
  }
  return [{ label: source.label, text: cleanText(source.text) }];
};

const categoryForText = (text: string): StudyRubricCategory => {
  const lower = text.toLowerCase();
  if (/\bsubject to\b|\bshall not\b|\bexcept\b|\bunless\b|\bwithout\b/.test(lower)) return 'limit-exception';
  if (/\bnotice\b|\bserve\b|\bgive\b/.test(lower)) return 'notice';
  if (/\bwithin \d+\b|\b\d+\s+(days?|months?|years?)\b|\bdeadline\b/.test(lower)) return 'deadline-number';
  if (/\bfiled?\b|\bregistered?\b|\bnotation\b|\brecord\b|\bsuperseded\b/.test(lower)) return 'filing-record';
  if (/\bfinal\b|\bbinding\b|\bconclusive\b|\beffect\b|\bsuperseded\b|\bapplies\b/.test(lower)) return 'legal-effect';
  if (/\bplan of survey\b|\bevidence\b|\binformation\b|\bmaterial\b|\bform\b/.test(lower)) return 'required-material';
  if (/\bmay\b|\bshall\b|\bmust\b|\border\b|\brequire\b|\bprohibit\b/.test(lower)) return 'power-duty';
  if (/\bif\b|\bwhen\b|\bon receiving\b|\bbefore\b|\bafter\b/.test(lower)) return 'scope-trigger';
  return 'procedure';
};

const promptFor = (category: StudyRubricCategory, source: ImportedLegalComponent): string => {
  const label = source.label.toLowerCase().startsWith('section') ? source.label : `section ${source.label}`;
  if (category === 'purpose') return `What is the purpose of ${label}?`;
  if (category === 'scope-trigger') return `When does ${label} apply?`;
  if (category === 'actor') return `Who acts under ${label}?`;
  if (category === 'power-duty') return `What power or duty does ${label} create?`;
  if (category === 'notice') return `What notice rule applies under ${label}?`;
  if (category === 'limit-exception') return `What limit or exception applies under ${label}?`;
  if (category === 'filing-record') return `What filing or record step is required under ${label}?`;
  if (category === 'legal-effect') return `What legal effect follows under ${label}?`;
  if (category === 'required-material') return `What material or evidence matters under ${label}?`;
  if (category === 'related-provision') return `What related provision applies under ${label}?`;
  return `What procedure does ${label} establish?`;
};

const section16Rubric = (source: ImportedLegalComponent): GeneratedRubricItem[] => {
  const ref = sourceReferenceFor(source);
  return [
    ['purpose', 'What is the purpose of section 16?', 'To correct an inconsistency, error or omission in a previously filed plan of survey.'],
    ['actor', 'Who may order the correction, and on what basis?', 'The Registrar General may order it on receiving satisfactory evidence.'],
    ['notice', 'Must interested parties receive notice?', 'Notice is discretionary; the Registrar General may give notice or make the order without giving notice.'],
    ['limit-exception', 'What can a correction not change?', 'A correction shall not affect the location of a boundary that has been confirmed and certified under the Act.'],
    ['filing-record', 'How must the corrected plan be handled?', 'The Registrar General shall cause the corrected plan of survey to be filed in accordance with the regulations and with the Registry Act or the Land Titles Act, as the case may be.'],
    ['legal-effect', 'What happens to the original filed plan?', 'The original plan receives a notation to the effect that it is superseded by the corrected plan.'],
    ['related-provision', 'What related subsection applies?', 'Subsection 15(2) applies with the necessary modifications.'],
    ['survey-relevance', 'Why does this section matter to a surveyor?', 'Study note: a corrected survey plan may be prepared, but the correction process cannot alter an already confirmed boundary.'],
  ].map(([category, prompt, referenceAnswer], order) => ({
    category: category as StudyRubricCategory,
    prompt,
    referenceAnswer,
    required: true,
    origin: 'generated' as const,
    order,
    sourceReferences: [ref],
  }));
};

export const generateStudyRubric = ({
  selectedSources = [],
  unitType,
}: {
  document?: ImportedLegalDocument;
  selectedSources?: ImportedLegalComponent[];
  unitType: StudyUnitType;
}): GeneratedRubricItem[] => {
  if (selectedSources.length === 1 && selectedSources[0].sourceKey === 'section:16') {
    return section16Rubric(selectedSources[0]);
  }
  if (unitType !== 'section') {
    return getStudyRubricTemplate(unitType).map((item, order) => ({
      ...item,
      referenceAnswer: '',
      required: true,
      origin: 'generated',
      order,
    }));
  }
  const items = selectedSources.flatMap((source) =>
    sourceUnits(source).map((unit) => {
      const category = categoryForText(unit.text);
      return {
        category,
        prompt: promptFor(category, source),
        referenceAnswer: `${unit.label}: ${unit.text}`,
        required: true,
        origin: 'generated' as const,
        sourceReferences: [sourceReferenceFor(source)],
      };
    }),
  );
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.category}:${item.referenceAnswer.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map((item, order) => ({ ...item, order }));
};
