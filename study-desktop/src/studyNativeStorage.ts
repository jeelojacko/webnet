// Study — Tauri native storage adapter (Phase 2E).
//
// Implements the UNCHANGED `StudyStorage` interface over the narrow Tauri IPC
// module (`studyNativeIpc.ts`). All business logic (seeding, migration,
// official-content application, AI approval, CAS wording) reuses the same
// pure TypeScript helpers as the browser adapter — Rust only stores opaque
// JSON records and applies generic batch mutations/conditions inside ONE
// SQLite transaction. No SQL here, no platform checks in components/hooks.
//
// Fail-closed: any native init/IPC error throws to the caller. This adapter
// NEVER falls back to IndexedDB/OPFS.

import {
  applyOfficialContentPackageToSnapshot,
  previewOfficialContentPackage as previewOfficialContentPackageForSnapshot,
} from './studyOfficialContent';
import { createSeedStudyData } from './studySeed';
import {
  NATIVE_SCHEMA_VERSION,
  studyNativeBatch,
  studyNativeGet,
  studyNativeLoadAll,
  studyNativePut,
  studyNativeQueryField,
  studyNativeStatus,
  type NativeStudySnapshot,
} from './studyNativeIpc';
import type { StudyStorage } from './studyStorageTypes';
import { legalComponentFromRecord, legalComponentRecord } from './studyStorage';
import { migrateStudySnapshot } from './studyStorage';
import { applyAiProposalApprovalToSnapshot } from './ai/studyAiApproval';
import type { NbLawContentPackage } from './content/nbLawTypes';
import type {
  ImportedLegalComponent,
  StudyAttempt,
  StudyDataSnapshot,
  StudyDraft,
  StudyProgress,
} from './studyTypes';

// Browser key path per store — must match STORE_KEYS in `studyStorage.ts`.
const NATIVE_KEY_FIELDS: Record<string, string> = {
  progress: 'unitId',
  legalComponents: 'recordKey',
  aiAuthoringRuns: 'runId',
  aiUnitProposals: 'proposalId',
};

const keyOf = (store: string, record: Record<string, unknown>): string => {
  const field = NATIVE_KEY_FIELDS[store] ?? 'id';
  const key = record[field];
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`Native study record in store ${store} is missing key field ${field}.`);
  }
  return key;
};

const putOf = (store: string, record: Record<string, unknown>): { store: string; key: string; payload: unknown } => ({
  store,
  key: keyOf(store, record),
  payload: record,
});

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

const snapshotFromNative = (raw: NativeStudySnapshot): StudyDataSnapshot => {
  const at = (store: string): never[] => (raw[store] ?? []) as never[];
  const legalComponents = (at('legalComponents') as (ImportedLegalComponent & { recordKey?: string })[]).map(
    legalComponentFromRecord,
  );
  return migrateStudySnapshot({
    documents: at('documents') as never,
    units: at('units') as never,
    prompts: at('prompts') as never,
    concepts: at('concepts') as never,
    rubrics: at('rubrics') as never,
    progress: at('progress') as never,
    attempts: at('attempts') as never,
    drafts: at('drafts') as never,
    settings: (at('settings') as unknown[])[0] as never,
    legalDocuments: at('legalDocuments') as never,
    legalComponents: legalComponents as never,
    importHistory: at('importHistory') as never,
    aiAuthoringRuns: at('aiAuthoringRuns') as never,
    aiStudyMapProposals: at('aiStudyMapProposals') as never,
    aiUnitProposals: at('aiUnitProposals') as never,
    examPrepUnitProgress: at('examPrepUnitProgress') as never,
    examPrepRecallProgress: at('examPrepRecallProgress') as never,
    examPrepAttempts: at('examPrepAttempts') as never,
    examPrepSettings: at('examPrepSettings') as never,
    examPrepMockSessions: at('examPrepMockSessions') as never,
  });
};

/** Map raw native records to a migrated snapshot (no seeding side effects). */
export const nativeRecordsToStudySnapshot = (raw: NativeStudySnapshot): StudyDataSnapshot =>
  snapshotFromNative(raw);

