// Phase 2G: Tauri native search has no authoritative IndexedDB dependency.
// The worker builds/restores MiniSearch indexes purely from main-thread-
// supplied records; derived metadata/artifacts travel over native IPC.
// Browser behavior (IndexedDB path, MiniSearch semantics) is unchanged.

import { describe, expect, it, vi } from 'vitest';

import {
  applyNativeSearchBootstrap,
  applyNativeStudyUpdate,
  createStudySearchIndexState,
} from '../src/search/studySearchIndexCore';
import {
  MINISEARCH_VERSION,
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_INDEX_VERSION,
} from '../src/search/studySearchMiniSearch';
import type {
  StudySearchNativeBootstrapMessage,
  StudySearchWorkerResponse,
} from '../src/search/studySearchMessages';
import { NATIVE_SEARCH_DB_VERSION } from '../src/studySearchNativeBridge';
import {
  loadNativeSearchBootstrap,
  loadNativeStudyUpdate,
  persistNativeSearchArtifacts,
  readNativeSearchDiagnostics,
  type NativeSearchIpc,
} from '../src/studySearchNativeBridge';
import { StudySearchService } from '../src/search/studySearchService';
import { createSeedStudyData } from '../src/studySeed';
import { legalComponentRecord } from '../src/studyStorage';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyDataSnapshot,
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

const legalComponent: ImportedLegalComponent = {
  documentId: legalDocument.id,
  id: 'section-83',
  sourceKey: 'section-83',
  componentType: 'section',
  label: '83',
  heading: 'Integrated survey area',
  text: 'A coordinate monument may be used for survey control in an integrated survey area.',
  contentHash: 'component-hash-83',
  extractionStatus: 'complete',
};

const seedSnapshot = (): StudyDataSnapshot => ({
  ...createSeedStudyData('2026-08-01T10:00:00.000Z'),
  legalDocuments: [legalDocument],
  legalComponents: [legalComponent],
});

const bootstrapMessage = (
  snapshot: StudyDataSnapshot,
  overrides: Partial<StudySearchNativeBootstrapMessage> = {},
): StudySearchNativeBootstrapMessage => ({
  type: 'native-bootstrap',
  requestId: 'req-1',
  forceRebuild: false,
  expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
  snapshot,
  legalDocuments: snapshot.legalDocuments,
  legalComponents: snapshot.legalComponents,
  cachedMetadata: null,
  cachedOfficialSerialized: null,
  cachedStudySerialized: null,
  ...overrides,
});

