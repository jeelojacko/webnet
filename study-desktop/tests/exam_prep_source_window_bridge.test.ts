/** @vitest-environment jsdom */

// Study source secondary-window bridge (Phase 4C).
//
// Browser hosts keep the exact `window.open(path, '_blank',
// 'noopener,noreferrer')` transport with the same provision deep-link URLs.
// The Tauri desktop path never touches `window.open`: two stable native
// windows (library + reader) are created once, reused + focused for the same
// URL, navigated (close + recreate under the same label) for a new URL, and
// every failure is explicit — never a silent browser fallback.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTauriSourceWindowBridge,
  resolveSourceWindowBridge,
  resolveSourceWindowLabel,
  SOURCE_LIBRARY_WINDOW_LABEL,
  SOURCE_READER_WINDOW_LABEL,
  type SourceWindowTauriDeps,
} from '../src/studySourceWindowBridge';
import { STUDY_LIBRARY_PATH, studyProvisionPath } from '../src/studyWindow';

const provisionPath = studyProvisionPath('doc-registry-act', 'section:34');

const createMockDeps = () => {
  const created: Array<{ label: string; url: string }> = [];
  const focusCalls: string[] = [];
  const closeCalls: string[] = [];
  const live = new Map<string, { setFocus: () => Promise<void>; close: () => Promise<void> }>();
  let failCreate = false;
  let failGetByLabel = false;
  const deps: SourceWindowTauriDeps = {
    getByLabel: async (label) => {
      if (failGetByLabel) throw new Error('getByLabel failed');
      return live.get(label) ?? null;
    },
    create: async (label, url) => {
      if (failCreate) throw new Error('native create failed');
      created.push({ label, url });
      const handle = {
        setFocus: async () => {
          focusCalls.push(label);
        },
        close: async () => {
          closeCalls.push(label);
          live.delete(label);
        },
      };
      live.set(label, handle);
      return handle;
    },
  };
  return {
    deps,
    state: {
      created,
      focusCalls,
      closeCalls,
      setFailCreate: (value: boolean) => {
        failCreate = value;
      },
      setFailGetByLabel: (value: boolean) => {
        failGetByLabel = value;
      },
    },
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('source window label routing', () => {
  it('keeps library paths on the library window and reads elsewhere', () => {
    expect(resolveSourceWindowLabel(STUDY_LIBRARY_PATH)).toBe(SOURCE_LIBRARY_WINDOW_LABEL);
    expect(resolveSourceWindowLabel(`${STUDY_LIBRARY_PATH}?studyPicker=locate&t=1&s=2`)).toBe(
      SOURCE_LIBRARY_WINDOW_LABEL,
    );
    expect(resolveSourceWindowLabel(provisionPath)).toBe(SOURCE_READER_WINDOW_LABEL);
    expect(resolveSourceWindowLabel('/study/learn#unit-1')).toBe(SOURCE_READER_WINDOW_LABEL);
  });
});

describe('browser source window bridge', () => {
  it('opens the library with window.open _blank + noopener,noreferrer exactly', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const bridge = resolveSourceWindowBridge();
    expect(bridge.platform).toBe('browser');
    await expect(bridge.openLibrary()).resolves.toEqual({ opened: true });
    expect(openSpy).toHaveBeenCalledWith(STUDY_LIBRARY_PATH, '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('opens provisions on the reader deep-link URL a null handle still counts as opened', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const bridge = resolveSourceWindowBridge();
    await expect(bridge.openProvision('doc-registry-act', 'section:34')).resolves.toEqual({
      opened: true,
    });
    expect(openSpy).toHaveBeenCalledWith(provisionPath, '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('surfaces only a genuine synchronous exception as a failure', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked by policy');
    });
    const bridge = resolveSourceWindowBridge();
    const result = await bridge.openPath(provisionPath);
    expect(result.opened).toBe(false);
    if (!result.opened) expect(result.error).toBe('blocked by policy');
    openSpy.mockRestore();
  });
});

