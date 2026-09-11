/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import pilotPackageJson from '../../study-content/packages/nb-law-pilot.content-package.json';
import type { NbLawContentPackage } from '../src/content/nbLawTypes';
import { exportStudyData } from '../src/studyExportImport';
import { createNativeStudyStorage } from '../src/studyNativeStorage';
import { applyOfficialContentPackageToSnapshot } from '../src/studyOfficialContent';
import { createSeedStudyData } from '../src/studySeed';
import { migrateStudySnapshot } from '../src/studyStorage';
import type { StudyDataSnapshot } from '../src/studyTypes';
import { createFakeNativeIpc } from './study_native_conformance_support';

// Phase 2H: deterministic native-vs-browser logical snapshot/export contract.
// Representative fixture data (official/legal import, FSRS schedules/attempts,
// drafts, Exam Prep incl. a mock session, AI authoring artifacts) must be
// representable as native records, and native replace/load/export must be
// logically equivalent to the browser contract. The public export
// schema/format is unchanged — both sides go through `exportStudyData`.

const pilotPackage = pilotPackageJson as unknown as NbLawContentPackage;
const EXPORTED_AT = '2026-09-10T12:00:00.000Z';

const clonePackage = (): NbLawContentPackage =>
  JSON.parse(JSON.stringify(pilotPackage)) as NbLawContentPackage;

const buildRepresentativeSnapshot = (): StudyDataSnapshot => {
  const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
  const { snapshot: imported } = applyOfficialContentPackageToSnapshot({
    snapshot: seed,
    contentPackage: clonePackage(),
    importedAt: '2026-08-05T11:00:00.000Z',
  });
  const unitId = imported.units[0].id;
  const promptId = imported.prompts.find((prompt) => prompt.unitId === unitId)?.id ?? 'prompt-1';
  return {
    ...imported,
    exportedAt: EXPORTED_AT,
    attempts: [
      {
        id: 'attempt-fsrs-1',
        unitId,
        promptId,
        phase: 'guided-recall',
        phaseBefore: 'guided-recall',
        responseMode: 'freeText',
        answer: 'A monument placed under the Surveys Act is prima facie evidence.',
        guidedResponses: {},
        coveredConceptIds: [],
        rubricCoverage: [],
        rating: 'good',
        startedAt: '2026-08-10T10:00:00.000Z',
        revealedAt: '2026-08-10T10:05:00.000Z',
        completedAt: '2026-08-10T10:06:00.000Z',
        scheduling: {
          algorithm: 'fsrs',
          schedulingApplied: true,
          rating: 'good',
          reviewedAt: '2026-08-10T10:06:00.000Z',
          reason: 'scheduled-review',
          dueBefore: '2026-08-10T10:00:00.000Z',
          dueAfter: '2026-08-11T10:00:00.000Z',
          configVersion: 1,
        },
      },
    ],
    drafts: [
      {
        id: 'draft-parity-1',
        unitId,
        promptId,
        answer: 'autosaved parity answer',
        startedAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-10T10:02:00.000Z',
      },
    ],
    examPrepUnitProgress: [
      { id: 'epp-1', unitId, status: 'learning', updatedAt: '2026-08-10T10:00:00.000Z' },
    ],
    examPrepRecallProgress: [
      { id: 'epr-1', cardId: 'recall-1', stability: 1.2, updatedAt: '2026-08-10T10:00:00.000Z' },
    ],
    examPrepAttempts: [
      {
        id: 'epa-1',
        taskId: 'recognition-1',
        curriculumContentHash: 'curriculum-hash-1',
        rating: 'good',
        completedAt: '2026-08-10T10:06:00.000Z',
      },
    ],
    examPrepSettings: [{ id: 'exam-prep-settings', dailyTarget: 10 }],
    examPrepMockSessions: [
      {
        id: 'mock-parity-1',
        status: 'submitted',
        curriculumId: 'nb-sit-exam-curriculum-v1',
        curriculumContentHash: 'curriculum-hash-1',
        seed: 'mock-test-seed-0001',
        startedAt: '2026-08-10T09:00:00.000Z',
        updatedAt: '2026-08-10T10:00:00.000Z',
      },
    ],
    aiAuthoringRuns: [{ runId: 'run-parity-1', status: 'prepared' }],
    aiStudyMapProposals: [{ id: 'mp-parity-1', runId: 'run-parity-1', status: 'pending' }],
    aiUnitProposals: [
      {
        proposalId: 'up-parity-1',
        runId: 'run-parity-1',
        reviewStatus: 'pending',
        validationStatus: 'valid',
      },
    ],
  } as unknown as StudyDataSnapshot;
};

describe('native-vs-browser snapshot/export parity', () => {
  it('native replace/load/export is logically equivalent to the browser contract', async () => {
    const source = buildRepresentativeSnapshot();
    // Representative coverage actually present before asserting parity.
    expect(source.legalDocuments.length).toBeGreaterThan(0);
    expect(source.legalComponents.length).toBeGreaterThan(0);
    expect(source.examPrepMockSessions).toHaveLength(1);
    expect(source.aiUnitProposals).toHaveLength(1);

    const canonical = migrateStudySnapshot(source);
    const ipc = createFakeNativeIpc();
    const native = createNativeStudyStorage(ipc);
    await native.replaceAll(source);
    const loaded = await native.loadAll();

    // Per-store logical equivalence (native strips only the recordKey wrapper).
    const stores: (keyof StudyDataSnapshot)[] = [
      'documents',
      'units',
      'prompts',
      'concepts',
      'rubrics',
      'progress',
      'attempts',
      'drafts',
      'legalDocuments',
      'legalComponents',
      'importHistory',
      'aiAuthoringRuns',
      'aiStudyMapProposals',
      'aiUnitProposals',
      'examPrepUnitProgress',
      'examPrepRecallProgress',
      'examPrepAttempts',
      'examPrepSettings',
      'examPrepMockSessions',
    ];
    for (const store of stores) {
      expect(
        (loaded[store] as unknown[]).length,
        `native store ${store} lost records`,
      ).toBe((canonical[store] as unknown[]).length);
    }
    expect(loaded.legalComponents[0]).not.toHaveProperty('recordKey');
    expect(loaded.legalComponents[0]).toEqual(canonical.legalComponents[0]);
    expect(loaded.attempts[0]).toEqual(canonical.attempts[0]);
    expect(loaded.examPrepMockSessions[0]).toEqual(canonical.examPrepMockSessions[0]);

    // Export bytes are identical: same schema, same format, same content.
    expect(exportStudyData(loaded, EXPORTED_AT)).toBe(exportStudyData(canonical, EXPORTED_AT));

    // Deterministic: a fresh load over the same native backend repeats it.
    const reloaded = await createNativeStudyStorage(ipc).loadAll();
    expect(exportStudyData(reloaded, EXPORTED_AT)).toBe(exportStudyData(canonical, EXPORTED_AT));
  });
});