/** Fail the test if anything touches IndexedDB during the callback. */
const assertNoIndexedDbUse = async (fn: () => Promise<void>): Promise<void> => {
  const holder = globalThis as Record<string, unknown>;
  const previous = holder['indexedDB'];
  holder['indexedDB'] = {
    open: () => {
      throw new Error('IndexedDB must not be opened on the native search path.');
    },
  };
 try {
    await fn();
  } finally {
    if (previous === undefined) delete holder['indexedDB'];
    else holder['indexedDB'] = previous;
  }
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

describe('native search worker bootstrap', () => {
  it('builds both indexes from supplied records with no IndexedDB open', async () => {
    const snapshot = seedSnapshot();
    const state = createStudySearchIndexState();
    const posted: StudySearchWorkerResponse[] = [];
    await assertNoIndexedDbUse(() =>
      applyNativeSearchBootstrap({ state, message: bootstrapMessage(snapshot), post: (m) => posted.push(m) }),
    );

    const persist = posted.filter((m) => m.type === 'native-persist');
    const ready = posted.filter((m) => m.type === 'ready');
    expect(persist).toHaveLength(1);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      requestId: 'req-1',
      status: { ready: true, phase: 'ready' },
    });
    const payload = persist[0];
    expect(payload.type).toBe('native-persist');
    if (payload.type !== 'native-persist') throw new Error('unreachable');
    expect(payload.metadata).toMatchObject({
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      dbVersion: NATIVE_SEARCH_DB_VERSION,
      indexVersion: SEARCH_INDEX_VERSION,
      engine: 'minisearch',
      engineVersion: MINISEARCH_VERSION,
    });
    expect(payload.officialSerialized).toContain('provision:doc-surveys-act:section-83');
    expect(payload.studySerialized).toContain(`unit:${snapshot.units[0].id}`);
    expect(state.officialIndex).not.toBeNull();
    expect(state.studyIndex).not.toBeNull();
  });

  it('restores valid cached artifacts silently (no rebuild, no persist)', async () => {
    const snapshot = seedSnapshot();
    const first: StudySearchWorkerResponse[] = [];
    const firstState = createStudySearchIndexState();
    await applyNativeSearchBootstrap({
      state: firstState,
      message: bootstrapMessage(snapshot),
      post: (m) => first.push(m),
    });
    const built = first.find((m) => m.type === 'native-persist');
    expect(built?.type).toBe('native-persist');
    if (built?.type !== 'native-persist') throw new Error('unreachable');

    const second: StudySearchWorkerResponse[] = [];
    const secondState = createStudySearchIndexState();
    await assertNoIndexedDbUse(() =>
      applyNativeSearchBootstrap({
        state: secondState,
        message: bootstrapMessage(snapshot, {
          requestId: 'req-2',
          cachedMetadata: built.metadata,
          cachedOfficialSerialized: built.officialSerialized,
          cachedStudySerialized: built.studySerialized,
        }),
        post: (m) => second.push(m),
      }),
    );
    expect(second.filter((m) => m.type === 'native-persist')).toHaveLength(0);
    expect(second.filter((m) => m.type === 'ready')).toHaveLength(1);
    expect(secondState.officialIndex).not.toBeNull();
    expect(secondState.studyIndex).not.toBeNull();
  });

  it('rebuilds when the corpus hash drifts and stamps the fresh hash', async () => {
    const snapshot = seedSnapshot();
    const first: StudySearchWorkerResponse[] = [];
    await applyNativeSearchBootstrap({
      state: createStudySearchIndexState(),
      message: bootstrapMessage(snapshot),
      post: (m) => first.push(m),
    });
    const built = first.find((m) => m.type === 'native-persist');
    if (built?.type !== 'native-persist') throw new Error('unreachable');

    const renamed: ImportedLegalDocument = { ...legalDocument, contentHash: 'doc-hash-2' };
    const second: StudySearchWorkerResponse[] = [];
    await applyNativeSearchBootstrap({
      state: createStudySearchIndexState(),
      message: bootstrapMessage(snapshot, {
        requestId: 'req-3',
        legalDocuments: [renamed],
        cachedMetadata: built.metadata,
        cachedOfficialSerialized: built.officialSerialized,
        cachedStudySerialized: built.studySerialized,
      }),
      post: (m) => second.push(m),
    });
    const rebuilt = second.find((m) => m.type === 'native-persist');
    expect(rebuilt?.type).toBe('native-persist');
    if (rebuilt?.type !== 'native-persist') throw new Error('unreachable');
    expect(rebuilt.metadata.officialIndex.corpusContentHash).not.toBe(
      built.metadata.officialIndex.corpusContentHash,
    );
  });

  it('refreshes only the study index on study updates and fails closed without bootstrap', async () => {
    const snapshot = seedSnapshot();
    const state = createStudySearchIndexState();
    const built: StudySearchWorkerResponse[] = [];
    await applyNativeSearchBootstrap({
      state,
      message: bootstrapMessage(snapshot),
      post: (m) => built.push(m),
    });
    const persist = built.find((m) => m.type === 'native-persist');
    if (persist?.type !== 'native-persist') throw new Error('unreachable');

    const renamed = {
      ...snapshot,
      units: [{ ...snapshot.units[0], title: 'Renamed unit', updatedAt: '2026-08-12T10:00:00.000Z' }],
    };
    const updated: StudySearchWorkerResponse[] = [];
    await assertNoIndexedDbUse(() =>
      applyNativeStudyUpdate({
        state,
        message: {
          type: 'native-study-update',
          requestId: 'req-4',
          expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
          snapshot: renamed,
          cachedMetadata: persist.metadata,
        },
        post: (m) => updated.push(m),
      }),
    );
    const studyPersist = updated.find((m) => m.type === 'native-persist');
    expect(studyPersist?.type).toBe('native-persist');
    if (studyPersist?.type !== 'native-persist') throw new Error('unreachable');
    // Study-only refresh keeps the stored official artifact untouched.
    expect(studyPersist.officialSerialized).toBeNull();
    expect(studyPersist.studySerialized).toContain('Renamed unit');
    expect(studyPersist.metadata.officialIndex).toEqual(persist.metadata.officialIndex);

    await expect(
      applyNativeStudyUpdate({
        state: createStudySearchIndexState(),
        message: {
          type: 'native-study-update',
          requestId: 'req-5',
          expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
          snapshot,
          cachedMetadata: persist.metadata,
        },
        post: () => undefined,
      }),
    ).rejects.toThrow('not bootstrapped');
  });
});

