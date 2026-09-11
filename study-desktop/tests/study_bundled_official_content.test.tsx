// Bundled official library boundary (Phase 5C/5D/5E/5O cases A/B/C/G).
//
// Mocked-bridge coverage over the platform-neutral seam:
// - A: genuinely empty DB + valid bundled text installs (history normal,
//   seeded content preserved, never overwritten).
// - B: existing official imports refuse the first-run install.
// - C: bundled matching current reports matches-current; a different valid
//   package previews differs-from-current and installs explicitly as an
//   update with appended history (no auto migration).
// - G: malformed resource text fails closed (no install, storage untouched).
// Plus: browser-shape unavailable bridge, pure guards, and the narrow IPC
// command surface (no path crosses the bridge).

/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { describePreviewDifference } from '../src/components/StudyManagePage.utils';
import {
  hasExistingOfficialImports,
  previewBundledPackageText,
  type BundledOfficialBridge,
} from '../src/studyBundledOfficialContent';
import {
  applyOfficialContentPackageToSnapshot,
  parseOfficialContentPackage,
} from '../src/studyOfficialContent';
import { createSeedStudyData } from '../src/studySeed';
import type { NbLawContentPackage } from '../src/content/nbLawTypes';
import type { StudyStorage } from '../src/studyStorageTypes';
import type { StudyDataSnapshot } from '../src/studyTypes';
import { useStudyBundledOfficialContent } from '../src/useStudyBundledOfficialContent';

const pilotPackage = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../study-content/packages/nb-law-pilot.content-package.json',
    ),
    'utf8',
  ),
) as NbLawContentPackage;

const bundledText = JSON.stringify(pilotPackage);
const seedIso = '2026-09-11T10:00:00.000Z';

const fakeBridge = (text: string): BundledOfficialBridge & { readCalls: number } => {
  const bridge = {
    readCalls: 0,
    getStatus: async () => ({ available: true as const, byteLength: text.length }),
    readPackageId: async () => (JSON.parse(text) as NbLawContentPackage).id,
    readPackageText: async () => {
      bridge.readCalls += 1;
      return text;
    },
  };
  return bridge;
};

const unavailableBridge: BundledOfficialBridge = {
  getStatus: async () => ({ available: false as const }),
  readPackageId: async () => {
    throw new Error('unavailable');
  },
  readPackageText: async () => {
    throw new Error('unavailable');
  },
};

type FakeStorage = StudyStorage & { importCalls: number };

const fakeStorage = (holder: { snapshot: StudyDataSnapshot }): FakeStorage => {
  const storage = {
    importCalls: 0,
    importOfficialContentPackage: async (contentPackage: NbLawContentPackage) => {
      storage.importCalls += 1;
      const { snapshot } = applyOfficialContentPackageToSnapshot({
        snapshot: holder.snapshot,
        contentPackage,
        importedAt: '2026-09-11T11:00:00.000Z',
      });
      holder.snapshot = snapshot;
      return snapshot;
    },
  };
  return storage as unknown as FakeStorage;
};

type HarnessApi = ReturnType<typeof useStudyBundledOfficialContent> & {
  data: StudyDataSnapshot | null;
  statusMessage: string;
};

