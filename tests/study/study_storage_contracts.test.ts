import { describe, expect, it } from 'vitest';

import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { buildStudyOpfsPath, sanitizeStudyPathSegment } from '../../src/study/studyOpfs';
import { createSeedStudyData } from '../../src/study/studySeed';
import { migrateStudySnapshot, STUDY_SCHEMA_VERSION } from '../../src/study/studyStorage';

describe('study storage contracts', () => {
  it('migrates partial imported data to the current schema version', () => {
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [],
      attempts: [],
      drafts: [],
    });

    expect(migrated.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(migrated.settings.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(migrated.settings.phaseRules.guidedRecallSuccessDaysToFreeRecall).toBe(2);
  });

  it('round-trips exported study data and preserves attempts and drafts', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const snapshot = {
      ...seed,
      attempts: [
        {
          id: 'attempt-1',
          unitId: seed.units[0].id,
          promptId: seed.prompts[0].id,
          phase: 'guided-recall' as const,
          answer: 'typed answer',
          coveredConceptIds: [seed.concepts[0].id],
          rating: 'good' as const,
          startedAt: '2026-08-01T10:00:00.000Z',
          revealedAt: '2026-08-01T10:05:00.000Z',
          completedAt: '2026-08-01T10:06:00.000Z',
        },
      ],
      drafts: [
        {
          id: 'active-session',
          unitId: seed.units[0].id,
          promptId: seed.prompts[0].id,
          answer: 'autosaved answer',
          startedAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:02:00.000Z',
        },
      ],
    };

    const restored = parseStudyImport(exportStudyData(snapshot, '2026-08-01T12:00:00.000Z'));

    expect(restored.attempts).toHaveLength(1);
    expect(restored.drafts[0]?.answer).toBe('autosaved answer');
  });

  it('generates deterministic OPFS paths for source assets', () => {
    expect(sanitizeStudyPathSegment('Surveys Act / Raw.HTML')).toBe('surveys-act-raw.html');
    expect(
      buildStudyOpfsPath({
        documentId: 'Doc Surveys Act',
        role: 'normalized-markdown',
        fileName: 'Part 1.md',
      }),
    ).toBe('study/documents/doc-surveys-act/normalized-markdown/part-1.md');
  });

  it('keeps raw source file metadata separate from editable study content', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const document = {
      ...seed.documents[0],
      sourceFiles: [
        {
          id: 'asset-1',
          role: 'raw-html' as const,
          label: 'source.html',
          storagePath: 'study/documents/doc-surveys-act/raw-html/source.html',
          mediaType: 'text/html',
          byteLength: 100,
          createdAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    };
    const unit = {
      ...seed.units[0],
      editableSummary: 'learner note',
      referenceAnswer: 'reference answer',
    };

    expect(document.sourceFiles[0]?.storagePath).toContain('/raw-html/');
    expect(unit.editableSummary).not.toBe(unit.referenceAnswer);
    expect(document.summary).not.toBe(unit.editableSummary);
  });
});