const nativeRawAll = (snapshot: StudyDataSnapshot): Record<string, unknown[]> => ({
  documents: snapshot.documents,
  units: snapshot.units,
  prompts: snapshot.prompts,
  concepts: snapshot.concepts,
  rubrics: snapshot.rubrics,
  progress: snapshot.progress,
  attempts: snapshot.attempts,
  drafts: snapshot.drafts,
  settings: [snapshot.settings],
  legalDocuments: snapshot.legalDocuments,
  legalComponents: snapshot.legalComponents.map((c) => legalComponentRecord(c)),
  importHistory: snapshot.importHistory,
  aiAuthoringRuns: [],
  aiStudyMapProposals: [],
  aiUnitProposals: [],
  examPrepUnitProgress: [],
  examPrepRecallProgress: [],
  examPrepAttempts: [],
  examPrepSettings: [],
  examPrepMockSessions: [],
});

const mockIpc = (raw: Record<string, unknown[]>): NativeSearchIpc & { batches: unknown[] } => {
  const store = new Map<string, unknown>();
  const batches: unknown[] = [];
  return {
    batches,
    status: async () => ({ schema_version: NATIVE_SEARCH_DB_VERSION }),
    loadAll: async () => raw,
    get: async (s, key) => store.get(`${s}::${key}`) ?? null,
    batch: async (batch) => {
      batches.push(batch);
      for (const put of batch.puts ?? []) store.set(`${put.store}::${put.key}`, put.payload);
    },
  };
};

describe('native search bridge', () => {
  it('maps native records to a snapshot, round-trips artifacts, and reports diagnostics', async () => {
    const snapshot = seedSnapshot();
    const ipc = mockIpc(nativeRawAll(snapshot));

    const bootstrap = await loadNativeSearchBootstrap(ipc);
    expect(bootstrap.legalDocuments).toHaveLength(1);
    // recordKey storage detail is stripped back to domain components.
    expect(bootstrap.legalComponents[0]).not.toHaveProperty('recordKey');
    expect(bootstrap.legalComponents[0]).toMatchObject({ documentId: legalDocument.id });
    expect(bootstrap.cachedMetadata).toBeNull();

    // Persist a built cache, then prove it survives through the native path.
    const state = createStudySearchIndexState();
    const posted: StudySearchWorkerResponse[] = [];
    await applyNativeSearchBootstrap({
      state,
      message: bootstrapMessage(bootstrap.snapshot, {
        legalDocuments: bootstrap.legalDocuments,
        legalComponents: bootstrap.legalComponents,
        cachedMetadata: bootstrap.cachedMetadata,
        cachedOfficialSerialized: bootstrap.cachedOfficialSerialized,
        cachedStudySerialized: bootstrap.cachedStudySerialized,
      }),
      post: (m) => posted.push(m),
    });
    const persist = posted.find((m) => m.type === 'native-persist');
    if (persist?.type !== 'native-persist') throw new Error('unreachable');
    await persistNativeSearchArtifacts(ipc, {
      metadata: persist.metadata,
      officialSerialized: persist.officialSerialized,
      studySerialized: persist.studySerialized,
    });
    expect(ipc.batches).toHaveLength(1);

    const reloaded = await loadNativeSearchBootstrap(ipc);
    expect(reloaded.cachedMetadata?.officialIndex.corpusContentHash).toBe(
      persist.metadata.officialIndex.corpusContentHash,
    );
    const diagnostics = await readNativeSearchDiagnostics(ipc);
    expect(diagnostics.metadata).not.toBeNull();
    expect(diagnostics.totalArtifactBytes).toBe(
      diagnostics.officialArtifactBytes + diagnostics.studyArtifactBytes,
    );
    expect(diagnostics.totalArtifactBytes).toBeGreaterThan(0);

    const studyUpdate = await loadNativeStudyUpdate(ipc);
    expect(studyUpdate.cachedMetadata).not.toBeNull();
    expect(studyUpdate.snapshot.units.length).toBe(snapshot.units.length);
  });

  it('fails closed on native schema drift', async () => {
    const ipc = mockIpc(nativeRawAll(seedSnapshot()));
    ipc.status = async () => ({ schema_version: 999 });
    await expect(loadNativeSearchBootstrap(ipc)).rejects.toThrow('schema version');
    await expect(readNativeSearchDiagnostics(ipc)).rejects.toThrow('schema version');
  });
});

