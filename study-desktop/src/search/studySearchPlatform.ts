// Study search — backend selection seam (Phase 2G).
//
// Single centralized place that decides which search backend the
// `StudySearchService` uses. Browser/standalone hosts keep the direct
// IndexedDB worker path; the Tauri desktop runtime uses the native bootstrap
// path (main-thread-supplied records + native IPC/SQLite artifacts). No
// scattered host checks elsewhere.

import { resolveStudyStoragePlatform } from '../studyStoragePlatform';

export type StudySearchBackend = 'indexeddb' | 'native';

export const resolveStudySearchBackend = (): StudySearchBackend =>
  resolveStudyStoragePlatform() === 'tauri' ? 'native' : 'indexeddb';
