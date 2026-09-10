import type { NbLawContentPackage } from './content/nbLawTypes';
import {
  NB_LAW_FORBIDDEN_BOILERPLATE_MARKERS,
  validateNbLawContentPackage,
} from './content/nbLawContentPackage';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateSourceCitationSummary,
  generateStudyQuestion,
  generateStudyTitle,
  suggestRequiredConcepts,
} from './studyDraftGeneration';
import { generateStudyRubric } from './studyRubricGeneration';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyConcept,
  StudyDataSnapshot,
  StudyDocument,
  StudyOfficialImportHistory,
  StudyPrompt,
  StudyRubricItem,
  StudySourceReference,
  StudyUnit,
} from './studyTypes';

export type OfficialContentPreview = {
  valid: boolean;
  errors: string[];
  packageId?: string;
  manifestId?: string;
  newDocuments: string[];
  updatedDocuments: string[];
  unchangedDocuments: string[];
  absentExistingDocuments: string[];
  newComponents: string[];
  changedComponents: string[];
  removedComponents: string[];
  unchangedComponents: string[];
  referenceOnlyForms: string[];
  unitsRequiringSourceReview: string[];
};

export type OfficialContentImportResult = {
  snapshot: StudyDataSnapshot;
  preview: OfficialContentPreview;
  history: StudyOfficialImportHistory;
};

const emptyPreview = (errors: string[] = []): OfficialContentPreview => ({
  valid: errors.length === 0,
  errors,
  newDocuments: [],
  updatedDocuments: [],
  unchangedDocuments: [],
  absentExistingDocuments: [],
  newComponents: [],
  changedComponents: [],
  removedComponents: [],
  unchangedComponents: [],
  referenceOnlyForms: [],
  unitsRequiringSourceReview: [],
});

const componentRecordKey = (documentId: string, sourceKey: string): string => `${documentId}::${sourceKey}`;

const componentTypeRank: Record<ImportedLegalComponent['componentType'], number> = {
  'part-heading': 0,
  'division-heading': 1,
  section: 2,
  schedule: 3,
  appendix: 4,
  form: 5,
};

const splitLegalLabel = (value: string): Array<number | string> =>
  value
    .toLowerCase()
    .split(/([0-9]+)/)
    .filter(Boolean)
    .map((part) => (/^[0-9]+(?:\.[0-9]+)?$/.test(part) ? Number(part) : part));

const compareLegalLabels = (left: string, right: string): number => {
  const leftParts = splitLegalLabel(left);
  const rightParts = splitLegalLabel(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
    const compared = String(a).localeCompare(String(b));
    if (compared !== 0) return compared;
  }
  return 0;
};

export const compareImportedLegalComponents = (
  left: ImportedLegalComponent,
  right: ImportedLegalComponent,
): number => {
  const rank = componentTypeRank[left.componentType] - componentTypeRank[right.componentType];
  if (rank !== 0) return rank;
  const label = compareLegalLabels(left.label, right.label);
  if (label !== 0) return label;
  return left.sourceKey.localeCompare(right.sourceKey);
};

export const shouldShowLegalComponentInReader = (component: ImportedLegalComponent): boolean =>
  !(component.componentType === 'form' && component.extractionStatus === 'reference-only');

export const buildCompleteDocumentText = (components: ImportedLegalComponent[]): string =>
  components
    .filter(shouldShowLegalComponentInReader)
    .slice()
    .sort(compareImportedLegalComponents)
    .map((component) => component.text)
    .join('\n\n');

export const parseOfficialContentPackage = (text: string): NbLawContentPackage => {
  const parsed = JSON.parse(text) as NbLawContentPackage;
  return parsed;
};

