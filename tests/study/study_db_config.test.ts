/** @vitest-environment jsdom */

// Study — shared DB config and search-opener version regression.
//
// The Study storage layer and the derived-search worker persistence must open
// the SAME IndexedDB name at the SAME version. These tests pin the shared
// config, assert the search opener forwards the shared constants, and regress
// the old drift where search opened `webnet.study.v1` at version 7 while
// storage used 10 (a stale lower open can silently read a mismatched store
// layout and never trigger an upgrade/migration).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDY_DB_NAME as CONFIG_DB_NAME,
  STUDY_DB_VERSION as CONFIG_DB_VERSION,
  STUDY_SCHEMA_VERSION as CONFIG_SCHEMA_VERSION,
} from '../../src/study/studyDbConfig';
import {
  STUDY_DB_NAME,
  STUDY_DB_VERSION,
  STUDY_SCHEMA_VERSION,
} from '../../src/study/studyStorage';
import { openStudySearchDatabase } from '../../src/study/search/studySearchPersistence';

const originalIndexedDb = globalThis.indexedDB;

const installSearchOpenSpy = (databaseVersion: number) => {
  const openCalls: Array<{ name: string; version?: number }> = [];
  const fakeRequest = (resolve: () => IDBDatabase) => {
    const request = {
      result: null as IDBDatabase | null,
      error: null as DOMException | null,
      onsuccess: null as IDBOpenDBRequest['onsuccess'],
      onerror: null as IDBOpenDBRequest['onerror'],
    };
    const openRequest = request as unknown as IDBOpenDBRequest;
    window.setTimeout(() => {
      try {
        request.result = resolve();
        request.onsuccess?.call(openRequest, new Event('success') as never);
      } catch (error) {
        request.error = error as DOMException;
        request.onerror?.call(openRequest, new Event('error') as never);
      }
    }, 0);
    return openRequest;
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: (name: string, version?: number) => {
        openCalls.push({ name, version });
        return fakeRequest(
          () =>
            ({
              version: databaseVersion,
              close: () => undefined,
            }) as unknown as IDBDatabase,
        );
      },
    },
  });
  return openCalls;
};

afterEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: originalIndexedDb,
  });
  vi.restoreAllMocks();
});

describe('shared Study DB config', () => {
  it('pins the single source of truth at v10 and re-exports it from studyStorage', () => {
    expect(CONFIG_DB_NAME).toBe('webnet.study.v1');
    expect(CONFIG_DB_VERSION).toBe(10);
    expect(CONFIG_SCHEMA_VERSION).toBe(10);
    // studyStorage consumers keep working through the re-export.
    expect(STUDY_DB_NAME).toBe(CONFIG_DB_NAME);
    expect(STUDY_DB_VERSION).toBe(CONFIG_DB_VERSION);
    expect(STUDY_SCHEMA_VERSION).toBe(CONFIG_SCHEMA_VERSION);
  });

  it('opens the search database with the SHARED name and version (no private 7)', async () => {
    const openCalls = installSearchOpenSpy(CONFIG_DB_VERSION);
    const db = await openStudySearchDatabase();
    expect(db.version).toBe(10);
    expect(openCalls).toHaveLength(1);
    expect(openCalls[0]?.name).toBe('webnet.study.v1');
    expect(openCalls[0]?.version).toBe(CONFIG_DB_VERSION);
    // Regression guard: the search opener must never request an older open
    // version than the authoritative storage layer (the historical drift).
    expect(openCalls[0]?.version).toBe(STUDY_DB_VERSION);
  });

  it('v10 regression: opening a v10-shaped database triggers no upgrade request from search', async () => {
    const openCalls = installSearchOpenSpy(CONFIG_DB_VERSION);
    const db = await openStudySearchDatabase();
    // A real IDB database already at version 10 opened with version 10 fires
    // no onupgradeneeded; asserting the requested version equals the current
    // database version is the regression signal that a stale (lower) open —
    // the pre-shared-config bug — is impossible.
    expect(db.version).toBe(CONFIG_DB_VERSION);
    expect(openCalls[0]?.version).toBe(db.version);
  });
});