/** All authoritative stores (everything but the derived search stores). */
const AUTHORITATIVE_STORES = [
  'documents',
  'units',
  'prompts',
  'concepts',
  'rubrics',
  'progress',
  'attempts',
  'drafts',
  'settings',
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

export const createNativeStudyStorage = (
  ipc: {
    status?: () => Promise<{ schema_version: number }>;
    batch?: typeof studyNativeBatch;
    loadAll?: typeof studyNativeLoadAll;
    get?: typeof studyNativeGet;
    put?: typeof studyNativePut;
    queryField?: typeof studyNativeQueryField;
  } = {},
): StudyStorage => {
  const statusFn = ipc.status ?? studyNativeStatus;
  const batchFn = ipc.batch ?? studyNativeBatch;
  const loadAllFn = ipc.loadAll ?? studyNativeLoadAll;
  const getFn = ipc.get ?? studyNativeGet;
  const putFn = ipc.put ?? studyNativePut;
  const queryFieldFn = ipc.queryField ?? studyNativeQueryField;

  let ready: Promise<void> | null = null;
  const ensureNativeReady = (): Promise<void> => {
    if (!ready) {
      ready = statusFn().then((status) => {
        if (status.schema_version !== NATIVE_SCHEMA_VERSION) {
          throw new Error(
            `Unsupported native study schema version: ${status.schema_version}.`,
          );
        }
      });
      // Do not cache rejections: a transient IPC failure must not permanently
      // poison the adapter — but it NEVER falls back to another backend.
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };

  const loadAuthoritativeSnapshot = async (): Promise<StudyDataSnapshot> => {
    await ensureNativeReady();
    return snapshotFromNative(await loadAllFn());
  };

  return {
    async loadAll() {
      await ensureNativeReady();
      const raw = await loadAllFn();
      const settings = (raw['settings'] ?? []) as unknown[];
      const documents = (raw['documents'] ?? []) as unknown[];
      if (settings.length === 0 && documents.length === 0) {
        const seed = createSeedStudyData(new Date().toISOString());
        await batchFn({
          puts: [
            ...seed.documents.map((r) => putOf('documents', asRecord(r))),
            ...seed.units.map((r) => putOf('units', asRecord(r))),
            ...seed.prompts.map((r) => putOf('prompts', asRecord(r))),
            ...seed.concepts.map((r) => putOf('concepts', asRecord(r))),
            ...seed.rubrics.map((r) => putOf('rubrics', asRecord(r))),
            ...seed.progress.map((r) => putOf('progress', asRecord(r))),
            putOf('settings', asRecord(seed.settings)),
          ],
        });
        return migrateStudySnapshot({
          documents: seed.documents as never,
          units: seed.units as never,
          prompts: seed.prompts as never,
          concepts: seed.concepts as never,
          rubrics: seed.rubrics as never,
          progress: seed.progress as never,
          attempts: [],
          drafts: [],
          settings: seed.settings as never,
          legalDocuments: [],
          legalComponents: [],
          importHistory: [],
          aiAuthoringRuns: [],
          aiStudyMapProposals: [],
          aiUnitProposals: [],
          examPrepUnitProgress: [],
          examPrepRecallProgress: [],
          examPrepAttempts: [],
          examPrepSettings: [],
          examPrepMockSessions: [],
        });
      }
      return snapshotFromNative(raw);
    },
    async getLegalComponent(documentId, sourceKey) {
      await ensureNativeReady();
      const record = await getFn('legalComponents', `${documentId}::${sourceKey}`);
      return record ? legalComponentFromRecord(asRecord(record) as ImportedLegalComponent & { recordKey?: string }) : null;
    },
    async getLegalComponentsByDocument(documentId) {
      await ensureNativeReady();
      // Native equivalent of the `byDocumentId` index: one generic filtered
      // read, no full-store load on the caller side.
      const records = await queryFieldFn('legalComponents', 'documentId', documentId);
      return records.map((record) =>
        legalComponentFromRecord(asRecord(record) as ImportedLegalComponent & { recordKey?: string }),
      );
    },
    async getLegalComponentsBySourceKeys(documentId, sourceKeys) {
      await ensureNativeReady();
      if (sourceKeys.length === 0) return [];
      const records = await Promise.all(
        sourceKeys.map((sourceKey) => getFn('legalComponents', `${documentId}::${sourceKey}`)),
      );
      return records
        .filter((record): record is NonNullable<typeof record> => record !== null && record !== undefined)
        .map((record) =>
          legalComponentFromRecord(asRecord(record) as ImportedLegalComponent & { recordKey?: string }),
        );
    },
    async getLegalDocumentComponentSummary(documentId) {
      const components = await this.getLegalComponentsByDocument(documentId);
      return {
        documentId,
        componentCount: components.length,
        sectionCount: components.filter((component) => component.componentType === 'section').length,
        subsectionCount: components.reduce(
          (sum, component) => sum + (component.subsections?.length ?? 0),
          0,
        ),
        scheduleCount: components.filter((component) => component.componentType === 'schedule').length,
        formCount: components.filter((component) => component.componentType === 'form').length,
        referenceOnlyFormCount: components.filter(
          (component) =>
            component.componentType === 'form' && component.extractionStatus === 'reference-only',
        ).length,
      };
    },
    async getLegalComponentCount(documentId) {
      return (await this.getLegalComponentsByDocument(documentId)).length;
    },
    async previewOfficialContentPackage(contentPackage: NbLawContentPackage) {
      const snapshot = await loadAuthoritativeSnapshot();
      return previewOfficialContentPackageForSnapshot(snapshot, contentPackage);
    },
    async saveDocument(document) {
      await ensureNativeReady();
      await putFn({ store: 'documents', key: keyOf('documents', asRecord(document)), payload: document });
    },
    async saveUnit(unit) {
      await ensureNativeReady();
      await putFn({ store: 'units', key: keyOf('units', asRecord(unit)), payload: unit });
    },
    async savePrompt(prompt) {
      await ensureNativeReady();
      await putFn({ store: 'prompts', key: keyOf('prompts', asRecord(prompt)), payload: prompt });
    },
    async replaceUnitConcepts(unitId, concepts) {
      await ensureNativeReady();
      const existing = await queryFieldFn('concepts', 'unitId', unitId);
      await batchFn({
        deletes: existing.map((record) => ({
          store: 'concepts',
          key: keyOf('concepts', asRecord(record)),
        })),
        puts: concepts.map((concept) => putOf('concepts', asRecord(concept))),
      });
    },
    async replaceUnitRubrics(unitId, rubrics) {
      await ensureNativeReady();
      const existing = await queryFieldFn('rubrics', 'unitId', unitId);
      await batchFn({
        deletes: existing.map((record) => ({
          store: 'rubrics',
          key: keyOf('rubrics', asRecord(record)),
        })),
        puts: rubrics.map((rubric) => putOf('rubrics', asRecord(rubric))),
      });
    },
    async saveProgress(progress: StudyProgress) {
      await ensureNativeReady();
      await putFn({ store: 'progress', key: keyOf('progress', asRecord(progress)), payload: progress });
    },
    async saveAttempt(attempt: StudyAttempt) {
      await ensureNativeReady();
      await putFn({ store: 'attempts', key: keyOf('attempts', asRecord(attempt)), payload: attempt });
    },
    async saveRatedAttempt({ attempt, progress, draftId, expectedProgressUpdatedAt }) {
      await ensureNativeReady();
      await batchFn({
        puts: [putOf('attempts', asRecord(attempt)), putOf('progress', asRecord(progress))],
        deletes: [{ store: 'drafts', key: draftId }],
        conditions:
          expectedProgressUpdatedAt !== undefined
            ? [
                {
                  store: 'progress',
                  key: (progress as StudyProgress).unitId,
                  expected: { kind: 'updated_at_equals', updated_at: expectedProgressUpdatedAt },
                  message: 'Study progress changed before the rating could be saved.',
                },
              ]
            : [],
      });
    },
    async saveSchedulingUndo({ attempt, progress, expectedProgressUpdatedAt }) {
      await ensureNativeReady();
      await batchFn({
        puts: [putOf('attempts', asRecord(attempt)), putOf('progress', asRecord(progress))],
        conditions:
          expectedProgressUpdatedAt !== undefined
            ? [
                {
                  store: 'progress',
                  key: (progress as StudyProgress).unitId,
                  expected: { kind: 'updated_at_equals', updated_at: expectedProgressUpdatedAt },
                  message: 'Study progress changed before the rating could be undone.',
                },
              ]
            : [],
      });
    },
    async saveAttemptProgress({ attempt, progress, expectedProgressUpdatedAt }) {
      await ensureNativeReady();
      await batchFn({
        puts: [putOf('attempts', asRecord(attempt)), putOf('progress', asRecord(progress))],
        conditions:
          expectedProgressUpdatedAt !== undefined
            ? [
                {
                  store: 'progress',
                  key: (progress as StudyProgress).unitId,
                  expected: { kind: 'updated_at_equals', updated_at: expectedProgressUpdatedAt },
                  message: 'Study progress changed before the practice rating could be saved.',
                },
              ]
            : [],
      });
    },
    async saveDraft(draft: StudyDraft) {
      await ensureNativeReady();
      await putFn({ store: 'drafts', key: keyOf('drafts', asRecord(draft)), payload: draft });
    },
    async clearDraft(draftId) {
      await ensureNativeReady();
      await batchFn({ deletes: [{ store: 'drafts', key: draftId }] });
    },
    async deleteUnitCascade(unitId) {
      await ensureNativeReady();
      const [prompts, concepts, rubrics, attempts, drafts] = await Promise.all([
        queryFieldFn('prompts', 'unitId', unitId),
        queryFieldFn('concepts', 'unitId', unitId),
        queryFieldFn('rubrics', 'unitId', unitId),
        queryFieldFn('attempts', 'unitId', unitId),
        queryFieldFn('drafts', 'unitId', unitId),
      ]);
      // ONE native transaction for the whole cascade (mirrors the browser
      // multi-store transaction).
      await batchFn({
        deletes: [
          { store: 'units', key: unitId },
          { store: 'progress', key: unitId },
          ...prompts.map((record) => ({ store: 'prompts', key: keyOf('prompts', asRecord(record)) })),
          ...concepts.map((record) => ({ store: 'concepts', key: keyOf('concepts', asRecord(record)) })),
          ...rubrics.map((record) => ({ store: 'rubrics', key: keyOf('rubrics', asRecord(record)) })),
          ...attempts.map((record) => ({ store: 'attempts', key: keyOf('attempts', asRecord(record)) })),
          ...drafts.map((record) => ({ store: 'drafts', key: keyOf('drafts', asRecord(record)) })),
        ],
      });
    },
    async saveSettings(settings) {
      await ensureNativeReady();
      await putFn({ store: 'settings', key: keyOf('settings', asRecord(settings)), payload: settings });
    },
    async saveExamPrepUnitProgress(record) {
      await ensureNativeReady();
      await putFn({
        store: 'examPrepUnitProgress',
        key: keyOf('examPrepUnitProgress', asRecord(record)),
        payload: record,
      });
    },
    async deleteExamPrepUnitProgress(recordId) {
      await ensureNativeReady();
      await batchFn({ deletes: [{ store: 'examPrepUnitProgress', key: recordId }] });
    },
    async saveExamPrepRecallRating({ attempt, progress, expectation }) {
      await ensureNativeReady();
      await batchFn({
        puts: [
          putOf('examPrepRecallProgress', asRecord(progress)),
          putOf('examPrepAttempts', asRecord(attempt)),
        ],
        conditions: [
          {
            store: 'examPrepRecallProgress',
            key: (progress as { id: string }).id,
            expected:
              expectation.kind === 'absent'
                ? { kind: 'absent' }
                : { kind: 'present_with_updated_at', updated_at: expectation.updatedAt },
            message: 'Exam Prep recall progress changed before the rating could be saved.',
          },
        ],
      });
    },
    async saveExamPrepAttempt(attempt) {
      await ensureNativeReady();
      // Immutable `add` semantics: the key must not already exist.
      const key = keyOf('examPrepAttempts', asRecord(attempt));
      await batchFn({
        puts: [{ store: 'examPrepAttempts', key, payload: attempt }],
        conditions: [
          {
            store: 'examPrepAttempts',
            key,
            expected: { kind: 'absent' },
            message: 'Exam Prep attempt already exists.',
          },
        ],
      });
    },
    async saveExamPrepSettings(record) {
      await ensureNativeReady();
      await putFn({
        store: 'examPrepSettings',
        key: keyOf('examPrepSettings', asRecord(record)),
        payload: record,
      });
    },
    async saveExamPrepMockSession({ session, expectation }) {
      await ensureNativeReady();
      await batchFn({
        puts: [putOf('examPrepMockSessions', asRecord(session))],
        conditions: [
          {
            store: 'examPrepMockSessions',
            key: (session as { id: string }).id,
            expected:
              expectation.kind === 'absent'
                ? { kind: 'absent' }
                : { kind: 'present_with_updated_at', updated_at: expectation.updatedAt },
            message:
              'This mock session changed in another tab. Reload to resume the latest saved version.',
          },
        ],
        // Transactional one-active-current-mock creation lock, checked in the
        // same native transaction as the write (mirrors the browser guard).
        uniqueness_guard:
          expectation.kind === 'absent' && (session as { status: string }).status === 'in_progress'
            ? {
                store: 'examPrepMockSessions',
                except_key: (session as { id: string }).id,
                active_status: 'in_progress',
                field_equals: {
                  curriculumId: (session as { curriculumId: string }).curriculumId,
                  curriculumContentHash: (session as { curriculumContentHash: string })
                    .curriculumContentHash,
                },
                message:
                  'A mock exam is already in progress. Submit or abandon it before starting another.',
              }
            : undefined,
      });
    },
    async saveAiAuthoringRun(run) {
      await ensureNativeReady();
      await putFn({ store: 'aiAuthoringRuns', key: keyOf('aiAuthoringRuns', asRecord(run)), payload: run });
    },
    async saveAiStudyMapProposal(proposal) {
      await ensureNativeReady();
      await putFn({
        store: 'aiStudyMapProposals',
        key: keyOf('aiStudyMapProposals', asRecord(proposal)),
        payload: proposal,
      });
    },
    async saveAiUnitProposal(proposal) {
      await ensureNativeReady();
      await putFn({
        store: 'aiUnitProposals',
        key: keyOf('aiUnitProposals', asRecord(proposal)),
        payload: proposal,
      });
    },
    async replaceAiAuthoringArtifacts({ runs, mapProposals, unitProposals }) {
      await ensureNativeReady();
      await batchFn({
        puts: [
          ...(runs ?? []).map((run) => putOf('aiAuthoringRuns', asRecord(run))),
          ...(mapProposals ?? []).map((proposal) => putOf('aiStudyMapProposals', asRecord(proposal))),
          ...(unitProposals ?? []).map((proposal) => putOf('aiUnitProposals', asRecord(proposal))),
        ],
      });
    },
    async approveAiUnitProposal({ proposalId, sourceComponents }) {
      const current = await loadAuthoritativeSnapshot();
      const proposal = current.aiUnitProposals.find((entry) => entry.proposalId === proposalId);
      if (!proposal) throw new Error(`AI unit proposal not found: ${proposalId}`);
      if (proposal.reviewStatus === 'approved') {
        throw new Error(`AI unit proposal is already approved: ${proposalId}`);
      }
      if (proposal.validationStatus === 'invalid') {
        throw new Error(`AI unit proposal is invalid and cannot be approved: ${proposalId}`);
      }
      const snapshot = applyAiProposalApprovalToSnapshot({
        snapshot: current,
        proposal,
        sourceComponents,
      });
      const approvedUnit = snapshot.units.at(-1);
      const approvedProgress = snapshot.progress.at(-1);
      if (!approvedUnit || !approvedProgress) throw new Error('AI proposal approval failed.');
      // ONE native transaction for the whole approval (mirrors the browser
      // multi-store transaction).
      await batchFn({
        puts: [
          putOf('units', asRecord(approvedUnit)),
          ...snapshot.prompts
            .filter((prompt) => prompt.unitId === approvedUnit.id)
            .map((prompt) => putOf('prompts', asRecord(prompt))),
          ...snapshot.concepts
            .filter((concept) => concept.unitId === approvedUnit.id)
            .map((concept) => putOf('concepts', asRecord(concept))),
          ...snapshot.rubrics
            .filter((rubric) => rubric.unitId === approvedUnit.id)
            .map((rubric) => putOf('rubrics', asRecord(rubric))),
          putOf('progress', asRecord(approvedProgress)),
          putOf(
            'aiUnitProposals',
            asRecord(
              snapshot.aiUnitProposals.find((entry) => entry.proposalId === proposalId) ?? proposal,
            ),
          ),
        ],
      });
      return snapshot;
    },
    async replaceAll(snapshot) {
      await ensureNativeReady();
      const next = migrateStudySnapshot(snapshot);
      await batchFn({
        clears: AUTHORITATIVE_STORES,
        puts: [
          ...next.documents.map((r) => putOf('documents', asRecord(r))),
          ...next.units.map((r) => putOf('units', asRecord(r))),
          ...next.prompts.map((r) => putOf('prompts', asRecord(r))),
          ...next.concepts.map((r) => putOf('concepts', asRecord(r))),
          ...next.rubrics.map((r) => putOf('rubrics', asRecord(r))),
          ...next.progress.map((r) => putOf('progress', asRecord(r))),
          ...next.attempts.map((r) => putOf('attempts', asRecord(r))),
          ...next.drafts.map((r) => putOf('drafts', asRecord(r))),
          putOf('settings', asRecord(next.settings)),
          ...next.legalDocuments.map((r) => putOf('legalDocuments', asRecord(r))),
          ...next.legalComponents.map((c) => putOf('legalComponents', asRecord(legalComponentRecord(c)))),
          ...next.importHistory.map((r) => putOf('importHistory', asRecord(r))),
          ...next.aiAuthoringRuns.map((r) => putOf('aiAuthoringRuns', asRecord(r))),
          ...next.aiStudyMapProposals.map((r) => putOf('aiStudyMapProposals', asRecord(r))),
          ...next.aiUnitProposals.map((r) => putOf('aiUnitProposals', asRecord(r))),
          ...next.examPrepUnitProgress.map((r) => putOf('examPrepUnitProgress', asRecord(r))),
          ...next.examPrepRecallProgress.map((r) => putOf('examPrepRecallProgress', asRecord(r))),
          ...next.examPrepAttempts.map((r) => putOf('examPrepAttempts', asRecord(r))),
          ...next.examPrepSettings.map((r) => putOf('examPrepSettings', asRecord(r))),
          ...next.examPrepMockSessions.map((r) => putOf('examPrepMockSessions', asRecord(r))),
        ],
      });
    },
    async importOfficialContentPackage(contentPackage) {
      const current = await loadAuthoritativeSnapshot();
      const { snapshot } = applyOfficialContentPackageToSnapshot({
        snapshot: current,
        contentPackage,
      });
      // ONE native transaction for the whole import (mirrors the browser
      // multi-store transaction, including derived-search-store clearing).
      await batchFn({
        clears: [
          'documents',
          'units',
          'legalDocuments',
          'legalComponents',
          'importHistory',
          'searchIndexMetadata',
          'searchIndexArtifacts',
        ],
        puts: [
          ...snapshot.documents.map((r) => putOf('documents', asRecord(r))),
          ...snapshot.units.map((r) => putOf('units', asRecord(r))),
          ...snapshot.legalDocuments.map((r) => putOf('legalDocuments', asRecord(r))),
          ...snapshot.legalComponents.map((c) => putOf('legalComponents', asRecord(legalComponentRecord(c)))),
          ...snapshot.importHistory.map((r) => putOf('importHistory', asRecord(r))),
        ],
      });
      return snapshot;
    },
  };
};
