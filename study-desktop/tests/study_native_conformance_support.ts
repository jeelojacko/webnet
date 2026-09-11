// Study native conformance/parity test support (Phase 2H+2I).
//
// In-memory fakes for the narrow native IPC surfaces: the JSON-record stores
// (`createNativeStudyStorage` injection) and the asset byte store
// (`saveStudyTextAsset` injection). The record backend enforces CAS
// conditions and the one-active-mock uniqueness guard atomically, like the
// Rust transaction; the file backend enforces the Rust logical-path prefix
// rules so traversal rejections propagate. No Tauri runtime, no IndexedDB.

import type { NativeStudyBatch, NativeStudyPut } from '../src/studyNativeIpc';

type Row = Record<string, unknown>;

export const createFakeNativeIpc = (
  statusImpl?: () => Promise<{ schema_version: number }>,
) => {
  const stores = new Map<string, Map<string, unknown>>();
  const batches: NativeStudyBatch[] = [];
  const puts: NativeStudyPut[] = [];
  const table = (store: string): Map<string, unknown> => {
    let t = stores.get(store);
    if (!t) {
      t = new Map();
      stores.set(store, t);
    }
    return t;
  };
  const checkCondition = (c: NonNullable<NativeStudyBatch['conditions']>[number]): void => {
    const existing = table(c.store).get(c.key) as Row | undefined;
    const ok =
      c.expected.kind === 'absent'
        ? existing === undefined
        : c.expected.kind === 'updated_at_equals'
          ? existing?.['updatedAt'] === undefined || existing['updatedAt'] === c.expected.updated_at
          : existing?.['updatedAt'] === c.expected.updated_at;
    if (!ok) throw new Error(c.message);
  };
  return {
    batches,
    puts,
    stores,
    status: statusImpl ?? (async () => ({ schema_version: 1 })),
    batch: async (batch: NativeStudyBatch): Promise<void> => {
      batches.push(batch);
      for (const c of batch.conditions ?? []) checkCondition(c);
      const guard = batch.uniqueness_guard;
      if (guard) {
        for (const [key, value] of table(guard.store)) {
          const row = value as Row;
          if (
            key !== guard.except_key &&
            row['status'] === guard.active_status &&
            Object.entries(guard.field_equals).every(([f, v]) => row[f] === v)
          ) {
            throw new Error(guard.message);
          }
        }
      }
      for (const store of batch.clears ?? []) table(store).clear();
      for (const put of batch.puts ?? []) table(put.store).set(put.key, put.payload);
      for (const del of batch.deletes ?? []) table(del.store).delete(del.key);
    },
    loadAll: async (): Promise<Record<string, unknown[]>> => {
      const out: Record<string, unknown[]> = {};
      for (const [store, t] of stores) out[store] = [...t.values()];
      return out;
    },
    get: async (store: string, key: string): Promise<unknown | null> =>
      table(store).get(key) ?? null,
    put: async (put: NativeStudyPut): Promise<void> => {
      puts.push(put);
      table(put.store).set(put.key, put.payload);
    },
    queryField: async (store: string, field: string, value: string): Promise<unknown[]> =>
      [...table(store).values()].filter((v) => (v as Row)[field] === value),
  };
};

export type FakeNativeIpc = ReturnType<typeof createFakeNativeIpc>;

const FILES_PREFIX = 'study/documents/';

const checkAssetPath = (path: string): void => {
  if (!path.startsWith(FILES_PREFIX)) {
    throw new Error('rejected study file path: must start with study/documents/');
  }
  const rest = path.slice(FILES_PREFIX.length);
  if (
    !rest ||
    path.includes('\\') ||
    path.includes('\0') ||
    rest.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`rejected study file path: bad segment: ${path}`);
  }
};

export const createFakeNativeFiles = () => {
  const files = new Map<string, number[]>();
  const writes: { path: string; byteLength: number }[] = [];
  return {
    files,
    writes,
    write: async (path: string, contents: number[]): Promise<number> => {
      checkAssetPath(path);
      files.set(path, [...contents]);
      writes.push({ path, byteLength: contents.length });
      return contents.length;
    },
    read: async (path: string): Promise<number[]> => {
      checkAssetPath(path);
      const bytes = files.get(path);
      if (!bytes) throw new Error(`read asset: not found: ${path}`);
      return [...bytes];
    },
  };
};

export type FakeNativeFiles = ReturnType<typeof createFakeNativeFiles>;