const renderHarness = async (
  initial: StudyDataSnapshot,
  bridge: BundledOfficialBridge,
  storage: StudyStorage,
): Promise<{ api: () => HarnessApi; unmount: () => void }> => {
  let latest: HarnessApi | null = null;
  const Harness = () => {
    const [data, setData] = React.useState<StudyDataSnapshot | null>(initial);
    const [statusMessage, setStatusMessage] = React.useState('');
    const bundled = useStudyBundledOfficialContent({
      data,
      storage,
      setData,
      setStatusMessage,
      bridge,
    });
    // eslint-disable-next-line react-hooks/globals
    latest = { ...bundled, data, statusMessage };
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  // Let the status/id probe effect settle.
  await act(async () => {});
  return {
    api: () => {
      if (!latest) throw new Error('harness not rendered');
      return latest;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('bundled official content seam', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports empty guards honestly (case A precondition)', () => {
    const seed = createSeedStudyData(seedIso);
    expect(hasExistingOfficialImports(seed)).toBe(false);
    expect(
      hasExistingOfficialImports({ ...seed, legalDocuments: [], importHistory: [] }),
    ).toBe(false);
  });

  it('installs the bundled library on a genuinely empty DB with normal history (case A)', async () => {
    const seed = createSeedStudyData(seedIso);
    const seedDocCount = seed.documents.length;
    expect(seedDocCount).toBeGreaterThan(0);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const harness = await renderHarness(seed, fakeBridge(bundledText), storage);
    try {
      expect(harness.api().bundledStatus).toEqual({
        available: true,
        byteLength: bundledText.length,
      });
      expect(harness.api().bundledPackageId).toBe(pilotPackage.id);
      expect(harness.api().bundledFirstRunAvailable).toBe(true);
      await act(async () => {
        await harness.api().installBundledPackage();
      });
      const installed = harness.api().data;
      expect(installed?.legalDocuments).toHaveLength(pilotPackage.documents.length);
      expect(installed?.importHistory).toHaveLength(1);
      expect(installed?.importHistory[0]?.packageId).toBe(pilotPackage.id);
      // Seeded user content is enriched, never overwritten.
      expect(installed?.documents.length).toBeGreaterThanOrEqual(seedDocCount);
      expect(harness.api().statusMessage).toContain('Bundled official library installed');
      expect(harness.api().bundledFirstRunAvailable).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it('refuses the first-run install when official imports exist (case B)', async () => {
    const seed = createSeedStudyData(seedIso);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const first = await renderHarness(seed, fakeBridge(bundledText), storage);
    try {
      await act(async () => {
        await first.api().installBundledPackage();
      });
      expect(first.api().data?.importHistory).toHaveLength(1);
    } finally {
      first.unmount();
    }
    const callsAfterFirst = storage.importCalls;
    const second = await renderHarness(holder.snapshot, fakeBridge(bundledText), storage);
    try {
      await act(async () => {
        await second.api().installBundledPackage();
      });
      expect(storage.importCalls).toBe(callsAfterFirst);
      expect(second.api().data?.importHistory).toHaveLength(1);
      expect(second.api().statusMessage).toContain('refused');
    } finally {
      second.unmount();
    }
  });

  it('matches current after install and updates explicitly on a different package (case C)', async () => {
    const seed = createSeedStudyData(seedIso);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const harness = await renderHarness(seed, fakeBridge(bundledText), storage);
    try {
      await act(async () => {
        await harness.api().installBundledPackage();
      });
      await act(async () => {
        await harness.api().loadBundledPreview();
      });
      expect(harness.api().bundledPreview?.valid).toBe(true);
      const { buildCurrentOfficialPackageDiagnostics } =
        await import('../src/components/StudyManagePage.utils');
      // holder.snapshot keeps legalComponents (storage truth); the UI
      // snapshot clears them, so match against storage truth here.
      const current = buildCurrentOfficialPackageDiagnostics(holder.snapshot);
      const installedPreview = previewBundledPackageText(bundledText, holder.snapshot);
      expect(describePreviewDifference(current, installedPreview)).toBe('matches-current');
      // A different (renamed-id) valid package previews as different.
      const renamed = { ...pilotPackage, id: `${pilotPackage.id}-next` } as NbLawContentPackage;
      const different = previewBundledPackageText(JSON.stringify(renamed), harness.api().data!);
      expect(describePreviewDifference(current, different)).toBe('differs-from-current');
    } finally {
      harness.unmount();
    }
    // Explicit update appends history and keeps existing documents.
    const updater = await renderHarness(
      holder.snapshot,
      fakeBridge(JSON.stringify({ ...pilotPackage, id: `${pilotPackage.id}-next` })),
      storage,
    );
    try {
      const before = updater.api().data?.legalDocuments.length ?? 0;
      await act(async () => {
        await updater.api().installBundledUpdate();
      });
      expect(updater.api().data?.importHistory).toHaveLength(2);
      expect(updater.api().data?.legalDocuments.length).toBeGreaterThanOrEqual(before);
      expect(updater.api().statusMessage).toContain('updated');
    } finally {
      updater.unmount();
    }
  });

  it('fails closed on malformed bundled text without touching storage (case G)', async () => {
    const seed = createSeedStudyData(seedIso);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const harness = await renderHarness(seed, fakeBridge('not-json{{{'), storage);
    try {
      await act(async () => {
        await harness.api().loadBundledPreview();
      });
      expect(harness.api().bundledPreview).toBeNull();
      expect(harness.api().bundledPreviewError).toBeTruthy();
      await act(async () => {
        await harness.api().installBundledPackage();
      });
      expect(storage.importCalls).toBe(0);
      expect(harness.api().data?.legalDocuments).toHaveLength(0);
      expect(harness.api().statusMessage).toContain('failed');
    } finally {
      harness.unmount();
    }
  });

  it('fails closed on schema-invalid bundled JSON without touching storage (case G)', async () => {
    const seed = createSeedStudyData(seedIso);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const harness = await renderHarness(seed, fakeBridge('{"id":"","schemaVersion":99}'), storage);
    try {
      await act(async () => {
        await harness.api().loadBundledPreview();
      });
      expect(harness.api().bundledPreview).toBeNull();
      expect(harness.api().bundledPreviewError).toBeTruthy();
      expect(storage.importCalls).toBe(0);
    } finally {
      harness.unmount();
    }
  });

  it('treats an unavailable bridge as no bundled library (browser-safe fallback)', async () => {
    const seed = createSeedStudyData(seedIso);
    const holder = { snapshot: seed };
    const storage = fakeStorage(holder);
    const harness = await renderHarness(seed, unavailableBridge, storage);
    try {
      expect(harness.api().bundledStatus).toEqual({ available: false });
      expect(harness.api().bundledPackageId).toBeNull();
      expect(harness.api().bundledFirstRunAvailable).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it('parses the real pilot package through the shared core (no duplicate importer)', () => {
    expect(parseOfficialContentPackage(bundledText).id).toBe(pilotPackage.id);
  });

  it('exposes only narrow commands with no path crossing the IPC bridge', async () => {
    const { readFile } = await import('node:fs/promises');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const ipcSource = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/studyNativeIpc.ts'),
      'utf8',
    );
    expect(ipcSource).toContain('study_bundled_official_package_status');
    expect(ipcSource).toContain('study_bundled_official_package_id');
    expect(ipcSource).toContain('study_bundled_official_package_read');
    expect(ipcSource).not.toMatch(/study_bundled_official_package_(read|status)\s*\(.*path/i);
  });
});
