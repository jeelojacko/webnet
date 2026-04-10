/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectStorage,
  requestPersistentStorage,
} from '../src/engine/projectStorage';

const originalStorage = navigator.storage;
const originalIndexedDb = window.indexedDB;

afterEach(() => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: originalStorage,
  });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: originalIndexedDb,
  });
});

describe('project storage status', () => {
  it('reports OPFS and persistence availability from navigator storage', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => ({})),
        persist: vi.fn(async () => true),
        persisted: vi.fn(async () => true),
      },
    });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {},
    });

    const status = await createProjectStorage().getStatus();

    expect(status.hasOpfs).toBe(true);
    expect(status.hasIndexedDb).toBe(true);
    expect(status.canPersist).toBe(true);
    expect(status.persisted).toBe(true);
    expect(status.preferredBackend).toBe('opfs');
  });

  it('returns no recent projects when indexeddb is unavailable', async () => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: undefined,
    });

    const projects = await createProjectStorage().listProjects();

    expect(projects).toEqual([]);
  });

  it('requests persistent storage when supported', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist,
      },
    });

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
