// Exam Prep — minimal fake IndexedDB fixture (jsdom tests).
//
// Mirrors the open/upgrade semantics of src/study/studyStorage so storage
// tests can exercise schema v9 migration, transactional rating saves with
// stale protection, and replaceAll round-trips without a real IndexedDB.
//
// Transaction completion is scheduled only AFTER each request succeeds so
// callers that attach their `oncomplete` handler after awaiting the request
// (e.g. readStore) always observe it.

export type FakeStores = Record<string, Map<string, unknown>>;
export type FakeKeyPaths = Record<string, string>;

export const EXAM_PREP_STORE_KEYS: Record<string, string> = {
  documents: 'id',
  units: 'id',
  prompts: 'id',
  concepts: 'id',
  rubrics: 'id',
  progress: 'unitId',
  attempts: 'id',
  drafts: 'id',
  settings: 'id',
  legalDocuments: 'id',
  legalComponents: 'recordKey',
  importHistory: 'id',
  searchIndexMetadata: 'id',
  searchIndexArtifacts: 'id',
  aiAuthoringRuns: 'runId',
  aiStudyMapProposals: 'id',
  aiUnitProposals: 'proposalId',
  examPrepUnitProgress: 'id',
  examPrepRecallProgress: 'id',
  examPrepAttempts: 'id',
  examPrepSettings: 'id',
};

const schedule = (callback: () => void): void => {
  window.setTimeout(callback, 0);
};

/** A request-like object; handlers are invoked on later timers. */
type FakeRequest = {
  result: unknown;
  error: unknown;
  onsuccess: ((_event: Event) => void) | null;
  onerror: ((_event: Event) => void) | null;
};

const createFakeRequest = <T>(resolveValue: () => T, afterSuccess?: () => void): FakeRequest => {
  const request: FakeRequest = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  schedule(() => {
    try {
      request.result = resolveValue();
      request.onsuccess?.(new Event('success'));
      afterSuccess?.();
    } catch (error) {
      request.error = error;
      request.onerror?.(new Event('error'));
    }
  });
  return request;
};

type FakeTransaction = {
  oncomplete: ((_event: Event) => void) | null;
  onerror: ((_event: Event) => void) | null;
  onabort: ((_event: Event) => void) | null;
  error: DOMException | null;
  abort: () => void;
};

type FakeStore = {
  keyPath?: string;
  indexNames: { contains: (_name: string) => boolean };
  createIndex: (..._args: unknown[]) => void;
  getAll: () => FakeRequest;
  get: (_key: string) => FakeRequest;
  put: (_value: unknown) => FakeRequest;
  delete: (_key: string) => FakeRequest;
  clear: () => FakeRequest;
};

const createFakeStore = (
  stores: FakeStores,
  keyPaths: FakeKeyPaths,
  _storeName: string,
  transaction: FakeTransaction,
): FakeStore => {
  const scheduleComplete = (): void => {
    schedule(() =>
      transaction.oncomplete?.(new Event('complete')),
    );
  };
  return {
    keyPath: keyPaths[_storeName],
    indexNames: { contains: () => false },
    createIndex: () => undefined,
    getAll: () =>
      createFakeRequest(
        () => Array.from(stores[_storeName]?.values() ?? []),
        scheduleComplete,
      ),
    get: (key: string) => createFakeRequest(() => stores[_storeName]?.get(key), scheduleComplete),
    put: (value: unknown) => {
      const keyPath = keyPaths[_storeName];
      const key = (value as Record<string, string>)[keyPath];
      stores[_storeName] ??= new Map();
      stores[_storeName].set(key, value);
      return createFakeRequest(() => key, scheduleComplete);
    },
    delete: (key: string) => {
      stores[_storeName]?.delete(key);
      return createFakeRequest(() => undefined, scheduleComplete);
    },
    clear: () => {
      stores[_storeName]?.clear();
      return createFakeRequest(() => undefined, scheduleComplete);
    },
  };
};

const makeDatabase = (stores: FakeStores, keyPaths: FakeKeyPaths): IDBDatabase => {
  const makeTransaction = (names: string[]): FakeTransaction & {
    objectStore: (_storeName: string) => FakeStore;
  } => {
    const transaction: FakeTransaction = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
      abort: () => undefined,
    };
    const withObjectStore = transaction as FakeTransaction & {
      objectStore: (_storeName: string) => FakeStore;
    };
    withObjectStore.objectStore = (_storeName: string) => {
      if (names.length > 0 && !names.includes('all') && !names.includes(_storeName))
        throw new Error(`Unexpected store ${_storeName}`);
      stores[_storeName] ??= new Map();
      keyPaths[_storeName] ??= EXAM_PREP_STORE_KEYS[_storeName];
      return createFakeStore(stores, keyPaths, _storeName, transaction);
    };
    return withObjectStore;
  };

  const db = {
    objectStoreNames: {
      contains: (storeName: string) => stores[storeName] !== undefined,
    },
    createObjectStore: (storeName: string) => {
      stores[storeName] ??= new Map();
      keyPaths[storeName] = EXAM_PREP_STORE_KEYS[storeName];
      const transaction = makeTransaction([]);
      return createFakeStore(stores, keyPaths, storeName, transaction) as unknown as IDBObjectStore;
    },
    deleteObjectStore: (storeName: string) => {
      stores[storeName] = new Map();
      delete keyPaths[storeName];
    },
    close: () => undefined,
    transaction: (storeNames: string | string[], _mode?: string) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return makeTransaction(names) as unknown as IDBTransaction;
    },
  };
  return db as unknown as IDBDatabase;
};

export const installExamPrepIndexedDbFixture = ({
  stores,
  keyPaths = {},
  oldVersion,
}: {
  stores: FakeStores;
  keyPaths?: FakeKeyPaths;
  oldVersion: number;
}) => {
  Object.keys(stores).forEach((storeName) => {
    keyPaths[storeName] ??= EXAM_PREP_STORE_KEYS[storeName];
  });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: (name: string, version?: number) => {
        const request = {
          result: null as IDBDatabase | null,
          error: null as DOMException | null,
          transaction: null as IDBTransaction | null,
          onsuccess: null as ((_event: Event) => void) | null,
          onerror: null as ((_event: Event) => void) | null,
          onupgradeneeded: null as ((_event: Event) => void) | null,
        };
        schedule(() => {
          if (name !== 'webnet.study.v1') {
            request.error = new DOMException('Unexpected database name.');
            request.onerror?.(new Event('error'));
            return;
          }
          const db = makeDatabase(stores, keyPaths);
          request.result = db;
          if ((version ?? 0) > oldVersion) {
            request.transaction = db.transaction([], 'versionchange');
            request.onupgradeneeded?.(new Event('upgradeneeded'));
          }
          request.onsuccess?.(new Event('success'));
        });
        return request as unknown as IDBOpenDBRequest;
      },
    },
  });
};

export const restoreWindowIndexedDb = (original: unknown): void => {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: original,
  });
};
