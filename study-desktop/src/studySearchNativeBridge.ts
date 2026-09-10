// Study search — Tauri native bridge (Phase 2G, main thread only).
//
// Reads authoritative records plus cached derived search artifacts over
// native IPC/SQLite, and writes fresh derived artifacts back. Shapes mirror
// `search/studySearchPersistence.ts` (metadata id `current`, artifact ids
// `${kind}-fulltext`) so validity semantics stay identical across backends.
// The worker never imports this module: Web Workers cannot use Tauri IPC
// (`window.__TAURI_INTERNALS__` does not exist there), so the service
// supplies records to the worker and persists its `native-persist` reply.
//
// Fail-closed: any status/IPC error throws to the caller. NEVER falls back
// to IndexedDB/OPFS.

import { nativeRecordsToStudySnapshot } from './studyNativeStorage';
import {
  NATIVE_SCHEMA_VERSION,
  studyNativeBatch,
  studyNativeGet,
  studyNativeLoadAll,
  studyNativeStatus,
  type NativeStudyBatch,
  type NativeStudySnapshot,
} from './studyNativeIpc';
import type { ImportedLegalComponent, ImportedLegalDocument, StudyDataSnapshot } from './studyTypes';
import type {
  StudySearchDiagnostics,
  StudySearchIndexKind,
  StudySearchIndexMetadata,
} from './search/studySearchTypes';

export type NativeSearchIpc = {
  status: () => Promise<{ schema_version: number }>;
  loadAll: () => Promise<NativeStudySnapshot>;
  get: (_store: string, _key: string) => Promise<unknown | null>;
  batch: (_batch: NativeStudyBatch) => Promise<void>;
};

export const defaultNativeSearchIpc: NativeSearchIpc = {
  status: studyNativeStatus,
  loadAll: studyNativeLoadAll,
  get: studyNativeGet,
  batch: studyNativeBatch,
};

export const NATIVE_SEARCH_DB_VERSION = NATIVE_SCHEMA_VERSION;

const SEARCH_METADATA_KEY = 'current';
const artifactKeyOf = (kind: StudySearchIndexKind): string => `${kind}-fulltext`;

const ensureNativeReady = async (ipc: NativeSearchIpc): Promise<void> => {
  const status = await ipc.status();
  if (status.schema_version !== NATIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported native study schema version: ${status.schema_version}.`);
  }
};

const readMetadata = async (
  ipc: NativeSearchIpc,
): Promise<StudySearchIndexMetadata | null> => {
  const record = (await ipc.get('searchIndexMetadata', SEARCH_METADATA_KEY)) as
    | (StudySearchIndexMetadata & { id: string })
    | null;
  if (!record) return null;
  const { id: _id, ...metadata } = record;
  return metadata;
};

const readArtifactSerialized = async (
  ipc: NativeSearchIpc,
  kind: StudySearchIndexKind,
): Promise<string | null> => {
  const record = (await ipc.get('searchIndexArtifacts', artifactKeyOf(kind))) as {
    serialized: string;
  } | null;
  return record?.serialized ?? null;
};

export type NativeSearchBootstrap = {
  snapshot: StudyDataSnapshot;
  legalDocuments: ImportedLegalDocument[];
  legalComponents: ImportedLegalComponent[];
  cachedMetadata: StudySearchIndexMetadata | null;
  cachedOfficialSerialized: string | null;
  cachedStudySerialized: string | null;
};

export const loadNativeSearchBootstrap = async (
  ipc: NativeSearchIpc = defaultNativeSearchIpc,
): Promise<NativeSearchBootstrap> => {
  await ensureNativeReady(ipc);
  const snapshot = nativeRecordsToStudySnapshot(await ipc.loadAll());
  const [cachedMetadata, cachedOfficialSerialized, cachedStudySerialized] = await Promise.all([
    readMetadata(ipc),
    readArtifactSerialized(ipc, 'official'),
    readArtifactSerialized(ipc, 'study'),
  ]);
  return {
    snapshot,
    legalDocuments: snapshot.legalDocuments,
    legalComponents: snapshot.legalComponents,
    cachedMetadata,
    cachedOfficialSerialized,
    cachedStudySerialized,
  };
};

export type NativeStudyUpdatePayload = {
  snapshot: StudyDataSnapshot;
  cachedMetadata: StudySearchIndexMetadata | null;
};

export const loadNativeStudyUpdate = async (
  ipc: NativeSearchIpc = defaultNativeSearchIpc,
): Promise<NativeStudyUpdatePayload> => {
  await ensureNativeReady(ipc);
  const [snapshot, cachedMetadata] = await Promise.all([
    nativeRecordsToStudySnapshot(await ipc.loadAll()),
    readMetadata(ipc),
  ]);
  return { snapshot, cachedMetadata };
};

export const persistNativeSearchArtifacts = async (
  ipc: NativeSearchIpc,
  {
    metadata,
    officialSerialized,
    studySerialized,
  }: {
    metadata: StudySearchIndexMetadata;
    officialSerialized: string | null;
    studySerialized: string | null;
  },
): Promise<void> => {
  await ipc.batch({
    puts: [
      {
        store: 'searchIndexMetadata',
        key: SEARCH_METADATA_KEY,
        payload: { id: SEARCH_METADATA_KEY, ...metadata },
      },
      ...(officialSerialized !== null
        ? [
            {
              store: 'searchIndexArtifacts',
              key: artifactKeyOf('official'),
              payload: {
                id: artifactKeyOf('official'),
                kind: 'official',
                serialized: officialSerialized,
                updatedAt: new Date().toISOString(),
              },
            },
          ]
        : []),
      ...(studySerialized !== null
        ? [
            {
              store: 'searchIndexArtifacts',
              key: artifactKeyOf('study'),
              payload: {
                id: artifactKeyOf('study'),
                kind: 'study',
                serialized: studySerialized,
                updatedAt: new Date().toISOString(),
              },
            },
          ]
        : []),
    ],
  });
};

export const readNativeSearchDiagnostics = async (
  ipc: NativeSearchIpc = defaultNativeSearchIpc,
): Promise<StudySearchDiagnostics> => {
  await ensureNativeReady(ipc);
  const [metadata, officialSerialized, studySerialized] = await Promise.all([
    readMetadata(ipc),
    readArtifactSerialized(ipc, 'official'),
    readArtifactSerialized(ipc, 'study'),
  ]);
  const officialArtifactBytes = officialSerialized?.length ?? 0;
  const studyArtifactBytes = studySerialized?.length ?? 0;
  return {
    metadata,
    officialArtifactBytes,
    studyArtifactBytes,
    totalArtifactBytes: officialArtifactBytes + studyArtifactBytes,
  };
};