describe('native search service wiring', () => {
  const fakeWorker = () => {
    const posted: unknown[] = [];
    const worker = {
      posted,
      onmessage: null as ((_event: { data: StudySearchWorkerResponse }) => void) | null,
      postMessage: (message: unknown) => posted.push(message),
      terminate: () => undefined,
    };
    return worker;
  };

  const mockBridge = (snapshot: StudyDataSnapshot) => {
    const persisted: unknown[] = [];
    return {
      persisted,
      bridge: {
        loadBootstrap: vi.fn(async () => ({
          snapshot,
          legalDocuments: snapshot.legalDocuments,
          legalComponents: snapshot.legalComponents,
          cachedMetadata: null,
          cachedOfficialSerialized: null,
          cachedStudySerialized: null,
        })),
        loadStudyUpdate: vi.fn(async () => ({ snapshot, cachedMetadata: null })),
        persist: vi.fn(async (p: unknown) => {
          persisted.push(p);
        }),
        readDiagnostics: vi.fn(async () => ({
          metadata: null,
          officialArtifactBytes: 0,
          studyArtifactBytes: 0,
          totalArtifactBytes: 0,
        })),
      },
    };
  };

  it('bootstraps over the native path and persists worker artifacts without IndexedDB', async () => {
    const snapshot = seedSnapshot();
    const worker = fakeWorker();
    const { bridge, persisted } = mockBridge(snapshot);
    const service = new StudySearchService({
      backend: 'native',
      nativeBridge: bridge,
      createWorker: () => worker as unknown as Worker,
    });
    const statuses: unknown[] = [];
    service.subscribeStatus((s) => statuses.push(s));

    await assertNoIndexedDbUse(async () => {
      service.initialize();
      // Fail-closed latch: `native-arm` is posted synchronously on worker
      // creation, before the async bootstrap resolves.
      expect(worker.posted[0]).toMatchObject({ type: 'native-arm' });
      await flush();
      const bootstrap = worker.posted.find(
        (m) => (m as { type: string }).type === 'native-bootstrap',
      ) as StudySearchNativeBootstrapMessage;
      expect(bootstrap).toBeDefined();
      expect(bootstrap.snapshot.units.length).toBe(snapshot.units.length);
      // No browser-path fallback message is ever posted on native.
      expect(worker.posted.some((m) => (m as { type: string }).type === 'initialize')).toBe(false);

      worker.onmessage?.({
        data: {
          type: 'native-persist',
          requestId: bootstrap.requestId,
          metadata: {
            schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
            dbVersion: NATIVE_SEARCH_DB_VERSION,
            indexVersion: SEARCH_INDEX_VERSION,
            engine: 'minisearch',
            engineVersion: MINISEARCH_VERSION,
            officialIndex: { corpusContentHash: 'h', builtAt: 't', recordCount: 1 },
            studyIndex: { contentRevision: 1, builtAt: 't', recordCount: 1 },
          },
          officialSerialized: 'official-blob',
          studySerialized: 'study-blob',
        },
      });
      await flush();
      expect(persisted).toHaveLength(1);

      await expect(service.requestDiagnostics()).resolves.toMatchObject({
        totalArtifactBytes: 0,
      });
      // Diagnostics never round-trips through the worker on native.
      expect(worker.posted.some((m) => (m as { type: string }).type === 'diagnostics')).toBe(false);
      service.dispose();
    });
    expect(statuses.filter((s) => (s as { phase: string }).phase === 'error')).toHaveLength(0);
  });

  it('fails closed on native IPC errors with no IndexedDB fallback', async () => {
    const worker = fakeWorker();
    const failing = {
      loadBootstrap: vi.fn(async () => {
        throw new Error('native IPC unavailable');
      }),
      loadStudyUpdate: vi.fn(async () => {
        throw new Error('native IPC unavailable');
      }),
      persist: vi.fn(),
      readDiagnostics: vi.fn(async () => {
        throw new Error('native IPC unavailable');
      }),
    };
    const service = new StudySearchService({
      backend: 'native',
      nativeBridge: failing,
      createWorker: () => worker as unknown as Worker,
    });
    const statuses: Array<{ phase: string; message: string }> = [];
    service.subscribeStatus((s) => statuses.push(s as { phase: string; message: string }));

    await assertNoIndexedDbUse(async () => {
      service.initialize();
      // The only worker traffic on bootstrap IPC failure is the synchronous
      // fail-closed arm; no bootstrap/update/search is ever posted.
      expect(worker.posted[0]).toMatchObject({ type: 'native-arm' });
      await flush();
      service.rebuild();
      await flush();
      service.commitStudyBulkUpdate({ upsertUnitIds: ['u-1'], removeUnitIds: [] });
      await flush();
      await expect(service.requestDiagnostics()).rejects.toThrow('native IPC unavailable');
      service.dispose();
    });

    expect(
      worker.posted.filter((m) => (m as { type: string }).type !== 'native-arm'),
    ).toHaveLength(0);
    expect(statuses.filter((s) => s.phase === 'error').length).toBeGreaterThanOrEqual(3);
    expect(statuses[0].message).toContain('native IPC unavailable');
  });

  it('arms synchronously so a search racing the bootstrap stays fail-closed', async () => {
    const snapshot = seedSnapshot();
    const worker = fakeWorker();
    let resolveBootstrap!: (_value: {
      snapshot: StudyDataSnapshot;
      legalDocuments: ImportedLegalDocument[];
      legalComponents: ImportedLegalComponent[];
      cachedMetadata: null;
      cachedOfficialSerialized: null;
      cachedStudySerialized: null;
    }) => void;
    const pendingBootstrap = new Promise<{
      snapshot: StudyDataSnapshot;
      legalDocuments: ImportedLegalDocument[];
      legalComponents: ImportedLegalComponent[];
      cachedMetadata: null;
      cachedOfficialSerialized: null;
      cachedStudySerialized: null;
    }>((resolve) => {
      resolveBootstrap = resolve;
    });
    const { bridge } = mockBridge(snapshot);
    bridge.loadBootstrap = vi.fn(() => pendingBootstrap);
    const service = new StudySearchService({
      backend: 'native',
      nativeBridge: bridge,
      createWorker: () => worker as unknown as Worker,
    });

    await assertNoIndexedDbUse(async () => {
      service.initialize();
      // Synchronous arm lands before ANY async bootstrap traffic.
      expect(worker.posted).toHaveLength(1);
      expect(worker.posted[0]).toMatchObject({ type: 'native-arm' });
      // A search issued while the bootstrap is still pending goes to the
      // armed worker (which fails it closed until bootstrapped) — never to
      // a browser-path fallback.
      service.search('survey', 'all');
      expect(worker.posted[1]).toMatchObject({ type: 'search' });
      expect(
        worker.posted.some((m) =>
          ['initialize', 'rebuild', 'study-bulk-update', 'diagnostics'].includes(
            (m as { type: string }).type,
          ),
        ),
      ).toBe(false);
      resolveBootstrap({
        snapshot,
        legalDocuments: snapshot.legalDocuments,
        legalComponents: snapshot.legalComponents,
        cachedMetadata: null,
        cachedOfficialSerialized: null,
        cachedStudySerialized: null,
      });
      await flush();
      expect(
        worker.posted.some(
          (m) => (m as { type: string }).type === 'native-bootstrap',
        ),
      ).toBe(true);
      service.dispose();
    });
  });
});

