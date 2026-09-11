// Study — persistence platform selection seam (Phase 2B/2E).
//
// Single centralized place that decides which StudyStorage adapter the
// composition root (`createStudyStorage`) returns. Browser/standalone hosts
// use the IndexedDB adapter; the Tauri desktop runtime uses the native
// SQLite adapter. No scattered host checks elsewhere.

export type StudyStoragePlatform = 'browser' | 'tauri';

const hasTauriRuntime = (): boolean => {
  if (typeof globalThis.window === 'undefined') return false;
  const w = globalThis.window as unknown as Record<string, unknown>;
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w;
};

export const resolveStudyStoragePlatform = (): StudyStoragePlatform =>
  hasTauriRuntime() ? 'tauri' : 'browser';