const hasOnlyOwnFormLabel = (component: Pick<ImportedLegalComponent, 'componentType' | 'label' | 'text'>): boolean => {
  if (component.componentType !== 'form') return false;
  const cleaned = component.text
    .replace(/N\.B\.\s*This Regulation is consolidated to [A-Za-z]+\s+\d{1,2},\s+\d{4}\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return cleaned === component.label.trim().toLowerCase();
};

export const classifyLegalComponentExtractionStatus = (
  component: Pick<ImportedLegalComponent, 'componentType' | 'label' | 'text'>,
): ImportedLegalComponent['extractionStatus'] => {
  if (hasOnlyOwnFormLabel(component)) return 'reference-only';
  return 'complete';
};

export const validateOfficialContentPackageForImport = (
  contentPackage: NbLawContentPackage,
): string[] => {
  const errors = validateNbLawContentPackage(contentPackage).errors.slice();
  if (contentPackage.schemaVersion !== 1) errors.push('Unsupported official content package schema version.');
  if (!contentPackage.id?.trim()) errors.push('Package ID is required.');
  if (!contentPackage.manifestId?.trim()) errors.push('Manifest ID is required.');
  if ((contentPackage.integrityReport?.errors.length ?? 0) > 0) {
    errors.push('Embedded integrity report contains errors.');
  }
  const documentIds = new Set<string>();
  for (const document of contentPackage.documents ?? []) {
    if (documentIds.has(document.id)) errors.push(`Duplicate document ID: ${document.id}.`);
    documentIds.add(document.id);
    if (contentPackage.sourceHashes[document.id] !== document.contentHash) {
      errors.push(`Source hash mismatch for ${document.id}.`);
    }
    const componentKeys = new Set<string>();
    for (const component of document.components ?? []) {
      if (!component.contentHash) errors.push(`${document.id} ${component.sourceKey} is missing a hash.`);
      if (componentKeys.has(component.sourceKey)) {
        errors.push(`Duplicate component sourceKey for ${document.id}: ${component.sourceKey}.`);
      }
      componentKeys.add(component.sourceKey);
      const text = component.text ?? '';
      const marker = NB_LAW_FORBIDDEN_BOILERPLATE_MARKERS.find((entry) => text.includes(entry));
      if (marker) errors.push(`${document.id} ${component.sourceKey} contains interface text: ${marker}.`);
    }
    for (const item of document.tableOfContents ?? []) {
      if (item.sourceKey && !componentKeys.has(item.sourceKey)) {
        errors.push(`${document.id} TOC sourceKey has no component: ${item.sourceKey}.`);
      }
    }
  }
  for (const relationship of contentPackage.relationships ?? []) {
    if (!documentIds.has(relationship.parentActId)) {
      errors.push(`Relationship parent does not exist: ${relationship.parentActId}.`);
    }
    if (!documentIds.has(relationship.regulationId)) {
      errors.push(`Relationship regulation does not exist: ${relationship.regulationId}.`);
    }
  }
  return errors;
};

export const toImportedLegalDocuments = (
  contentPackage: NbLawContentPackage,
  importedAt: string,
): ImportedLegalDocument[] =>
  contentPackage.documents.map((document) => ({
    id: document.id,
    packageId: contentPackage.id,
    manifestId: contentPackage.manifestId,
    officialTitle: document.officialTitle,
    officialCitationDisplay: document.officialCitationDisplay ?? document.officialCitation ?? '',
    officialCitationNormalized: document.officialCitationNormalized ?? '',
    officialNumberDisplay: document.officialNumberDisplay,
    officialNumberNormalized: document.officialNumberNormalized,
    documentType: document.documentType,
    parentActId: document.parentActId,
    enablingActs: document.enablingActs,
    sourceUrl: document.sourceUrl,
    fetchDate: document.fetchDate,
    consolidatedTo: document.consolidatedTo,
    contentHash: document.contentHash,
    importedAt,
    packageCreatedAt: contentPackage.createdAt,
  }));

export const toImportedLegalComponents = (contentPackage: NbLawContentPackage): ImportedLegalComponent[] =>
  contentPackage.documents.flatMap((document) =>
    document.components.map((component) => {
      const record: ImportedLegalComponent = {
        documentId: document.id,
        id: component.id,
        sourceKey: component.sourceKey,
        componentType: component.componentType,
        label: component.label,
        heading: component.heading,
        text: component.text,
        contentHash: component.contentHash,
        subsections:
          component.componentType === 'section'
            ? component.subsections.map((subsection) => ({ ...subsection }))
            : undefined,
        extractionStatus: 'complete',
      };
      return {
        ...record,
        extractionStatus: classifyLegalComponentExtractionStatus(record),
      };
    }),
  );

const sourceReferenceNeedsReview = (
  reference: StudySourceReference,
  incomingComponentsByKey: Map<string, ImportedLegalComponent>,
): boolean => {
  const component = incomingComponentsByKey.get(componentRecordKey(reference.documentId, reference.sourceKey));
  return Boolean(component && component.contentHash !== reference.contentHashAtLinkTime);
};

const isSourceReferenceMissing = (
  reference: StudySourceReference,
  incomingComponentsByKey: Map<string, ImportedLegalComponent>,
): boolean => !incomingComponentsByKey.has(componentRecordKey(reference.documentId, reference.sourceKey));

export const previewOfficialContentPackage = (
  snapshot: StudyDataSnapshot,
  contentPackage: NbLawContentPackage,
): OfficialContentPreview => {
  const errors = validateOfficialContentPackageForImport(contentPackage);
  const preview = emptyPreview(errors);
  preview.packageId = contentPackage.id;
  preview.manifestId = contentPackage.manifestId;
  if (errors.length > 0) return preview;
  const importedAt = new Date().toISOString();
  const incomingDocuments = toImportedLegalDocuments(contentPackage, importedAt);
  const incomingComponents = toImportedLegalComponents(contentPackage);
  const existingDocumentsById = new Map(snapshot.legalDocuments.map((document) => [document.id, document]));
  const incomingDocumentIds = new Set(incomingDocuments.map((document) => document.id));
  for (const document of incomingDocuments) {
    const existing = existingDocumentsById.get(document.id);
    if (!existing) preview.newDocuments.push(document.id);
    else if (existing.contentHash !== document.contentHash) preview.updatedDocuments.push(document.id);
    else preview.unchangedDocuments.push(document.id);
  }
  preview.absentExistingDocuments = snapshot.legalDocuments
    .filter((document) => !incomingDocumentIds.has(document.id))
    .map((document) => document.id);

  const existingComponentsByKey = new Map(
    snapshot.legalComponents.map((component) => [componentRecordKey(component.documentId, component.sourceKey), component]),
  );
  const incomingComponentsByKey = new Map(
    incomingComponents.map((component) => [componentRecordKey(component.documentId, component.sourceKey), component]),
  );
  for (const component of incomingComponents) {
    const key = componentRecordKey(component.documentId, component.sourceKey);
    const existing = existingComponentsByKey.get(key);
    if (!existing) preview.newComponents.push(key);
    else if (existing.contentHash !== component.contentHash) preview.changedComponents.push(key);
    else preview.unchangedComponents.push(key);
    if (component.extractionStatus === 'reference-only') preview.referenceOnlyForms.push(key);
  }
  preview.removedComponents = snapshot.legalComponents
    .filter((component) => incomingDocumentIds.has(component.documentId))
    .map((component) => componentRecordKey(component.documentId, component.sourceKey))
    .filter((key) => !incomingComponentsByKey.has(key));

  preview.unitsRequiringSourceReview = snapshot.units
    .filter((unit) =>
      (unit.sourceReferences ?? []).some(
        (reference) =>
          sourceReferenceNeedsReview(reference, incomingComponentsByKey) ||
          isSourceReferenceMissing(reference, incomingComponentsByKey),
      ),
    )
    .map((unit) => unit.id);
  return preview;
};

export const upsertStudyDocumentsWithOfficialMetadata = (
  documents: StudyDocument[],
  legalDocuments: ImportedLegalDocument[],
): StudyDocument[] => {
  const legalById = new Map(legalDocuments.map((document) => [document.id, document]));
  const existingIds = new Set(documents.map((document) => document.id));
  const existingById = new Map(documents.map((document) => [document.id, document]));
  const enrichedExisting = documents.map((document) => {
    const legal = legalById.get(document.id);
    if (!legal) return document;
    return {
      ...document,
      title: document.title || legal.officialTitle,
      kind: legal.documentType,
      citation: document.citation ?? legal.officialCitationDisplay,
      updatedAt: document.updatedAt,
    };
  });
  const addedOfficialDocuments = legalDocuments
    .filter((legal) => !existingIds.has(legal.id))
    .map((legal): StudyDocument => {
      const parent = legal.parentActId ? existingById.get(legal.parentActId) : undefined;
      const title =
        legal.documentType === 'regulation' && legal.officialNumberDisplay
          ? `Regulation ${legal.officialNumberDisplay}${parent ? ` - ${parent.title}` : ''}`
          : legal.officialTitle;
      return {
        id: legal.id,
        title,
        kind: legal.documentType,
        jurisdiction: 'New Brunswick',
        category: parent?.category ?? (legal.documentType === 'regulation' ? 'Regulation' : 'Statute law'),
        priority: parent?.priority ?? 3,
        citation: legal.officialCitationDisplay,
        summary: '',
        sourceFiles: [],
        createdAt: legal.importedAt,
        updatedAt: legal.importedAt,
      };
    });
  return [...enrichedExisting, ...addedOfficialDocuments];
};

export const applyOfficialContentPackageToSnapshot = ({
  snapshot,
  contentPackage,
  importedAt = new Date().toISOString(),
}: {
  snapshot: StudyDataSnapshot;
  contentPackage: NbLawContentPackage;
  importedAt?: string;
}): OfficialContentImportResult => {
  const preview = previewOfficialContentPackage(snapshot, contentPackage);
  if (!preview.valid) throw new Error(preview.errors.join('\n'));
  const incomingDocuments = toImportedLegalDocuments(contentPackage, importedAt);
  const incomingComponents = toImportedLegalComponents(contentPackage);
  const incomingDocumentIds = new Set(incomingDocuments.map((document) => document.id));
  const incomingComponentsByKey = new Map(
    incomingComponents.map((component) => [componentRecordKey(component.documentId, component.sourceKey), component]),
  );
  const retainedDocuments = snapshot.legalDocuments.filter((document) => !incomingDocumentIds.has(document.id));
  const retainedComponents = snapshot.legalComponents.filter((component) => !incomingDocumentIds.has(component.documentId));
  const units = snapshot.units.map((unit) => {
    const references = unit.sourceReferences ?? [];
    if (references.length === 0) return unit;
    const sourceReviewRequired = references.some((reference) =>
      sourceReferenceNeedsReview(reference, incomingComponentsByKey),
    );
    const sourceReferenceIsMissing = references.some((reference) =>
      isSourceReferenceMissing(reference, incomingComponentsByKey),
    );
    return {
      ...unit,
      sourceReviewRequired: unit.sourceReviewRequired || sourceReviewRequired,
      sourceReferenceMissing: unit.sourceReferenceMissing || sourceReferenceIsMissing,
    };
  });
  const history: StudyOfficialImportHistory = {
    id: `official-import-${importedAt}`,
    packageId: contentPackage.id,
    manifestId: contentPackage.manifestId,
    packageCreatedAt: contentPackage.createdAt,
    importedAt,
    addedDocuments: preview.newDocuments.length,
    changedDocuments: preview.updatedDocuments.length,
    addedComponents: preview.newComponents.length,
    changedComponents: preview.changedComponents.length,
    removedComponents: preview.removedComponents.length,
    referenceOnlyForms: preview.referenceOnlyForms.length,
    unitsFlaggedForReview: preview.unitsRequiringSourceReview.length,
    result: 'success',
    message: `Imported ${contentPackage.id}.`,
  };
  const legalDocuments = [...retainedDocuments, ...incomingDocuments].sort((a, b) => a.id.localeCompare(b.id));
  const nextSnapshot: StudyDataSnapshot = {
    ...snapshot,
    legalDocuments,
    legalComponents: [...retainedComponents, ...incomingComponents].sort((a, b) => {
      const documentCompared = a.documentId.localeCompare(b.documentId);
      return documentCompared !== 0 ? documentCompared : compareImportedLegalComponents(a, b);
    }),
    documents: upsertStudyDocumentsWithOfficialMetadata(snapshot.documents, legalDocuments),
    units,
    importHistory: [...snapshot.importHistory, history],
  };
  return { snapshot: nextSnapshot, preview, history };
};

export const acknowledgeUnitSourceReview = (
  unit: StudyUnit,
  components: ImportedLegalComponent[],
  acknowledgedAt = new Date().toISOString(),
): StudyUnit => {
  const componentsByKey = new Map(
    components.map((component) => [componentRecordKey(component.documentId, component.sourceKey), component]),
  );
  return {
    ...unit,
    sourceReferences: (unit.sourceReferences ?? []).map((reference) => {
      const component = componentsByKey.get(componentRecordKey(reference.documentId, reference.sourceKey));
      return component ? { ...reference, contentHashAtLinkTime: component.contentHash } : reference;
    }),
    sourceReviewRequired: false,
    sourceReferenceMissing: (unit.sourceReferences ?? []).some(
      (reference) => !componentsByKey.has(componentRecordKey(reference.documentId, reference.sourceKey)),
    ),
    sourceReviewAcknowledgedAt: acknowledgedAt,
    updatedAt: acknowledgedAt,
  };
};

export const createStudyUnitFromSourceSelection = ({
  document,
  legalDocument,
  components,
  existingUnits,
  nowIso = new Date().toISOString(),
}: {
  document: StudyDocument;
  legalDocument?: ImportedLegalDocument;
  components: ImportedLegalComponent[];
  existingUnits: StudyUnit[];
  nowIso?: string;
}): StudyUnit => {
  const sourceReferences = components.map((component) => ({
    documentId: component.documentId,
    sourceKey: component.sourceKey,
    contentHashAtLinkTime: component.contentHash,
  }));
  const documentTitle = legalDocument?.officialTitle ?? document.title;
  const referenceAnswer = legalDocument
    ? generateReferenceAnswer({
        document: legalDocument,
        selectedSources: components,
        options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
      }).text
    : '';
  return {
    id: `unit-source-${document.id}-${Date.now().toString(36)}-${existingUnits.length + 1}`,
    title: generateStudyTitle({ documentTitle, selectedSources: components }),
    sourceMode: 'official',
    documentIds: [document.id],
    sectionRefs: components.map((component) => ({
      documentId: component.documentId,
      label: component.label,
      anchor: component.sourceKey,
    })),
    sourceReferences,
    sourceCitationSummary: legalDocument
      ? generateSourceCitationSummary({ document: legalDocument, selectedSources: components })
      : undefined,
    generatedContentState: {
      title: 'generated',
      question: 'generated',
      referenceAnswer: referenceAnswer ? 'generated' : 'empty',
      editableSummary: 'empty',
      concepts: 'empty',
    },
    sourceReviewRequired: false,
    sourceReferenceMissing: false,
    category: document.category,
    priority: document.priority,
    editableSummary: '',
    referenceAnswer,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
};

export const createStudyContentFromSourceSelection = ({
  document,
  legalDocument,
  components,
  existingUnits,
  nowIso = new Date().toISOString(),
}: {
  document: StudyDocument;
  legalDocument?: ImportedLegalDocument;
  components: ImportedLegalComponent[];
  existingUnits: StudyUnit[];
  nowIso?: string;
}): { unit: StudyUnit; prompt: StudyPrompt; concepts: StudyConcept[]; rubrics: StudyRubricItem[] } => {
  const unit = createStudyUnitFromSourceSelection({
    document,
    legalDocument,
    components,
    existingUnits,
    nowIso,
  });
  const documentTitle = legalDocument?.officialTitle ?? document.title;
  const conceptLabels = suggestRequiredConcepts(components);
  const concepts = conceptLabels.map((label, index): StudyConcept => ({
    id: `${unit.id}-concept-${index + 1}`,
    unitId: unit.id,
    label,
    required: true,
    origin: 'generated',
    order: index,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const rubrics = generateStudyRubric({
    document: legalDocument,
    selectedSources: components,
    unitType: 'section',
  }).map((rubric, index): StudyRubricItem => ({
    ...rubric,
    id: `${unit.id}-rubric-${index + 1}`,
    unitId: unit.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const question = generateStudyQuestion({
    documentTitle,
    officialCitation: legalDocument?.officialCitationDisplay ?? document.citation,
    selectedSources: components,
    rubricCategories: rubrics.map((rubric) => rubric.category),
  }).question;
  return {
    unit: {
      ...unit,
      unitType: 'section',
      generatedContentState: {
        ...unit.generatedContentState!,
        concepts: concepts.length > 0 ? 'generated' : 'empty',
        rubrics: rubrics.length > 0 ? 'generated' : 'empty',
      },
    },
    prompt: {
      id: `${unit.id}-guided`,
      unitId: unit.id,
      kind: 'guided-recall',
      question,
      referenceAnswer: unit.referenceAnswer,
      conceptIds: concepts.map((concept) => concept.id),
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    concepts,
    rubrics,
  };
};