describe('armed native worker (real module)', () => {
  it('fails closed on search/rebuild before bootstrap without opening IndexedDB', async () => {
    const holder = globalThis as Record<string, unknown>;
    const previousIndexedDB = holder['indexedDB'];
    const previousSelf = holder['self'];
    const responses: StudySearchWorkerResponse[] = [];
    holder['indexedDB'] = {
      open: () => {
        throw new Error('IndexedDB opened: the armed native worker must never open it.');
      },
    };
    const fakeSelf: Record<string, unknown> = {
      postMessage: (message: unknown) => {
        responses.push(message as StudySearchWorkerResponse);
      },
    };
    holder['self'] = fakeSelf;
    try {
      await import('../src/search/studySearchWorker');
      const onmessage = fakeSelf['onmessage'] as
        | ((_event: { data: { type: string; requestId: string } }) => void)
        | undefined;
      expect(typeof onmessage).toBe('function');
      if (!onmessage) throw new Error('unreachable');
      onmessage({ data: { type: 'native-arm', requestId: 'arm-1' } });
      await flush();
      // Search arrives before any bootstrap: fail closed, never IndexedDB.
      onmessage({
        data: { type: 'search', requestId: 'search-before', query: 'survey', scope: 'all' },
      } as unknown as { data: { type: string; requestId: string } });
      await flush();
      // Browser-path rebuild on an armed worker: fail closed, never IndexedDB.
      onmessage({ data: { type: 'rebuild', requestId: 'rebuild-before' } });
      await flush();
      const errors = responses.filter((m) => m.type === 'error');
      expect(errors.length).toBeGreaterThanOrEqual(2);
      for (const error of errors) {
        if (error.type !== 'error') throw new Error('unreachable');
        expect(error.message).toMatch(/not bootstrapped/i);
      }
      expect(responses.some((m) => m.type === 'results')).toBe(false);
      expect(responses.some((m) => m.type === 'ready')).toBe(false);
    } finally {
      if (previousIndexedDB === undefined) delete holder['indexedDB'];
      else holder['indexedDB'] = previousIndexedDB;
      if (previousSelf === undefined) delete holder['self'];
      else holder['self'] = previousSelf;
    }
  });
});
