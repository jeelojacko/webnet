// Phase 3B–3E file interaction boundary tests (mocked; no Tauri runtime).
//
// Browser selection (existing file input, textarea import, export text) is
// unchanged: the boundary reports no native dialogs there. Native selection
// maps the coupled Rust dialog results; validation/parsing stays in
// TypeScript (`parseStudyImport` + existing `replaceAll` semantics).

import { describe, expect, it } from 'vitest';
import { exportStudyData, parseStudyImport } from '../src/studyExportImport';
import { createEmptyStudyData } from '../src/studySeed';
import { STUDY_SCHEMA_VERSION } from '../src/studyStorage';
import {
  STUDY_BACKUP_FILE_EXTENSION,
  backupByteLength,
  createStudyFileInteractions,
} from '../src/studyFileInteractions';

describe('study file interaction boundary', () => {
  it('browser platform exposes no native backup dialogs', async () => {
    const interactions = createStudyFileInteractions({ platform: 'browser' });
    expect(interactions.canUseNativeBackupDialogs).toBe(false);
    await expect(interactions.openBackupForImport()).rejects.toThrow('browser');
    await expect(interactions.saveBackupExport('{}')).rejects.toThrow('browser');
  });

  it('native cancelled selection maps to a no-op outcome', async () => {
    const interactions = createStudyFileInteractions({
      platform: 'tauri',
      openNativeBackup: async () => ({ cancelled: true }),
      saveNativeBackup: async () => ({ cancelled: true }),
    });
    expect(interactions.canUseNativeBackupDialogs).toBe(true);
    expect(await interactions.openBackupForImport()).toEqual({ cancelled: true });
    expect(await interactions.saveBackupExport('{}')).toEqual({ cancelled: true });
  });

  it('native selection returns the dialog-read backup text', async () => {
    const interactions = createStudyFileInteractions({
      platform: 'tauri',
      openNativeBackup: async () => ({ cancelled: false, contents: '{"a":1}' }),
    });
    expect(await interactions.openBackupForImport()).toEqual({
      cancelled: false,
      text: '{"a":1}',
    });
  });

  it('native save returns the written byte count', async () => {
    const interactions = createStudyFileInteractions({
      platform: 'tauri',
      saveNativeBackup: async () => ({ cancelled: false, bytes: 42 }),
    });
    expect(await interactions.saveBackupExport('{}')).toEqual({
      cancelled: false,
      bytes: 42,
    });
  });

  it('native transport failures propagate instead of faking success', async () => {
    const interactions = createStudyFileInteractions({
      platform: 'tauri',
      openNativeBackup: async () => {
        throw new Error('read backup: denied');
      },
      saveNativeBackup: async () => {
        throw new Error('publish backup: disk full');
      },
    });
    await expect(interactions.openBackupForImport()).rejects.toThrow('denied');
    await expect(interactions.saveBackupExport('{}')).rejects.toThrow('disk full');
  });

  it('export byte length is exact UTF-8 with a JSON extension', () => {
    expect(STUDY_BACKUP_FILE_EXTENSION).toBe('.json');
    expect(backupByteLength('{"a":1}')).toBe(7);
    expect(backupByteLength('é')).toBe(2);
  });

  it('valid backup round-trips through the existing export/import format', () => {
    const text = exportStudyData(createEmptyStudyData(), '2026-09-10T00:00:00.000Z');
    const snapshot = parseStudyImport(text);
    expect(snapshot.schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(backupByteLength(text)).toBeGreaterThan(0);
  });

  it('invalid and incompatible backups fail in TypeScript parsing', () => {
    expect(() => parseStudyImport('not json')).toThrow();
    expect(() => parseStudyImport('null')).toThrow();
    expect(() => parseStudyImport('')).toThrow();
  });
});
