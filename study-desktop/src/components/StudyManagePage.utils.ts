import type { OfficialContentPreview } from '../studyOfficialContent';
import { corpusContentHashFor } from '../search/studySearchDocuments';
import type { StudyDataSnapshot, StudyOfficialImportHistory } from '../studyTypes';

export type CurrentOfficialPackageDocument = {
  id: string;
  officialTitle: string;
  citation: string;
  contentHash: string;
};

export type CurrentOfficialPackageDiagnostics = {
  packageIds: string[];
  manifestIds: string[];
  /** Latest package creation date across imported documents/history. */
  packageCreatedAt: string | null;
  /** Same deterministic corpus hash used to invalidate official search artifacts. */
  packageHash: string;
  /** Latest import date across history/documents. */
  importedAt: string | null;
  documentCount: number;
  componentCount: number | null;
  documents: CurrentOfficialPackageDocument[];
  lastImport: StudyOfficialImportHistory | null;
};

const distinctSorted = (values: Array<string | undefined>): string[] =>
  [...new Set(values.filter((value): value is string => Boolean(value)))].sort();

const latestOf = (values: Array<string | undefined>): string | null => {
  const dated = values.filter((value): value is string => Boolean(value)).sort();
  return dated.length > 0 ? dated[dated.length - 1] : null;
};

/**
 * Current imported official-package diagnostics. Derived only from the
 * already-loaded snapshot (`legalDocuments` stay in memory; `legalComponents`
 * are intentionally cleared on the main thread, so component totals come
 * from the latest import-history deltas). Never triggers migration or
 * overwrite — read-only metadata for the Manage page.
 */
export const buildCurrentOfficialPackageDiagnostics = (
  data: StudyDataSnapshot,
): CurrentOfficialPackageDiagnostics | null => {
  if (data.legalDocuments.length === 0 && data.importHistory.length === 0) return null;
  const documents = data.legalDocuments
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const lastImport =
    data.importHistory.length > 0 ? data.importHistory[data.importHistory.length - 1] : null;
  return {
    packageIds: distinctSorted([
      ...documents.map((document) => document.packageId),
      lastImport?.packageId,
    ]),
    manifestIds: distinctSorted([
      ...documents.map((document) => document.manifestId),
      lastImport?.manifestId,
    ]),
    packageCreatedAt: latestOf([
      ...documents.map((document) => document.packageCreatedAt),
      lastImport?.packageCreatedAt,
    ]),
    packageHash: corpusContentHashFor(data.legalDocuments),
    importedAt: latestOf([
      ...documents.map((document) => document.importedAt),
      lastImport?.importedAt,
    ]),
    documentCount: documents.length,
    componentCount:
      lastImport?.componentCount ??
      (data.legalComponents.length > 0
        ? data.legalComponents.filter((component) =>
            documents.some((document) => document.id === component.documentId),
          ).length
        : null),
    documents: documents.map((document) => ({
      id: document.id,
      officialTitle: document.officialTitle,
      citation: document.officialCitationDisplay,
      contentHash: document.contentHash,
    })),
    lastImport,
  };
};

export type PreviewDifference = 'matches-current' | 'differs-from-current' | 'first-import';

/**
 * Compact alias for a (potentially very long) corpus fingerprint: leading
 * and trailing edges joined with an ellipsis. Short values pass through
 * unchanged so the alias stays exact for small corpora.
 */
export const compactCorpusFingerprint = (fingerprint: string, edge = 12): string => {
  if (fingerprint.length <= edge * 2 + 1) return fingerprint;
  return `${fingerprint.slice(0, edge)}\u2026${fingerprint.slice(-edge)}`;
};

/**
 * Newer/different indication for a validated pasted-package preview against
 * the current import. Display-only: callers must not auto-migrate or
 * overwrite on a `differs-from-current` result.
 */
export const describePreviewDifference = (
  current: CurrentOfficialPackageDiagnostics | null,
  preview: OfficialContentPreview | null,
): PreviewDifference | null => {
  if (!preview?.valid) return null;
  if (!current) return 'first-import';
  const differs =
    (preview.packageId != null && !current.packageIds.includes(preview.packageId)) ||
    preview.newDocuments.length > 0 ||
    preview.updatedDocuments.length > 0 ||
    preview.newComponents.length > 0 ||
    preview.changedComponents.length > 0 ||
    preview.removedComponents.length > 0 ||
    preview.unitsRequiringSourceReview.length > 0;
  return differs ? 'differs-from-current' : 'matches-current';
};
