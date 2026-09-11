// Study — platform-neutral source secondary-window bridge (Phase 4C).
//
// Single seam deciding how "open in a new window" source actions behave.
// Browsers keep the existing transport EXACTLY: `window.open` with
// `'_blank','noopener,noreferrer'` via `studyWindow` (same deep-link URLs,
// same null-WindowProxy contract). The Tauri desktop runtime uses two stable
// native WebviewWindows (one statute-library window, one source-reader
// window): an existing window is focused and reused, a new URL navigates it
// by deterministic close + recreate under the same label, and every failure
// is explicit (`{ opened: false }`) — never a silent fallback to
// `window.open`. No PDF/corpus or reader-presentation changes here; only the
// window transport differs.

import { openStudyUrlNewTab, STUDY_LIBRARY_PATH, studyProvisionPath } from './studyWindow';
import { resolveStudyStoragePlatform } from './studyStoragePlatform';

/** Stable native window for the statute library (one persistent window). */
export const SOURCE_LIBRARY_WINDOW_LABEL = 'study-source-library';

/** Stable native window for source-reader deep links (one persistent window). */
export const SOURCE_READER_WINDOW_LABEL = 'study-source-reader';

export type SourceWindowOpenResult = { opened: true } | { opened: false; error: string };

/** Minimal injectable Tauri surface (mocked in tests; lazy real import below). */
export type SourceWindowTauriHandle = {
  setFocus: () => Promise<void>;
  close: () => Promise<void>;
};

export type SourceWindowTauriDeps = {
  getByLabel: (_label: string) => Promise<SourceWindowTauriHandle | null>;
  create: (_label: string, _url: string) => Promise<SourceWindowTauriHandle>;
};

type WebviewWindowModule = {
  WebviewWindow: {
    getByLabel: (_label: string) => Promise<SourceWindowTauriHandle | null>;
    new (_label: string, _options?: unknown): SourceWindowTauriHandle;
  };
};

// Lazy real Tauri bindings (desktop runtime only). Variable specifiers keep
// bundlers from statically pulling `@tauri-apps/api` into browser bundles.
const loadTauriDeps = async (): Promise<SourceWindowTauriDeps> => {
  const windowMod = await import(
    /* @vite-ignore */ '@tauri-apps/api/webviewWindow'
  ) as WebviewWindowModule;
  return {
    getByLabel: (label) => windowMod.WebviewWindow.getByLabel(label),
    create: async (label, url) => {
      const created = new windowMod.WebviewWindow(label, {
        url,
        title: label === SOURCE_LIBRARY_WINDOW_LABEL ? 'Statute Library' : 'Source Reader',
        width: 1100,
        height: 800,
      });
      return created;
    },
  };
};

let cachedTauriDeps: Promise<SourceWindowTauriDeps> | null = null;
const defaultTauriDeps = (): Promise<SourceWindowTauriDeps> =>
  (cachedTauriDeps ??= loadTauriDeps());

/** Library paths share one window; every other Study path reads in the reader window. */
export const resolveSourceWindowLabel = (path: string): string =>
  path === STUDY_LIBRARY_PATH || path.startsWith(`${STUDY_LIBRARY_PATH}?`) ||
      path.startsWith(`${STUDY_LIBRARY_PATH}#`) || path.startsWith(`${STUDY_LIBRARY_PATH}/`)
    ? SOURCE_LIBRARY_WINDOW_LABEL
    : SOURCE_READER_WINDOW_LABEL;

export interface SourceWindowBridge {
  readonly platform: 'browser' | 'tauri';
  openPath: (_path: string) => Promise<SourceWindowOpenResult>;
  openLibrary: () => Promise<SourceWindowOpenResult>;
  openProvision: (_documentId: string, _sourceKey: string) => Promise<SourceWindowOpenResult>;
}

const toOpenResult = (path: string): SourceWindowOpenResult => {
  const result = openStudyUrlNewTab(path);
  if (!result.attempted) return { opened: false, error: result.error.message };
  return { opened: true };
};

const createBrowserBridge = (): SourceWindowBridge => ({
  platform: 'browser',
  openPath: async (path) => toOpenResult(path),
  openLibrary: async () => toOpenResult(STUDY_LIBRARY_PATH),
  openProvision: async (documentId, sourceKey) =>
    toOpenResult(studyProvisionPath(documentId, sourceKey)),
});

export const createTauriSourceWindowBridge = (
  deps: SourceWindowTauriDeps | Promise<SourceWindowTauriDeps>,
): SourceWindowBridge => {
  const resolve = () => Promise.resolve(deps);
  // Last URL opened per label (this process): same URL reuses + focuses the
  // stable window; a new URL navigates it via close + recreate under the same
  // label (the Tauri WebviewWindow API exposes no in-place navigation).
  const lastUrlByLabel = new Map<string, string>();
  const openTauriPath = async (path: string): Promise<SourceWindowOpenResult> => {
    const label = resolveSourceWindowLabel(path);
    try {
      const api = await resolve();
      const existing = await api.getByLabel(label);
      if (!existing) {
        console.info(`[study][source] window created (${label})`);
        await api.create(label, path);
        lastUrlByLabel.set(label, path);
        return { opened: true };
      }
      if (lastUrlByLabel.get(label) === path) {
        console.info(`[study][source] window reused and focused (${label})`);
        await existing.setFocus();
        return { opened: true };
      }
      console.info(`[study][source] window navigated (${label})`);
      await existing.close();
      await api.create(label, path);
      lastUrlByLabel.set(label, path);
      return { opened: true };
    } catch (error) {
      console.error(`[study][source] window open failed (${label})`, error);
      return {
        opened: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  return {
    platform: 'tauri',
    openPath: openTauriPath,
    openLibrary: () => openTauriPath(STUDY_LIBRARY_PATH),
    openProvision: (documentId, sourceKey) =>
      openTauriPath(studyProvisionPath(documentId, sourceKey)),
  };
};

let cachedSourceTauriBridge: SourceWindowBridge | null = null;
let cachedSourceTauriDeps: SourceWindowTauriDeps | Promise<SourceWindowTauriDeps> | undefined;

/** Platform-neutral entry: browser keeps window.open, Tauri goes native. */
export const resolveSourceWindowBridge = (
  tauriDeps?: SourceWindowTauriDeps | Promise<SourceWindowTauriDeps>,
): SourceWindowBridge => {
  if (resolveStudyStoragePlatform() !== 'tauri') return createBrowserBridge();
  const deps = tauriDeps ?? defaultTauriDeps();
  if (cachedSourceTauriBridge && cachedSourceTauriDeps === deps) {
    return cachedSourceTauriBridge;
  }
  cachedSourceTauriDeps = deps;
  cachedSourceTauriBridge = createTauriSourceWindowBridge(deps);
  return cachedSourceTauriBridge;
};
