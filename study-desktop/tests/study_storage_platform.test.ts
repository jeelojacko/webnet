/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import {
  createBrowserStudyStorage,
  createStudyStorage,
  STUDY_DB_NAME,
  STUDY_DB_VERSION,
} from '../src/studyStorage';
import { resolveStudyStoragePlatform } from '../src/studyStoragePlatform';

// Phase 2B: the platform seam selects the browser adapter and the browser
// factory remains the IndexedDB-backed implementation (DB identity unchanged).
describe('study storage platform boundary', () => {
  it('resolves to the browser platform on standalone/browser hosts', () => {
    expect(resolveStudyStoragePlatform()).toBe('browser');
  });

  it('exposes the browser adapter as the IndexedDB implementation', () => {
    expect(STUDY_DB_NAME).toBe('webnet.study.v1');
    expect(STUDY_DB_VERSION).toBe(10);
    const browser = createBrowserStudyStorage();
    const composed = createStudyStorage();
    for (const storage of [browser, composed]) {
      expect(typeof storage.loadAll).toBe('function');
      expect(typeof storage.replaceAll).toBe('function');
      expect(typeof storage.saveRatedAttempt).toBe('function');
    }
  });

  it('composition routes to the browser adapter (seed fallback without IndexedDB)', async () => {
    const original = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: undefined,
    });
    try {
      const snapshot = await createStudyStorage().loadAll();
      expect(snapshot.schemaVersion).toBe(10);
      expect(snapshot.documents.length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: original });
    }
  });
});
