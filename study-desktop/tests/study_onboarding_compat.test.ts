// Phase 5F/5G/5H/5N onboarding + compatibility tests (pure, no runtime).
//
// Uses only existing seams (`studySeed`, `studyExportImport`,
// `studyStorage` migration/constants): empty vs non-empty library state,
// imported-backup round-trips, and current-schema compatibility. Backup
// import keeps the portable format with parse-before-replace semantics — a
// failed parse throws before any storage write could happen.

import { describe, expect, it } from 'vitest';

import { exportStudyData, parseStudyImport } from '../src/studyExportImport';
import {
  formatBackupRestoredMessage,
  isStudyLibraryEmpty,
  shouldSurfaceBundledUpdatePreview,
  summarizeRestoredBackup,
} from '../src/studyOnboarding';
import { createEmptyStudyData, createSeedStudyData } from '../src/studySeed';
import { STUDY_SCHEMA_VERSION } from '../src/studyStorage';

describe('onboarding library state', () => {
  it('treats a fresh empty database as the clear first-run state', () => {
    expect(isStudyLibraryEmpty(createEmptyStudyData('2026-09-11T00:00:00.000Z'))).toBe(true);
  });

  it('never treats seeded non-empty data as first-run (no overwrite/reset)', () => {
    expect(isStudyLibraryEmpty(createSeedStudyData('2026-09-11T00:00:00.000Z'))).toBe(false);
  });

  it('never treats an imported backup as first-run', () => {
    const text = exportStudyData(createSeedStudyData('2026-09-11T00:00:00.000Z'));
    expect(isStudyLibraryEmpty(parseStudyImport(text))).toBe(false);
  });
});

describe('backup compatibility', () => {
  it('empty snapshots round-trip on the current schema', () => {
    const text = exportStudyData(createEmptyStudyData('2026-09-11T00:00:00.000Z'));
    const restored = parseStudyImport(text);
    expect(restored.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(isStudyLibraryEmpty(restored)).toBe(true);
  });

  it('non-empty snapshots round-trip on the current schema with counts intact', () => {
    const text = exportStudyData(createSeedStudyData('2026-09-11T00:00:00.000Z'));
    const restored = parseStudyImport(text);
    expect(restored.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(summarizeRestoredBackup(restored)).toEqual({
      documents: 5,
      units: 5,
      legalDocuments: 0,
      attempts: 0,
    });
  });

  it('imported backups re-export through the same portable format', () => {
    const once = parseStudyImport(exportStudyData(createSeedStudyData('2026-09-11T00:00:00.000Z')));
    const twice = parseStudyImport(exportStudyData(once));
    expect(summarizeRestoredBackup(twice)).toEqual(summarizeRestoredBackup(once));
    expect(twice.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
  });

  it('invalid backups fail parsing before any storage write', () => {
    expect(() => parseStudyImport('not json')).toThrow();
    expect(() => parseStudyImport('')).toThrow();
  });

  it('reports restored counts after import', () => {
    const restored = parseStudyImport(
      exportStudyData(createSeedStudyData('2026-09-11T00:00:00.000Z')),
    );
    expect(formatBackupRestoredMessage(summarizeRestoredBackup(restored))).toBe(
      'Study backup restored: 5 documents, 5 units, 0 official documents, 0 attempts.',
    );
  });
});

describe('bundled update preview hook', () => {
  it('stays dormant when no bundle is wired yet', () => {
    expect(
      shouldSurfaceBundledUpdatePreview({
        currentPackageIds: ['nb-sit-old'],
        bundledPackageId: null,
        hasOfficialCorpus: true,
      }),
    ).toBe(false);
  });

  it('stays dormant for the empty first-run state', () => {
    expect(
      shouldSurfaceBundledUpdatePreview({
        currentPackageIds: [],
        bundledPackageId: 'nb-sit-new',
        hasOfficialCorpus: false,
      }),
    ).toBe(false);
  });

  it('surfaces a preview (never auto-apply) when an old corpus remains', () => {
    expect(
      shouldSurfaceBundledUpdatePreview({
        currentPackageIds: ['nb-sit-old'],
        bundledPackageId: 'nb-sit-new',
        hasOfficialCorpus: true,
      }),
    ).toBe(true);
  });

  it('stays quiet when the current import already includes the bundle', () => {
    expect(
      shouldSurfaceBundledUpdatePreview({
        currentPackageIds: ['nb-sit-new'],
        bundledPackageId: 'nb-sit-new',
        hasOfficialCorpus: true,
      }),
    ).toBe(false);
  });
});
