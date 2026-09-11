import { describe, expect, it } from 'vitest';

import {
  buildCurrentOfficialPackageDiagnostics,
  describePreviewDifference,
} from '../src/components/StudyManagePage.utils';
import { createSeedStudyData } from '../src/studySeed';
import type { OfficialContentPreview } from '../src/studyOfficialContent';
import type {
  ImportedLegalDocument,
  StudyOfficialImportHistory,
} from '../src/studyTypes';

const legalDocument: ImportedLegalDocument = {
  id: 'doc-surveys-act',
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  officialTitle: 'Surveys Act',
  officialCitationDisplay: 'S.N.B. 1976, c. S-17',
  officialCitationNormalized: 'snb-1976-c-s-17',
  documentType: 'act',
  sourceUrl: 'https://example.test',
  fetchDate: '2026-08-01',
  consolidatedTo: '2026-08-01',
  contentHash: 'doc-hash-1',
  importedAt: '2026-08-11T10:00:00.000Z',
  packageCreatedAt: '2026-08-11T09:00:00.000Z',
};

const history: StudyOfficialImportHistory = {
  id: 'official-import-2026-08-11T10:00:00.000Z',
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  packageCreatedAt: '2026-08-11T09:00:00.000Z',
  importedAt: '2026-08-11T10:00:00.000Z',
  addedDocuments: 1,
  changedDocuments: 0,
  addedComponents: 83,
  changedComponents: 0,
  removedComponents: 0,
  componentCount: 83,
  referenceOnlyForms: 0,
  unitsFlaggedForReview: 0,
  result: 'success',
  message: 'Imported nb-sit.',
};

const validPreview = (overrides: Partial<OfficialContentPreview> = {}): OfficialContentPreview => ({
  valid: true,
  errors: [],
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  newDocuments: [],
  updatedDocuments: [],
  unchangedDocuments: ['doc-surveys-act'],
  absentExistingDocuments: [],
  newComponents: [],
  changedComponents: [],
  removedComponents: [],
  unchangedComponents: ['doc-surveys-act::section-83'],
  referenceOnlyForms: [],
  unitsRequiringSourceReview: [],
  ...overrides,
});

describe('manage current official package diagnostics', () => {
  it('returns null when nothing is imported', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    expect(buildCurrentOfficialPackageDiagnostics(seed)).toBeNull();
  });

  it('summarizes package id/hash/date, import date, and document/component counts', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const current = buildCurrentOfficialPackageDiagnostics({
      ...seed,
      legalDocuments: [legalDocument],
      importHistory: [history],
    });

    expect(current?.packageIds).toEqual(['nb-sit']);
    expect(current?.manifestIds).toEqual(['nb-sit-statute-corpus']);
    expect(current?.packageCreatedAt).toBe('2026-08-11T09:00:00.000Z');
    expect(current?.packageHash).toBe('doc-surveys-act:doc-hash-1');
    expect(current?.importedAt).toBe('2026-08-11T10:00:00.000Z');
    expect(current?.documentCount).toBe(1);
    expect(current?.componentCount).toBe(83);
    expect(current?.documents).toEqual([
      {
        id: 'doc-surveys-act',
        officialTitle: 'Surveys Act',
        citation: 'S.N.B. 1976, c. S-17',
        contentHash: 'doc-hash-1',
      },
    ]);
    expect(current?.lastImport?.addedComponents).toBe(83);
  });

  it('indicates matching, differing, and first-import previews without migrating', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const current = buildCurrentOfficialPackageDiagnostics({
      ...seed,
      legalDocuments: [legalDocument],
      importHistory: [history],
    });

    expect(describePreviewDifference(current, null)).toBeNull();
    expect(describePreviewDifference(current, { ...validPreview(), valid: false })).toBeNull();
    expect(describePreviewDifference(current, validPreview())).toBe('matches-current');
    expect(
      describePreviewDifference(current, validPreview({ changedComponents: ['doc::s-1'] })),
    ).toBe('differs-from-current');
    expect(
      describePreviewDifference(current, validPreview({ packageId: 'other-package' })),
    ).toBe('differs-from-current');
    expect(describePreviewDifference(null, validPreview())).toBe('first-import');
  });
});
