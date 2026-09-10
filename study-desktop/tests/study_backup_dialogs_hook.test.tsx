/** @vitest-environment jsdom */

// Phase 3E hook tests for the native backup dialogs (mocked boundary +
// mocked storage; no Tauri runtime). Browser textarea/file-input/export-text
// behavior is untouched; these cover only the new native actions.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeedStudyData } from '../src/studySeed';
import { exportStudyData } from '../src/studyExportImport';
import type { StudyDataSnapshot } from '../src/studyTypes';
import { useStudyApp } from '../src/useStudyApp';

const dialogStubs = vi.hoisted(() => ({
  open: async (): Promise<{ cancelled: true } | { cancelled: false; text: string }> => ({
    cancelled: true,
  }),
  save: async (): Promise<{ cancelled: boolean; bytes?: number }> => ({ cancelled: true }),
  replaceAll: vi.fn(),
  snapshot: null as StudyDataSnapshot | null,
}));

vi.mock('../src/studyFileInteractions', () => ({
  createStudyFileInteractions: () => ({
    platform: 'tauri',
    canUseNativeBackupDialogs: true,
    openBackupForImport: () => dialogStubs.open(),
    saveBackupExport: () => dialogStubs.save(),
  }),
}));

vi.mock('../src/studyStorage', () => ({
  createStudyStorage: () => ({
    loadAll: vi.fn(async () => dialogStubs.snapshot),
    replaceAll: dialogStubs.replaceAll,
    saveDraft: vi.fn(),
    saveRatedAttempt: vi.fn(),
    saveSchedulingUndo: vi.fn(),
    saveSettings: vi.fn(),
  }),
  STUDY_SCHEMA_VERSION: 5,
  STUDY_DB_NAME: 'webnet.study.v1',
  STUDY_DB_VERSION: 1,
  migrateStudySnapshot: (input: Partial<StudyDataSnapshot>) => input,
}));

type HookValue = ReturnType<typeof useStudyApp>;

const HookHarness = ({ onValue }: { onValue: (_value: HookValue) => void }) => {
  const value = useStudyApp();
  React.useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
};

describe('native backup dialog actions', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const hookValue: { current: HookValue | null } = { current: null };

  beforeEach(async () => {
    dialogStubs.snapshot = createSeedStudyData('2026-08-01T10:00:00.000Z');
    dialogStubs.replaceAll.mockClear().mockImplementation(async () => {});
    dialogStubs.open = async () => ({ cancelled: true });
    dialogStubs.save = async () => ({ cancelled: true });
    window.history.replaceState(null, '', '/study/manage');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<HookHarness onValue={(value) => { hookValue.current = value; }} />);
    });
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    hookValue.current = null;
  });

  it('cancelled import is a no-op (no replaceAll, no status change)', async () => {
    const before = hookValue.current?.statusMessage;
    await act(async () => {
      await hookValue.current?.importBackupFromFile();
    });
    expect(dialogStubs.replaceAll).not.toHaveBeenCalled();
    expect(hookValue.current?.statusMessage).toBe(before);
  });

  it('valid backup imports through the existing replaceAll semantics', async () => {
    const text = exportStudyData(createSeedStudyData('2026-09-01T10:00:00.000Z'));
    dialogStubs.open = async () => ({ cancelled: false, text });
    await act(async () => {
      await hookValue.current?.importBackupFromFile();
    });
    expect(dialogStubs.replaceAll).toHaveBeenCalledTimes(1);
    expect(hookValue.current?.statusMessage).toBe('Study backup imported from file.');
  });

  it('invalid backup surfaces a failure without touching storage', async () => {
    dialogStubs.open = async () => ({ cancelled: false, text: 'not json' });
    await act(async () => {
      await hookValue.current?.importBackupFromFile();
    });
    expect(dialogStubs.replaceAll).not.toHaveBeenCalled();
    expect(hookValue.current?.statusMessage).toMatch(/^Study backup import failed: /);
  });

  it('storage failure during import surfaces a failure', async () => {
    const text = exportStudyData(createSeedStudyData('2026-09-01T10:00:00.000Z'));
    dialogStubs.open = async () => ({ cancelled: false, text });
    dialogStubs.replaceAll.mockRejectedValueOnce(new Error('disk gone'));
    await act(async () => {
      await hookValue.current?.importBackupFromFile();
    });
    expect(hookValue.current?.statusMessage).toBe('Study backup import failed: disk gone');
  });

  it('cancelled export is a no-op', async () => {
    const before = hookValue.current?.statusMessage;
    await act(async () => {
      await hookValue.current?.exportBackupToFile();
    });
    expect(hookValue.current?.statusMessage).toBe(before);
  });

  it('successful export reports bytes', async () => {
    dialogStubs.save = async () => ({ cancelled: false, bytes: 1234 });
    await act(async () => {
      await hookValue.current?.exportBackupToFile();
    });
    expect(hookValue.current?.statusMessage).toBe('Study backup saved (1234 bytes).');
  });

  it('dialog rejection during import surfaces a failure without touching storage', async () => {
    dialogStubs.open = async () => {
      throw new Error('dialog closed unexpectedly');
    };
    await act(async () => {
      await hookValue.current?.importBackupFromFile();
    });
    expect(dialogStubs.replaceAll).not.toHaveBeenCalled();
    expect(hookValue.current?.statusMessage).toBe(
      'Study backup import failed: dialog closed unexpectedly',
    );
  });

  it('dialog rejection during export surfaces a failure', async () => {
    dialogStubs.save = async () => {
      throw new Error('IPC down');
    };
    await act(async () => {
      await hookValue.current?.exportBackupToFile();
    });
    expect(hookValue.current?.statusMessage).toBe('Study backup export failed: IPC down');
  });
});
