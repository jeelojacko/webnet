import type { NbLawContentPackage, NbLawDocumentIntegrityReport, NbLawNormalizedDocument } from './nbLawTypes';

export type NbLawContentPackageValidation = {
  valid: boolean;
  errors: string[];
};

export const NB_LAW_FORBIDDEN_BOILERPLATE_MARKERS = [
  'Copy to Drafting',
  'Copy to LAW',
  'Select this element',
  'Select parent element',
  'Advanced search (includes point-in-time)',
  'Drafted, consolidated and published',
  'Cyberlex',
  'Feedback',
  'Privacy Statement',
] as const;

const normalizeTitleForComparison = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const findDuplicates = (values: string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

const findBoilerplateMarkers = (document: NbLawNormalizedDocument): string[] => {
  const text = document.components.map((component) => component.text).join('\n');
  return NB_LAW_FORBIDDEN_BOILERPLATE_MARKERS.filter((marker) => text.includes(marker));
};

const buildDocumentIntegrityReport = (
  document: NbLawNormalizedDocument,
  documentsById: Map<string, NbLawNormalizedDocument>,
): NbLawDocumentIntegrityReport => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedParent = document.parentActId ? documentsById.get(document.parentActId) : undefined;
  const expectedParentTitle = expectedParent?.officialTitle;
  const extractedEnablingActs = document.enablingActs ?? [];
  const boilerplateMarkers = findBoilerplateMarkers(document);
  const duplicateSourceKeys = findDuplicates(document.components.map((component) => component.sourceKey));
  const componentSourceKeys = new Set(document.components.map((component) => component.sourceKey));
  const missingTocSourceKeys = document.tableOfContents
    .map((item) => item.sourceKey)
    .filter((sourceKey): sourceKey is string => Boolean(sourceKey))
    .filter((sourceKey) => !componentSourceKeys.has(sourceKey));

  if (!document.officialTitle.trim()) errors.push('Missing official title.');
  if (!document.officialCitationDisplay?.trim()) errors.push('Missing official citation.');
  if (document.components.length === 0) errors.push('No legal components were extracted.');
  if (boilerplateMarkers.length > 0) {
    errors.push(`Known laws.gnb.ca interface text found: ${boilerplateMarkers.join(', ')}.`);
  }
  if (duplicateSourceKeys.length > 0) {
    errors.push(`Duplicate component source keys: ${duplicateSourceKeys.join(', ')}.`);
  }
  if (missingTocSourceKeys.length > 0) {
    errors.push(`Table of contents references missing components: ${missingTocSourceKeys.join(', ')}.`);
  }
  if (document.documentType === 'regulation') {
    if (extractedEnablingActs.length === 0) {
      errors.push('Regulation enabling Act was not extracted.');
    }
    if (expectedParentTitle) {
      const expectedKey = normalizeTitleForComparison(expectedParentTitle);
      const matchesParent = extractedEnablingActs.some(
        (act) => normalizeTitleForComparison(act.title) === expectedKey,
      );
      if (!matchesParent) {
        errors.push(
          `Enabling Act mismatch: expected ${expectedParentTitle}, extracted ${
            extractedEnablingActs.map((act) => act.title).join(', ') || 'none'
          }.`,
        );
      }
    }
  }
  if (!document.consolidatedTo) {
    warnings.push('No consolidation date was extracted.');
  }

  return {
    documentId: document.id,
    officialTitle: document.officialTitle,
    officialCitation: document.officialCitationDisplay,
    documentType: document.documentType,
    expectedParentAct: expectedParentTitle,
    extractedEnablingActs,
    sourceUrl: document.sourceUrl,
    consolidationDate: document.consolidatedTo,
    sectionCount: document.sections.length,
    subsectionCount: document.sections.reduce((sum, section) => sum + section.subsections.length, 0),
    scheduleCount: document.components.filter((component) => component.componentType === 'schedule').length,
    formCount: document.components.filter((component) => component.componentType === 'form').length,
    parsingWarnings: document.notes,
    boilerplateContamination: {
      ok: boilerplateMarkers.length === 0,
      markers: boilerplateMarkers,
    },
    duplicateSourceKeys: {
      ok: duplicateSourceKeys.length === 0,
      keys: duplicateSourceKeys,
    },
    tableOfContentsReferences: {
      ok: missingTocSourceKeys.length === 0,
      missingSourceKeys: missingTocSourceKeys,
    },
    contentHash: document.contentHash,
    errors,
    warnings,
  };
};

export const buildNbLawIntegrityReports = (
  documents: NbLawNormalizedDocument[],
): NbLawDocumentIntegrityReport[] => {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  return documents.map((document) => buildDocumentIntegrityReport(document, documentsById));
};

export const buildNbLawContentPackage = ({
  id,
  manifestId,
  createdAt,
  documents,
}: {
  id: string;
  manifestId: string;
  createdAt: string;
  documents: NbLawNormalizedDocument[];
}): NbLawContentPackage => {
  const documentReports = buildNbLawIntegrityReports(documents);
  return {
    schemaVersion: 1,
    id,
    manifestId,
    createdAt,
    documents,
    integrityReport: {
      createdAt,
      documents: documentReports,
      errors: documentReports.flatMap((report) =>
        report.errors.map((error) => `${report.documentId}: ${error}`),
      ),
      warnings: documentReports.flatMap((report) =>
        report.warnings.map((warning) => `${report.documentId}: ${warning}`),
      ),
    },
    relationships: documents
      .filter((document) => document.documentType === 'regulation' && document.parentActId)
      .map((document) => ({ parentActId: document.parentActId as string, regulationId: document.id })),
    sourceHashes: Object.fromEntries(documents.map((document) => [document.id, document.contentHash])),
  };
};

export const validateNbLawContentPackage = (
  contentPackage: NbLawContentPackage,
): NbLawContentPackageValidation => {
  const errors: string[] = [];
  if (contentPackage.schemaVersion !== 1) errors.push('Package schemaVersion must be 1.');
  if (!contentPackage.id?.trim()) errors.push('Package id is required.');
  const ids = new Set(contentPackage.documents.map((document) => document.id));
  errors.push(...(contentPackage.integrityReport?.errors ?? []));
  for (const document of contentPackage.documents) {
    if (document.schemaVersion !== 1) errors.push(`${document.id} document schemaVersion must be 1.`);
    if (!document.officialTitle.trim()) errors.push(`${document.id} officialTitle is required.`);
    if (!document.sourceUrl.startsWith('https://laws.gnb.ca/')) {
      errors.push(`${document.id} sourceUrl must use laws.gnb.ca.`);
    }
    if (document.components.length === 0) errors.push(`${document.id} must include at least one legal component.`);
    if (contentPackage.sourceHashes[document.id] !== document.contentHash) {
      errors.push(`${document.id} sourceHashes entry does not match document hash.`);
    }
    if (document.parentActId && !ids.has(document.parentActId)) {
      errors.push(`${document.id} parentActId does not exist in package.`);
    }
  }
  return { valid: errors.length === 0, errors };
};
