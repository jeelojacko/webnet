import type { StudySearchWorkerRequest, StudySearchWorkerResponse } from './studySearchMessages';
import {
  defaultNativeSearchIpc,
  loadNativeSearchBootstrap,
  loadNativeStudyUpdate,
  NATIVE_SEARCH_DB_VERSION,
  persistNativeSearchArtifacts,
  readNativeSearchDiagnostics,
  type NativeSearchBootstrap,
  type NativeStudyUpdatePayload,
} from '../studySearchNativeBridge';
import { resolveStudySearchBackend, type StudySearchBackend } from './studySearchPlatform';
import type {
  StudySearchDiagnostics,
  StudySearchIndexMetadata,
  StudySearchResultSummary,
  StudySearchScope,
  StudySearchStatus,
} from './studySearchTypes';

type SearchListener = (_results: StudySearchResultSummary[]) => void;
type StatusListener = (_status: StudySearchStatus) => void;

const createRequestId = (): string =>
  `study-search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Native main-thread side of the Tauri search path (injectable for tests). */
export type StudySearchNativeBridge = {
  loadBootstrap: () => Promise<NativeSearchBootstrap>;
  loadStudyUpdate: () => Promise<NativeStudyUpdatePayload>;
  persist: (_persist: {
    metadata: StudySearchIndexMetadata;
    officialSerialized: string | null;
    studySerialized: string | null;
  }) => Promise<void>;
  readDiagnostics: () => Promise<StudySearchDiagnostics>;
};

export type StudySearchServiceDeps = {
  backend?: StudySearchBackend;
  nativeBridge?: StudySearchNativeBridge;
  createWorker?: () => Worker;
};

export class StudySearchService {
  private worker: Worker | null = null;
  private readonly backend: StudySearchBackend;
  private readonly nativeBridge: StudySearchNativeBridge | null;
  private readonly createWorker: () => Worker;
  private latestSearchRequestId = '';
  private resultListeners = new Set<SearchListener>();
  private statusListeners = new Set<StatusListener>();
  private diagnosticsResolvers = new Map<string, (_diagnostics: StudySearchDiagnostics) => void>();

  constructor(deps: StudySearchServiceDeps = {}) {
    // Centralized platform choice — no scattered host checks in callers.
    this.backend = deps.backend ?? resolveStudySearchBackend();
    this.nativeBridge = deps.nativeBridge ?? (this.backend === 'native' ? defaultBridge : null);
    this.createWorker =
      deps.createWorker ??
      (() =>
        new Worker(new URL('./studySearchWorker.ts', import.meta.url), {
          type: 'module',
        }));
  }

  initialize(): void {
    this.ensureWorker();
    if (this.backend === 'native') {
      const requestId = createRequestId();
      void this.requireBridge()
        .loadBootstrap()
        .then((bootstrap) => {
          this.post({
            type: 'native-bootstrap',
            requestId,
            forceRebuild: false,
            expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
            snapshot: bootstrap.snapshot,
            legalDocuments: bootstrap.legalDocuments,
            legalComponents: bootstrap.legalComponents,
            cachedMetadata: bootstrap.cachedMetadata,
            cachedOfficialSerialized: bootstrap.cachedOfficialSerialized,
            cachedStudySerialized: bootstrap.cachedStudySerialized,
          });
        })
        .catch((error) => this.emitError(error));
      return;
    }
    this.post({ type: 'initialize', requestId: createRequestId() });
  }

  search(query: string, scope: StudySearchScope, limitPerCategory = 8): void {
    this.ensureWorker();
    const requestId = createRequestId();
    this.latestSearchRequestId = requestId;
    this.post({ type: 'search', requestId, query, scope, limitPerCategory });
  }

  rebuild(): void {
    this.ensureWorker();
    if (this.backend === 'native') {
      const requestId = createRequestId();
      void this.requireBridge()
        .loadBootstrap()
        .then((bootstrap) => {
          this.post({
            type: 'native-bootstrap',
            requestId,
            forceRebuild: true,
            expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
            snapshot: bootstrap.snapshot,
            legalDocuments: bootstrap.legalDocuments,
            legalComponents: bootstrap.legalComponents,
            cachedMetadata: bootstrap.cachedMetadata,
            cachedOfficialSerialized: bootstrap.cachedOfficialSerialized,
            cachedStudySerialized: bootstrap.cachedStudySerialized,
          });
        })
        .catch((error) => this.emitError(error));
      return;
    }
    this.post({ type: 'rebuild', requestId: createRequestId() });
  }

  commitStudyBulkUpdate({
    upsertUnitIds,
    removeUnitIds,
  }: {
    upsertUnitIds: string[];
    removeUnitIds: string[];
  }): void {
    this.ensureWorker();
    if (this.backend === 'native') {
      // Unit ids are informational here: the worker rebuilds the study index
      // from a fresh native snapshot (same validity/ordering semantics).
      void upsertUnitIds;
      void removeUnitIds;
      const requestId = createRequestId();
      void this.requireBridge()
        .loadStudyUpdate()
        .then(({ snapshot, cachedMetadata }) => {
          this.post({
            type: 'native-study-update',
            requestId,
            expectedDbVersion: NATIVE_SEARCH_DB_VERSION,
            snapshot,
            cachedMetadata,
          });
        })
        .catch((error) => this.emitError(error));
      return;
    }
    this.post({
      type: 'study-bulk-update',
      requestId: createRequestId(),
      upsertUnitIds,
      removeUnitIds,
    });
  }

  requestDiagnostics(): Promise<StudySearchDiagnostics> {
    // Native diagnostics come straight from SQLite via IPC — the worker is
    // never involved, so no IndexedDB open can happen on desktop.
    if (this.backend === 'native') return this.requireBridge().readDiagnostics();
    this.ensureWorker();
    const requestId = createRequestId();
    return new Promise((resolve) => {
      this.diagnosticsResolvers.set(requestId, resolve);
      this.post({ type: 'diagnostics', requestId });
    });
  }

  subscribeResults(listener: SearchListener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private requireBridge(): StudySearchNativeBridge {
    if (!this.nativeBridge) throw new Error('Native study search bridge is unavailable.');
    return this.nativeBridge;
  }

  private emitError(error: unknown): void {
    // Fail-closed: surface the error status. NEVER fall back to IndexedDB.
    const message = error instanceof Error ? error.message : String(error);
    this.statusListeners.forEach((listener) =>
      listener({ ready: false, phase: 'error', message }),
    );
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = this.createWorker();
    if (this.backend === 'native') {
      // Synchronous fail-closed latch, posted BEFORE the async bootstrap
      // resolves (or fails): the worker lifetime is native-only from here on
      // and must never open IndexedDB, even if a search races the bootstrap.
      this.worker.postMessage({ type: 'native-arm', requestId: createRequestId() });
    }
    this.worker.onmessage = (event: MessageEvent<StudySearchWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'native-persist') {
        // Derived-artifact write-back over native IPC/SQLite.
        void this.requireBridge()
          .persist({
            metadata: message.metadata,
            officialSerialized: message.officialSerialized,
            studySerialized: message.studySerialized,
          })
          .catch((error) => this.emitError(error));
        return;
      }
      if (message.type === 'progress' || message.type === 'ready') {
        this.statusListeners.forEach((listener) => listener(message.status));
      }
      if (message.type === 'results' && message.requestId === this.latestSearchRequestId) {
        this.resultListeners.forEach((listener) => listener(message.results));
      }
      if (message.type === 'diagnostics') {
        this.diagnosticsResolvers.get(message.requestId)?.(message.diagnostics);
        this.diagnosticsResolvers.delete(message.requestId);
      }
      if (message.type === 'error') {
        this.statusListeners.forEach((listener) =>
          listener({ ready: false, phase: 'error', message: message.message }),
        );
      }
    };
  }

  private post(message: StudySearchWorkerRequest): void {
    this.worker?.postMessage(message);
  }
}

const defaultBridge: StudySearchNativeBridge = {
  loadBootstrap: () => loadNativeSearchBootstrap(),
  loadStudyUpdate: () => loadNativeStudyUpdate(),
  persist: (persist) => persistNativeSearchArtifacts(defaultNativeSearchIpc, persist),
  readDiagnostics: () => readNativeSearchDiagnostics(),
};

export const createStudySearchService = (
  deps: StudySearchServiceDeps = {},
): StudySearchService => new StudySearchService(deps);
