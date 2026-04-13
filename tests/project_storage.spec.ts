/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildProjectIndexRow,
  createProjectStorage,
  requestPersistentStorage,
} from '../src/engine/projectStorage';
import { createManifestEntry, createProjectManifest } from '../src/engine/projectWorkspace';
import { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../src/engine/adjustedPointsExport';

type FakeIdbStores = {
  projectIndex: Map<string, unknown>;
  projectManifest: Map<string, unknown>;
  projectFile: Map<string, unknown>;
};

const createFakeRequest = <T,>(
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

const installIndexedDbMock = (stores: FakeIdbStores) => {
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
                return {
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

type FakeDirectoryHandle = {
  getDirectoryHandle: (
    _name: string,
    _options?: { create?: boolean },
  ) => Promise<FakeDirectoryHandle>;
  getFileHandle: (_name: string, _options?: { create?: boolean }) => Promise<{
    getFile: () => Promise<{ text: () => Promise<string> }>;
  }>;
  removeEntry: (_name: string, _options?: { recursive?: boolean }) => Promise<void>;
};

type FakeDirectoryTree = {
  directories?: Record<string, FakeDirectoryHandle>;
  files?: Record<string, string>;
};

const createFakeDirectoryHandle = (tree: FakeDirectoryTree): FakeDirectoryHandle => ({
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

const originalStorage = navigator.storage;
const originalIndexedDb = window.indexedDB;

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

describe('project storage status', () => {
  it('reports OPFS and persistence availability from navigator storage', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => ({})),
        persist: vi.fn(async () => true),
        persisted: vi.fn(async () => true),
      },
    });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {},
    });

    const status = await createProjectStorage().getStatus();

    expect(status.hasOpfs).toBe(true);
    expect(status.hasIndexedDb).toBe(true);
    expect(status.canPersist).toBe(true);
    expect(status.persisted).toBe(true);
    expect(status.preferredBackend).toBe('opfs');
  });

  it('returns no recent projects when indexeddb is unavailable', async () => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: undefined,
    });

    const projects = await createProjectStorage().listProjects();

    expect(projects).toEqual([]);
  });

  it('requests persistent storage when supported', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist,
      },
    });

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reopens OPFS-backed projects without requiring an indexeddb manifest record', async () => {
    const createdAt = '2026-04-10T10:00:00.000Z';
    const file = createManifestEntry({
      id: 'file-1',
      name: 'main.dat',
      kind: 'dat',
      order: 0,
      enabled: true,
      text: 'C A 0 0 0 ! !',
      createdAt,
      updatedAt: createdAt,
    });
    const manifest = createProjectManifest({
      projectId: 'project-opfs-1',
      name: 'OPFS Project',
      createdAt,
      updatedAt: createdAt,
      files: [file],
      ui: {
        settings: {},
        parseSettings: {},
        exportFormat: 'points',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: {},
        selectedInstrument: '',
        levelLoopCustomPresets: [],
      },
    });
    const stores: FakeIdbStores = {
      projectIndex: new Map([
        [
          manifest.projectId,
          buildProjectIndexRow({
            id: manifest.projectId,
            name: manifest.name,
            backend: 'opfs',
            createdAt,
            updatedAt: createdAt,
          }),
        ],
      ]),
      projectManifest: new Map(),
      projectFile: new Map(),
    };
    installIndexedDbMock(stores);

    const opfsRoot = createFakeDirectoryHandle({
      directories: {
        projects: createFakeDirectoryHandle({
          directories: {
            [manifest.projectId]: createFakeDirectoryHandle({
              files: {
                'project.wnproj': JSON.stringify(manifest, null, 2),
              },
              directories: {
                data: createFakeDirectoryHandle({
                  files: {
                    [`${file.id}-main.dat`]: 'C A 0 0 0 ! !',
                  },
                }),
              },
            }),
          },
        }),
      },
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => opfsRoot),
      },
    });

    const session = await createProjectStorage().openProject(manifest.projectId);

    expect(session).not.toBeNull();
    expect(session?.manifest.name).toBe('OPFS Project');
    expect(session?.sourceTexts[file.id]).toBe('C A 0 0 0 ! !');
  });

  it('bumps recent-project open recency when reopening an indexeddb-backed project', async () => {
    const createdAt = '2026-04-10T10:00:00.000Z';
    const olderOpenedAt = '2026-04-10T11:00:00.000Z';
    const newerOpenedAt = '2026-04-10T12:00:00.000Z';
    const reopenedAt = '2026-04-10T13:00:00.000Z';
    const file = createManifestEntry({
      id: 'file-1',
      name: 'main.dat',
      kind: 'dat',
      order: 0,
      enabled: true,
      text: 'C A 0 0 0 ! !',
      createdAt,
      updatedAt: createdAt,
    });
    const manifest = createProjectManifest({
      projectId: 'project-indexeddb-1',
      name: 'IndexedDB Project',
      createdAt,
      updatedAt: createdAt,
      files: [file],
      ui: {
        settings: {},
        parseSettings: {},
        exportFormat: 'points',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: {},
        selectedInstrument: '',
        levelLoopCustomPresets: [],
      },
    });
    const siblingRow = {
      ...buildProjectIndexRow({
        id: 'project-indexeddb-2',
        name: 'Sibling Project',
        backend: 'indexeddb',
        createdAt,
        updatedAt: createdAt,
      }),
      lastOpenedAt: newerOpenedAt,
    };
    const targetRow = {
      ...buildProjectIndexRow({
        id: manifest.projectId,
        name: manifest.name,
        backend: 'indexeddb',
        createdAt,
        updatedAt: createdAt,
      }),
      lastOpenedAt: olderOpenedAt,
    };
    const stores: FakeIdbStores = {
      projectIndex: new Map([
        [targetRow.id, targetRow],
        [siblingRow.id, siblingRow],
      ]),
      projectManifest: new Map([
        [
          manifest.projectId,
          {
            projectId: manifest.projectId,
            manifest,
          },
        ],
      ]),
      projectFile: new Map([
        [
          `${manifest.projectId}:${file.id}`,
          {
            projectId: manifest.projectId,
            fileId: file.id,
            text: 'C A 0 0 0 ! !',
          },
        ],
      ]),
    };
    installIndexedDbMock(stores);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(reopenedAt));

    try {
      const storage = createProjectStorage();
      const sessionPromise = storage.openProject(manifest.projectId);
      await vi.runAllTimersAsync();
      const session = await sessionPromise;

      expect(session).not.toBeNull();
      expect(session?.indexRow.lastOpenedAt.localeCompare(reopenedAt)).toBeGreaterThanOrEqual(0);

      const projectsPromise = storage.listProjects();
      await vi.runAllTimersAsync();
      const projects = await projectsPromise;

      expect(projects.map((project) => project.id)).toEqual([
        manifest.projectId,
        siblingRow.id,
      ]);
      expect(projects[0]?.lastOpenedAt.localeCompare(reopenedAt)).toBeGreaterThanOrEqual(0);
      expect(
        (stores.projectIndex.get(manifest.projectId) as { lastOpenedAt: string }).lastOpenedAt,
      ).toBe(projects[0]?.lastOpenedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
