// Study — platform-neutral file interaction boundary (Phase 3B).
//
// The ONLY place that selects between browser and native Study backup file
// interactions. Components/hooks call this boundary; nothing else checks the
// host platform for file selection. Browser behavior is unchanged (file
// input, textarea import, export text); the Tauri path opens the coupled
// Rust dialog commands (`study_backup_*`: dialog + read/write in one call,
// no path ever crosses the bridge).

import {
  studyNativeBackupExport,
  studyNativeBackupImport,
} from './studyNativeIpc';
import {
  resolveStudyStoragePlatform,
  type StudyStoragePlatform,
} from './studyStoragePlatform';

/// Suggested backup file extension (matches the Rust Save dialog default).
export const STUDY_BACKUP_FILE_EXTENSION = '.json';

export type StudyBackupOpenOutcome =
  | { cancelled: true }
  | { cancelled: false; text: string };

export type StudyBackupSaveOutcome =
  | { cancelled: true }
  | { cancelled: false; bytes: number };

export interface StudyFileInteractionDeps {
  platform?: StudyStoragePlatform;
  openNativeBackup?: () => Promise<{ cancelled: boolean; contents?: string | null }>;
  saveNativeBackup?: (_contents: string) => Promise<{ cancelled: boolean; bytes?: number }>;
}

export interface StudyFileInteractions {
  readonly platform: StudyStoragePlatform;
  readonly canUseNativeBackupDialogs: boolean;
  openBackupForImport(): Promise<StudyBackupOpenOutcome>;
  saveBackupExport(_exportText: string): Promise<StudyBackupSaveOutcome>;
}

/// UTF-8 byte length of export text (what the native Save reports back).
export const backupByteLength = (text: string): number =>
  new TextEncoder().encode(text).length;

export const createStudyFileInteractions = (
  deps: StudyFileInteractionDeps = {},
): StudyFileInteractions => {
  const platform = deps.platform ?? resolveStudyStoragePlatform();
  const canUseNativeBackupDialogs = platform === 'tauri';
  const openNativeBackup = deps.openNativeBackup ?? studyNativeBackupImport;
  const saveNativeBackup = deps.saveNativeBackup ?? studyNativeBackupExport;
  // Selection/transport only: validation, parsing, and storage writes stay
  // with the caller (`parseStudyImport` + `storage.replaceAll`), so the
  // browser import path keeps its exact semantics.
  if (!canUseNativeBackupDialogs) {
    const unavailable = (): Promise<never> =>
      Promise.reject(new Error('Native backup dialogs are not available in the browser.'));
    return {
      platform,
      canUseNativeBackupDialogs,
      openBackupForImport: unavailable,
      saveBackupExport: unavailable,
    };
  }
  return {
    platform,
    canUseNativeBackupDialogs,
    openBackupForImport: async () => {
      const result = await openNativeBackup();
      if (result.cancelled) return { cancelled: true as const };
      return { cancelled: false as const, text: result.contents ?? '' };
    },
    saveBackupExport: async (exportText: string) => {
      const result = await saveNativeBackup(exportText);
      if (result.cancelled) return { cancelled: true as const };
      return { cancelled: false as const, bytes: result.bytes ?? 0 };
    },
  };
};