describe('Tauri source window bridge', () => {
  it('creates stable library and reader windows with the requested URLs', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriSourceWindowBridge(deps);
    expect(bridge.platform).toBe('tauri');

    await expect(bridge.openLibrary()).resolves.toEqual({ opened: true });
    await expect(bridge.openProvision('doc-registry-act', 'section:34')).resolves.toEqual({
      opened: true,
    });
    expect(state.created).toEqual([
      { label: SOURCE_LIBRARY_WINDOW_LABEL, url: STUDY_LIBRARY_PATH },
      { label: SOURCE_READER_WINDOW_LABEL, url: provisionPath },
    ]);
  });

  it('reuses and focuses the same window for the same URL instead of recreating', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriSourceWindowBridge(deps);

    await bridge.openProvision('doc-registry-act', 'section:34');
    await expect(bridge.openProvision('doc-registry-act', 'section:34')).resolves.toEqual({
      opened: true,
    });
    expect(state.created).toHaveLength(1);
    expect(state.focusCalls).toEqual([SOURCE_READER_WINDOW_LABEL]);
    expect(state.closeCalls).toEqual([]);
  });

  it('navigates the stable window (close + recreate under the same label) for a new URL', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriSourceWindowBridge(deps);

    await bridge.openProvision('doc-registry-act', 'section:34');
    const next = studyProvisionPath('doc-registry-act', 'section:35');
    await expect(bridge.openProvision('doc-registry-act', 'section:35')).resolves.toEqual({
      opened: true,
    });
    expect(state.closeCalls).toEqual([SOURCE_READER_WINDOW_LABEL]);
    expect(state.created).toEqual([
      { label: SOURCE_READER_WINDOW_LABEL, url: provisionPath },
      { label: SOURCE_READER_WINDOW_LABEL, url: next },
    ]);
    // The recreated window serves the new URL without another recreate.
    await bridge.openProvision('doc-registry-act', 'section:35');
    expect(state.created).toHaveLength(2);
    expect(state.focusCalls).toEqual([SOURCE_READER_WINDOW_LABEL]);
  });

  it('never touches window.open on the desktop path', async () => {
    const { deps } = createMockDeps();
    const bridge = createTauriSourceWindowBridge(deps);
    const openSpy = vi.spyOn(window, 'open');

    await bridge.openLibrary();
    await bridge.openProvision('doc-registry-act', 'section:34');
    await bridge.openProvision('doc-registry-act', 'section:34');
    await bridge.openPath('/study/learn#unit-1');

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('surfaces native failures explicitly instead of falling back to window.open', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriSourceWindowBridge(deps);
    const openSpy = vi.spyOn(window, 'open');

    state.setFailCreate(true);
    const created = await bridge.openLibrary();
    expect(created.opened).toBe(false);
    if (!created.opened) expect(created.error).toBe('native create failed');

    state.setFailCreate(false);
    state.setFailGetByLabel(true);
    const listed = await bridge.openLibrary();
    expect(listed.opened).toBe(false);
    if (!listed.opened) expect(listed.error).toBe('getByLabel failed');

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('resolves the Tauri bridge inside the Tauri runtime with injected deps', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const { deps } = createMockDeps();
      const bridge = resolveSourceWindowBridge(deps);
      expect(bridge.platform).toBe('tauri');
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
    expect(resolveSourceWindowBridge().platform).toBe('browser');
  });

  it('reuses resolved Tauri bridge state across caller lookups', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const { deps, state } = createMockDeps();
      const first = resolveSourceWindowBridge(deps);
      const second = resolveSourceWindowBridge(deps);
      expect(second).toBe(first);
      await first.openProvision('doc-registry-act', 'section:34');
      await second.openProvision('doc-registry-act', 'section:34');
      expect(state.created).toHaveLength(1);
      expect(state.focusCalls).toEqual([SOURCE_READER_WINDOW_LABEL]);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
