import type {
  ProjectIndexRow,
  ProjectStorageBackend,
  ProjectStorageStatus,
  ProjectSessionState,
  WebNetProjectManifestV5,
} from './projectWorkspace';
import { createSessionFromManifest } from './projectWorkspace';

const PROJECT_DB_NAME = 'webnet.project-storage.v1';
const PROJECT_DB_VERSION = 1;
const PROJECT_INDEX_STORE = 'projectIndex';
const PROJECT_MANIFEST_STORE = 'projectManifest';
const PROJECT_FILE_STORE = 'projectFile';

type ProjectFileRecord = {
  projectId: string;
  fileId: string;
  text: string;
};

type ProjectManifestRecord = {
  projectId: string;
  manifest: WebNetProjectManifestV5;
};

type CreateStoredProjectArgs = {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
};

type SaveStoredProjectArgs = {
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
  dirtyFileIds?: string[];
};

export interface ProjectStorage {
  getStatus: () => Promise<ProjectStorageStatus>;
  listProjects: () => Promise<ProjectIndexRow[]>;
  createProject: (_args: CreateStoredProjectArgs) => Promise<ProjectSessionState>;
  openProject: (_projectId: string) => Promise<ProjectSessionState | null>;
  saveProject: (_args: SaveStoredProjectArgs) => Promise<ProjectSessionState>;
  deleteProject: (_projectId: string) => Promise<void>;
}

const hasWindowIndexedDb = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const hasOpfsSupport = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

const getProjectRootPath = (projectId: string): string => `projects/${projectId}`;

const buildIndexRowForSession = (session: ProjectSessionState): ProjectIndexRow => ({
  ...session.indexRow,
});

const sortProjectRows = (rows: ProjectIndexRow[]): ProjectIndexRow[] =>
  [...rows].sort(
    (a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

const openProjectDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!hasWindowIndexedDb()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = window.indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_INDEX_STORE)) {
        db.createObjectStore(PROJECT_INDEX_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROJECT_MANIFEST_STORE)) {
        db.createObjectStore(PROJECT_MANIFEST_STORE, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(PROJECT_FILE_STORE)) {
        db.createObjectStore(PROJECT_FILE_STORE, { keyPath: ['projectId', 'fileId'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open project database.'));
  });

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });

const readAllProjectFilesFromDb = async (
  db: IDBDatabase,
  projectId: string,
): Promise<Record<string, string>> => {
  const transaction = db.transaction(PROJECT_FILE_STORE, 'readonly');
  const store = transaction.objectStore(PROJECT_FILE_STORE);
  const allRecords = (await requestToPromise(store.getAll())) as ProjectFileRecord[];
  await transactionDone(transaction);
  return Object.fromEntries(
    allRecords
      .filter((record) => record.projectId === projectId)
      .map((record) => [record.fileId, record.text]),
  );
};

const writeAllProjectFilesToDb = async (
  db: IDBDatabase,
  projectId: string,
  sourceTexts: Record<string, string>,
  dirtyFileIds?: string[],
): Promise<void> => {
  const targetFileIds = dirtyFileIds && dirtyFileIds.length > 0 ? dirtyFileIds : Object.keys(sourceTexts);
  if (targetFileIds.length === 0) return;
  const transaction = db.transaction(PROJECT_FILE_STORE, 'readwrite');
  const store = transaction.objectStore(PROJECT_FILE_STORE);
  targetFileIds.forEach((fileId) => {
    store.put({
      projectId,
      fileId,
      text: sourceTexts[fileId] ?? '',
    } satisfies ProjectFileRecord);
  });
  await transactionDone(transaction);
};

const deleteProjectFilesFromDb = async (db: IDBDatabase, projectId: string): Promise<void> => {
  const transaction = db.transaction(PROJECT_FILE_STORE, 'readwrite');
  const store = transaction.objectStore(PROJECT_FILE_STORE);
  const allRecords = (await requestToPromise(store.getAll())) as ProjectFileRecord[];
  allRecords
    .filter((record) => record.projectId === projectId)
    .forEach((record) => store.delete([record.projectId, record.fileId]));
  await transactionDone(transaction);
};

const getOpfsDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!hasOpfsSupport()) return null;
  return navigator.storage.getDirectory();
};

