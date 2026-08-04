/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

import {
  buildProjectIndexRow,
  createProjectStorage,
} from '../../src/engine/projectStorage';
import { createManifestEntry, createProjectManifest } from '../../src/engine/projectWorkspace';
import { DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS } from '../../src/engine/adjustedPointsExport';
import {
  createFakeDirectoryHandle,
  type FakeIdbStores,
  installIndexedDbMock,
} from './projectStorageTestSupport';

describe('project storage reopen behavior', () => {  it('reopens OPFS-backed projects without requiring an indexeddb manifest record', async () => {
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
