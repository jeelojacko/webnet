import { describe, expect, it } from 'vitest';

import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { createStudyFsrsScheduler } from '../../src/study/fsrs/studyFsrs';
import { isFsrsReplayableAttempt } from '../../src/study/fsrs/studyFsrsMigration';
import { buildStudyOpfsPath, sanitizeStudyPathSegment } from '../../src/study/studyOpfs';
import { createSeedStudyData } from '../../src/study/studySeed';
import { migrateStudySnapshot, shouldSeedStudyData, STUDY_SCHEMA_VERSION } from '../../src/study/studyStorage';

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
    expect(migrated.settings.fsrsConfig?.schemaVersion).toBe(1);
    expect(migrated.settings.fsrsConfig?.configVersion).toBe(1);
  });

  it('migrates legacy progress to uninitialized FSRS schedules with legacy due dates', () => {
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [
        {
          unitId: 'unit-1',
          phase: 'guided-recall',
          dueAt: '2026-08-11T10:00:00.000Z',
          lastStudiedAt: null,
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 0,
          createdAt: '2026-08-10T10:00:00.000Z',
          updatedAt: '2026-08-10T10:00:00.000Z',
        },
      ],
      attempts: [],
      drafts: [],
    });

    expect(migrated.progress[0]?.scheduling).toMatchObject({
      schemaVersion: 1,
      algorithm: 'fsrs',
      initialized: false,
      legacyDueAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('preserves valid FSRS card schedules and sanitizes corrupt ones during migration', () => {
    const scheduler = createStudyFsrsScheduler({ ...createSeedStudyData().settings.fsrsConfig!.userSettings, enableFuzz: false });
    const now = new Date('2026-08-10T10:00:00.000Z');
    const result = scheduler.applyStudyRating(
      {
        schemaVersion: 1,
        algorithm: 'fsrs',
        initialized: false,
        configVersion: 1,
      },
      'good',
      now,
    );
    const migrated = migrateStudySnapshot({
      documents: [],
      units: [],
      prompts: [],
      concepts: [],
      progress: [
        {
          unitId: 'valid',
          phase: 'guided-recall',
          scheduling: {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: true,
            card: result.card,
            initializedAt: now.toISOString(),
            lastScheduledAt: now.toISOString(),
            configVersion: 1,
          },
          dueAt: '2026-08-11T10:00:00.000Z',
          lastStudiedAt: now.toISOString(),
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          unitId: 'corrupt',
          phase: 'guided-recall',
          scheduling: {
            schemaVersion: 1,
            algorithm: 'fsrs',
            initialized: true,
            card: { due: 'not-a-date' } as never,
            configVersion: 1,
          },
          dueAt: '2026-08-12T10:00:00.000Z',
          lastStudiedAt: null,
          successfulGuidedRecallDays: [],
          successfulFreeRecallDays: [],
          applicationSuccessCount: 0,
          reviewCount: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      attempts: [],
      drafts: [],
    });

    expect(migrated.progress.find((entry) => entry.unitId === 'valid')?.scheduling?.card).toEqual(result.card);
    expect(migrated.progress.find((entry) => entry.unitId === 'corrupt')?.scheduling).toMatchObject({
      initialized: false,
      legacyDueAt: '2026-08-12T10:00:00.000Z',
    });
  });

  it('does not auto-seed after an intentional clean-slate reset leaves settings behind', () => {
    expect(shouldSeedStudyData({ documentCount: 0, settingsCount: 0 })).toBe(true);
    expect(shouldSeedStudyData({ documentCount: 0, settingsCount: 1 })).toBe(false);
    expect(shouldSeedStudyData({ documentCount: 5, settingsCount: 0 })).toBe(false);
  });

  it('migrates existing units and concepts to Phase 2D fields', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const legacy = {
      ...seed,
      units: [
        {
          ...seed.units[0],
          sourceMode: undefined,
          tags: undefined,
        },
        {
          ...seed.units[1],
          id: 'legacy-unlinked',
          documentIds: [],
          sectionRefs: [],
          sourceMode: undefined,
        },
      ],
      concepts: [
        {
          ...seed.concepts[0],
          origin: undefined,
          order: undefined,
        },
      ],
    } as unknown as Parameters<typeof migrateStudySnapshot>[0];

    const migrated = migrateStudySnapshot(legacy);

    expect(migrated.units.find((unit) => unit.id === seed.units[0].id)?.sourceMode).toBe('official');
    expect(migrated.units.find((unit) => unit.id === 'legacy-unlinked')?.sourceMode).toBe('custom');
    expect(migrated.units[0].tags).toEqual([]);
    expect(migrated.concepts[0].origin).toBe('manual');
    expect(migrated.concepts[0].order).toBe(0);
    expect(migrated.rubrics[0]).toMatchObject({
      unitId: seed.concepts[0].unitId,
      category: 'custom',
      prompt: seed.concepts[0].label,
      referenceAnswer: '',
    });
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
      rubrics: [
        {
          id: 'rubric-1',
          unitId: seed.units[0].id,
          category: 'purpose' as const,
          prompt: 'What is the purpose?',
          referenceAnswer: 'Reference answer.',
          required: true,
          origin: 'manual' as const,
          order: 0,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    };

    const restored = parseStudyImport(exportStudyData(snapshot, '2026-08-01T12:00:00.000Z'));

    expect(restored.attempts).toHaveLength(1);
    expect(restored.drafts[0]?.answer).toBe('autosaved answer');
    expect(restored.rubrics[0]?.prompt).toBe('What is the purpose?');
    expect(restored.settings.fsrsConfig?.resolvedParameters).toBeTruthy();
    expect(restored.progress[0]?.scheduling?.algorithm).toBe('fsrs');
  });

  it('identifies only counted FSRS review attempts as replayable', () => {
    const counted = {
      scheduling: {
        algorithm: 'fsrs' as const,
        schedulingApplied: true,
        rating: 'good' as const,
        reviewedAt: '2026-08-10T10:00:00.000Z',
        reason: 'scheduled-review' as const,
      },
    };

    expect(isFsrsReplayableAttempt(counted)).toBe(true);
    expect(isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, schedulingApplied: false } })).toBe(false);
    expect(isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reason: 'preview' } })).toBe(false);
    expect(isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reason: 'source-review' } })).toBe(false);
    expect(isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, reviewedAt: 'bad-date' } })).toBe(false);
    expect(isFsrsReplayableAttempt({ scheduling: { ...counted.scheduling, undoneAt: '2026-08-10T11:00:00.000Z' } })).toBe(false);
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