const ensureDirectoryHandle = async (
  parent: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<FileSystemDirectoryHandle> => {
  let current = parent;
  for (const segment of pathSegments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
};

const getDirectoryHandleForRelativePath = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  const segments = relativePath.split('/').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
};

const writeTextFileToOpfs = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
  text: string,
): Promise<void> => {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return;
  const directory = await ensureDirectoryHandle(root, segments);
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

const readTextFileFromOpfs = async (
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<string> => {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return '';
  const directory = await getDirectoryHandleForRelativePath(root, segments.join('/'), false);
  const handle = await directory.getFileHandle(fileName, { create: false });
  const file = await handle.getFile();
  return file.text();
};

const deleteOpfsProjectRoot = async (
  root: FileSystemDirectoryHandle,
  projectId: string,
): Promise<void> => {
  const projectsDirectory = await ensureDirectoryHandle(root, ['projects']);
  try {
    await projectsDirectory.removeEntry(projectId, { recursive: true });
  } catch {
    return;
  }
};

const readOpfsProject = async (
  indexRow: ProjectIndexRow,
): Promise<ProjectSessionState | null> => {
  const root = await getOpfsDirectoryHandle();
  if (!root) return null;
  try {
    const manifestText = await readTextFileFromOpfs(root, `${getProjectRootPath(indexRow.id)}/project.wnproj`);
    const manifest = JSON.parse(manifestText) as WebNetProjectManifestV5;
    const sourceTexts = Object.fromEntries(
      await Promise.all(
        manifest.files.map(async (file) => [file.id, await readTextFileFromOpfs(root, `${getProjectRootPath(indexRow.id)}/${file.path}`)]),
      ),
    );
    return createSessionFromManifest({ indexRow, manifest, sourceTexts });
  } catch {
    return null;
  }
};

const createIndexedDbStorage = (): ProjectStorage => ({
  async getStatus() {
    const canPersist = typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';
    const persisted =
      typeof navigator !== 'undefined' && typeof navigator.storage?.persisted === 'function'
        ? await navigator.storage.persisted()
        : null;
    return {
      hasOpfs: hasOpfsSupport(),
      hasIndexedDb: hasWindowIndexedDb(),
      canPersist,
      persisted,
      preferredBackend: hasOpfsSupport() ? 'opfs' : 'indexeddb',
    };
  },
  async listProjects() {
    if (!hasWindowIndexedDb()) {
      return [];
    }
    const db = await openProjectDatabase();
    try {
      const transaction = db.transaction(PROJECT_INDEX_STORE, 'readonly');
      const store = transaction.objectStore(PROJECT_INDEX_STORE);
      const rows = (await requestToPromise(store.getAll())) as ProjectIndexRow[];
      await transactionDone(transaction);
      return sortProjectRows(rows);
    } finally {
      db.close();
    }
  },
  async createProject({ indexRow, manifest, sourceTexts }) {
    if (!hasWindowIndexedDb()) {
      throw new Error('IndexedDB is not available.');
    }
    const db = await openProjectDatabase();
    try {
      const transaction = db.transaction(
        [PROJECT_INDEX_STORE, PROJECT_MANIFEST_STORE, PROJECT_FILE_STORE],
        'readwrite',
      );
      transaction.objectStore(PROJECT_INDEX_STORE).put(indexRow);
      if (indexRow.backend === 'indexeddb') {
        transaction.objectStore(PROJECT_MANIFEST_STORE).put({
          projectId: manifest.projectId,
          manifest,
        } satisfies ProjectManifestRecord);
        manifest.files.forEach((file) => {
          transaction.objectStore(PROJECT_FILE_STORE).put({
            projectId: manifest.projectId,
            fileId: file.id,
            text: sourceTexts[file.id] ?? '',
          } satisfies ProjectFileRecord);
        });
      }
      await transactionDone(transaction);
      if (indexRow.backend === 'opfs') {
        const root = await getOpfsDirectoryHandle();
        if (!root) throw new Error('OPFS is not available.');
        const projectRoot = `${getProjectRootPath(indexRow.id)}`;
        await writeTextFileToOpfs(root, `${projectRoot}/project.wnproj`, JSON.stringify(manifest, null, 2));
        for (const file of manifest.files) {
          await writeTextFileToOpfs(root, `${projectRoot}/${file.path}`, sourceTexts[file.id] ?? '');
        }
      }
      return createSessionFromManifest({ indexRow, manifest, sourceTexts });
    } finally {
      db.close();
    }
  },
  async openProject(projectId) {
    if (!hasWindowIndexedDb()) {
      return null;
    }
    const db = await openProjectDatabase();
    try {
      const transaction = db.transaction([PROJECT_INDEX_STORE, PROJECT_MANIFEST_STORE], 'readonly');
      const indexStore = transaction.objectStore(PROJECT_INDEX_STORE);
      const manifestStore = transaction.objectStore(PROJECT_MANIFEST_STORE);
      const indexRow = (await requestToPromise(indexStore.get(projectId))) as ProjectIndexRow | undefined;
      const manifestRecord = (await requestToPromise(
        manifestStore.get(projectId),
      )) as ProjectManifestRecord | undefined;
      await transactionDone(transaction);
      if (!indexRow || !manifestRecord) return null;
      if (indexRow.backend === 'opfs') {
        const session = await readOpfsProject(indexRow);
        if (!session) return null;
        return session;
      }
      const sourceTexts = await readAllProjectFilesFromDb(db, projectId);
      return createSessionFromManifest({
        indexRow,
        manifest: manifestRecord.manifest,
        sourceTexts,
      });
    } finally {
      db.close();
    }
  },
  async saveProject({ indexRow, manifest, sourceTexts, dirtyFileIds }) {
    if (!hasWindowIndexedDb()) {
      throw new Error('IndexedDB is not available.');
    }
    const db = await openProjectDatabase();
    try {
      if (indexRow.backend === 'opfs') {
        const root = await getOpfsDirectoryHandle();
        if (!root) throw new Error('OPFS is not available.');
        const projectRoot = `${getProjectRootPath(indexRow.id)}`;
        await writeTextFileToOpfs(root, `${projectRoot}/project.wnproj`, JSON.stringify(manifest, null, 2));
        const targetFileIds = dirtyFileIds && dirtyFileIds.length > 0 ? dirtyFileIds : manifest.files.map((file) => file.id);
        for (const fileId of targetFileIds) {
          const file = manifest.files.find((entry) => entry.id === fileId);
          if (!file) continue;
          await writeTextFileToOpfs(root, `${projectRoot}/${file.path}`, sourceTexts[file.id] ?? '');
        }
      } else {
        const transaction = db.transaction([PROJECT_INDEX_STORE, PROJECT_MANIFEST_STORE], 'readwrite');
        transaction.objectStore(PROJECT_INDEX_STORE).put(indexRow);
        transaction.objectStore(PROJECT_MANIFEST_STORE).put({
          projectId: manifest.projectId,
          manifest,
        } satisfies ProjectManifestRecord);
        await transactionDone(transaction);
        await writeAllProjectFilesToDb(db, manifest.projectId, sourceTexts, dirtyFileIds);
      }
      return createSessionFromManifest({ indexRow, manifest, sourceTexts });
    } finally {
      db.close();
    }
  },
  async deleteProject(projectId) {
    if (!hasWindowIndexedDb()) {
      return;
    }
    const db = await openProjectDatabase();
    try {
      const transaction = db.transaction([PROJECT_INDEX_STORE, PROJECT_MANIFEST_STORE], 'readwrite');
      const indexStore = transaction.objectStore(PROJECT_INDEX_STORE);
      const manifestStore = transaction.objectStore(PROJECT_MANIFEST_STORE);
      const existingRow = (await requestToPromise(indexStore.get(projectId))) as ProjectIndexRow | undefined;
      indexStore.delete(projectId);
      manifestStore.delete(projectId);
      await transactionDone(transaction);
      await deleteProjectFilesFromDb(db, projectId);
      if (existingRow?.backend === 'opfs') {
        const root = await getOpfsDirectoryHandle();
        if (root) {
          await deleteOpfsProjectRoot(root, projectId);
        }
      }
    } finally {
      db.close();
    }
  },
});

export const createProjectStorage = (): ProjectStorage => createIndexedDbStorage();

export const requestPersistentStorage = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

export const buildProjectIndexRow = ({
  id,
  name,
  backend,
  createdAt,
  updatedAt,
}: {
  id: string;
  name: string;
  backend: ProjectStorageBackend;
  createdAt: string;
  updatedAt: string;
}): ProjectIndexRow => ({
  id,
  name,
  backend,
  rootKey: backend === 'opfs' ? getProjectRootPath(id) : id,
  schemaVersion: 5,
  createdAt,
  updatedAt,
  lastOpenedAt: updatedAt,
});

export const touchProjectIndexRow = (
  row: ProjectIndexRow,
  updatedAt: string,
): ProjectIndexRow => ({
  ...row,
  updatedAt,
  lastOpenedAt: updatedAt,
});

export const buildSavedSessionForStorage = (
  session: ProjectSessionState,
): SaveStoredProjectArgs => ({
  indexRow: buildIndexRowForSession(session),
  manifest: session.manifest,
  sourceTexts: session.sourceTexts,
  dirtyFileIds: session.dirtyFileIds,
});
