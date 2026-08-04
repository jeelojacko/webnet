import { afterEach, vi } from 'vitest';
export type FakeIdbStores = {
  projectIndex: Map<string, unknown>;
  projectManifest: Map<string, unknown>;
  projectFile: Map<string, unknown>;
};

export const createFakeRequest = <T,>(
  resolver: () => T,
  onComplete?: () => void,
): IDBRequest<T> => {
  const request: {
    result: T;
    error: DOMException | null;
    onsuccess: IDBRequest<T>['onsuccess'];
    onerror: IDBRequest<T>['onerror'];
  } = {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  const idbRequest = request as unknown as IDBRequest<T>;
  window.setTimeout(() => {
    try {
      request.result = resolver();
      request.onsuccess?.call(idbRequest, new Event('success') as never);
      window.setTimeout(() => {
        onComplete?.();
      }, 0);
    } catch (error) {
      request.error = error as DOMException;
      request.onerror?.call(idbRequest, new Event('error') as never);
      window.setTimeout(() => {
        onComplete?.();
      }, 0);
    }
  }, 0);
  return idbRequest;
};

export const installIndexedDbMock = (stores: FakeIdbStores) => {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: vi.fn(() => {
        const request: {
          result: IDBDatabase | null;
          error: DOMException | null;
          onsuccess: IDBOpenDBRequest['onsuccess'];
          onerror: IDBOpenDBRequest['onerror'];
          onupgradeneeded: IDBOpenDBRequest['onupgradeneeded'];
        } = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        const db = {
          objectStoreNames: {
            contains: () => true,
          },
          createObjectStore: () => undefined,
          close: () => undefined,
          transaction: (storeNames: string | string[]) => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            const transaction = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: (name: string) => {
                if (!names.includes(name)) {
                  throw new Error(`Unexpected store ${name}`);
                }
                const store =
                  name === 'projectIndex'
                    ? stores.projectIndex
                    : name === 'projectManifest'
                      ? stores.projectManifest
                      : stores.projectFile;
                const buildProjectFileIndex = () => ({
                  getAll: (projectId: string) =>
                    createFakeRequest(
                      () =>
                        Array.from(stores.projectFile.values()).filter(
                          (record) =>
                            (record as { projectId?: string }).projectId === projectId,
                        ),
                      () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      },
                    ),
                  getAllKeys: (projectId: string) =>
                    createFakeRequest(
                      () =>
                        Array.from(stores.projectFile.values())
                          .filter(
                            (record) =>
                              (record as { projectId?: string }).projectId === projectId,
                          )
                          .map((record) => {
                            const fileRecord = record as { projectId: string; fileId: string };
                            return [fileRecord.projectId, fileRecord.fileId];
                          }),
                      () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      },
                    ),
                });
                return {
                  indexNames: {
                    contains: (indexName: string) => indexName === 'byProjectId',
                  },
                  index: (indexName: string) => {
                    if (indexName !== 'byProjectId') throw new Error(`Unexpected index ${indexName}`);
                    return buildProjectFileIndex();
                  },
                  createIndex: () => buildProjectFileIndex(),
                  get: (key: string) =>
                    createFakeRequest(() => store.get(key), () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  getAll: () =>
                    createFakeRequest(() => Array.from(store.values()), () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  put: (value: unknown) =>
                    createFakeRequest(() => {
                      if (name === 'projectIndex') {
                        const row = value as { id: string };
                        store.set(row.id, value);
                      } else if (name === 'projectManifest') {
                        const row = value as { projectId: string };
                        store.set(row.projectId, value);
                      } else {
                        const row = value as { projectId: string; fileId: string };
                        store.set(`${row.projectId}:${row.fileId}`, value);
                      }
                      return value;
                    }, () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                  delete: (key: string | string[]) =>
                    createFakeRequest(() => {
                      store.delete(Array.isArray(key) ? key.join(':') : key);
                      return undefined;
                    }, () => {
                      transaction.oncomplete?.(new Event('complete') as never);
                    }),
                };
              },
            } as unknown as IDBTransaction;
            return transaction;
          },
        } as unknown as IDBDatabase;
        request.result = db;
        const openRequest = request as unknown as IDBOpenDBRequest;
        window.setTimeout(() => {
          request.onsuccess?.call(openRequest, new Event('success') as never);
        }, 0);
        return openRequest;
      }),
    },
  });
};

export type FakeDirectoryHandle = {
  getDirectoryHandle: (
    _name: string,
    _options?: { create?: boolean },
  ) => Promise<FakeDirectoryHandle>;
  getFileHandle: (_name: string, _options?: { create?: boolean }) => Promise<{
    getFile: () => Promise<{ text: () => Promise<string> }>;
  }>;
  removeEntry: (_name: string, _options?: { recursive?: boolean }) => Promise<void>;
};

export type FakeDirectoryTree = {
  directories?: Record<string, FakeDirectoryHandle>;
  files?: Record<string, string>;
};

export const createFakeDirectoryHandle = (tree: FakeDirectoryTree): FakeDirectoryHandle => ({
  async getDirectoryHandle(name, options) {
    const existing = tree.directories?.[name];
    if (existing) return existing;
    if (options?.create) {
      const created = createFakeDirectoryHandle({});
      tree.directories = { ...(tree.directories ?? {}), [name]: created };
      return created;
    }
    throw new Error(`Missing directory ${name}`);
  },
  async getFileHandle(name, options) {
    if (tree.files?.[name] != null) {
      return {
        getFile: async () => ({
          text: async () => tree.files?.[name] ?? '',
        }),
      };
    }
    if (options?.create) {
      tree.files = { ...(tree.files ?? {}), [name]: '' };
      return {
        getFile: async () => ({
          text: async () => tree.files?.[name] ?? '',
        }),
      };
    }
    throw new Error(`Missing file ${name}`);
  },
  async removeEntry(name) {
    if (tree.directories?.[name]) {
      const nextDirectories = { ...(tree.directories ?? {}) };
      delete nextDirectories[name];
      tree.directories = nextDirectories;
      return;
    }
    if (tree.files?.[name] != null) {
      const nextFiles = { ...(tree.files ?? {}) };
      delete nextFiles[name];
      tree.files = nextFiles;
      return;
    }
    throw new Error(`Missing entry ${name}`);
  },
});

export const originalStorage = navigator.storage;
export const originalIndexedDb = window.indexedDB;

afterEach(() => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: originalStorage,
  });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: originalIndexedDb,
  });
});
