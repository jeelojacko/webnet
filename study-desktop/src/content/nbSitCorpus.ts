import { createHash } from 'node:crypto';
import type { NbLawManifestEntry } from './nbLawTypes';
import type {
  SitCorpusInventoryFinding,
  SitCorpusInventoryReport,
  SitCorpusManifest,
  SitCorpusManifestDocument,
} from './nbSitCorpusTypes';

export const NB_SIT_CORPUS_ID = 'nb-sit-statute-corpus';
export const NB_SIT_FETCH_PIPELINE_VERSION = 'nb-sit-fetch-1';
export const NB_SIT_NORMALIZER_VERSION = 'nb-law-normalizer-1';
export const NB_SIT_PACKAGE_SCHEMA_VERSION = 'nb-law-content-package-1';

const normalizeForHash = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'generatedAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeForHash(nestedValue)]),
  );
};

export const hashSitCorpusManifest = (manifest: SitCorpusManifest): string =>
  createHash('sha256')
    .update(JSON.stringify(normalizeForHash(manifest)), 'utf8')
    .digest('hex');

const findDuplicates = (values: string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

export const getRequiredSitDocuments = (manifest: SitCorpusManifest): SitCorpusManifestDocument[] =>
  manifest.documents.filter((document) => document.examScope === 'required');

export const getRequiredSitActs = (manifest: SitCorpusManifest): SitCorpusManifestDocument[] =>
  getRequiredSitDocuments(manifest).filter((document) => document.type === 'act');

export const getRequiredSitRegulations = (manifest: SitCorpusManifest): SitCorpusManifestDocument[] =>
  getRequiredSitDocuments(manifest).filter((document) => document.type === 'regulation');

export const getFetchableRequiredSitDocuments = (
  manifest: SitCorpusManifest,
): SitCorpusManifestDocument[] => getRequiredSitDocuments(manifest).filter((document) => document.sourceUrl.trim());

export const toNbLawManifestEntry = (document: SitCorpusManifestDocument): NbLawManifestEntry => ({
  id: document.id,
  manualTitle: document.title,
  currentTitle: document.title,
  sourceType: document.type,
  sourceCorpus: document.sourceCorpus ?? (document.type === 'act' ? 'cs' : 'cr'),
  sourceIdentifier: document.sourceIdentifier ?? document.sourceUrl.split('/').pop() ?? '',
  parentActId: document.parentActId,
  priority: document.existingPilot ? 1 : 3,
  categories: document.type === 'act' ? ['Statute law'] : ['Regulation'],
  tags: ['nb-sit'],
  expectedCitation: document.citation,
  enabled: document.examScope === 'required',
});

export const buildSitCorpusInventoryReport = (
  manifest: SitCorpusManifest,
  generatedAt = new Date().toISOString(),
): SitCorpusInventoryReport => {
  const findings: SitCorpusInventoryFinding[] = [];
  const ids = manifest.documents.map((document) => document.id);
  const manualEntryIds = manifest.manualScopeMappings?.map((mapping) => mapping.manualEntryId) ?? [];
  const duplicateIds = findDuplicates(ids);
  const duplicateManualEntryIds = findDuplicates(manualEntryIds);
  const duplicateTitles = findDuplicates(
    manifest.documents.map((document) => `${document.type}:${normalizeTitle(document.title)}`),
  );
  const idsSet = new Set(ids);
  const requiredActs = getRequiredSitActs(manifest);
  const manualActCount = manifest.manualScopeMappings?.length ?? requiredActs.length;
  const requiredRegulations = getRequiredSitRegulations(manifest);
  const candidates = manifest.documents.filter((document) => document.examScope === 'candidate');
  const missingSourceUrls = getRequiredSitDocuments(manifest)
    .filter((document) => !document.sourceUrl.trim())
    .map((document) => document.id);
  const unresolvedParentActs = manifest.documents
    .filter((document) => document.parentActId && !idsSet.has(document.parentActId))
    .map((document) => document.id);
  const unknownCitations = getRequiredSitDocuments(manifest)
    .filter((document) => !document.citation?.trim())
    .map((document) => document.id);
  const awaitingManualConfirmation = getRequiredSitDocuments(manifest)
    .filter((document) => document.examSource?.note?.toLowerCase().includes('manual confirmation'))
    .map((document) => document.id);

  if (manifest.schemaVersion !== 1) {
    findings.push({ severity: 'ERROR', code: 'schema-version', message: 'Manifest schemaVersion must be 1.' });
  }
  if (manifest.corpusId !== NB_SIT_CORPUS_ID) {
    findings.push({ severity: 'ERROR', code: 'corpus-id', message: `Manifest corpusId must be ${NB_SIT_CORPUS_ID}.` });
  }
  if (!manifest.sourceAuthority.includes('laws.gnb.ca')) {
    findings.push({
      severity: 'ERROR',
      code: 'source-authority',
      message: 'Legal text authority must reference laws.gnb.ca.',
    });
  }
  if (manualActCount !== manifest.expectedRequiredActCount) {
    findings.push({
      severity: 'ERROR',
      code: 'required-act-count',
      message: `Manual SIT entry count is ${manualActCount}; expected ${manifest.expectedRequiredActCount}.`,
    });
  }
  for (const id of duplicateManualEntryIds) {
    findings.push({
      severity: 'ERROR',
      code: 'duplicate-manual-entry-id',
      documentId: id,
      message: `Duplicate manual entry id: ${id}.`,
    });
  }
  for (const id of duplicateIds) {
    findings.push({ severity: 'ERROR', code: 'duplicate-id', documentId: id, message: `Duplicate document id: ${id}.` });
  }
  for (const title of duplicateTitles) {
    findings.push({ severity: 'ERROR', code: 'duplicate-title', message: `Duplicate document title key: ${title}.` });
  }
  for (const documentId of missingSourceUrls) {
    findings.push({
      severity: 'ERROR',
      code: 'missing-source-url',
      documentId,
      message: `${documentId} is required but has no official source URL.`,
    });
  }
  for (const documentId of unresolvedParentActs) {
    findings.push({
      severity: 'ERROR',
      code: 'unresolved-parent-act',
      documentId,
      message: `${documentId} declares a parentActId that is not in the manifest.`,
    });
  }
  for (const documentId of unknownCitations) {
    findings.push({
      severity: 'WARNING',
      code: 'unknown-citation',
      documentId,
      message: `${documentId} has no citation in the SIT corpus manifest.`,
    });
  }
  for (const document of manifest.documents) {
    if (document.sourceUrl && !document.sourceUrl.startsWith('https://laws.gnb.ca/')) {
      if (document.sourceType === 'official-pdf' && document.sourceUrl.startsWith('https://www.anbls.nb.ca/')) {
        continue;
      }
      findings.push({
        severity: 'ERROR',
        code: 'non-official-source',
        documentId: document.id,
        message: `${document.id} sourceUrl must use laws.gnb.ca.`,
      });
    }
    if (document.sourceType === 'official-pdf' && !document.pdfSelector) {
      findings.push({
        severity: 'ERROR',
        code: 'missing-pdf-selector',
        documentId: document.id,
        message: `${document.id} is an official PDF source without a pdfSelector.`,
      });
    }
    if (document.type === 'regulation' && document.examScope === 'required' && !document.parentActId) {
      findings.push({
        severity: 'ERROR',
        code: 'missing-parent-act',
        documentId: document.id,
        message: `${document.id} is a required regulation without parentActId.`,
      });
    }
    if (document.examScope === 'candidate') {
      findings.push({
        severity: 'INFO',
        code: 'candidate-regulation',
        documentId: document.id,
        message: `${document.id} is recorded for review and excluded from the required package.`,
      });
    }
  }
  const legalDocumentIds = new Set(manifest.documents.map((document) => document.id));
  for (const mapping of manifest.manualScopeMappings ?? []) {
    if (mapping.currentDocumentId && !legalDocumentIds.has(mapping.currentDocumentId)) {
      findings.push({
        severity: 'ERROR',
        code: 'manual-mapping-target-missing',
        documentId: mapping.currentDocumentId,
        message: `${mapping.manualEntryId} maps to missing legal document ${mapping.currentDocumentId}.`,
      });
    }
    if (mapping.sourceStatus === 'legacy-replaced') {
      findings.push({
        severity: 'INFO',
        code: 'legacy-replaced',
        documentId: mapping.currentDocumentId,
        message: `${mapping.manualTitle} is represented by ${mapping.currentDocumentId} pending Registrar confirmation.`,
      });
    }
  }

  return {
    corpusId: manifest.corpusId,
    title: manifest.title,
    generatedAt,
    manifestHash: hashSitCorpusManifest(manifest),
    expectedActCount: manifest.expectedRequiredActCount,
    actualRequiredActCount: manualActCount,
    requiredRegulationCount: requiredRegulations.length,
    candidateRegulationCount: candidates.length,
    missingSourceUrls,
    duplicateTitles,
    duplicateIds,
    unresolvedParentActs,
    unknownCitations,
    pilotDocuments: manifest.documents.filter((document) => document.existingPilot).map((document) => document.id),
    awaitingManualConfirmation,
    findings,
  };
};

export const assertSitCorpusInventoryCanFetchRequired = (report: SitCorpusInventoryReport): void => {
  const blocking = report.findings.filter((finding) => finding.severity === 'ERROR');
  if (blocking.length > 0) {
    throw new Error(blocking.map((finding) => `${finding.code}: ${finding.message}`).join('\n'));
  }
};
