// Study — first-run/get-started onboarding helpers (Phase 5F/5G/5H/5N).
//
// Pure, display-only helpers. They never read browser profiles, never touch
// storage, and never modify Study domain state:
// - first-run visibility derives from the loaded snapshot (no persistent
//   flag), so non-empty data can never be overwritten or reset by onboarding;
// - backup import keeps the existing portable format and parse-before-replace
//   semantics (`parseStudyImport` + `storage.replaceAll`); these helpers only
//   describe the restored snapshot for the status message;
// - the bundled-update hook only decides whether to SURFACE a preview prompt
//   (navigating to the existing Manage Validate Preview path). It never
//   auto-applies anything.

import type { StudyDataSnapshot } from './studyTypes';

export type RestoredBackupCounts = {
  documents: number;
  units: number;
  legalDocuments: number;
  attempts: number;
};

/**
 * Clear official library state: no documents, no study units, and no
 * imported official corpus. Attempts/progress/settings are derived or
 * ambient and do not count — an untouched first run is exactly this shape.
 */
export const isStudyLibraryEmpty = (
  data: Pick<StudyDataSnapshot, 'documents' | 'units' | 'legalDocuments'>,
): boolean =>
  data.documents.length === 0 &&
  data.units.length === 0 &&
  data.legalDocuments.length === 0;

/** Restored-record counts for the post-import status message. */
export const summarizeRestoredBackup = (
  snapshot: Pick<
    StudyDataSnapshot,
    'documents' | 'units' | 'legalDocuments' | 'attempts'
  >,
): RestoredBackupCounts => ({
  documents: snapshot.documents.length,
  units: snapshot.units.length,
  legalDocuments: snapshot.legalDocuments.length,
  attempts: snapshot.attempts.length,
});

/** Compact restored-counts message shown after a backup import. */
export const formatBackupRestoredMessage = (counts: RestoredBackupCounts): string =>
  `Study backup restored: ${counts.documents} documents, ${counts.units} units, ` +
  `${counts.legalDocuments} official documents, ${counts.attempts} attempts.`;

/**
 * Bundled-update preview hook: surface a preview prompt only when a bundled
 * package id is known, an old official corpus remains, and the current
 * import does not already include the bundled package. Never triggers an
 * import — the caller routes to the existing Manage preview path.
 */
export const shouldSurfaceBundledUpdatePreview = ({
  currentPackageIds,
  bundledPackageId,
  hasOfficialCorpus,
}: {
  currentPackageIds: string[];
  bundledPackageId: string | null;
  hasOfficialCorpus: boolean;
}): boolean =>
  bundledPackageId !== null &&
  bundledPackageId.length > 0 &&
  hasOfficialCorpus &&
  !currentPackageIds.includes(bundledPackageId);
