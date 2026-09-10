import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyConcept,
  StudyDataSnapshot,
  StudyPrompt,
  StudyRubricItem,
  StudyUnit,
} from '../studyTypes';
import type { StudySearchRecord } from './studySearchTypes';

const stableNumberHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const corpusContentHashFor = (documents: ImportedLegalDocument[]): string =>
  documents
    .map((document) => `${document.id}:${document.contentHash}`)
    .sort()
    .join('|');

export const studyContentRevisionFor = (data: StudyDataSnapshot): number =>
  stableNumberHash(
    [
      ...data.units.map(
        (unit) =>
          `u:${unit.id}:${unit.updatedAt}:${unit.title}:${unit.referenceAnswer}:${unit.editableSummary}:${(unit.tags ?? []).join(',')}`,
      ),
      ...data.prompts.map(
        (prompt) => `p:${prompt.id}:${prompt.updatedAt}:${prompt.question}:${prompt.referenceAnswer}`,
      ),
      ...data.rubrics.map(
        (rubric) => `r:${rubric.id}:${rubric.updatedAt}:${rubric.prompt}:${rubric.referenceAnswer}`,
      ),
      ...data.concepts.map(
        (concept) => `c:${concept.id}:${concept.updatedAt}:${concept.label}:${concept.explanation ?? ''}`,
      ),
    ]
      .sort()
      .join('|'),
  );

export const buildDocumentSearchRecords = (
  documents: ImportedLegalDocument[],
): StudySearchRecord[] =>
  documents.map((document) => ({
    id: `document:${document.id}`,
    entityType: 'document',
    entityId: document.id,
    documentId: document.id,
    title: document.officialTitle,
    citation: document.officialCitationDisplay,
    metadataText: [
      document.officialTitle,
      document.officialCitationDisplay,
      document.officialCitationNormalized,
      document.officialNumberDisplay,
      document.consolidatedTo,
    ]
      .filter(Boolean)
      .join(' '),
    excerpt: document.consolidatedTo,
    snippetText: [
      document.officialTitle,
      document.officialCitationDisplay,
      document.officialCitationNormalized,
      document.officialNumberDisplay,
      document.consolidatedTo,
    ]
      .filter(Boolean)
      .join(' '),
  }));

export const buildOfficialProvisionSearchRecord = ({
  document,
  component,
}: {
  document?: ImportedLegalDocument;
  component: ImportedLegalComponent;
}): StudySearchRecord => ({
  id: `provision:${component.documentId}:${component.sourceKey}`,
  entityType: 'official-provision',
  entityId: `${component.documentId}::${component.sourceKey}`,
  documentId: component.documentId,
  sourceKey: component.sourceKey,
  title: `${component.label}${component.heading ? ` ${component.heading}` : ''}`.trim(),
  citation: document?.officialCitationDisplay,
  heading: component.heading,
  metadataText: [
    document?.officialTitle,
    document?.officialCitationDisplay,
    component.label,
    component.sourceKey,
    component.heading,
    ...(component.subsections ?? []).map((subsection) => subsection.label),
  ]
    .filter(Boolean)
    .join(' '),
  fullText: [
    component.text,
    ...(component.subsections ?? []).flatMap((subsection) => [subsection.label, subsection.text]),
  ].join('\n'),
  excerpt: component.text.slice(0, 260),
  snippetText: [
    document?.officialTitle,
    document?.officialCitationDisplay,
    component.label,
    component.heading,
    component.text,
    ...(component.subsections ?? []).flatMap((subsection) => [subsection.label, subsection.text]),
  ]
    .filter(Boolean)
    .join('\n'),
});

const promptsFor = (prompts: StudyPrompt[], unitId: string): StudyPrompt[] =>
  prompts.filter((prompt) => prompt.unitId === unitId);

const rubricsFor = (rubrics: StudyRubricItem[], unitId: string): StudyRubricItem[] =>
  rubrics.filter((rubric) => rubric.unitId === unitId);

const conceptsFor = (concepts: StudyConcept[], unitId: string): StudyConcept[] =>
  concepts.filter((concept) => concept.unitId === unitId);

export const buildStudyUnitSearchRecord = (
  data: StudyDataSnapshot,
  unit: StudyUnit,
): StudySearchRecord => {
  const prompts = promptsFor(data.prompts, unit.id);
  const rubrics = rubricsFor(data.rubrics, unit.id);
  const concepts = conceptsFor(data.concepts, unit.id);
  const legalDocument = data.legalDocuments.find((document) => document.id === unit.documentIds[0]);
  return {
    id: `unit:${unit.id}`,
    entityType: unit.sourceMode === 'custom' ? 'custom-unit' : 'study-unit',
    entityId: unit.id,
    unitId: unit.id,
    documentId: unit.documentIds[0],
    sourceKey: unit.sourceReferences?.[0]?.sourceKey,
    title: unit.title,
    citation: unit.sourceCitationSummary?.text ?? legalDocument?.officialCitationDisplay,
    metadataText: [
      unit.title,
      unit.category,
      ...(unit.tags ?? []),
      unit.notesCitationText,
      unit.sourceCitationSummary?.text,
      ...unit.sectionRefs.map((reference) => reference.label),
      ...prompts.map((prompt) => prompt.question),
      ...rubrics.map((rubric) => rubric.prompt),
      ...concepts.map((concept) => concept.label),
    ]
      .filter(Boolean)
      .join(' '),
    fullText: [
      unit.referenceAnswer,
      unit.editableSummary,
      ...prompts.map((prompt) => prompt.referenceAnswer),
      ...rubrics.flatMap((rubric) => [rubric.prompt, rubric.referenceAnswer]),
      ...concepts.map((concept) => concept.explanation ?? ''),
    ].join('\n'),
    excerpt: unit.editableSummary || unit.referenceAnswer.slice(0, 260),
    snippetText: [
      unit.title,
      unit.sourceCitationSummary?.text,
      unit.editableSummary,
      unit.referenceAnswer,
      ...prompts.flatMap((prompt) => [prompt.question, prompt.referenceAnswer]),
      ...rubrics.flatMap((rubric) => [rubric.prompt, rubric.referenceAnswer]),
      ...concepts.flatMap((concept) => [concept.label, concept.explanation ?? '']),
    ]
      .filter(Boolean)
      .join('\n'),
  };
};
