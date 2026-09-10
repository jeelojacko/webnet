// Study — narrow Tauri IPC module for native persistence (Phase 2E).
//
// The ONLY place that touches `@tauri-apps/api/core` `invoke` for Study
// storage. The native adapter (`studyNativeStorage.ts`) calls these helpers;
// components/hooks never import this module (or `invoke`) directly, and no
// SQL or platform check lives outside the storage seam. Every function maps
// 1:1 to a Rust command in `src-tauri/src/study_store.rs` carrying opaque
// `{store, key, payload}` JSON — no raw SQL crosses the bridge.

type InvokeFn = <T>(_cmd: string, _args?: Record<string, unknown>) => Promise<T>;

// Resolved lazily (and only) on the Tauri runtime so browser bundles and
// non-Tauri test tiers never require the Tauri package to be resolvable.
// The variable specifier keeps bundlers from statically pulling it in.
const loadInvoke = (): Promise<InvokeFn> => {
  const specifier = '@tauri-apps/api/core';
  return import(/* @vite-ignore */ specifier).then(
    (mod: unknown) => (mod as { invoke: InvokeFn }).invoke,
  );
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (await loadInvoke())<T>(cmd, args);
}

export interface NativeStudyStatus {
  db_path: string;
  schema_version: number;
  stores: string[];
}

export interface NativeStudyPut {
  store: string;
  key: string;
  payload: unknown;
}

export interface NativeStudyKey {
  store: string;
  key: string;
}

export type NativeStudyExpected =
  | { kind: 'absent' }
  | { kind: 'updated_at_equals'; updated_at: string }
  | { kind: 'present_with_updated_at'; updated_at: string };

export interface NativeStudyCondition {
  store: string;
  key: string;
  expected: NativeStudyExpected;
  message: string;
}

export interface NativeStudyUniquenessGuard {
  store: string;
  except_key: string;
  active_status: string;
  field_equals: Record<string, string>;
  message: string;
}

export interface NativeStudyBatch {
  clears?: string[];
  puts?: NativeStudyPut[];
  deletes?: NativeStudyKey[];
  conditions?: NativeStudyCondition[];
  uniqueness_guard?: NativeStudyUniquenessGuard;
}

export type NativeStudySnapshot = Record<string, unknown[]>;

export const NATIVE_SCHEMA_VERSION = 1;

export const studyNativeStatus = (): Promise<NativeStudyStatus> =>
  invoke<NativeStudyStatus>('study_native_status');

export const studyNativeBatch = (batch: NativeStudyBatch): Promise<void> =>
  invoke<void>('study_native_batch', { batch });

export const studyNativeLoadAll = (): Promise<NativeStudySnapshot> =>
  invoke<NativeStudySnapshot>('study_native_load_all');

export const studyNativeListStore = (store: string): Promise<unknown[]> =>
  invoke<unknown[]>('study_native_list_store', { input: { store } });

export const studyNativeQueryField = (
  store: string,
  field: string,
  value: string,
): Promise<unknown[]> =>
  invoke<unknown[]>('study_native_query_field', { input: { store, field, value } });

export const studyNativeGet = (
  store: string,
  key: string,
): Promise<unknown | null> =>
  invoke<unknown | null>('study_native_get', { input: { store, key } });

export const studyNativePut = (put: NativeStudyPut): Promise<void> =>
  invoke<void>('study_native_put', { input: put });

// ---- Study document asset files (Rust `study_files.rs`, Phase 2D) ----
//
// Narrow typed bridge for the platform-neutral asset boundary
// (`studyFileAssets.ts`). Logical paths keep the browser OPFS namespace
// (`study/documents/...`); Rust validates/traverses-safely and stores bytes
// natively. Contents cross the bridge as a JSON number array (serde
// `Vec<u8>`); callers convert via TextEncoder/TextDecoder.

export const studyNativeFilesStatus = (): Promise<{ root: string }> =>
  invoke<{ root: string }>('study_files_status');

export const studyNativeFilesWrite = (path: string, contents: number[]): Promise<number> =>
  invoke<number>('study_files_write', { input: { path, contents } });

export const studyNativeFilesRead = (path: string): Promise<number[]> =>
  invoke<number[]>('study_files_read', { input: { path } });

export const studyNativeFilesDelete = (path: string): Promise<void> =>
  invoke<void>('study_files_delete', { input: { path } });

export const studyNativeFilesExists = (path: string): Promise<boolean> =>
  invoke<boolean>('study_files_exists', { input: { path } });
